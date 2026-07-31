/**
 * All the screens that are not the HUD: start menu, mission picker, free-flight
 * setup, settings (with key remapping), credits, pause and the debrief.
 */

import { MISSIONS } from '../game/missions.js';
import { PRESETS, TIMES, CONDITIONS } from '../world/weather.js';
import { ACTIONS, keyLabel } from '../flight/input.js';
import { CREDITS_HTML } from './credits.js';
import { MAPS } from '../world/maps.js';

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * A small painted preview of a map, drawn from the same island list the
 * terrain generator uses — so the picture is genuinely the place you are
 * about to fly, not decoration.
 */
function mapThumbnail(def) {
  const S = 190;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.className = 'map-thumb';
  const g = c.getContext('2d');
  const pal = def.palette;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  // Sea.
  const sea = g.createLinearGradient(0, 0, 0, S);
  sea.addColorStop(0, hex(pal.swell));
  sea.addColorStop(1, hex(pal.deepWater));
  g.fillStyle = sea;
  g.fillRect(0, 0, S, S);

  // Fit every island into the frame.
  let span = 2500;
  for (const i of def.islands) {
    span = Math.max(span, Math.abs(i.cx) + i.radius * 1.3, Math.abs(i.cz) + i.radius * 1.3);
  }
  const k = (S * 0.46) / span;
  const px = (x) => S / 2 + x * k;
  const pz = (z) => S / 2 + z * k;

  const land = `rgb(${Math.round(150 * pal.grass[0])}, ${Math.round(175 * pal.grass[1])}, ${Math.round(105 * pal.grass[2])})`;
  const shore = `rgb(${Math.round(214 * pal.sand[0])}, ${Math.round(198 * pal.sand[1])}, ${Math.round(158 * pal.sand[2])})`;
  const high = `rgb(${Math.round(150 * pal.rock[0])}, ${Math.round(148 * pal.rock[1])}, ${Math.round(144 * pal.rock[2])})`;

  for (const isl of def.islands) {
    const r = isl.radius * k;
    // Beach ring, then land, then a cap of high ground scaled by the peak.
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 1.06, 0, Math.PI * 2);
    g.fillStyle = shore;
    g.fill();
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 0.92, 0, Math.PI * 2);
    g.fillStyle = land;
    g.fill();
    const relief = Math.min(0.72, isl.peak / 900);
    if (relief > 0.08) {
      g.beginPath();
      g.arc(px(isl.cx), pz(isl.cz), r * relief, 0, Math.PI * 2);
      g.fillStyle = high;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
    }
  }

  // The runway, in the same place on every map.
  g.strokeStyle = '#f2f5f8';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px(-550), pz(0));
  g.lineTo(px(550), pz(0));
  g.stroke();
  return c;
}

export class Menus {
  /**
   * @param {HTMLElement} root
   * @param {object} hooks callbacks into the game
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.current = null;
    this.screens = {};
    this.build();
  }

  build() {
    const layer = h('<div class="menu-layer" hidden></div>');
    this.layer = layer;

    layer.appendChild(this.buildMain());
    layer.appendChild(this.buildMissions());
    layer.appendChild(this.buildMaps());
    layer.appendChild(this.buildFree());
    layer.appendChild(this.buildSettings());
    layer.appendChild(this.buildCredits());
    layer.appendChild(this.buildPause());
    layer.appendChild(this.buildDebrief());

    this.root.appendChild(layer);
  }

  /* ------------------------------------------------------------------ */

