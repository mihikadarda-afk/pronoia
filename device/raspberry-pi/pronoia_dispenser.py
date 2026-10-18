#!/usr/bin/env python3
"""Pronoia dispenser on a Raspberry Pi with a Raspberry Pi Camera.

At each dose time it drops the pill into the cup, waits for it to be lifted, films a
12-second video with the Pi Camera and uploads it to the Pronoia server
(POST {api_url}/api/device-clip), which runs the AI check and tells the family.
Two buttons on the dispenser: I'm okay (a check-in) and I need help.

Hardware hooks are in the Hardware class: fill them in for your servo/motor, load cell
and buzzer. Everything else (schedule, timing, uploads, retries) is done here.

  python3 pronoia_dispenser.py --config config.json            # on the Pi
  python3 pronoia_dispenser.py --config config.json --simulate # anywhere: no GPIO, no camera
"""
from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("pronoia")

RECORD_SECONDS = 12
GIVE_UP_MINUTES = 90  # stop waiting for the lift; the server marks the dose missed
LIFT_GRAMS = 0.15  # a pill weighs about 0.2-0.6 g; the cup's load cell sees it leave
HEARTBEAT_SECONDS = 60


@dataclass
class Config:
    api_url: str  # where the Pronoia app is hosted, e.g. https://your-site.vercel.app
    supabase_url: str
    supabase_anon_key: str
    device_code: str
    device_secret: str
    video_width: int = 640
    video_height: int = 480
    video_bitrate: int = 800_000
    button_ok_pin: int = 17
    button_help_pin: int = 27
    buzzer_pin: int = 22
    slot_pins: list[int] = field(default_factory=lambda: [5, 6, 13, 19, 26])

    @staticmethod
    def load(path: str) -> "Config":
        data = json.loads(Path(path).read_text())
        return Config(**data)


# ---------------------------------------------------------------------------
# Hardware. Replace the bodies marked HARDWARE with your own drivers.
# ---------------------------------------------------------------------------


class Hardware:
    def __init__(self, cfg: Config, simulate: bool, sample_video: str | None):
        self.cfg = cfg
        self.simulate = simulate
        self.sample_video = sample_video
        self.cup_grams = 0.0
        self.on_ok = lambda: None
        self.on_help = lambda: None
        if simulate:
            return
        from gpiozero import Button, Buzzer  # preinstalled on Raspberry Pi OS

        self.buzzer = Buzzer(cfg.buzzer_pin)
        self.ok_button = Button(cfg.button_ok_pin, bounce_time=0.1)
        self.help_button = Button(cfg.button_help_pin, hold_time=2)  # hold 2 s, so it isn't pressed by accident
        self.ok_button.when_pressed = lambda: self.on_ok()
        self.help_button.when_held = lambda: self.on_help()
        # HARDWARE: set up your slot motors (servos via a PCA9685, steppers...) and the cup's load cell
        # (an HX711 board, e.g. `pip install hx711`), and tare it here.

    def dispense(self, slot: int) -> bool:
        """Drop one pill from `slot` (1-5) into the cup. Returns False if the slot seems stuck."""
        if self.simulate:
            self.cup_grams = 0.4
            return True
        # HARDWARE: turn the slot's motor one step; check the cup gained weight.
        log.info("dispense slot %s (fill in Hardware.dispense)", slot)
        return True

    def cup_weight(self) -> float:
        """Grams on the cup's load cell."""
        if self.simulate:
            return self.cup_grams
        # HARDWARE: read the HX711.
        return 0.0

    def pills_left(self, slot: int) -> int | None:
        """Pills left in a slot, from its load cell, or None if there's no sensor."""
        return None

    def reminder(self, on: bool):
        if self.simulate:
            log.info("reminder %s", "on" if on else "off")
            return
        if on:
            self.buzzer.beep(on_time=0.2, off_time=2.8)
        else:
            self.buzzer.off()

    def record_video(self) -> tuple[bytes, str]:
        """Film RECORD_SECONDS with the Pi Camera. Returns (bytes, mime type)."""
        if self.simulate:
            if self.sample_video:
                path = Path(self.sample_video)
                return path.read_bytes(), "video/webm" if path.suffix == ".webm" else "video/mp4"
            return b"\x00\x00\x00\x18ftypmp42" + os.urandom(64), "video/mp4"
        from picamera2 import Picamera2
        from picamera2.encoders import H264Encoder
        from picamera2.outputs import FfmpegOutput

        out = Path(tempfile.mkdtemp()) / "dose.mp4"
        cam = Picamera2()
        try:
            cam.configure(cam.create_video_configuration(main={"size": (self.cfg.video_width, self.cfg.video_height)}))
            cam.start_recording(H264Encoder(bitrate=self.cfg.video_bitrate), FfmpegOutput(str(out)))
            time.sleep(RECORD_SECONDS)
            cam.stop_recording()
        finally:
            cam.close()
        data = out.read_bytes()
        out.unlink(missing_ok=True)
        return data, "video/mp4"


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------


