// Pronoia dispenser firmware (ESP32, Arduino core).
//
// What it does:
//   - Every 30 s: heartbeat to the server, which answers with the schedule and the
//     parent's local time. The clock keeps running offline from the last sync.
//   - At each dose time: drop the pill, report "dispensed", then watch the cup's
//     weight. Beep and light up if it isn't lifted after the reminder delay.
//   - When the pill is lifted: report "picked_up", record a short clip, report the
//     swallow check's confidence.
//   - Events that can't be sent (WiFi down) wait in a queue and go out later.
//
// Hardware hooks are marked HARDWARE: fill them in for your motor, load cell,
// buzzer/LED and camera. Libraries: ArduinoJson 7.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

const int SLOTS = 5;
const uint32_t HEARTBEAT_MS = 30 * 1000;
const float LIFT_GRAMS = 0.15f;              // weight drop that counts as "picked up"
const uint32_t GIVE_UP_MS = 2UL * 60 * 60 * 1000;  // stop watching an untouched cup after 2 h

// ---------------------------------------------------------------------------
// HARDWARE: replace these with your own drivers.
// ---------------------------------------------------------------------------

void hwSetup() {
  // pinMode(BUZZER_PIN, OUTPUT); servo/stepper init; HX711 begin + tare; camera init.
}

// Turn slot `slot` (1..5) one step so one pill drops into the cup.
// Return false if the motor stalled (jam).
bool hwDispense(int slot) {
  Serial.printf("[hw] dispense slot %d\n", slot);
  return true;
}

// Grams currently in the cup (load cell under the cup).
float hwCupGrams() {
  return 0.0f;
}

// Pills left in a slot, estimated from the slot's load cell. Return -1 if unknown.
int hwPillsLeft(int slot) {
  return -1;
}

void hwReminder(bool on) {
  // Beep + light the cup's LED ring while on.
  Serial.printf("[hw] reminder %s\n", on ? "on" : "off");
}