  buildMain() {
    const s = h(`
      <section class="screen screen-main" data-screen="main" hidden>
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="58" height="58">
              <path d="M32 6 L36 24 L58 32 L36 40 L32 58 L28 40 L6 32 L28 24 Z" fill="currentColor" opacity="0.9"/>
              <circle cx="32" cy="32" r="5" fill="#0b1220"/>
            </svg>
          </div>
          <div>
            <h1>Island Flight Simulator</h1>
            <p class="tagline">Learn to fly a real aeroplane — <span data-map-name>Kestrel Island</span></p>
          </div>
        </div>

        <nav class="main-nav">
          <button class="card-btn" data-act="tutorial">
            <span class="card-icon">✦</span>
            <span class="card-body"><strong>Tutorial</strong><em>Start here — learn take-off, turning and landing</em></span>
          </button>
          <button class="card-btn" data-act="missions">
            <span class="card-icon">◎</span>
            <span class="card-body"><strong>Missions</strong><em>Three challenges: rings, a delivery and a storm</em></span>
          </button>
          <button class="card-btn" data-act="free">
            <span class="card-icon">☁</span>
            <span class="card-body"><strong>Free Flight</strong><em>Any weather, any time of day, no rules</em></span>
          </button>
          <button class="card-btn" data-act="maps">
            <span class="card-icon">🗺</span>
            <span class="card-body"><strong>Choose Map</strong><em data-map-blurb>Five places to fly, from flat grassland to a volcano</em></span>
          </button>
          <button class="card-btn" data-act="settings">
            <span class="card-icon">⚙</span>
            <span class="card-body"><strong>Settings</strong><em>Controls, sound, graphics and accessibility</em></span>
          </button>
        </nav>

        <div class="main-foot">
          <div class="stats" data-stats></div>
          <div class="foot-links">
            <button class="ghost" data-act="sound" data-sound>🔇 Sound is off — turn it on</button>
            <button class="ghost" data-act="credits">Credits &amp; licences</button>
            <button class="ghost" data-act="install" data-install hidden>⇩ Install / Download game</button>
            <a class="ghost" data-zip href="download/island-flight-sim-source.zip" download>⇩ Download source ZIP</a>
          </div>
          <p class="tiny">Works offline once installed. All artwork and sound is generated by the game itself.</p>
        </div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      this.hooks.onClick && this.hooks.onClick(act);
      if (act === 'tutorial') this.hooks.startTutorial();
      else if (act === 'missions') this.show('missions');
      else if (act === 'free') this.show('free');
      else if (act === 'maps') this.show('maps');
      else if (act === 'settings') this.show('settings');
      else if (act === 'credits') this.show('credits');
      else if (act === 'install') this.hooks.install && this.hooks.install();
      else if (act === 'sound') this.hooks.toggleSound && this.hooks.toggleSound();
    });
    this.screens.main = s;
    return s;
  }

  buildMaps() {
    const cards = MAPS.map(
      (m) => `
      <article class="map-card" data-map-card="${m.id}">
        <div class="map-art" data-map-art="${m.id}" aria-hidden="true"></div>
        <div class="map-text">
          <h3>${m.name}</h3>
          <span class="map-sub">${m.subtitle}</span>
          <span class="map-diff diff-${m.difficulty}">${'●'.repeat(m.difficulty)}${'○'.repeat(5 - m.difficulty)} ${m.difficultyLabel}</span>
          <p>${m.blurb}</p>
        </div>
        <div class="map-foot">
          <span class="map-current" data-map-current="${m.id}" hidden>Currently flying here</span>
          <button class="primary" data-choose-map="${m.id}">Fly here</button>
        </div>
      </article>`
    ).join('');

    const s = h(`
      <section class="screen screen-list" data-screen="maps" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Choose your map</h2>
          <span></span>
        </header>
        <p class="hint">Every map has the same runway, so everything you have learned still works.
        What changes is the land around it — and how much room it leaves you.</p>
        <div class="map-grid">${cards}</div>
      </section>
    `);
    // A little painted preview of each map's shape, drawn from the same island
    // data the terrain uses. Cheap, and it makes the choice mean something.
    for (const m of MAPS) {
      const host = s.querySelector(`[data-map-art="${m.id}"]`);
      if (host) host.appendChild(mapThumbnail(m));
    }
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const pick = e.target.closest('[data-choose-map]');
      if (pick) {
        this.hooks.onClick && this.hooks.onClick('map');
        this.hooks.chooseMap && this.hooks.chooseMap(pick.dataset.chooseMap);
      }
    });
    this.screens.maps = s;
    return s;
  }

  /** Highlight the map currently loaded, everywhere it is mentioned. */
  syncMap(id) {
    const def = MAPS.find((m) => m.id === id) || MAPS[0];
    for (const el of this.root.querySelectorAll('[data-map-name]')) el.textContent = def.name;
    for (const el of this.root.querySelectorAll('[data-map-blurb]')) {
      el.textContent = `Now flying ${def.name} — ${def.subtitle}`;
    }
    if (!this.screens.maps) return;
    for (const m of MAPS) {
      const tag = this.screens.maps.querySelector(`[data-map-current="${m.id}"]`);
      const card = this.screens.maps.querySelector(`[data-map-card="${m.id}"]`);
      if (tag) tag.hidden = m.id !== id;
      if (card) card.classList.toggle('is-current', m.id === id);
    }
  }

  buildMissions() {
    const cards = MISSIONS.map(
      (m) => `
      <article class="mission-card" data-mission="${m.id}">
        <div class="mission-top">
          <span class="mission-icon">${m.icon}</span>
          <div>
            <h3>${m.name}</h3>
            <span class="mission-diff diff-${m.difficulty.toLowerCase()}">${m.difficulty}</span>
            <span class="mission-sub">${m.short}</span>
          </div>
        </div>
        <p>${m.blurb}</p>
        <p class="mission-learn">${m.reward}</p>
        <div class="mission-foot">
          <span class="mission-best" data-best="${m.id}"></span>
          <button class="primary" data-start="${m.id}">Fly this mission</button>
        </div>
      </article>`
    ).join('');

    const s = h(`
      <section class="screen screen-list" data-screen="missions" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Missions</h2>
          <span></span>
        </header>
        <div class="mission-grid">${cards}</div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const start = e.target.closest('[data-start]');
      if (start) this.hooks.startMission(start.dataset.start);
    });
    this.screens.missions = s;
    return s;
  }

  buildFree() {
    const presets = PRESETS.map(
      (p) => `<button class="preset" data-preset="${p.id}"><strong>${p.name}</strong><em>${p.hint}</em></button>`
    ).join('');
    const times = Object.entries(TIMES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
    const conds = Object.entries(CONDITIONS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');

    const s = h(`
      <section class="screen screen-list" data-screen="free" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Free Flight</h2>
          <span></span>
        </header>
        <div class="free-body">
          <div class="free-col">
            <h3>Weather presets</h3>
            <div class="preset-grid">${presets}</div>
          </div>
          <div class="free-col">
            <h3>Or choose it yourself</h3>
            <label class="field"><span>Time of day</span><select data-time>${times}</select></label>
            <label class="field"><span>Sky</span><select data-cond>${conds}</select></label>
            <label class="field"><span>Wind speed <b data-windval>4</b> kt</span>
              <input type="range" min="0" max="35" step="1" data-wind></label>
            <label class="field"><span>Wind comes from <b data-dirval>090</b>°</span>
              <input type="range" min="0" max="350" step="10" data-dir></label>
            <label class="field"><span>Start</span><select data-start-pos>
              <option value="runway">On the runway</option>
              <option value="air">Already flying, 2,000 ft</option>
            </select></label>
            <p class="hint" data-crosswind></p>
            <button class="primary big" data-fly>Take off</button>
          </div>
        </div>
      </section>
    `);

    const wind = s.querySelector('[data-wind]');
    const dir = s.querySelector('[data-dir]');
    const time = s.querySelector('[data-time]');
    const cond = s.querySelector('[data-cond]');
    const startPos = s.querySelector('[data-start-pos]');
    this.freeControls = { wind, dir, time, cond, startPos };

    const refresh = () => {
      s.querySelector('[data-windval]').textContent = wind.value;
      s.querySelector('[data-dirval]').textContent = String(dir.value).padStart(3, '0');
      // Explain the crosswind in plain words before they even take off.
      const rel = ((Number(dir.value) - 90 + 540) % 360) - 180;
      const cross = Math.abs(Math.sin((rel * Math.PI) / 180)) * Number(wind.value);
      const side = rel > 0 ? 'right' : 'left';
      let msg;
      if (Number(wind.value) < 2) msg = 'Calm air — the easiest conditions to fly in.';
      else if (cross < 4) msg = 'The wind is almost straight down the runway. Nice and easy.';
      else if (cross < 12) msg = `A gentle crosswind from the ${side} (${Math.round(cross)} kt across the runway).`;
      else msg = `A strong crosswind from the ${side} — ${Math.round(cross)} kt across the runway. Tricky!`;
      s.querySelector('[data-crosswind]').textContent = msg;
    };
    wind.addEventListener('input', refresh);
    dir.addEventListener('input', refresh);
    this.refreshFree = refresh;

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const p = e.target.closest('[data-preset]');
      if (p) {
        const preset = PRESETS.find((x) => x.id === p.dataset.preset);
        time.value = preset.time;
        cond.value = preset.condition;
        wind.value = preset.wind;
        dir.value = Math.round(preset.dir / 10) * 10;
        refresh();
        s.querySelectorAll('.preset').forEach((n) => n.classList.remove('is-on'));
        p.classList.add('is-on');
        return;
      }
      if (e.target.closest('[data-fly]')) {
        this.hooks.startFree({
          time: time.value,
          condition: cond.value,
          windSpeedKts: Number(wind.value),
          windDirDeg: Number(dir.value),
          airborne: startPos.value === 'air',
        });
      }
    });
    this.screens.free = s;
    return s;
  }

  buildSettings() {
    const s = h(`
      <section class="screen screen-list" data-screen="settings" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Settings</h2>
          <button class="ghost" data-reset-all>Reset everything</button>
        </header>
        <div class="tabs">
          <button class="tab is-on" data-tab="flight">Flying</button>
          <button class="tab" data-tab="sound">Sound</button>
          <button class="tab" data-tab="graphics">Graphics</button>
          <button class="tab" data-tab="controls">Controls</button>
          <button class="tab" data-tab="access">Accessibility</button>
        </div>

        <div class="tab-body" data-panel="flight">
          <label class="field"><span>Flight model</span>
            <select data-set="flightMode">
              <option value="simplified">Simplified — the plane helps you fly (recommended)</option>
              <option value="realistic">Realistic — full control, it can stall</option>
            </select>
          </label>
          <p class="hint">Simplified mode levels the wings by itself, coordinates the rudder for you and stops the wing stalling. Realistic mode does none of that.</p>
          <label class="check"><input type="checkbox" data-set="mouseFlying"><span>Fly with the mouse (click the sky to capture the pointer)</span></label>
          <label class="check"><input type="checkbox" data-set="invertMouse"><span>Invert mouse up/down</span></label>
          <label class="field"><span>Mouse / stick sensitivity <b data-out="sensitivity"></b></span>
            <input type="range" min="0.3" max="2" step="0.1" data-set="sensitivity"></label>
          <label class="check"><input type="checkbox" data-set="gamepad"><span>Use a gamepad if one is plugged in</span></label>
          <label class="check"><input type="checkbox" data-set="showHints"><span>Repeat hints if I get stuck</span></label>
          <label class="check"><input type="checkbox" data-set="guidance"><span>Show guidance lines to the runway or target (N)</span></label>
          <label class="check"><input type="checkbox" data-set="realisticFuel"><span>Realistic fuel — the tank drains 1% every 30 seconds, so you have to plan</span></label>
          <label class="check"><input type="checkbox" data-set="randomWinds"><span>Random winds — the wind wanders and gusts blow through</span></label>
          <p class="hint">With random winds on, the wind drifts around the speed and direction you chose and a gust rolls
          through every half minute or so. It makes landings much more interesting. Leave it off while you are learning.</p>
        </div>

        <div class="tab-body" data-panel="sound" hidden>
          <label class="field"><span>Overall volume <b data-out="volumes.master"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.master"></label>
          <label class="field"><span>Engine <b data-out="volumes.engine"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.engine"></label>
          <label class="field"><span>Wind, rain &amp; tyres <b data-out="volumes.environment"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.environment"></label>
          <label class="field"><span>ATC radio <b data-out="volumes.atc"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.atc"></label>
          <label class="field"><span>Warnings &amp; alerts <b data-out="volumes.alerts"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.alerts"></label>
          <label class="field"><span>Music <b data-out="volumes.music"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.music"></label>
          <label class="check"><input type="checkbox" data-set="music"><span>Play background music</span></label>
          <label class="check"><input type="checkbox" data-set="atcChatter"><span>Background radio chatter from other aircraft</span></label>
          <label class="check"><input type="checkbox" data-set="muted"><span>Mute everything</span></label>
          <p class="hint">Every sound is synthesised by the game — engine, wind, rain, tyres and the radio. Nothing is downloaded, so it all works offline.</p>
        </div>

        <div class="tab-body" data-panel="graphics" hidden>
          <label class="field"><span>Detail level</span>
            <select data-set="quality">
              <option value="low">Low — fastest, for older laptops</option>
              <option value="medium">Medium</option>
              <option value="high">High — best looking</option>
            </select>
          </label>
          <p class="hint">Changing the detail level rebuilds the island, which takes a couple of seconds.</p>
          <div class="fps-box">Frames per second: <b data-fps>—</b></div>
        </div>

        <div class="tab-body" data-panel="controls" hidden>
          <p class="hint">Click a key, then press the new key you want to use.</p>
          <div class="keymap" data-keymap></div>
          <button class="ghost" data-reset-keys>Reset keys to default</button>
        </div>

        <div class="tab-body" data-panel="access" hidden>
          <label class="check"><input type="checkbox" data-set="subtitles"><span>Show subtitles for radio calls</span></label>
          <label class="check"><input type="checkbox" data-set="reducedMotion"><span>Reduced motion (much less camera shake)</span></label>
          <label class="check"><input type="checkbox" data-set="highContrast"><span>High-contrast display</span></label>
          <label class="check"><input type="checkbox" data-set="largeText"><span>Larger text</span></label>
        </div>
      </section>
    `);

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show(this.settingsReturn || 'main');
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        s.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
        s.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.panel !== tab.dataset.tab));
        return;
      }
      if (e.target.closest('[data-reset-keys]')) {
        this.hooks.resetKeys();
        this.renderKeymap();
        return;
      }
      if (e.target.closest('[data-reset-all]')) {
        if (confirm('Reset all settings, keys and mission progress?')) this.hooks.resetAll();
      }
    });

    s.addEventListener('input', (e) => {
      const t = e.target.closest('[data-set]');
      if (!t) return;
      const path = t.dataset.set;
      let value;
      if (t.type === 'checkbox') value = t.checked;
      else if (t.type === 'range') value = Number(t.value);
      else value = t.value;
      this.hooks.onSetting(path, value);
      const out = s.querySelector(`[data-out="${path}"]`);
      if (out) out.textContent = t.type === 'range' && Number(value) <= 1 ? `${Math.round(value * 100)}%` : value;
    });

    this.screens.settings = s;
    return s;
  }

  buildCredits() {
    const s = h(`
      <section class="screen screen-list" data-screen="credits" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Credits &amp; licences</h2>
          <span></span>
        </header>
        <div class="credits">${CREDITS_HTML}</div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) this.show('main');
    });
    this.screens.credits = s;
    return s;
  }

  buildPause() {
    const s = h(`
      <section class="screen screen-pause" data-screen="pause" hidden>
        <div class="pause-card">
          <h2>Paused</h2>
          <div class="pause-info" data-pause-info></div>
          <div class="pause-actions">
            <button class="primary" data-act="resume">Resume flight</button>
            <button data-act="restart">Restart</button>
            <button data-act="airport">Return to airport</button>
            <button data-act="settings">Settings</button>
            <button data-act="quit">Quit to menu</button>
          </div>
          <p class="tiny">Esc resumes · C changes camera · H shows the controls</p>
        </div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'settings') {
        this.settingsReturn = 'pause';
        this.show('settings');
      } else {
        this.hooks.onPauseAction(act);
      }
    });
    this.screens.pause = s;
    return s;
  }

  buildDebrief() {
    const s = h(`
      <section class="screen screen-pause" data-screen="debrief" hidden>
        <div class="pause-card debrief-card">
          <h2 data-title>Mission complete</h2>
          <div class="debrief-body" data-body></div>
          <div class="pause-actions" data-actions></div>
        </div>
      </section>
    `);
    this.screens.debrief = s;
    return s;
  }

  /* ------------------------------------------------------------------ */

  renderKeymap() {
    const host = this.screens.settings.querySelector('[data-keymap]');
    const bindings = this.hooks.getBindings();
    const groups = {};
    for (const key in ACTIONS) {
      const a = ACTIONS[key];
      groups[a.group] = groups[a.group] || [];
      groups[a.group].push({ key, ...a });
    }
    host.innerHTML = Object.entries(groups)
      .map(
        ([g, items]) => `
        <div class="keymap-group"><h4>${g}</h4>
          ${items
            .map(
              (i) => `<div class="keymap-row"><span>${i.label}</span>
                <button class="keycap" data-bind="${i.key}">${(bindings[i.key] || [])
                  .map(keyLabel)
                  .join(' / ') || '—'}</button></div>`
            )
            .join('')}
        </div>`
      )
      .join('');

    host.querySelectorAll('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.textContent = 'press a key…';
        btn.classList.add('is-listening');
        this.hooks.captureKey(btn.dataset.bind, () => {
          btn.classList.remove('is-listening');
          this.renderKeymap();
        });
      });
    });
  }

  syncSettings(settings) {
    const s = this.screens.settings;
    const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings);
    s.querySelectorAll('[data-set]').forEach((node) => {
      const v = get(node.dataset.set);
      if (v === undefined) return;
      if (node.type === 'checkbox') node.checked = !!v;
      else node.value = v;
      const out = s.querySelector(`[data-out="${node.dataset.set}"]`);
      if (out) out.textContent = node.type === 'range' && Number(v) <= 1 ? `${Math.round(v * 100)}%` : v;
    });
    // Free-flight defaults follow the saved weather.
    if (this.freeControls && settings.weather) {
      this.freeControls.time.value = settings.weather.time;
      this.freeControls.cond.value = settings.weather.condition;
      this.freeControls.wind.value = settings.weather.windSpeedKts;
      this.freeControls.dir.value = Math.round(settings.weather.windDirDeg / 10) * 10;
      this.refreshFree();
    }
  }

  syncProgress(progress) {
    const stats = this.screens.main.querySelector('[data-stats]');
    const done = Object.values(progress.missions).filter((m) => m.complete).length;
    const best = progress.bestLanding;
    stats.innerHTML = `
      <span><b>${done}</b>/${MISSIONS.length} missions</span>
      <span><b>${progress.landings}</b> landings</span>
      ${best ? `<span>Best landing <b>${best.score}</b>/100</span>` : '<span>No landings yet</span>'}
      ${progress.tutorialComplete ? '<span class="ok">Flight school ✓</span>' : ''}
    `;
    for (const m of MISSIONS) {
      const node = this.screens.missions.querySelector(`[data-best="${m.id}"]`);
      const rec = progress.missions[m.id];
      if (node) {
        node.innerHTML = rec && rec.complete
          ? `<span class="ok">Completed ✓</span> best ${rec.bestScore}/100`
          : 'Not flown yet';
      }
    }
  }

  /** Reflect the mute state on the start-screen button. */
  syncSound(muted) {
    const btn = this.screens.main.querySelector('[data-sound]');
    if (!btn) return;
    btn.textContent = muted ? '🔇 Sound is off — turn it on' : '🔊 Sound is on — turn it off';
    btn.classList.toggle('is-live', !muted);
  }

  showInstall(canInstall) {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = !canInstall;
  }

  setInstalled() {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = false;
    btn.textContent = '✓ Installed — playable offline';
    btn.disabled = true;
  }

  setZipAvailable(ok) {
    const a = this.screens.main.querySelector('[data-zip]');
    if (!ok) a.remove();
  }

  updateFps(fps) {
    const n = this.screens.settings.querySelector('[data-fps]');
    if (n) n.textContent = fps;
  }

  setPauseInfo(html) {
    this.screens.pause.querySelector('[data-pause-info]').innerHTML = html;
  }

  showDebrief({ title, kind, body, actions }) {
    const s = this.screens.debrief;
    s.querySelector('[data-title]').textContent = title;
    s.querySelector('[data-title]').className = `debrief-title is-${kind}`;
    s.querySelector('[data-body]').innerHTML = body;
    const host = s.querySelector('[data-actions]');
    host.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', a.onClick);
      host.appendChild(b);
    }
    this.show('debrief');
  }

  show(name) {
    this.layer.hidden = false;
    for (const key in this.screens) this.screens[key].hidden = key !== name;
    this.current = name;
    if (name === 'settings') this.renderKeymap();
    if (name !== 'settings') this.settingsReturn = null;
    // Move focus for keyboard users.
    const focusable = this.screens[name].querySelector('button, select, input, a');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
  }

  hide() {
    this.layer.hidden = true;
    this.current = null;
    for (const key in this.screens) this.screens[key].hidden = true;
  }

  get isOpen() {
    return !this.layer.hidden;
  }
}