class Server:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.queue: list[dict] = []  # events to retry when the network is back

    def _post(self, url: str, body: dict, headers: dict | None = None, timeout: int = 20):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = res.read().decode() or "null"
            return json.loads(text)

    def rpc(self, fn: str, args: dict, timeout: int = 20):
        key = self.cfg.supabase_anon_key
        # Newer keys (sb_publishable_...) go in apikey only; older JWT anon keys also in Authorization.
        headers = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}
        return self._post(f"{self.cfg.supabase_url}/rest/v1/rpc/{fn}", args, headers, timeout)

    def event(self, event: dict):
        """device_event, queued for later if the network is down."""
        try:
            return self.rpc("device_event", {"p_code": self.cfg.device_code, "p_secret": self.cfg.device_secret, "p_event": event})
        except urllib.error.HTTPError as e:
            log.warning("event %s rejected: %s %s", event.get("type"), e.code, e.read()[:200])
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning("offline (%s); will retry %s", e, event.get("type"))
            if len(self.queue) < 50:
                self.queue.append(event)
        return None

    def flush(self):
        while self.queue:
            event = self.queue[0]
            try:
                self.rpc("device_event", {"p_code": self.cfg.device_code, "p_secret": self.cfg.device_secret, "p_event": event})
            except urllib.error.HTTPError:
                pass  # rejected: retrying won't help
            except (urllib.error.URLError, TimeoutError):
                return
            self.queue.pop(0)

    def button(self, kind: str):
        try:
            self.rpc("device_button", {"p_code": self.cfg.device_code, "p_secret": self.cfg.device_secret, "p_kind": kind})
            return True
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning("button %s not sent: %s", kind, e)
            return False

    def upload_clip(self, slot: int, hhmm: str, video: bytes, mime: str):
        body = {
            "code": self.cfg.device_code, "secret": self.cfg.device_secret, "slot": slot, "time": hhmm,
            "video": f"data:{mime};base64,{base64.b64encode(video).decode()}",
        }
        for attempt in range(3):
            try:
                return self._post(f"{self.cfg.api_url.rstrip('/')}/api/device-clip", body, timeout=90)
            except urllib.error.HTTPError as e:
                log.warning("clip rejected: %s %s", e.code, e.read()[:300])
                if e.code < 500:
                    return None
            except (urllib.error.URLError, TimeoutError) as e:
                log.warning("clip upload failed (%s), try %s", e, attempt + 1)
            time.sleep(10 * (attempt + 1))
        return None


# ---------------------------------------------------------------------------
# The dispenser
# ---------------------------------------------------------------------------


def hhmm(minutes: int) -> str:
    return f"{minutes // 60 % 24:02d}:{minutes % 60:02d}"


