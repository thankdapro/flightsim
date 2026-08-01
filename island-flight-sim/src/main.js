/**
 * Island Flight Simulator — entry point.
 *
 * Owns the renderer, the world, the game state machine and the frame loop.
 * Physics runs at a fixed 120 Hz in sub-steps so the flight model behaves the
 * same on a 60 Hz laptop and a 144 Hz monitor.
 */

import * as THREE from './vendor/three.module.js';

import { warmTextures } from './render/textures.js';
import { Weather } from './world/weather.js';
import { SkyDome } from './world/sky.js';
import { createTerrain, heightAt, AIRPORT, applyMap } from './world/terrain.js';
import { Ocean } from './world/water.js';
import { Airport, RUNWAY } from './world/airport.js';
import { Scenery, DELIVERY_PAD } from './world/scenery.js';
import { CloudField } from './world/clouds.js';
import { Rain } from './world/precip.js';

import { Aircraft, EVENTS, UNITS, SPEC } from './aircraft/physics.js';
import { createAircraftModel } from './aircraft/model.js';
import { createCockpit } from './aircraft/cockpit.js';

import { Input, ACTIONS, keyLabel } from './flight/input.js';
import { CameraRig, VIEW_LABELS } from './flight/camera.js';

import { GameAudio } from './audio/index.js';

import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';

import { MissionRunner, STATUS } from './game/runner.js';
import { MISSIONS, findMission, FREE_FLIGHT, RUNWAY_START } from './game/missions.js';
import { TUTORIAL } from './game/tutorial.js';
import { AtcDirector } from './game/atc-director.js';
import { CargoCrate } from './game/markers.js';
import { NavGuide } from './game/navguide.js';
import { Autopilot } from './flight/autopilot.js';

import {
  loadSettings,
  saveSettings,
  loadProgress,
  saveProgress,
  recordLanding,
  recordMission,
  resetAll,
} from './core/storage.js';
import { clamp } from './core/noise.js';

const KTS = UNITS.KTS;
const FT = UNITS.FT;
const FPM = UNITS.FPM;

/** Bumped whenever the game changes. Printed on boot so you can tell at a
 *  glance whether a browser is running a stale cached copy. */
export const BUILD = 'v10 — cockpit controls, ATC voice options';

const loadEl = document.getElementById('loading');
const loadBar = document.getElementById('load-bar');
const loadMsg = document.getElementById('load-msg');
const loadTip = document.getElementById('load-tip');

const TIPS = [
  'Shift adds power, Ctrl takes it away.',
  'Two white and two red PAPI lights means you are on the perfect glide path.',
  'A slow, gentle pull on S lifts you off — never yank it.',
  'In a crosswind, point the nose slightly into the wind to stay lined up.',
  'Press C to look at your aeroplane from outside.',
  'Runway 09 means you land heading 090 degrees — east.',
  'If the stall warning sounds, lower the nose and add power.',
];

function setLoad(pct, msg) {
  if (loadBar) loadBar.style.width = `${Math.round(pct * 100)}%`;
  if (msg && loadMsg) loadMsg.textContent = msg;
}

