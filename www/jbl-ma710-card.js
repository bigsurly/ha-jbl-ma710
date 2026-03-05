/**
 * JBL MA710 Remote Control — Home Assistant Lovelace Custom Card
 *
 * Installation:
 *   1. Copy this file to /config/www/community/jbl-ma710-card/jbl-ma710-card.js
 *   2. In HA → Settings → Dashboards → Resources → Add:
 *        URL:  /local/community/jbl-ma710-card/jbl-ma710-card.js
 *        Type: JavaScript Module
 *   3. Add card to dashboard:
 *        type: custom:jbl-ma710-card
 *        entity: media_player.jbl_ma710
 */

const SOURCES = [
  "TV (ARC)", "HDMI 1", "HDMI 2", "HDMI 3", "HDMI 4",
  "HDMI 5", "HDMI 6", "Coax", "Optical",
  "Analog 1", "Analog 2", "Phono", "Bluetooth", "Network"
];
const SURROUND_MODES = [
  "Native", "Stereo 2.0", "Stereo 2.1", "All Stereo",
  "Dolby Surround", "DTS Neural:X"
];
const SOURCE_ICONS = {
  "TV (ARC)":  "mdi:television",   "HDMI 1": "mdi:hdmi-port",
  "HDMI 2":    "mdi:hdmi-port",    "HDMI 3": "mdi:hdmi-port",
  "HDMI 4":    "mdi:hdmi-port",    "HDMI 5": "mdi:hdmi-port",
  "HDMI 6":    "mdi:hdmi-port",    "Coax":   "mdi:cable-data",
  "Optical":   "mdi:fiber-manual-record",
  "Analog 1":  "mdi:audio-input-rca", "Analog 2": "mdi:audio-input-rca",
  "Phono":     "mdi:record-player",   "Bluetooth": "mdi:bluetooth",
  "Network":   "mdi:web",
};
const STREAM_ICONS = {
  "Spotify":          "mdi:spotify",
  "AirPlay":          "mdi:airplay",
  "Google Cast":      "mdi:cast",
  "Tidal":            "mdi:music",
  "Roon":             "mdi:roon",
  "Amazon Music":     "mdi:music-box",
  "Bluetooth":        "mdi:bluetooth",
  "TuneIn":           "mdi:radio",
  "Airable Radio":    "mdi:radio",
  "Airable Podcasts": "mdi:podcast",
  "Deezer":           "mdi:music-circle",
  "Qobuz":            "mdi:music-note",
  "Napster":          "mdi:music",
  "Pandora":          "mdi:pandora",
  "UPnP":             "mdi:dlna",
  "USB":              "mdi:usb",
};

const ARC_R    = 44;
const ARC_CIRC = 2 * Math.PI * ARC_R * (270 / 360);