class Dispenser:
    def __init__(self, cfg: Config, hw: Hardware, server: Server):
        self.cfg, self.hw, self.server = cfg, hw, server
        self.schedule: list[tuple[int, int]] = []  # (slot, minutes after midnight), parent's local time
        self.local_minutes = 0
        self.local_date = ""
        self.synced_at = time.monotonic()
        self.reminder_after = 10
        self.done: set[str] = set()  # "date slot time" given today
        hw.on_ok = lambda: threading.Thread(target=self.server.button, args=("ok",), daemon=True).start()
        hw.on_help = lambda: threading.Thread(target=self.server.button, args=("help",), daemon=True).start()

    def now_minutes(self) -> int:
        return (self.local_minutes + int((time.monotonic() - self.synced_at) // 60)) % (24 * 60)

    def heartbeat(self):
        reply = self.server.event({"type": "heartbeat", "camera": "ready", "firmware": "pi-0.1.0"})
        if not reply:
            return
        if not reply.get("paired"):
            log.info("Not paired yet. In Pronoia: Settings → Dispenser, and enter %s", self.cfg.device_code)
            return
        self.server.flush()
        self.local_minutes = int(reply["local_minutes"])
        self.synced_at = time.monotonic()
        if reply["local_date"] != self.local_date:
            self.local_date = reply["local_date"]
            self.done = {d for d in self.done if d.startswith(self.local_date)}
        self.reminder_after = int(reply.get("reminder_after_min") or 10)
        self.schedule = []
        for s in reply.get("slots", []):
            for t in s.get("times", []):
                h, m = t.split(":")
                self.schedule.append((int(s["slot"]), int(h) * 60 + int(m)))

    def due(self) -> tuple[int, int] | None:
        now = self.now_minutes()
        for slot, minutes in sorted(self.schedule, key=lambda x: x[1]):
            key = f"{self.local_date} {slot} {minutes}"
            if key not in self.done and 0 <= now - minutes < 30:
                return slot, minutes
        return None

    def give_dose(self, slot: int, minutes: int):
        key = f"{self.local_date} {slot} {minutes}"
        self.done.add(key)
        log.info("dose: slot %s at %s", slot, hhmm(minutes))
        if not self.hw.dispense(slot):
            self.server.event({"type": "slot_status", "slot": slot, "stuck": True})
            return
        self.server.event({"type": "dispensed", "slot": slot, "time": hhmm(minutes)})
        full = self.hw.cup_weight()
        started = time.monotonic()
        reminding = False
        while True:
            if full - self.hw.cup_weight() >= LIFT_GRAMS or (self.hw.simulate and time.monotonic() - started > 3):
                break
            waited = (time.monotonic() - started) / 60
            if not reminding and waited >= self.reminder_after:
                self.hw.reminder(True)
                reminding = True
            if waited >= GIVE_UP_MINUTES:
                self.hw.reminder(False)
                log.info("not lifted; the server will mark it missed")
                return
            time.sleep(0.5)
        self.hw.reminder(False)
        self.server.event({"type": "picked_up", "slot": slot, "time": hhmm(minutes)})
        video, mime = self.hw.record_video()
        log.info("filmed %s KB, uploading", len(video) // 1024)
        result = self.server.upload_clip(slot, hhmm(minutes), video, mime)
        log.info("AI check: %s", result)
        left = self.hw.pills_left(slot)
        if left is not None:
            self.server.event({"type": "slot_status", "slot": slot, "pills_left": left})

    def run(self, once: bool = False):
        last_beat = 0.0
        while True:
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS or last_beat == 0:
                self.heartbeat()
                last_beat = time.monotonic()
            dose = self.due()
            if dose:
                self.give_dose(*dose)
            if once:
                return
            time.sleep(5)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--simulate", action="store_true", help="no GPIO or camera: pretend the pill is lifted and send a sample video")
    ap.add_argument("--sample-video", help="with --simulate: a video file to upload instead of filming")
    ap.add_argument("--once", action="store_true", help="one heartbeat and at most one dose, then exit")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    cfg = Config.load(args.config)
    Dispenser(cfg, Hardware(cfg, args.simulate, args.sample_video), Server(cfg)).run(once=args.once)


if __name__ == "__main__":
    main()
