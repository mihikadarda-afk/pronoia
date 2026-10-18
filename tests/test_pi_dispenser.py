"""The Raspberry Pi dispenser program in --simulate mode, against a fake Supabase and Pronoia server.
Run: python3 -m unittest tests/test_pi_dispenser.py"""
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
calls = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        calls.append((self.path, body))
        if self.path.endswith("/device_event") and body["p_event"]["type"] == "heartbeat":
            out = {"ok": True, "paired": True, "local_date": "2026-10-20", "local_minutes": 8 * 60 + 2,
                   "reminder_after_min": 10, "slots": [{"slot": 1, "times": ["08:00", "20:00"]}, {"slot": 2, "times": ["08:30"]}]}
        elif self.path == "/api/device-clip":
            out = {"status": "taken", "confidence": 93, "reason": "Taken.", "recorded": "taken"}
        else:
            out = {"ok": True}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class PiDispenserTest(unittest.TestCase):
    def test_gives_the_due_dose_and_uploads_the_video(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_address[1]}"
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "config.json"
            cfg.write_text(json.dumps({"api_url": url, "supabase_url": url, "supabase_anon_key": "anon",
                                       "device_code": "PRN-TEST-01", "device_secret": "sekret"}))
            video = Path(d) / "dose.mp4"
            video.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"x" * 1000)
            run = subprocess.run([sys.executable, str(ROOT / "device/raspberry-pi/pronoia_dispenser.py"), "--config", str(cfg),
                                  "--simulate", "--once", "--sample-video", str(video)], capture_output=True, text=True, timeout=60)
        server.shutdown()
        self.assertEqual(run.returncode, 0, run.stderr)
        events = [b["p_event"]["type"] for p, b in calls if p.endswith("/device_event")]
        self.assertEqual(events, ["heartbeat", "dispensed", "picked_up"])
        dispensed = next(b["p_event"] for p, b in calls if p.endswith("/device_event") and b["p_event"]["type"] == "dispensed")
        self.assertEqual((dispensed["slot"], dispensed["time"]), (1, "08:00"))  # 8:02 now: the 8:00 dose, not 8:30
        clip = next(b for p, b in calls if p == "/api/device-clip")
        self.assertEqual((clip["code"], clip["secret"], clip["slot"], clip["time"]), ("PRN-TEST-01", "sekret", 1, "08:00"))
        self.assertTrue(clip["video"].startswith("data:video/mp4;base64,"))
        self.assertIn("AI check", run.stderr)


if __name__ == "__main__":
    unittest.main()