class JblMa710Card extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._volDragging = false;
    this._volStartY = 0;
    this._volStartVal = 0;
    this._volPending = undefined;
    this._rendered = false;
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Please define entity");
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) { this._render(); this._rendered = true; }
    else this._update();
  }

  getCardSize() { return 7; }

  get _stateObj()  { return this._hass?.states[this._config.entity]; }
  get _isOn()      { return this._stateObj?.state === "on"; }
  get _isMuted()   { return this._stateObj?.attributes?.is_volume_muted === true; }
  get _volume()    { return Math.round((this._stateObj?.attributes?.volume_level ?? 0) * 99); }
  get _source()    { return this._stateObj?.attributes?.source ?? "—"; }
  get _mode()      { return this._stateObj?.attributes?.sound_mode ?? "—"; }
  get _bass()      { return this._stateObj?.attributes?.bass ?? 0; }
  get _treble()    { return this._stateObj?.attributes?.treble ?? 0; }
  get _streamSvc() { return this._stateObj?.attributes?.stream_service ?? null; }
  get _streamSt()  { return this._stateObj?.attributes?.stream_state ?? null; }

  _call(service, data = {}) {
    this._hass.callService("media_player", service, {
      entity_id: this._config.entity, ...data,
    });
  }
  _callCustom(service, data = {}) {
    this._hass.callService("jbl_ma710", service, {
      entity_id: this._config.entity, ...data,
    });
  }

  _render() {
    this.shadowRoot.innerHTML = `<style>${this._css()}</style><div class="card" id="card">${this._html()}</div>`;
    this._bind();
    this._update();
  }

  _css() { return `
    @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host {
      display: block;
      --c-bg:      #0e0f11; --c-surface: #161719; --c-raised: #1e2024;
      --c-border:  #2a2d32; --c-accent:  #e8a020; --c-red:    #e05050;
      --c-dim:     #3a3d44; --c-text:    #d8dce4; --c-sub:    #5a5f6b;
      --c-on:      #4fc97a;
      --font-ui:   'Rajdhani', sans-serif;
      --font-mono: 'Share Tech Mono', monospace;
    }
    .card {
      background: var(--c-bg); border: 1px solid var(--c-border);
      border-radius: 18px; overflow: hidden; font-family: var(--font-ui);
      color: var(--c-text); user-select: none;
      box-shadow: 0 0 0 1px #ffffff06 inset, 0 12px 48px #00000090;
    }

    /* HEADER */
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px 12px;
      background: linear-gradient(180deg, #1b1d21 0%, var(--c-bg) 100%);
      border-bottom: 1px solid var(--c-border);
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-logo {
      width: 36px; height: 36px; border-radius: 8px; background: var(--c-accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: #000; letter-spacing: -.5px;
      box-shadow: 0 0 16px #e8a02050;
    }
    .brand-name  { font-size: 18px; font-weight: 700; letter-spacing: 1px; line-height: 1; }
    .brand-model { font-size: 10px; color: var(--c-sub); letter-spacing: 2.5px; text-transform: uppercase; margin-top: 2px; }
    .status-pill {
      display: flex; align-items: center; gap: 6px; padding: 5px 13px;
      border-radius: 20px; border: 1px solid var(--c-border); background: var(--c-surface);
      font-family: var(--font-mono); font-size: 11px; letter-spacing: 1px; transition: all .3s;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c-dim); transition: all .3s; }
    .card.is-on .status-dot  { background: var(--c-on); box-shadow: 0 0 6px var(--c-on); }
    .card.is-on .status-pill { border-color: #4fc97a28; }
    .status-label { color: var(--c-sub); transition: color .3s; }
    .card.is-on .status-label { color: var(--c-on); }

    /* VOLUME ZONE */
    .vol-zone {
      padding: 24px 24px 20px;
      background: linear-gradient(180deg, #131517 0%, var(--c-bg) 100%);
      border-bottom: 1px solid var(--c-border);
    }
    .vol-zone-label {
      font-size: 10px; letter-spacing: 3px; text-transform: uppercase;
      color: var(--c-sub); text-align: center; margin-bottom: 20px;
    }
    .vol-main { display: grid; grid-template-columns: 76px 1fr 76px; align-items: center; gap: 12px; }
    .vol-step-btn {
      width: 64px; height: 64px; border-radius: 14px;
      border: 1px solid var(--c-border); background: var(--c-surface);
      cursor: pointer; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 2px;
      transition: all .15s; position: relative; overflow: hidden;
    }
    .vol-step-btn::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(circle at 50% 0%, #ffffff0a, transparent 60%);
    }
    .vol-step-btn .step-icon  { font-size: 26px; font-weight: 300; line-height: 1; color: var(--c-sub); transition: color .15s; font-family: var(--font-ui); }
    .vol-step-btn .step-label { font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--c-dim); transition: color .15s; }
    .vol-step-btn:hover { border-color: var(--c-accent); background: var(--c-raised); transform: scale(1.04); box-shadow: 0 0 16px #e8a02030; }
    .vol-step-btn:hover .step-icon  { color: var(--c-accent); }
    .vol-step-btn:hover .step-label { color: var(--c-accent); }
    .vol-step-btn:active { transform: scale(0.96); }
    .card:not(.is-on) .vol-step-btn { opacity: .3; pointer-events: none; }
    .vol-knob-wrap { position: relative; width: 160px; height: 160px; margin: 0 auto; }
    .vol-knob-svg  { width: 100%; height: 100%; transform: rotate(-135deg); filter: drop-shadow(0 0 12px #00000090); }
    .vol-track { fill: none; stroke: #1e2126; stroke-width: 8; stroke-linecap: round; }
    .vol-fill  { fill: none; stroke: var(--c-accent); stroke-width: 8; stroke-linecap: round;
                 transition: stroke-dashoffset .2s ease, stroke .25s;
                 filter: drop-shadow(0 0 4px #e8a02080); }
    .card.is-muted .vol-fill { stroke: #444750; filter: none; }
    .vol-knob-inner {
      position: absolute; inset: 22px; border-radius: 50%;
      background: radial-gradient(circle at 38% 32%, #252830, #14161a);
      border: 1px solid #2e3138;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      cursor: ns-resize; gap: 2px;
      box-shadow: 0 6px 20px #00000080, 0 0 0 1px #ffffff06 inset, 0 1px 0 #ffffff10 inset;
      transition: border-color .2s;
    }
    .vol-knob-inner:hover { border-color: #e8a02050; }
    .card:not(.is-on) .vol-knob-inner { cursor: default; opacity: .35; pointer-events: none; }
    .vol-number {
      font-family: var(--font-mono); font-size: 42px; line-height: 1;
      color: var(--c-text); transition: color .2s; letter-spacing: -1px;
    }
    .card.is-muted .vol-number { color: var(--c-dim); }
    .vol-unit-label { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--c-sub); margin-top: -2px; }
    .vol-slider-row { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
    .vol-slider-label { font-family: var(--font-mono); font-size: 10px; color: var(--c-sub); width: 18px; text-align: center; flex-shrink: 0; }
    .vol-slider-track {
      flex: 1; height: 6px; border-radius: 3px; background: var(--c-raised);
      border: 1px solid var(--c-border); position: relative; cursor: pointer;
    }
    .card:not(.is-on) .vol-slider-track { opacity: .3; pointer-events: none; }
    .vol-slider-fill {
      height: 100%; border-radius: 3px;
      background: linear-gradient(90deg, #c97800, var(--c-accent));
      transition: width .2s ease; position: relative;
    }
    .card.is-muted .vol-slider-fill { background: var(--c-dim); }
    .vol-slider-thumb {
      position: absolute; right: -6px; top: 50%;
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--c-accent); border: 2px solid var(--c-bg);
      transform: translateY(-50%); box-shadow: 0 0 8px #e8a02060;
      transition: background .2s, box-shadow .2s;
    }
    .card.is-muted .vol-slider-thumb { background: var(--c-dim); box-shadow: none; }
    .mute-row { display: flex; align-items: center; justify-content: center; margin-top: 14px; }
    .mute-btn {
      display: flex; align-items: center; gap: 8px; padding: 9px 24px;
      border-radius: 10px; border: 1px solid var(--c-border); background: var(--c-surface);
      cursor: pointer; transition: all .2s; font-family: var(--font-ui);
      font-size: 13px; font-weight: 600; letter-spacing: 1px;
      text-transform: uppercase; color: var(--c-sub);
    }
    .mute-btn ha-icon { --mdc-icon-size: 18px; color: var(--c-sub); transition: color .2s; }
    .mute-btn:hover { border-color: var(--c-accent); background: var(--c-raised); color: var(--c-text); }
    .mute-btn:hover ha-icon { color: var(--c-accent); }
    .mute-btn:active { transform: scale(0.97); }
    .card.is-muted .mute-btn { border-color: var(--c-accent); background: #e8a02012; color: var(--c-accent); box-shadow: 0 0 12px #e8a02030; }
    .card.is-muted .mute-btn ha-icon { color: var(--c-accent); }
    .card:not(.is-on) .mute-btn { opacity: .3; pointer-events: none; }

    /* EQ SECTION */
    .eq-section {
      padding: 16px 24px 18px;
      border-bottom: 1px solid var(--c-border);
      background: var(--c-bg);
    }
    .eq-row { display: flex; flex-direction: column; gap: 12px; }
    .eq-slider-wrap { display: flex; align-items: center; gap: 12px; }
    .eq-label {
      font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
      color: var(--c-sub); width: 44px; flex-shrink: 0; font-family: var(--font-ui);
    }
    .eq-track {
      flex: 1; height: 4px; border-radius: 2px;
      background: var(--c-raised); border: 1px solid var(--c-border);
      position: relative; cursor: pointer;
    }
    .card:not(.is-on) .eq-track { opacity: .3; pointer-events: none; }
    .eq-fill-neg {
      position: absolute; top: 0; bottom: 0; border-radius: 2px;
      background: #5a8fff; transition: left .15s, right .15s;
    }
    .eq-fill-pos {
      position: absolute; top: 0; bottom: 0; border-radius: 2px;
      background: var(--c-accent); transition: left .15s, right .15s;
    }
    .eq-center-line {
      position: absolute; top: -3px; bottom: -3px; width: 2px;
      background: var(--c-border); left: 50%; transform: translateX(-50%);
      border-radius: 1px;
    }
    .eq-thumb {
      position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%;
      background: var(--c-text); border: 2px solid var(--c-bg);
      transform: translate(-50%, -50%);
      box-shadow: 0 0 6px #00000080; transition: left .15s, background .2s;
      cursor: ew-resize;
    }
    .eq-value {
      font-family: var(--font-mono); font-size: 11px;
      color: var(--c-sub); width: 32px; text-align: right;
      flex-shrink: 0; transition: color .2s;
    }
    .eq-value.pos { color: var(--c-accent); }
    .eq-value.neg { color: #5a8fff; }

    /* POWER ROW */
    .power-row { display: flex; align-items: center; justify-content: center; padding: 16px 24px 4px; gap: 16px; }
    .power-btn {
      flex: 1; max-width: 200px; height: 48px; border-radius: 12px;
      border: 1px solid var(--c-border); background: var(--c-surface);
      cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: all .2s; font-family: var(--font-ui); font-size: 14px; font-weight: 600;
      letter-spacing: 1.5px; text-transform: uppercase; color: var(--c-sub);
      position: relative; overflow: hidden;
    }
    .power-btn::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 50% 0%, #ffffff08, transparent 60%); }
    .power-btn ha-icon { --mdc-icon-size: 20px; color: var(--c-sub); transition: color .2s; }
    .power-btn:hover { border-color: var(--c-accent); background: var(--c-raised); color: var(--c-text); }
    .power-btn:hover ha-icon { color: var(--c-text); }
    .power-btn:active { transform: scale(0.98); }
    .card.is-on .power-btn { border-color: #e0505040; color: var(--c-red); box-shadow: 0 0 16px #e0505020; }
    .card.is-on .power-btn ha-icon { color: var(--c-red); }
    .card.is-on .power-btn:hover { border-color: var(--c-red); background: #e0505012; }

    /* DIVIDER / SECTION */
    .divider { height: 1px; background: var(--c-border); margin: 0 20px; }
    .section { padding: 14px 20px; }
    .section-label {
      font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase;
      color: var(--c-sub); margin-bottom: 10px;
      display: flex; align-items: center; gap: 8px;
    }
    .section-label::after { content: ''; flex: 1; height: 1px; background: var(--c-border); }
    .source-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .src-btn {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 5px; padding: 10px 4px; border-radius: 10px;
      border: 1px solid var(--c-border); background: var(--c-surface);
      cursor: pointer; transition: all .18s; min-height: 60px;
    }
    .src-btn ha-icon { --mdc-icon-size: 20px; color: var(--c-dim); transition: color .18s; }
    .src-btn span { font-size: 10px; font-weight: 500; color: var(--c-sub); text-align: center; line-height: 1.2; transition: color .18s; }
    .src-btn:hover { background: var(--c-raised); border-color: var(--c-accent); transform: translateY(-1px); box-shadow: 0 4px 12px #00000060; }
    .src-btn:hover ha-icon { color: var(--c-accent); }
    .src-btn:hover span { color: var(--c-text); }
    .src-btn:active { transform: translateY(0); }
    .src-btn.active { background: linear-gradient(135deg,#e8a02018,#e8a02008); border-color: var(--c-accent); box-shadow: 0 0 12px #e8a02028,0 0 0 1px #e8a02018 inset; }
    .src-btn.active ha-icon { color: var(--c-accent); }
    .src-btn.active span { color: var(--c-accent); }
    .card:not(.is-on) .source-grid { opacity: .3; pointer-events: none; }
    .mode-strip { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
    .mode-strip::-webkit-scrollbar { display: none; }
    .mode-btn {
      flex-shrink: 0; padding: 7px 14px; border-radius: 20px;
      border: 1px solid var(--c-border); background: var(--c-surface);
      cursor: pointer; font-family: var(--font-ui); font-size: 12px; font-weight: 500;
      color: var(--c-sub); transition: all .18s; white-space: nowrap;
    }
    .mode-btn:hover { border-color: var(--c-accent); color: var(--c-text); background: var(--c-raised); }
    .mode-btn.active { background: var(--c-accent); border-color: var(--c-accent); color: #000; font-weight: 600; box-shadow: 0 0 10px #e8a02050; }
    .card:not(.is-on) .mode-strip { opacity: .3; pointer-events: none; }

    /* FOOTER */
    .footer {
      padding: 10px 20px 14px; border-top: 1px solid var(--c-border);
      background: linear-gradient(0deg, #090a0c 0%, transparent 100%);
      display: flex; flex-direction: column; gap: 8px;
    }
    .footer-main { display: flex; align-items: center; justify-content: space-between; }
    .now-playing { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .np-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--c-dim); transition: all .3s; }
    .card.is-on .np-dot { background: var(--c-on); box-shadow: 0 0 4px var(--c-on); }
    .np-text { font-family: var(--font-mono); font-size: 11px; color: var(--c-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .3s; }
    .card.is-on .np-text { color: var(--c-text); }
    .mode-badge { flex-shrink: 0; font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px; color: var(--c-sub); padding: 3px 8px; border: 1px solid var(--c-border); border-radius: 4px; text-transform: uppercase; background: var(--c-surface); }

    /* Streaming strip */
    .stream-strip {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 8px;
      background: var(--c-surface); border: 1px solid var(--c-border);
      transition: all .3s; overflow: hidden;
      max-height: 0; opacity: 0; padding: 0;
      border-width: 0;
    }
    .stream-strip.visible {
      max-height: 40px; opacity: 1;
      padding: 7px 10px; border-width: 1px;
    }
    .stream-strip.playing  { border-color: #e8a02040; background: #e8a02008; }
    .stream-strip.paused   { border-color: #5a5f6b50; }
    .stream-icon { --mdc-icon-size: 16px; flex-shrink: 0; }
    .stream-strip.playing  .stream-icon { color: var(--c-accent); }
    .stream-strip.paused   .stream-icon { color: var(--c-sub); }
    .stream-name { font-family: var(--font-mono); font-size: 11px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stream-strip.playing  .stream-name { color: var(--c-text); }
    .stream-strip.paused   .stream-name { color: var(--c-sub); }
    .stream-state {
      font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
      padding: 2px 7px; border-radius: 10px; flex-shrink: 0;
    }
    .stream-strip.playing  .stream-state { color: #000; background: var(--c-accent); }
    .stream-strip.paused   .stream-state { color: var(--c-sub); background: var(--c-raised); }

    /* Ripple */
    @keyframes ripple { from { transform:scale(0); opacity:.35; } to { transform:scale(3.5); opacity:0; } }
    .ripple { position:absolute; border-radius:50%; width:24px; height:24px; margin:-12px; background:var(--c-accent); pointer-events:none; animation:ripple .5s ease-out forwards; }
  `; }

  _html() { return `
    <!-- Header -->
    <div class="header">
      <div class="brand">
        <div class="brand-logo">JBL</div>
        <div>
          <div class="brand-name">MA710</div>
          <div class="brand-model">A/V Receiver</div>
        </div>
      </div>
      <div class="status-pill">
        <div class="status-dot"></div>
        <span class="status-label" id="status-label">STANDBY</span>
      </div>
    </div>

    <!-- Volume Zone -->
    <div class="vol-zone">
      <div class="vol-zone-label">Volume</div>
      <div class="vol-main">
        <div class="vol-step-btn" id="vol-down">
          <span class="step-icon">−</span><span class="step-label">Down</span>
        </div>
        <div class="vol-knob-wrap">
          <svg class="vol-knob-svg" viewBox="0 0 110 110">
            <circle class="vol-track" cx="55" cy="55" r="${ARC_R}"
              stroke-dasharray="${ARC_CIRC.toFixed(2)}" stroke-dashoffset="0"/>
            <circle class="vol-fill" id="vol-fill" cx="55" cy="55" r="${ARC_R}"
              stroke-dasharray="${ARC_CIRC.toFixed(2)}" stroke-dashoffset="${ARC_CIRC.toFixed(2)}"/>
          </svg>
          <div class="vol-knob-inner" id="vol-knob">
            <div class="vol-number" id="vol-num">0</div>
            <div class="vol-unit-label">Volume</div>
          </div>
        </div>
        <div class="vol-step-btn" id="vol-up">
          <span class="step-icon">+</span><span class="step-label">Up</span>
        </div>
      </div>
      <div class="vol-slider-row">
        <span class="vol-slider-label">0</span>
        <div class="vol-slider-track" id="vol-track">
          <div class="vol-slider-fill" id="vol-bar" style="width:0%">
            <div class="vol-slider-thumb"></div>
          </div>
        </div>
        <span class="vol-slider-label">99</span>
      </div>
      <div class="mute-row">
        <button class="mute-btn" id="mute-btn">
          <ha-icon icon="mdi:volume-mute" id="mute-icon"></ha-icon>
          <span id="mute-label">Mute</span>
        </button>
      </div>
    </div>

    <!-- EQ Section -->
    <div class="eq-section">
      <div class="section-label" style="margin-bottom:14px">Equalizer</div>
      <div class="eq-row">
        <div class="eq-slider-wrap">
          <span class="eq-label">Treble</span>
          <div class="eq-track" id="treble-track">
            <div class="eq-center-line"></div>
            <div class="eq-fill-pos" id="treble-fill-pos" style="left:50%;right:50%"></div>
            <div class="eq-fill-neg" id="treble-fill-neg" style="left:50%;right:50%"></div>
            <div class="eq-thumb" id="treble-thumb" style="left:50%"></div>
          </div>
          <span class="eq-value" id="treble-val">0</span>
        </div>
        <div class="eq-slider-wrap">
          <span class="eq-label">Bass</span>
          <div class="eq-track" id="bass-track">
            <div class="eq-center-line"></div>
            <div class="eq-fill-pos" id="bass-fill-pos" style="left:50%;right:50%"></div>
            <div class="eq-fill-neg" id="bass-fill-neg" style="left:50%;right:50%"></div>
            <div class="eq-thumb" id="bass-thumb" style="left:50%"></div>
          </div>
          <span class="eq-value" id="bass-val">0</span>
        </div>
      </div>
    </div>

    <!-- Power -->
    <div class="power-row">
      <button class="power-btn" id="power-btn">
        <ha-icon icon="mdi:power"></ha-icon>
        <span id="power-label">Power On</span>
      </button>
    </div>

    <div class="divider" style="margin-top:16px"></div>

    <!-- Source -->
    <div class="section">
      <div class="section-label">Input Source</div>
      <div class="source-grid" id="source-grid">
        ${SOURCES.map(s=>`
          <div class="src-btn" data-source="${s}" title="${s}">
            <ha-icon icon="${SOURCE_ICONS[s]||'mdi:import'}"></ha-icon>
            <span>${s}</span>
          </div>`).join("")}
      </div>
    </div>

    <div class="divider"></div>

    <!-- Sound Mode -->
    <div class="section">
      <div class="section-label">Sound Mode</div>
      <div class="mode-strip" id="mode-strip">
        ${SURROUND_MODES.map(m=>`<div class="mode-btn" data-mode="${m}">${m}</div>`).join("")}
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-main">
        <div class="now-playing">
          <div class="np-dot"></div>
          <div class="np-text" id="np-text">STANDBY</div>
        </div>
        <div class="mode-badge" id="mode-badge">—</div>
      </div>
      <div class="stream-strip" id="stream-strip">
        <ha-icon class="stream-icon" id="stream-icon" icon="mdi:music"></ha-icon>
        <span class="stream-name" id="stream-name"></span>
        <span class="stream-state" id="stream-state"></span>
      </div>
    </div>
  `; }

  _bind() {
    const R = this.shadowRoot;

    R.getElementById("power-btn").addEventListener("click", e => {
      this._ripple(e.currentTarget, e);
      this._isOn ? this._call("turn_off") : this._call("turn_on");
    });
    R.getElementById("mute-btn").addEventListener("click", e => {
      this._ripple(e.currentTarget, e);
      this._call("volume_mute", { is_volume_muted: !this._isMuted });
    });
    R.getElementById("vol-up").addEventListener("click", e => { this._ripple(e.currentTarget,e); this._call("volume_up"); });
    R.getElementById("vol-down").addEventListener("click", e => { this._ripple(e.currentTarget,e); this._call("volume_down"); });

    // Vol knob drag
    const knob = R.getElementById("vol-knob");
    knob.addEventListener("mousedown",  e => this._volDragStart(e));
    knob.addEventListener("touchstart", e => this._volDragStart(e), { passive: true });
    window.addEventListener("mousemove",  e => this._volDragMove(e));
    window.addEventListener("touchmove",  e => this._volDragMove(e), { passive: false });
    window.addEventListener("mouseup",  () => this._volDragEnd());
    window.addEventListener("touchend", () => this._volDragEnd());

    // Vol slider click
    R.getElementById("vol-track").addEventListener("click", e => {
      if (!this._isOn) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const vol  = Math.round(Math.max(0, Math.min(99, ((e.clientX - rect.left) / rect.width) * 99)));
      this._setVolDisplay(vol);
      this._call("volume_set", { volume_level: vol / 99 });
    });

    // EQ sliders
    this._bindEq("treble", R.getElementById("treble-track"));
    this._bindEq("bass",   R.getElementById("bass-track"));

    // Sources
    R.getElementById("source-grid").addEventListener("click", e => {
      const btn = e.target.closest(".src-btn");
      if (btn) { this._ripple(btn, e); this._call("select_source", { source: btn.dataset.source }); }
    });
    // Modes
    R.getElementById("mode-strip").addEventListener("click", e => {
      const btn = e.target.closest(".mode-btn");
      if (btn) this._call("select_sound_mode", { sound_mode: btn.dataset.mode });
    });
  }

  _bindEq(which, trackEl) {
    if (!trackEl) return;
    let dragging = false, startX = 0, startDb = 0;

    const dbFromEvent = (clientX) => {
      const rect  = trackEl.getBoundingClientRect();
      const pct   = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round((pct - 0.5) * 24); // -12 to +12
    };

    const commit = (db) => {
      if (!this._isOn) return;
      // Call the HA service — bass/treble are custom services registered via services.yaml
      // Fall back to calling volume_set with a special attribute if not registered
      this._hass.callService("jbl_ma710", `set_${which}`, {
        entity_id: this._config.entity,
        [which]: db,
      });
    };

    trackEl.addEventListener("click", e => {
      if (!this._isOn) return;
      const db = dbFromEvent(e.clientX);
      this._setEqDisplay(which, db);
      commit(db);
    });

    const thumb = this.shadowRoot.getElementById(`${which}-thumb`);
    if (!thumb) return;

    thumb.addEventListener("mousedown", e => {
      if (!this._isOn) return;
      dragging = true; startX = e.clientX;
      startDb  = which === "treble" ? this._treble : this._bass;
      e.stopPropagation();
    });
    thumb.addEventListener("touchstart", e => {
      if (!this._isOn) return;
      dragging = true; startX = e.touches[0].clientX;
      startDb  = which === "treble" ? this._treble : this._bass;
    }, { passive: true });

    const move = (clientX) => {
      if (!dragging) return;
      const rect  = trackEl.getBoundingClientRect();
      const delta = Math.round(((clientX - startX) / rect.width) * 24);
      const db    = Math.max(-12, Math.min(12, startDb + delta));
      this._setEqDisplay(which, db);
      this[`_eq${which}Pending`] = db;
    };

    window.addEventListener("mousemove",  e => move(e.clientX));
    window.addEventListener("touchmove",  e => move(e.touches[0].clientX), { passive: true });
    window.addEventListener("mouseup",  () => { if (dragging) { dragging=false; commit(this[`_eq${which}Pending`] ?? startDb); } });
    window.addEventListener("touchend", () => { if (dragging) { dragging=false; commit(this[`_eq${which}Pending`] ?? startDb); } });
  }

  _volDragStart(e) {
    if (!this._isOn) return;
    this._volDragging = true;
    this._volStartY   = e.touches ? e.touches[0].clientY : e.clientY;
    this._volStartVal = this._volume;
  }
  _volDragMove(e) {
    if (!this._volDragging) return;
    if (e.cancelable) e.preventDefault();
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const v = Math.max(0, Math.min(99, this._volStartVal + Math.round((this._volStartY - y) / 1.8)));
    this._setVolDisplay(v);
    this._volPending = v;
  }
  _volDragEnd() {
    if (!this._volDragging) return;
    this._volDragging = false;
    if (this._volPending !== undefined) {
      this._call("volume_set", { volume_level: this._volPending / 99 });
      this._volPending = undefined;
    }
  }

  _ripple(el, e) {
    const r = document.createElement("span");
    r.className = "ripple";
    const rect = el.getBoundingClientRect();
    r.style.left = ((e.clientX || rect.left + rect.width/2) - rect.left) + "px";
    r.style.top  = ((e.clientY || rect.top  + rect.height/2) - rect.top)  + "px";
    el.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
  }

  _update() {
    if (!this._stateObj) return;
    const R    = this.shadowRoot;
    const card = R.getElementById("card");
    if (!card) return;

    const on   = this._isOn, mute = this._isMuted;
    const src  = this._source, mode = this._mode;
    const svc  = this._streamSvc, sst = this._streamSt;

    card.classList.toggle("is-on",    on);
    card.classList.toggle("is-muted", mute);

    R.getElementById("status-label").textContent = on ? "ONLINE" : "STANDBY";
    R.getElementById("power-label").textContent  = on ? "Turn Off" : "Turn On";
    R.getElementById("mute-icon").setAttribute("icon", mute ? "mdi:volume-off" : "mdi:volume-mute");
    R.getElementById("mute-label").textContent   = mute ? "Unmute" : "Mute";

    if (!this._volDragging) this._setVolDisplay(this._volume);
    this._setEqDisplay("treble", this._treble);
    this._setEqDisplay("bass",   this._bass);

    R.querySelectorAll(".src-btn").forEach(b  => b.classList.toggle("active", b.dataset.source === src));
    R.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode   === mode));

    R.getElementById("np-text").textContent =
      on ? (src && src !== "—" ? `▶  ${src}` : "ONLINE") : "STANDBY";
    R.getElementById("mode-badge").textContent = on ? (mode || "—") : "—";

    // Streaming strip
    const strip = R.getElementById("stream-strip");
    if (on && svc && sst && sst !== "stopped") {
      strip.className = `stream-strip visible ${sst}`;
      R.getElementById("stream-icon").setAttribute("icon", STREAM_ICONS[svc] || "mdi:music");
      R.getElementById("stream-name").textContent  = svc;
      R.getElementById("stream-state").textContent = sst === "playing" ? "▶ Playing" : "⏸ Paused";
    } else {
      strip.className = "stream-strip";
    }
  }

  _setVolDisplay(vol) {
    const R = this.shadowRoot;
    const n = R.getElementById("vol-num");
    const f = R.getElementById("vol-fill");
    const b = R.getElementById("vol-bar");
    if (n) n.textContent = vol;
    if (f) f.style.strokeDashoffset = (ARC_CIRC * (1 - vol/99)).toFixed(2);
    if (b) b.style.width = ((vol/99)*100).toFixed(1) + "%";
  }

  _setEqDisplay(which, db) {
    const R      = this.shadowRoot;
    const thumb  = R.getElementById(`${which}-thumb`);
    const posEl  = R.getElementById(`${which}-fill-pos`);
    const negEl  = R.getElementById(`${which}-fill-neg`);
    const valEl  = R.getElementById(`${which}-val`);
    if (!thumb) return;

    const pct = ((db + 12) / 24 * 100).toFixed(1);  // 0–100%
    thumb.style.left = pct + "%";

    if (db >= 0) {
      if (posEl) { posEl.style.left = "50%"; posEl.style.right = (50 - (db/12*50)).toFixed(1) + "%"; }
      if (negEl) { negEl.style.left = "50%"; negEl.style.right = "50%"; }
    } else {
      if (negEl) { negEl.style.right = "50%"; negEl.style.left = (50 + (db/12*50)).toFixed(1) + "%"; }
      if (posEl) { posEl.style.left = "50%"; posEl.style.right = "50%"; }
    }

    if (valEl) {
      valEl.textContent = db > 0 ? `+${db}` : `${db}`;
      valEl.className   = `eq-value ${db > 0 ? "pos" : db < 0 ? "neg" : ""}`;
    }
  }
}

customElements.define("jbl-ma710-card", JblMa710Card);
