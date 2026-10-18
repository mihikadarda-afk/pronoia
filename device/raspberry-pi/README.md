# Pronoia dispenser on a Raspberry Pi

A Raspberry Pi (any with a camera connector: Pi 4, Pi 5, Zero 2 W) with a Raspberry Pi Camera runs the Device plan's dispenser:

1. Every minute it reports in and gets the schedule, in the parent's local time.
2. At dose time it drops the pill into the cup (`dispensed`).
3. When the cup's load cell feels the pill lifted (`picked_up`), the Pi Camera films **12 seconds** of video.
4. The video is uploaded to the Pronoia server (`/api/device-clip`), which runs the Gemini check and notifies the family.
5. Two buttons: **I'm okay** (a check-in) and **I need help** (hold for 2 seconds).

## Set up

On Raspberry Pi OS (Bookworm or later):

```bash
sudo apt install -y python3-picamera2 ffmpeg git
git clone https://github.com/mihikadarda-afk/pronoia ~/pronoia
cd ~/pronoia/device/raspberry-pi
cp config.example.json config.json   # then fill it in
rpicam-hello -t 2000                 # check the camera works
python3 pronoia_dispenser.py --config config.json
```

To start it on boot: `sudo cp pronoia-dispenser.service /etc/systemd/system/ && sudo systemctl enable --now pronoia-dispenser`.

**config.json**

| Key | What |
| --- | --- |
| `api_url` | Where Pronoia is hosted, e.g. your Vercel URL. Clips are uploaded here |
| `supabase_url`, `supabase_anon_key` | From your Supabase project (Settings → API). The anon key is safe on the device: it can only act with this dispenser's code and secret |
| `device_code`, `device_secret` | From `node scripts/provision-device.mjs`. The code goes on the label; the caregiver types it in **Settings → Dispenser** |
| `button_ok_pin`, `button_help_pin`, `buzzer_pin` | GPIO (BCM) numbers. Buttons go between the pin and ground |

## Fill in the hardware

`pronoia_dispenser.py` has a `Hardware` class. The camera, buttons and buzzer work as they are. Two parts depend on how you build it:

- **`dispense(slot)`**: turn the slot's motor once. For servos, a PCA9685 board with `adafruit-circuitpython-servokit` is the easy way.
- **`cup_weight()`** (and optionally `pills_left(slot)`): read the load cell under the cup, e.g. an HX711 with `pip install hx711`. Until it's wired up, the pill is never seen being lifted and the dose times out; for a quick test, return a lower weight after a few seconds.

## Try it without the hardware

```bash
python3 pronoia_dispenser.py --config config.json --simulate --once --sample-video some-video.mp4
```

It reports in, gives any dose due in the last 30 minutes, pretends the pill was lifted, and uploads the sample video instead of filming.
