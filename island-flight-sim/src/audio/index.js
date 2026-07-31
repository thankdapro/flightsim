/**
 * Audio facade: one object the rest of the game talks to.
 */

import { AudioMixer, BUSES } from './mixer.js';
import { EngineSound } from './engine.js';
import { Ambience } from './ambience.js';
import { Radio } from './atc.js';
import { Alerts } from './alerts.js';
import { Music } from './music.js';

export class GameAudio {
  constructor() {
    this.mixer = new AudioMixer();
    this.engine = new EngineSound(this.mixer);
    this.ambience = new Ambience(this.mixer);
    this.radio = new Radio(this.mixer);
    this.alerts = new Alerts(this.mixer);
    this.music = new Music(this.mixer);
    this.started = false;
    this.musicEnabled = true;
    this._lastFlash = 0;
  }

  /** Called from the first click/keypress — browsers require a gesture. */
  async start() {
    const ok = await this.mixer.ensure();
    if (!ok) return false;
    this.engine.build();
    this.ambience.build();
    this.radio.build();
    this.alerts.build();
    this.music.build();
    this.started = true;
    return true;
  }

  get available() {
    return this.started && !this.mixer.failed;
  }

  setVolume(bus, v) {
    this.mixer.setVolume(bus, v);
  }

  setMuted(m) {
    this.mixer.setMuted(m);
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (!on) this.music.stop();
  }

  setInterior(inside) {
    this.engine.setInterior(inside);
    this.ambience.setInterior(inside);
  }

  update(dt, ac, weather, cloudImmersion) {
    if (!this.available) return;
    this.engine.update(dt, ac, weather);
    this.ambience.update(dt, ac, weather, cloudImmersion);
    this.alerts.update(dt, ac, weather);
    this.radio.update(dt, weather);
    this.music.update(dt);

    // Thunder follows the lightning flash.
    if (weather.lightningFlash > 0.9 && this._lastFlash <= 0.9) {
      const distance = Math.random();
      setTimeout(() => this.ambience.playThunder(distance), 300 + distance * 3200);
    }
    this._lastFlash = weather.lightningFlash;
  }

  volumes() {
    return { master: this.mixer.volumes.master, ...BUSES.reduce((o, b) => ((o[b] = this.mixer.volumes[b]), o), {}) };
  }
}