function fatal(message, detail) {
  const box = document.getElementById('fatal');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h2>Something went wrong</h2><p>${message}</p>${
    detail ? `<pre>${String(detail).slice(0, 900)}</pre>` : ''
  }<p class="tiny">Try reloading the page. If it keeps happening, your browser may not support WebGL 2 —
  Chrome, Edge, Firefox and Safari 16+ all do.</p>`;
  if (loadEl) loadEl.hidden = true;
}

class Game {
  constructor() {
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.state = 'loading';
    this.mode = null;
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.papiHint = null;
    this.cloudImmersion = 0;
    this.activeTarget = null;
    this.hasCargo = false;
    this.crate = null;
    this.qualityBuilt = null;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async boot() {
    if (loadTip) loadTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

    const canvas = document.getElementById('view');
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: this.settings.quality !== 'low',
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (err) {
      fatal('This browser could not start WebGL, which the simulator needs to draw 3D graphics.', err);
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.quality === 'high' ? 2 : 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 60000);

    setLoad(0.04, 'Painting textures…');
    await warmTextures((p, label) => setLoad(0.04 + p * 0.5, `Painting ${label.toLowerCase()}…`));

    setLoad(0.56, 'Raising the islands…');
    await this.frame();
    this.weather = new Weather();
    this.weather.load(this.settings.weather);
    this.weather.setRandomWinds(!!this.settings.randomWinds);
    // A gust is worth calling out — it is the difference between a good
    // landing and a bounce, and you cannot see wind.
    this.weather.onGust = (kts, dirDeg) => {
      if (this.state !== 'flying' || !this.hud) return;
      const rel = ((dirDeg - (this.aircraft.readouts().heading || 0) + 540) % 360) - 180;
      const side =
        Math.abs(rel) < 35 ? 'head-on' : Math.abs(rel) > 145 ? 'from behind' : rel < 0 ? 'from the left' : 'from the right';
      this.hud.notify(`Gust ${side} — ${kts} knots`, 'warn', 2.6);
    };
    // Pick the saved map before anything reads the height field.
    applyMap(this.settings.map || 'kestrel');
    this.buildWorld(this.settings.quality);

    setLoad(0.82, 'Rolling out the aeroplane…');
    await this.frame();
    this.aircraft = new Aircraft();
    this.aircraft.mode = this.settings.flightMode;
    this.aircraft.realisticFuel = !!this.settings.realisticFuel;
    this.model = createAircraftModel();
    this.scene.add(this.model);
    this.cockpit = createCockpit({ highContrast: this.settings.highContrast });
    this.model.add(this.cockpit);
    this.cockpit.visible = false;

    this.rig = new CameraRig(this.camera, this.aircraft);
    this.rig.reducedMotion = this.settings.reducedMotion;

    this.navGuide = new NavGuide(this.scene);
    this.autopilot = new Autopilot();
    this.navGuide.setEnabled(this.settings.guidance !== false);

    setLoad(0.9, 'Warming up the radio…');
    await this.frame();
    this.audio = new GameAudio();
    this.audio.radio.onSubtitle = ({ text, voice, duration }) => this.hud.setSubtitle(text, voice, duration);

    this.input = new Input(canvas);
    this.hud = new Hud(document.getElementById('ui'), { onAction: (a) => this.hudAction(a) });
    this.hud.setSubtitlesEnabled(this.settings.subtitles);
    this.hud.setHighContrast(this.settings.highContrast);
    this.hud.setLargeText(this.settings.largeText);
    this.hud.setMuted(this.settings.muted);
    this.hud.setVisible(false);

    this.runner = new MissionRunner(this);
    this.runner.onStep = (step, i, total) => this.onMissionStep(step, i, total);
    this.runner.onComplete = (r) => this.onMissionComplete(r);
    this.runner.onFail = (f) => this.onMissionFail(f);
    this.runner.onEvent = (e) => this.onMissionEvent(e);

    this.atc = new AtcDirector(this);
    this.bindAircraftEvents();

    this.menus = new Menus(document.getElementById('ui'), {
      startTutorial: () => this.startMode('tutorial'),
      startMission: (id) => this.startMode('mission', { id }),
      startFree: (opts) => this.startMode('free', opts),
      onSetting: (path, value) => this.applySetting(path, value),
      onPauseAction: (a) => this.pauseAction(a),
      getBindings: () => this.input.bindings,
      captureKey: (action, done) => this.input.capture(action, done),
      resetKeys: () => this.input.resetBindings(),
      resetAll: () => {
        resetAll();
        location.reload();
      },
      chooseMap: (id) => this.setMap(id),
      install: () => this.promptInstall(),
      toggleSound: () => {
        this.hudAction('mute');
        this.menus.syncSound(this.settings.muted);
        if (!this.settings.muted) this.unlockAudio();
      },
      onClick: () => this.audio.available && this.audio.alerts.uiClick(),
    });
    this.menus.syncSettings(this.settings);
    this.menus.syncProgress(this.progress);
    this.menus.syncSound(this.settings.muted);
    this.menus.syncMap(this.settings.map || 'kestrel');

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('pointerdown', () => this.unlockAudio(), { once: false });
    window.addEventListener('keydown', () => this.unlockAudio(), { once: false });
    // Pause when the player switches tabs — nobody wants to come back to a
    // smoking crater. The flag exists so the automated self-test can opt out.
    this.autoPauseOnHide = true;
    document.addEventListener('visibilitychange', () => {
      if (this.autoPauseOnHide && document.hidden && this.state === 'flying') this.pause();
    });

    setLoad(1, 'Ready for take-off');
    await this.frame();
    if (loadEl) {
      // Take it out of the document entirely rather than just hiding it. It
      // sits above the interface, so if anything ever leaves it on screen — a
      // stalled transition, a stale stylesheet — you get a black sheet over
      // the whole game and no way to dismiss it. An element that is gone
      // cannot do that.
      loadEl.classList.add('is-done');
      loadEl.hidden = true;
      setTimeout(() => loadEl.remove(), 600);
    }

    this.state = 'menu';
    this.menus.show('main');
    this.setupPwa();
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
    this.loop();

    console.info(`[island-flight] build ${BUILD}`);
    this.checkForStuckOverlays();
    // Small headless API so the flight model can be driven in tests.
    window.__sim = this;
    window.__build = BUILD;
  }

  /**
   * Yield one frame so the loading bar can paint. Browsers pause
   * requestAnimationFrame entirely in a background tab, so race it against a
   * timer — otherwise loading would stall until the tab was brought forward.
   */
  frame() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 80);
    });
  }

  /**
   * Tear the old world down properly. Removing a group from the scene only
   * unhooks it — the geometry, materials and textures stay resident on the
   * GPU. That is fine once, but the world is rebuilt every time the graphics
   * quality or the map changes, and leaked render targets are exactly what
   * used to make the sea flicker after a long session.
   */
  disposeWorld() {
    if (!this.worldGroups) return;
    const seen = new Set();
    const killTex = (m) => {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap', 'aoMap', 'bumpMap']) {
        const t = m[k];
        if (t && t.isTexture && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    };
    for (const g of this.worldGroups) {
      if (!g) continue;
      g.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          killTex(m);
        }
      });
      this.scene.remove(g);
    }
    if (this.sky && this.sky.dispose) this.sky.dispose();
    this.worldGroups = null;
  }

  buildWorld(quality) {
    this.disposeWorld();
    // Timing each piece makes it obvious which part of the world is
    // expensive if someone changes the detail settings later.
    const t = (label, fn) => {
      const t0 = performance.now();
      const r = fn();
      console.debug(`[world] ${label} ${Math.round(performance.now() - t0)} ms`);
      return r;
    };

    console.debug('[world] build start', quality);
    this.sky = t('sky', () =>
      new SkyDome(this.scene, {
        shadows: quality !== 'low',
        shadowMapSize: quality === 'high' ? 2048 : 1024,
      })
    );
    this.terrain = t('terrain', () => createTerrain(this.scene, quality));
    this.ocean = t('ocean', () => new Ocean(this.scene));
    this.airport = t('airport', () => new Airport(this.scene));
    this.scenery = t('scenery', () => new Scenery(this.scene, quality));
    this.clouds = t('clouds', () => new CloudField(this.scene, quality));
    this.rain = t('rain', () => new Rain(this.scene, quality));
    // Image-based lighting from the sky. Do this after the world exists so the
    // aeroplane, sea and buildings all pick it up.
    try {
      this.sky.buildEnvironment(this.renderer, this.scene);
    } catch (err) {
      console.warn('Could not build the environment map:', err);
    }

    this.worldGroups = [
      this.sky.mesh,
      this.terrain,
      this.ocean.group,
      this.airport.group,
      this.scenery.group,
      this.clouds.group,
      this.rain.mesh,
    ];
    this.qualityBuilt = quality;
    console.debug('[world] build complete');
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  bindAircraftEvents() {
    const ac = this.aircraft;
    ac.on(EVENTS.TOUCHDOWN, (g) => {
      const impact = clamp(Math.abs(g.vsFpm) / 700, 0.05, 1);
      this.audio.available && this.audio.ambience.playTouchdown(impact, g.paved ? 'paved' : 'grass');
      this.rig.kick(0.25 + impact * 0.6);
      if (g.crashed) return;
      this.progress = recordLanding(this.progress, g);
      this.menus.syncProgress(this.progress);
      const words = {
        perfect: ['Perfect landing!', 'You barely felt that. Textbook.'],
        good: ['Good landing', 'Smooth and on the centreline.'],
        firm: ['Firm landing', 'A bit of a bump, but perfectly safe.'],
        rough: ['Rough landing', 'That was heavy — try to arrive more slowly next time.'],
      };
      const [title, sub] = words[g.quality] || words.good;
      this.hud.showBanner(
        `${title} · ${g.score}/100`,
        `${sub} Descent rate ${Math.abs(g.vsFpm)} ft/min${g.onRunway ? '' : ' · not on the runway'}`,
        g.quality === 'rough' ? 'warn' : 'good'
      );
      this.audio.available && (g.quality === 'rough' ? this.audio.alerts.uiBack() : this.audio.alerts.checkpoint());
      this.atc.onTouchdown(g);
    });

    ac.on(EVENTS.LIFTOFF, (d) => {
      this.progress.takeoffs++;
      saveProgress(this.progress);
      this.hud.showBanner('Airborne!', `Lift-off at ${Math.round(d.speedKts)} knots — well flown.`, 'good', 3);
      this.audio.available && this.audio.alerts.checkpoint();
    });

    ac.on(EVENTS.CRASH, (c) => {
      this.progress.crashes++;
      saveProgress(this.progress);
      if (this.audio.available) {
        if (this.aircraft.pos.y < 3 && heightAt(this.aircraft.pos.x, this.aircraft.pos.z) < 0)
          this.audio.ambience.playSplash();
        else this.audio.ambience.playCrash();
        this.audio.engine.playStop();
      }
      this.rig.kick(1.4);
      this.hud.showBanner('Crashed', c.reason, 'bad', 6);
      setTimeout(() => {
        if (this.state === 'flying') this.showCrashDebrief(c.reason);
      }, 2200);
    });

    ac.on(EVENTS.GEAR, (d) => {
      this.audio.available && this.audio.ambience.playGear(d.down);
      this.hud.notify(d.down ? 'Landing gear coming down' : 'Landing gear coming up', 'info', 2.6);
    });
    ac.on(EVENTS.ENGINE_START, () => {
      this.audio.available && this.audio.engine.playStart();
      this.hud.notify('Starting the engine…', 'info', 2.4);
    });
    ac.on(EVENTS.ENGINE_STOP, (d) => {
      this.audio.available && this.audio.engine.playStop();
      this.hud.notify(d.reason === 'fuel' ? 'The engine stopped — out of fuel!' : 'Engine off', 'warn', 5);
    });
    ac.on(EVENTS.STALL, () => this.hud.notify('Stall! Lower the nose and add power', 'bad', 3.5));
    ac.on(EVENTS.OVERSPEED, () => {
      this.audio.available && this.audio.alerts.overspeed();
      this.hud.notify('Too fast! Reduce power and level off', 'bad', 3.5);
    });
    ac.on(EVENTS.FUEL_LOW, () => {
      this.audio.available && this.audio.alerts.lowFuel();
      this.hud.notify('Low fuel — head back to the airfield', 'warn', 6);
    });
  }

  onMissionStep(step, i, total) {
    const title = this.runner.def.name + (total > 1 ? ` · step ${i + 1} of ${total}` : '');
    this.hud.setObjective(title, step.text);
    if (i > 0) this.audio.available && this.audio.alerts.checkpoint();
  }

  onMissionEvent(e) {
    if (e.type === 'checkpoint') {
      this.audio.available && this.audio.alerts.checkpoint();
      this.hud.notify(
        e.remaining > 0 ? `Ring passed! ${e.remaining} to go` : 'Last ring — nicely flown!',
        'good',
        2.6
      );
    } else if (e.type === 'hint') {
      this.hud.notify(`Hint: ${e.text}`, 'info', 6);
    }
  }

  onMissionComplete(result) {
    const isTutorial = result.id === 'tutorial';
    if (isTutorial) {
      this.progress.tutorialComplete = true;
      saveProgress(this.progress);
    } else if (result.id !== 'free') {
      this.progress = recordMission(this.progress, result.id, { score: result.score, time: result.time });
    }
    this.menus.syncProgress(this.progress);
    this.audio.available && this.audio.alerts.success();
    const mins = Math.floor(result.time / 60);
    const secs = Math.round(result.time % 60);
    const l = result.landing;
    const body = `
      <div class="debrief-score">${result.score}<span>/100</span></div>
      <ul class="debrief-list">
        <li>Time <b>${mins}m ${String(secs).padStart(2, '0')}s</b></li>
        ${l ? `<li>Touchdown <b>${Math.abs(l.vsFpm)} ft/min</b> (${l.quality})</li>` : ''}
        ${l ? `<li>Landing score <b>${l.score}/100</b></li>` : ''}
        ${l && l.onRunway ? `<li>Distance from centreline <b>${l.centreline} m</b></li>` : ''}
      </ul>
      <p>${isTutorial ? 'You have finished flight school — you are cleared for solo flight!' : 'Mission complete. Try it again for a better score, or take on another one.'}</p>
    `;
    const actions = [
      { label: 'Fly again', onClick: () => this.restart(), primary: true },
      { label: 'Missions', onClick: () => this.quitToMenu('missions') },
      { label: 'Main menu', onClick: () => this.quitToMenu('main') },
    ];
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: isTutorial ? 'Flight school complete!' : 'Mission complete!',
      kind: 'good',
      body,
      actions,
    });
  }

  onMissionFail(f) {
    this.audio.available && this.audio.alerts.failure();
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: 'Mission not completed',
      kind: 'bad',
      body: `<p class="debrief-reason">${f.reason}</p><p>Everybody walks away in this simulator. Have another go — you get better every time.</p>`,
      actions: [
        { label: 'Try again', onClick: () => this.restart(), primary: true },
        { label: 'Missions', onClick: () => this.quitToMenu('missions') },
        { label: 'Main menu', onClick: () => this.quitToMenu('main') },
      ],
    });
  }

  showCrashDebrief(reason) {
    if (this.runner.status === STATUS.RUNNING || this.runner.status === STATUS.FAILED) return;
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: 'Crashed',
      kind: 'bad',
      body: `<p class="debrief-reason">${reason}</p><p>No harm done — this is a simulator. Reset and try again.</p>`,
      actions: [
        { label: 'Reset on the runway', onClick: () => this.restart(), primary: true },
        { label: 'Main menu', onClick: () => this.quitToMenu('main') },
      ],
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mode control                                                        */
  /* ------------------------------------------------------------------ */

  async startMode(mode, opts = {}) {
    await this.unlockAudio();
    this.mode = mode;
    this.modeOpts = opts;
    this.menus.hide();
    this.hud.setVisible(true);
    this.hud.hideControls();
    this.hud.clearTransient();
    this.autopilot.setEngaged(false, this.aircraft);
    this.hud.setAutopilot(false);
    this.hud.setGuideActive(this.navGuide.enabled);
    this.atc.reset();
    this.removeCrate();
    this.hasCargo = false;
    this.progress.flights++;
    saveProgress(this.progress);

    let def = FREE_FLIGHT;
    if (mode === 'tutorial') def = TUTORIAL;
    else if (mode === 'mission') def = findMission(opts.id) || FREE_FLIGHT;

    // Weather.
    if (mode === 'free') {
      this.weather.load(opts);
      this.settings.weather = this.weather.serialize();
      saveSettings(this.settings);
    } else if (def.weather) {
      this.weather.load(def.weather);
    }

    // Spawn.
    const spawn = def.spawn || RUNWAY_START;
    const airborne = mode === 'free' ? !!opts.airborne : spawn.altAGL != null;
    if (mode === 'free' && airborne) {
      this.aircraft.reset({
        pos: new THREE.Vector3(-3400, 0, 300),
        headingDeg: 90,
        speed: 60,
        altAGL: 610,
        engineOn: true,
      });
      this.aircraft.controls.throttle = 0.7;
      this.input.throttleTarget = 0.7;
    } else {
      this.aircraft.reset({
        pos: spawn.pos ? spawn.pos.clone() : RUNWAY_START.pos.clone(),
        headingDeg: spawn.headingDeg ?? 90,
        speed: spawn.speed || 0,
        altAGL: spawn.altAGL ?? null,
        engineOn: spawn.engineOn !== false,
      });
      if (spawn.speed) {
        this.aircraft.controls.throttle = 0.65;
        this.input.throttleTarget = 0.65;
      } else {
        this.input.throttleTarget = 0;
      }
    }
    this.aircraft.mode = this.settings.flightMode;
    this.input.out.throttle = this.aircraft.controls.throttle;

    // Camera: cockpit for the tutorial (you learn the instruments), chase otherwise.
    this.rig.setMode(mode === 'tutorial' ? 'chase' : 'chase');
    this.rig.reducedMotion = this.settings.reducedMotion;

    if (this.audio.available && this.settings.music) this.audio.music.stop();

    if (def.steps && def.steps.length) {
      this.runner.start(def);
    } else {
      this.runner.status = STATUS.IDLE;
      this.runner.def = null;
      this.runner.clearGates();
      this.hud.setObjective(
        'Free Flight',
        airborne
          ? 'You are already flying. Explore the islands, then land back on runway 09 when you like.'
          : 'Take off from runway 09, explore the islands, and land whenever you like.'
      );
    }

    this.state = 'flying';
    this.clock.getDelta();
  }

  restart() {
    if (this.mode) this.startMode(this.mode, this.modeOpts);
    else this.quitToMenu('main');
  }

  returnToAirport() {
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
    this.input.throttleTarget = 0;
    this.atc.reset();
    this.removeCrate();
    this.hud.clearTransient();
    this.hud.notify('Back on runway 09, ready to go again.', 'info', 3.4);
    if (this.runner.status === STATUS.RUNNING) {
      // Restart the current mission from the top: fairer than resuming mid-step.
      this.runner.start(this.runner.def);
    }
    this.state = 'flying';
    this.menus.hide();
    this.hud.setVisible(true);
  }

  quitToMenu(screen = 'main') {
    this.state = 'menu';
    this.mode = null;
    this.runner.status = STATUS.IDLE;
    this.runner.clearGates();
    this.removeCrate();
    this.hud.setVisible(false);
    this.hud.hideControls();
    this.menus.syncProgress(this.progress);
    this.menus.show(screen);
    if (this.audio.available && this.settings.music) this.audio.music.start();
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
  }

  pause() {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    const r = this.aircraft.readouts();
    this.menus.setPauseInfo(`
      <div class="pause-grid">
        <span>Speed<b>${Math.round(r.iasKts)} kt</b></span>
        <span>Height<b>${Math.round(r.altFt).toLocaleString('en-GB')} ft</b></span>
        <span>Heading<b>${String(Math.round(r.heading)).padStart(3, '0')}°</b></span>
        <span>Fuel<b>${Math.round(r.fuelPct * 100)}%</b></span>
        <span>Wind<b>${Math.round(this.weather.windSpeedKts)} kt</b></span>
        <span>View<b>${VIEW_LABELS[this.rig.mode]}</b></span>
      </div>
    `);
    this.menus.show('pause');
    this.audio.available && this.audio.mixer.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.hide();
    this.hud.setVisible(true);
    this.state = 'flying';
    this.clock.getDelta();
    this.audio.available && this.audio.mixer.resume();
  }

  pauseAction(a) {
    if (a === 'resume') this.resume();
    else if (a === 'restart') {
      this.menus.hide();
      this.restart();
    } else if (a === 'airport') this.returnToAirport();
    else if (a === 'quit') this.quitToMenu('main');
  }

  hudAction(a) {
    switch (a) {
      case 'pause':
        this.state === 'paused' ? this.resume() : this.pause();
        break;
      case 'camera':
        this.hud.notify(`View: ${VIEW_LABELS[this.rig.cycle()]}`, 'info', 1.8);
        break;
      case 'restart':
        this.restart();
        break;
      case 'airport':
        this.returnToAirport();
        break;
      case 'mute':
        this.settings.muted = !this.settings.muted;
        this.audio.setMuted(this.settings.muted);
        this.hud.setMuted(this.settings.muted);
        this.menus.syncSound(this.settings.muted);
        saveSettings(this.settings);
        break;
      case 'guide':
        this.toggleGuide();
        break;
      case 'autopilot':
        this.toggleAutopilot();
        break;
      case 'hideUi':
        // Cinematic view. The button disappears along with everything else, so
        // the keyboard is the only way back — say so before it goes.
        this.toggleHideUi();
        break;
      case 'help':
        this.hud.toggleControls(this.input.bindings, keyLabel, ACTIONS);
        break;
    }
  }

  /** Hide the whole interface for a clean shot. U is the way back. */
  toggleHideUi() {
    const hidden = this.hud.toggleHidden();
    if (!hidden) this.hud.notify('Interface back on', 'info', 1.6);
    return hidden;
  }

  toggleGuide() {
    const on = this.navGuide.toggle();
    this.settings.guidance = on;
    saveSettings(this.settings);
    this.hud.setGuideActive(on);
    this.hud.notify(
      on ? 'Guidance lines on — fly between them' : 'Guidance lines off',
      'info',
      2.4
    );
    return on;
  }

  /**
   * Autopilot. Holds the wings level and the height steady, and steers towards
   * whatever you are supposed to be heading for. Touching the stick switches it
   * off, exactly like the real thing — you should never have to fight it.
   */
  toggleAutopilot(force) {
    const want = force === undefined ? !this.autopilot.engaged : !!force;
    if (want && this.aircraft.onGround) {
      this.hud.notify('Autopilot needs you to be flying first', 'warn', 2.6);
      return false;
    }
    const on = this.autopilot.setEngaged(want, this.aircraft);
    this.hud.setAutopilot(on);
    if (on) {
      this.hud.notify(
        `Autopilot on — holding ${Math.round(this.autopilot.targetAltFt)} ft. Move the stick to take over.`,
        'good',
        4
      );
    } else {
      this.hud.notify('Autopilot off — you have control', 'info', 2.4);
    }
    this.audio.available && this.audio.alerts.uiClick();
    return on;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  applySetting(path, value) {
    const parts = path.split('.');
    let obj = this.settings;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    saveSettings(this.settings);

    if (path.startsWith('volumes.')) {
      this.audio.setVolume(parts[1], value);
    } else if (path === 'muted') {
      this.audio.setMuted(value);
      this.hud.setMuted(value);
    } else if (path === 'music') {
      this.audio.setMusicEnabled(value);
      if (value && this.state === 'menu') this.audio.music.start();
    } else if (path === 'atcVoice') {
      this.audio.radio.setMode(value);
      this.hud.notify(
        value === 'speech'
          ? "ATC now uses your device's speech voice"
          : value === 'recordings'
            ? 'ATC will play your own clips from assets/atc/ where you have them'
            : 'ATC back to the synthesised radio',
        'info',
        3.2
      );
    } else if (path === 'atcChatter') {
      this.audio.radio.backgroundChatter = value;
    } else if (path === 'flightMode') {
      this.aircraft.mode = value;
      this.hud.notify(
        value === 'simplified'
          ? 'Easy mode: the aeroplane helps keep the wings level.'
          : 'Real mode: full control — it can stall now.',
        'info',
        4
      );
    } else if (path === 'quality') {
      this.rebuildQuality(value);
    } else if (path === 'subtitles') {
      this.hud.setSubtitlesEnabled(value);
    } else if (path === 'highContrast') {
      this.hud.setHighContrast(value);
      document.body.classList.toggle('is-contrast', !!value);
    } else if (path === 'largeText') {
      this.hud.setLargeText(value);
      document.body.classList.toggle('is-large', !!value);
    } else if (path === 'guidance') {
      this.navGuide.setEnabled(value);
      this.hud.setGuideActive(value);
    } else if (path === 'realisticFuel') {
      this.aircraft.realisticFuel = value;
      this.hud.notify(
        value
          ? 'Realistic fuel on — a full tank lasts about 50 minutes. Watch the gauge.'
          : 'Realistic fuel off',
        'info',
        3.5
      );
    } else if (path === 'randomWinds') {
      this.weather.setRandomWinds(value);
      this.hud.notify(
        value
          ? 'Random winds on — expect gusts. Watch the wind arrow.'
          : 'Random winds off — steady wind again',
        'info',
        3.5
      );
    } else if (path === 'reducedMotion') {
      this.rig.reducedMotion = value;
    } else if (path === 'mouseFlying') {
      this.input.requestMouseFlying(value);
    } else if (path === 'invertMouse') {
      this.input.invertMouse = value;
    } else if (path === 'sensitivity') {
      this.input.sensitivity = value;
    } else if (path === 'gamepad') {
      this.input.gamepadEnabled = value;
    }
  }

  rebuildQuality(quality) {
    if (quality === this.qualityBuilt) return;
    this.hud.notify('Rebuilding the island…', 'info', 2.5);
    // Give the message a frame to paint before the (blocking) rebuild.
    requestAnimationFrame(() => {
      this.buildWorld(quality);
      this.renderer.shadowMap.enabled = quality !== 'low';
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
      this.sky.update(this.weather);
    });
  }

  /**
   * Fly somewhere else. The runway is identical on every map, so the tutorial,
   * every mission and the landing scoring all carry over untouched — only the
   * land around the field changes.
   */
  setMap(id) {
    const def = applyMap(id);
    this.settings.map = def.id;
    saveSettings(this.settings);
    this.menus.syncMap(def.id);
    if (this.state === 'flying') this.quitToMenu();
    this.hud.notify(`Flying to ${def.name}…`, 'info', 3);
    // One frame so the message paints before the (blocking) rebuild.
    requestAnimationFrame(() => {
      this.buildWorld(this.settings.quality);
      // Each map has weather that suits it; the player can still change it in
      // Free Flight afterwards.
      this.weather.load({
        time: def.weather.time,
        condition: def.weather.cond,
        windSpeedKts: def.weather.windSpeedKts,
        windDirDeg: def.weather.windDirDeg,
      });
      this.settings.weather = this.weather.serialize();
      saveSettings(this.settings);
      this.menus.syncSettings(this.settings);
      this.sky.update(this.weather);
      this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
      this.hud.clearTransient();
      this.hud.notify(`${def.name} — ${def.subtitle}`, 'good', 5);
    });
    return def;
  }

  async unlockAudio() {
    if (this.audio.started || this._unlocking) return;
    this._unlocking = true;
    const ok = await this.audio.start();
    this._unlocking = false;
    if (!ok) {
      this.hud && this.hud.notify('Sound is unavailable in this browser — everything else still works.', 'warn', 6);
      return;
    }
    for (const bus in this.settings.volumes) this.audio.setVolume(bus, this.settings.volumes[bus]);
    this.audio.setMuted(this.settings.muted);
    this.audio.setMusicEnabled(this.settings.music);
    this.audio.radio.backgroundChatter = this.settings.atcChatter;
    this.audio.radio.setMode(this.settings.atcVoice || 'radio');
    if (this.settings.music && this.state === 'menu') this.audio.music.start();
  }

  /* ------------------------------------------------------------------ */
  /* PWA                                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Catch a whole class of bug that has now bitten this project twice: a
   * full-screen panel carrying the `hidden` attribute, whose class also sets
   * `display`, which beats `[hidden]` and leaves an invisible — or worse, a
   * near-opaque black — sheet over the entire game swallowing every click.
   *
   * Cheap, runs once, and says exactly which element is at fault.
   */
  checkForStuckOverlays() {
    try {
      for (const el of document.querySelectorAll('[hidden]')) {
        if (getComputedStyle(el).display !== 'none') {
          console.error(
            `[island-flight] "${el.id || el.className}" has the hidden attribute but is still ` +
              `displayed (display: ${getComputedStyle(el).display}). Add a ` +
              `"${el.id ? '#' + el.id : '.' + el.className.split(' ')[0]}[hidden] { display: none; }" rule.`
          );
        }
      }
      // And confirm nothing is sitting on top of the middle of the screen.
      const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (top && top.id === 'fatal') {
        console.error('[island-flight] the error panel is covering the game — see above.');
      }
    } catch {
      /* diagnostics must never break the game */
    }
  }

  setupPwa() {
    // ?dev=1 skips (and clears) the service worker. Cache-first offline support
    // is exactly what you want for players and exactly what you do not want
    // while editing the game, because reloads keep serving the old files.
    const params = new URLSearchParams(location.search);
    const devMode = params.has('dev');
    if ('serviceWorker' in navigator && devMode) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      console.info('[dev] service worker disabled for this session');
    } else if ('serviceWorker' in navigator) {
      // A new version has to be able to replace an old one even if the old one
      // is misbehaving. Check on every load, and reload once as soon as a new
      // worker takes over — otherwise the page you are looking at keeps the
      // files it was given, and an update can appear to do nothing at all.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (this._reloadingForUpdate) return;
        this._reloadingForUpdate = true;
        console.info('[sw] new version installed — reloading');
        location.reload();
      });
      // Boot is async and takes a second or two, so the window 'load' event has
      // usually already fired by the time we get here — registering on that
      // event alone means it never happens and offline play silently breaks.
      const register = () =>
        navigator.serviceWorker
          .register('sw.js')
          .then((reg) => reg.update())
          .catch((err) => {
            console.warn('Offline support unavailable:', err);
          });
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }

    // Escape hatch. If a cached copy ever goes wrong, ?reset=1 throws away
    // every service worker and cache and reloads clean.
    if (params.has('reset')) {
      const wipe = async () => {
        if ('serviceWorker' in navigator) {
          const rs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(rs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const ks = await caches.keys();
          await Promise.all(ks.map((k) => caches.delete(k)));
        }
        location.replace(location.pathname);
      };
      wipe();
      return;
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.menus.showInstall(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.menus.setInstalled();
    });
    if (window.matchMedia('(display-mode: standalone)').matches) this.menus.setInstalled();
  }

  async promptInstall() {
    if (!this.installPrompt) {
      alert(
        'Your browser has not offered an install prompt yet.\n\n' +
          'In Chrome or Edge, use the ⊕ / install icon in the address bar.\n' +
          'On iPhone or iPad, tap Share then "Add to Home Screen".\n\n' +
          'The game caches itself as soon as it loads, so it already works offline.'
      );
      return;
    }
    this.installPrompt.prompt();
    const choice = await this.installPrompt.userChoice;
    if (choice.outcome === 'accepted') this.menus.setInstalled();
    this.installPrompt = null;
  }

  /* ------------------------------------------------------------------ */
  /* Radio + notifications used by missions                              */
  /* ------------------------------------------------------------------ */

  speak(text, voice = 'tower', urgency = 0) {
    if (this.audio.available) this.audio.radio.transmit(text, { voice, urgency });
    else this.hud.setSubtitle(text, voice, 4);
  }

  notify(text, kind = 'info') {
    this.hud.notify(text, kind);
  }

  dropCargo() {
    if (!this.hasCargo || this.crate) return false;
    const offset = new THREE.Vector3(0, -1.6, 0).applyQuaternion(this.aircraft.quat).add(this.aircraft.pos);
    this.crate = new CargoCrate(this.scene, offset, this.aircraft.vel);
    this.hasCargo = false;
    this.hud.notify('Crate released — parachute out!', 'good', 3);
    this.audio.available && this.audio.ambience.playFlaps();
    return true;
  }

  removeCrate() {
    if (this.crate) {
      this.crate.dispose();
      this.crate = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                          */
  /* ------------------------------------------------------------------ */

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  handleDiscreteInput() {
    const input = this.input;
    const ac = this.aircraft;
    const pad = input.padEdges;

    if (input.pressed('pause') || (pad && pad.pause)) {
      if (this.state === 'flying') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'menu' && this.menus.current !== 'main') this.menus.show('main');
    }
    if (this.state !== 'flying') return;

    if (input.pressed('camera') || (pad && pad.camera)) {
      this.hud.notify(`View: ${VIEW_LABELS[this.rig.cycle()]}`, 'info', 1.8);
      this.runner.data.cameraChanged = true;
    }
    if (input.pressed('gear') || (pad && pad.gear)) {
      if (!ac.toggleGear()) this.hud.notify('Too fast for the landing gear — slow down first', 'warn', 3);
    }
    if (input.pressed('flapsDown')) {
      const s = ac.setFlaps(ac.flapStep() + 1);
      this.audio.available && this.audio.ambience.playFlaps();
      this.hud.notify(`Flaps ${s * 10}° — more lift, more drag`, 'info', 2.4);
    }
    if (input.pressed('flapsUp')) {
      const s = ac.setFlaps(ac.flapStep() - 1);
      this.audio.available && this.audio.ambience.playFlaps();
      this.hud.notify(`Flaps ${s * 10}°`, 'info', 2);
    }
    if (input.pressed('starter')) {
      if (ac.engineOn) ac.stopEngine('shutdown');
      else ac.startEngine();
    }
    if (input.pressed('drop') || (pad && pad.drop)) {
      if (!this.dropCargo()) this.hud.notify('Nothing to drop right now', 'info', 2);
    }
    if (input.pressed('help')) this.hud.toggleControls(this.input.bindings, keyLabel, ACTIONS);
    if (input.pressed('guide')) this.toggleGuide();
    if (input.pressed('autopilot')) this.toggleAutopilot();
    if (input.pressed('hideUi')) this.toggleHideUi();
    if (input.pressed('mute')) this.hudAction('mute');
  }

  update(dt) {
    const ac = this.aircraft;

    if (this.state === 'flying') {
      const ctrl = this.input.update(dt, { simple: ac.mode === 'simplified' });
      let pitch = ctrl.pitch;
      let roll = ctrl.roll;
      let yaw = ctrl.yaw;
      let throttle = ctrl.throttle;

      // Autopilot, if it is on and you have not grabbed the controls back.
      // Note the locals: `ctrl` belongs to the input module and is reused every
      // frame, so writing the autopilot's output into it would come straight
      // back next frame looking exactly like the player moving the stick.
      if (this.autopilot.engaged) {
        if (this.autopilot.playerTookOver(ctrl) || ac.onGround || ac.crashed) {
          this.toggleAutopilot(false);
        } else {
          const t = this.activeTarget ? this.activeTarget.pos : null;
          const ap = this.autopilot.update(dt, ac, t);
          pitch = ap.pitch;
          roll = ap.roll;
          yaw = ap.yaw;
          throttle = ap.throttle;
          this.input.throttleTarget = ap.throttle;
          this.hud.setAutopilot(true, this.autopilot.status(t));
        }
      }

      ac.controls.pitch = pitch;
      ac.controls.roll = roll;
      ac.controls.yaw = yaw;
      ac.controls.throttle = throttle;
      ac.controls.brakes = ctrl.brakes;
      // Test / debug hook: lets the self-test fly the aeroplane as if it were
      // holding the controls. Ignored entirely during normal play.
      if (this.override) {
        for (const k in this.override) {
          if (this.override[k] !== null && this.override[k] !== undefined) ac.controls[k] = this.override[k];
        }
      }
    } else {
      this.input.update(dt, { simple: true });
    }
    this.handleDiscreteInput();

    this.weather.update(dt);

    if (this.state === 'flying') {
      // Fixed-step physics for consistent behaviour on any refresh rate.
      const STEP = 1 / 120;
      this.acc += Math.min(dt, 0.1);
      let steps = 0;
      while (this.acc >= STEP && steps < 12) {
        ac.update(STEP, this.weather);
        this.acc -= STEP;
        steps++;
      }
      this.runner.update(dt);
      this.atc.update(dt);
      this.activeTarget = this.runner.activeTarget();
      if (this.crate) this.crate.update(dt, heightAt, this.weather.windVector());
    }

    // World.
    this.sky.update(this.weather);
    this.sky.followTarget(ac.pos);
    this.ocean.follow(ac.pos);
    this.ocean.update(dt, this.weather);
    this.airport.update(dt, this.weather);
    this.scenery.update(dt, this.weather);
    this.clouds.update(dt, this.weather, ac.pos);
    this.rain.update(dt, this.weather, this.camera.position, ac.vel);
    this.cloudImmersion = this.clouds.cloudImmersion(ac.pos.y, this.weather);
    this.papiHint = this.airport.updatePapi(ac.pos);

    // Aeroplane + cockpit.
    this.model.position.copy(ac.pos);
    this.model.quaternion.copy(ac.quat);
    this.model.userData.update(dt, ac, this.weather);
    const inCockpit = this.rig.mode === 'cockpit';
    this.cockpit.visible = inCockpit;
    if (inCockpit) this.cockpit.userData.update(dt, ac, this.weather);
    this.audio.setInterior(inCockpit);

    this.rig.update(dt, ac, this.input, this.weather);

    // Extra fog inside cloud gives a genuine whiteout.
    if (this.cloudImmersion > 0.01) {
      const p = this.weather.palette();
      this.scene.fog.density = p.fogDensity + this.cloudImmersion * 0.0045;
      this.scene.fog.color.copy(p.fogColor).lerp(new THREE.Color(0xdfe6ee), this.cloudImmersion * 0.7);
    }

    // Navigation guidance: the mission's current target, or the runway when
    // there is nothing else to aim at.
    if (this.navGuide) {
      let guideTarget = this.activeTarget ? this.activeTarget.pos : null;
      if (!guideTarget && this.state === 'flying' && !ac.onGround) guideTarget = RUNWAY.touchdown;
      this.navGuide.update(
        dt,
        this.state === 'flying' ? guideTarget : null,
        ac.pos,
        ac.quat,
        this.camera.position
      );
    }

    this.audio.update(dt, ac, this.weather, this.cloudImmersion);
    if (this.state === 'flying') {
      this.hud.setCoach(this.coachHint(ac));
      this.hud.update(dt, this);
    }
    this.input.endFrame();
  }

  /* ------------------------------------------------------------------ */
  /* Headless driver — used by the automated checks and handy for debugging.
     Advances the simulation by a fixed amount without waiting for frames.   */
  /* ------------------------------------------------------------------ */

  step(seconds = 1, dt = 1 / 60) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    return this.snapshot();
  }

  /** Compact state dump for tests. */
  snapshot() {
    const r = this.aircraft.readouts();
    const step = this.runner.step;
    return {
      state: this.state,
      mode: this.mode,
      view: this.rig.mode,
      pos: [Math.round(this.aircraft.pos.x), Math.round(this.aircraft.pos.y), Math.round(this.aircraft.pos.z)],
      ias: Math.round(r.iasKts),
      altFt: Math.round(r.altFt),
      aglFt: Math.round(r.aglFt),
      vsFpm: Math.round(r.vsFpm),
      heading: Math.round(r.heading),
      throttle: Math.round(r.throttle * 100),
      fuelPct: Math.round(r.fuelPct * 100),
      onGround: r.onGround,
      gearDown: r.gearDown,
      flaps: r.flapStep,
      stalled: r.stalled,
      engineOn: r.engineOn,
      crashed: this.aircraft.crashed,
      crashReason: this.aircraft.crashReason,
      lastTouchdown: this.aircraft.lastTouchdown,
      missionStatus: this.runner.status,
      stepId: step ? step.id : null,
      objective: this.hud.objectiveText.textContent,
      papi: this.papiHint ? this.papiHint.state : null,
      weather: this.weather.serialize(),
      target: this.activeTarget ? this.activeTarget.label : null,
      fps: this.fps,
    };
  }

  /** Press / release a bound action the way a real keyboard would. */
  key(code, down = true) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  }

  tap(code) {
    this.key(code, true);
    this.key(code, false);
  }

  /**
   * The single most useful thing to press right now, named explicitly. New
   * pilots do not need a manual, they need to know that Shift is power and that
   * S is back-pressure — at the moment it matters.
   */
  coachHint(ac) {
    const r = ac.readouts();
    const kts = r.iasKts;

    if (ac.crashed) return 'Press <kbd>Esc</kbd> and choose <b>Restart</b> to try again';
    if (!ac.engineOn && ac.rpm < 0.05) return 'Press <kbd>I</kbd> to start the engine';

    if (ac.onGround) {
      // Rolling fast with the power already off: they want the brakes.
      if (r.throttle < 0.2 && ac.groundSpeed > 6) return 'Hold <kbd>Space</kbd> to brake';
      if (r.throttle < 0.85) return 'Hold <kbd>Shift</kbd> for full power';
      if (kts > 52) return 'Now pull back gently on <kbd>S</kbd> to fly!';
      if (kts > 12) return 'Keep straight with <kbd>Q</kbd> / <kbd>E</kbd> — lift off at 55 knots';
      return 'Hold <kbd>Shift</kbd> — you need 55 knots to fly';
    }

    // Airborne.
    if (kts > 150) return 'Far too fast — ease the power right off with <kbd>Ctrl</kbd> and level the wings';
    if (kts < 52) return 'Too slow! Add power with <kbd>Shift</kbd> and lower the nose with <kbd>W</kbd>';
    if (ac.stalled) return 'Push the nose down with <kbd>W</kbd> and add power';
    if (ac.airborneTime < 8) return 'Climbing — keep the nose just above the horizon';

    // On final approach to runway 09.
    const onFinal =
      ac.pos.x < RUNWAY.thresholdWest.x &&
      ac.pos.x > RUNWAY.thresholdWest.x - 5000 &&
      r.aglFt < 900 &&
      Math.abs(((r.heading - 90 + 540) % 360) - 180) < 45;
    if (onFinal) {
      if (!r.gearDown) return 'Landing gear! Press <kbd>G</kbd> before you land';
      if (this.papiHint && this.papiHint.state === 'low') return 'Too low — add power with <kbd>Shift</kbd>';
      if (this.papiHint && this.papiHint.state === 'high') return 'Too high — ease the power off with <kbd>Ctrl</kbd>';
      if (kts > 95) return 'Too fast to land — ease the power off with <kbd>Ctrl</kbd> (aim for 70 knots)';
      if (r.flapStep === 0 && kts < 100) return 'Press <kbd>F</kbd> for flaps — they help you fly slowly';
      if (r.aglFt < 60) return 'Ease back on <kbd>S</kbd> just before the wheels touch';
      return 'Follow the PAPI lights — two white, two red';
    }
    return null;
  }

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      let dt = this.clock.getDelta();
      if (dt > 0.25) dt = 0.25; // after a tab switch, do not jump
      try {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        console.error(err);
        if (!this._errored) {
          this._errored = true;
          fatal('The simulator hit an unexpected error while running.', err && err.stack);
        }
        return;
      }
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 1) {
        this.fps = Math.round(this.fpsFrames / this.fpsTime);
        this.fpsFrames = 0;
        this.fpsTime = 0;
        this.menus.updateFps(this.fps);
      }
    };
    tick();
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error(err);
  fatal('The simulator could not start.', err && err.stack);
});

export default game;
