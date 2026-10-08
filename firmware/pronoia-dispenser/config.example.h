// Copy to config.h (which git ignores) and fill in.
#pragma once

#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-wifi-password"

// From your Supabase project: Settings → API. The anon/publishable key is safe on the device;
// the device can only call device_event with its own code and secret.
#define SUPABASE_URL "https://your-project.supabase.co"
#define SUPABASE_ANON_KEY "your-anon-key"

// From scripts/provision-device.mjs. The code is printed on the label; the secret stays here.
#define DEVICE_CODE "PRN-XXXX-XX"
#define DEVICE_SECRET "paste-the-secret"

#define FIRMWARE_VERSION "0.1.0"
