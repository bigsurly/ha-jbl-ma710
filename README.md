# JBL MA710 AVR — Home Assistant Integration

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/release/YOUR_USERNAME/ha-jbl-ma710.svg)](https://github.com/YOUR_USERNAME/ha-jbl-ma710/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A full-featured Home Assistant integration for the **JBL MA710** (and MA510 / MA7100HP / MA9100HP) A/V receiver, with a custom Lovelace remote control card.

Communicates directly over TCP/IP using JBL's native IP Control protocol on port 50000 — no cloud, no polling lag, real-time push updates.

---

## Features

| Feature | Details |
|---|---|
| Power on/off | Instant, reflects standby correctly |
| Volume | Set, step up/down, drag knob, click slider |
| Mute | Toggle with live state |
| Input source | All 14 inputs (TV ARC, HDMI 1–6, Coax, Optical, Analog 1/2, Phono, Bluetooth, Network) |
| Surround mode | Native, Stereo 2.0/2.1, All Stereo, Dolby Surround, DTS Neural:X |
| Bass / Treble EQ | ±12 dB, draggable sliders |
| Streaming status | Shows service (Spotify, AirPlay, Tidal, Roon, etc.) and play/pause state |
| Real-time updates | AVR pushes state changes instantly — front panel, remote, and app all reflect immediately |

---

## Screenshots

> The custom Lovelace card — fully interactive remote control panel.

*(Add a screenshot here once installed)*

---

## Installation

### Via HACS (recommended)

1. In Home Assistant, open **HACS**
2. Click ⋮ (three dots) → **Custom Repositories**
3. Add URL: `https://github.com/YOUR_USERNAME/ha-jbl-ma710`
4. Category: **Integration**
5. Click **Add**, then find **JBL MA710 AVR** and click **Download**
6. Restart Home Assistant

### Manual

1. Copy `custom_components/jbl_ma710/` into your HA `/config/custom_components/` directory
2. Restart Home Assistant

---

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **JBL MA710**
3. Enter the AVR's **IP address** (port defaults to `50000`)
4. Click Submit

> **Tip:** Set a static IP or DHCP reservation for the AVR so the address never changes.

---

## Lovelace Card

The custom remote control card is included in `www/jbl-ma710-card.js`.

### Install the card

1. Copy `www/jbl-ma710-card.js` to `/config/www/community/jbl-ma710-card/jbl-ma710-card.js`
2. In HA → **Settings → Dashboards → Resources** → Add:
   - URL: `/local/community/jbl-ma710-card/jbl-ma710-card.js`
   - Type: **JavaScript Module**
3. Hard-refresh your browser (Ctrl+Shift+R)

### Add to dashboard

```yaml
type: custom:jbl-ma710-card
entity: media_player.jbl_ma710
```

---

## Green Mode Warning

The JBL MA710's IP control port is **disabled** when the unit is in **Green (eco) standby**. To allow HA to see and control the AVR:

- Disable Green mode on the AVR (use standard standby instead), **or**
- Keep the AVR connected to the network and let the integration's 30-second heartbeat poll prevent it from going green

---

## Services

In addition to the standard `media_player` services, this integration registers:

| Service | Field | Description |
|---|---|---|
| `jbl_ma710.set_bass` | `bass` (-12 to +12) | Set bass EQ in dB |
| `jbl_ma710.set_treble` | `treble` (-12 to +12) | Set treble EQ in dB |

### Example automation

```yaml
automation:
  - alias: "Movie night — AVR on HDMI 1 with Dolby"
    trigger:
      - platform: state
        entity_id: media_player.your_tv
        to: "on"
    action:
      - service: media_player.turn_on
        target:
          entity_id: media_player.jbl_ma710
      - delay: "00:00:02"
      - service: media_player.select_source
        target:
          entity_id: media_player.jbl_ma710
        data:
          source: "HDMI 1"
      - service: media_player.select_sound_mode
        target:
          entity_id: media_player.jbl_ma710
        data:
          sound_mode: "Dolby Surround"
```

---

## Supported Models

| Model | Status |
|---|---|
| MA710 | ✅ Primary target |
| MA510 | ✅ Should work (limited sources/modes) |
| MA7100HP | ✅ Should work |
| MA9100HP | ✅ Should work |

---

## How It Works

Uses JBL/Harman's native **IP Control protocol v1.7** over TCP port 50000.

- A **persistent TCP connection** is maintained with a background reader task
- **Unsolicited push frames** from the AVR (front panel, remote) trigger instant HA state updates via `coordinator.async_set_updated_data()`
- A **30-second poll** acts as a safety net and reconnects after standby
- When the AVR powers off, it drops the TCP connection — the background reader detects this and immediately sets `power = False`

---

## License

MIT — see [LICENSE](LICENSE)