// Record a short clip after the lift and return the swallow-check confidence (0..1),
// or -1 if there is no camera. Send the clip to your vision service here.
float hwSwallowCheck(int *clipSeconds) {
  *clipSeconds = 0;
  return -1.0f;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

struct Slot {
  int slot = 0;
  int times[6];  // minutes after midnight, parent's local time
  int count = 0;
};
Slot schedule[SLOTS];
int scheduleCount = 0;
bool paired = false;
int reminderAfterMin = 10;

// Parent's local clock: minutes after midnight at `syncMillis`.
int syncMinutes = -1;
uint32_t syncMillis = 0;
String syncDate = "";

String queue[20];  // events waiting to be sent
int queued = 0;

int localMinutes() {
  if (syncMinutes < 0) return -1;
  return (syncMinutes + (millis() - syncMillis) / 60000) % (24 * 60);
}

String hhmm(int minutes) {
  char buf[6];
  snprintf(buf, sizeof buf, "%02d:%02d", minutes / 60, minutes % 60);
  return String(buf);
}

// POST /rest/v1/rpc/device_event. Returns the HTTP status (or <0 on network error).
int post(const String &event, JsonDocument *reply = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure tls;
  tls.setInsecure();  // TODO for production: pin the Supabase root certificate.
  HTTPClient http;
  http.begin(tls, String(SUPABASE_URL) + "/rest/v1/rpc/device_event");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  String body = String("{\"p_code\":\"") + DEVICE_CODE + "\",\"p_secret\":\"" + DEVICE_SECRET + "\",\"p_event\":" + event + "}";
  int status = http.POST(body);
  if (status == 200 && reply) deserializeJson(*reply, http.getString());
  else if (status != 200) Serial.printf("[net] %d %s\n", status, http.getString().c_str());
  http.end();
  return status;
}

// Send now, or keep it for later if the network is down.
void send(const String &event) {
  int status = post(event);
  if (status == 200) return;
  if (status >= 400 && status < 500) return;  // rejected: retrying won't help
  if (queued < 20) queue[queued++] = event;
}

void flushQueue() {
  while (queued > 0) {
    int status = post(queue[0]);
    if (status < 0 || status >= 500) return;
    for (int i = 1; i < queued; i++) queue[i - 1] = queue[i];
    queued--;
  }
}

String doseEvent(const char *type, int slot, int minutes) {
  return String("{\"type\":\"") + type + "\",\"slot\":" + slot + ",\"time\":\"" + hhmm(minutes) + "\"}";
}

void heartbeat() {
  JsonDocument doc;
  String hb = String("{\"type\":\"heartbeat\",\"wifi_dbm\":") + WiFi.RSSI() +
              ",\"camera\":\"ready\",\"firmware\":\"" + FIRMWARE_VERSION + "\"}";
  if (post(hb, &doc) != 200) return;
  paired = doc["paired"] | false;
  if (!paired) {
    Serial.printf("Not paired yet. Enter %s in the Pronoia app.\n", DEVICE_CODE);
    return;
  }
  syncMinutes = doc["local_minutes"] | -1;
  syncMillis = millis();
  syncDate = doc["local_date"] | "";
  reminderAfterMin = doc["reminder_after_min"] | 10;
  scheduleCount = 0;
  for (JsonObject s : doc["slots"].as<JsonArray>()) {
    if (scheduleCount >= SLOTS) break;
    Slot &slot = schedule[scheduleCount++];
    slot.slot = s["slot"];
    slot.count = 0;
    for (const char *t : s["times"].as<JsonArray>()) {
      if (slot.count < 6) slot.times[slot.count++] = atoi(t) * 60 + atoi(t + 3);
    }
  }
  flushQueue();
}

// ---------------------------------------------------------------------------
// One dose at a time: drop, wait for the lift, check the swallow.
// ---------------------------------------------------------------------------

enum Phase { IDLE, IN_CUP };
Phase phase = IDLE;
int doseSlot = 0, doseMinutes = 0;
uint32_t droppedAt = 0;
float emptyCupGrams = 0, fullCupGrams = 0;
bool reminding = false;
String givenToday[12];  // "slot@minutes" handled today
int givenCount = 0;
String givenDate = "";

bool alreadyGiven(int slot, int minutes) {
  if (givenDate != syncDate) {
    givenDate = syncDate;
    givenCount = 0;
  }
  String key = String(slot) + "@" + minutes;
  for (int i = 0; i < givenCount; i++)
    if (givenToday[i] == key) return true;
  if (givenCount < 12) givenToday[givenCount++] = key;
  return false;
}

void startDose(int slot, int minutes) {
  emptyCupGrams = hwCupGrams();
  if (!hwDispense(slot)) {
    send(String("{\"type\":\"slot_status\",\"slot\":") + slot + ",\"stuck\":true}");
    return;
  }
  delay(1500);
  fullCupGrams = hwCupGrams();
  doseSlot = slot;
  doseMinutes = minutes;
  droppedAt = millis();
  phase = IN_CUP;
  send(doseEvent("dispensed", slot, minutes));
  int left = hwPillsLeft(slot);
  if (left >= 0) send(String("{\"type\":\"slot_status\",\"slot\":") + slot + ",\"pills_left\":" + left + "}");
}

void watchCup() {
  uint32_t waited = millis() - droppedAt;
  bool lifted = fullCupGrams - hwCupGrams() >= LIFT_GRAMS || hwCupGrams() <= emptyCupGrams + 0.05f;
  if (lifted) {
    hwReminder(false);
    reminding = false;
    send(doseEvent("picked_up", doseSlot, doseMinutes));
    int clipSeconds = 0;
    float confidence = hwSwallowCheck(&clipSeconds);
    if (confidence >= 0) {
      String e = String("{\"type\":\"swallow\",\"slot\":") + doseSlot + ",\"time\":\"" + hhmm(doseMinutes) +
                 "\",\"confidence\":" + String(confidence, 2) + ",\"clip_seconds\":" + clipSeconds + "}";
      send(e);
    }
    phase = IDLE;
  } else if (!reminding && waited > (uint32_t)reminderAfterMin * 60000) {
    hwReminder(true);
    reminding = true;
  } else if (waited > GIVE_UP_MS) {
    // The server marks it missed; stop beeping and wait for the next dose.
    hwReminder(false);
    reminding = false;
    phase = IDLE;
  }
}

// ---------------------------------------------------------------------------

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
}

void setup() {
  Serial.begin(115200);
  hwSetup();
  WiFi.mode(WIFI_STA);
  connectWifi();
  heartbeat();
}

uint32_t lastBeat = 0;

void loop() {
  if (millis() - lastBeat > HEARTBEAT_MS) {
    lastBeat = millis();
    connectWifi();
    heartbeat();
  }
  int now = localMinutes();
  if (phase == IN_CUP) {
    watchCup();
  } else if (paired && now >= 0) {
    for (int i = 0; i < scheduleCount; i++) {
      for (int j = 0; j < schedule[i].count; j++) {
        // Up to 10 minutes late is still fine (e.g. two slots due at the same minute).
        int t = schedule[i].times[j];
        int late = now - t;
        if (late >= 0 && late < 10 && !alreadyGiven(schedule[i].slot, t)) {
          startDose(schedule[i].slot, t);
          return;
        }
      }
    }
  }
  delay(200);
}
