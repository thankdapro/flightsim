/**
 * Autopilot.
 *
 * Holds the wings level, holds the height it was engaged at, and — if the game
 * has given you somewhere to go — turns towards it. It works by moving the
 * controls, exactly as the beginner assists do, so it can never do anything
 * you could not do yourself and it behaves sensibly at any airspeed.
 *
 * Two rules keep it out of the way:
 *   1. Touching the stick hands control straight back to you.
 *   2. It refuses to fly you into the ground: below a safe height it climbs.
 *
 * It deliberately does not land the aeroplane. Landing is the game.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';

const M_TO_FT = 3.28084;
/** Below this height above ground the autopilot climbs instead of holding. */
const SAFE_AGL_FT = 500;
/** How far the player has to move a control before it counts as taking over. */
const TAKEOVER = 0.14;

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Autopilot {
  constructor() {
    this.engaged = false;
    this.targetAltFt = 1500;
    this.targetSpeedKts = 95;
    this.holdHeadingDeg = null;
    this._iAlt = 0;
    this._iSpd = 0;
  }

  /** @returns {boolean} whether it is now engaged */
  setEngaged(on, ac) {
    if (on && !this.engaged) {
      // Capture the current state so it does not lurch on engagement.
      const r = ac.readouts();
      // Hold the height you were at — but if you hand over low, climb to a
      // sensible 1,000 ft above the ground first. Nobody engages an autopilot
      // hoping to be left skimming the trees.
      const groundFt = r.altFt - r.aglFt;
      this.targetAltFt = clamp(
        Math.max(Math.round(r.altFt / 50) * 50, groundFt + 1000),
        400,
        12000
      );
      this.targetSpeedKts = clamp(Math.round(r.iasKts / 5) * 5, 70, 120);
      this.holdHeadingDeg = r.heading;
      this._iAlt = 0;
      this._iSpd = 0;
    }
    this.engaged = on;
    return this.engaged;
  }

  /** True if the player has moved a control enough to want it back. */
  playerTookOver(input) {
    return (
      Math.abs(input.pitch) > TAKEOVER ||
      Math.abs(input.roll) > TAKEOVER ||
      Math.abs(input.yaw) > TAKEOVER
    );
  }

  /**
   * Produce control positions. Call only when engaged.
   *
   * @param {object} ac the aeroplane
   * @param {THREE.Vector3|null} target where to steer, or null to hold heading
   * @returns {{pitch:number, roll:number, yaw:number, throttle:number}}
   */
  update(dt, ac, target) {
    const r = ac.readouts();

    /* ---- Where do we want to be pointing? ---- */
    let wantHeading = this.holdHeadingDeg;
    if (target) {
      _to.subVectors(target, ac.pos);
      // Heading is measured clockwise from north, and -Z is north.
      wantHeading = (Math.atan2(_to.x, -_to.z) * 180) / Math.PI;
      if (wantHeading < 0) wantHeading += 360;
    }
    let hdgErr = ((wantHeading - r.heading + 540) % 360) - 180;

    /* ---- Roll: turn towards the target, never steeply ---- */
    // A 25 degree bank is a comfortable rate-one turn in this aeroplane.
    const wantBankDeg = clamp(hdgErr * 0.8, -25, 25);
    const bankNowDeg = (ac.bankAngleRad() * 180) / Math.PI;
    const roll = clamp((wantBankDeg - bankNowDeg) * 0.055 - ac.omega.z * 0.55, -0.7, 0.7);

    /* ---- Pitch: hold height, but never fly into the ground ---- */
    let wantAlt = this.targetAltFt;
    if (r.aglFt < SAFE_AGL_FT) wantAlt = Math.max(wantAlt, r.altFt + (SAFE_AGL_FT - r.aglFt));
    const altErrFt = wantAlt - r.altFt;
    // Aim for a vertical speed proportional to the error, capped so it is
    // always a gentle ride.
    const wantVsFpm = clamp(altErrFt * 1.6, -700, 800);
    const vsErr = (wantVsFpm - r.vsFpm) / 1000;
    this._iAlt = clamp(this._iAlt + vsErr * dt * 0.35, -0.35, 0.35);
    // Steeper banks need back pressure or the nose drops through the turn.
    const bankLoad = Math.abs(bankNowDeg) / 25;
    let pitch = clamp(vsErr * 1.35 + this._iAlt - ac.omega.x * 0.5 + bankLoad * 0.06, -0.75, 0.85);

    // Stall guard: whatever else is going on, do not pull into a stall.
    if (r.iasKts < 58) pitch = Math.min(pitch, 0.05);

    /* ---- Throttle: hold the speed ---- */
    const spdErr = (this.targetSpeedKts - r.iasKts) / 40;
    this._iSpd = clamp(this._iSpd + spdErr * dt * 0.25, -0.35, 0.45);
    // Climbing costs power, descending gives it back.
    const climbBias = clamp(wantVsFpm / 900, -0.25, 0.3);
    const throttle = clamp(0.6 + spdErr * 0.8 + this._iSpd + climbBias, 0.12, 1);

    /* ---- Yaw: keep the turn coordinated ---- */
    const yaw = clamp(ac.beta * 1.6, -0.5, 0.5);

    return { pitch, roll, yaw, throttle };
  }

  /** One-line description for the HUD. */
  status(target) {
    const alt = `${Math.round(this.targetAltFt)} ft`;
    return target ? `AUTO · ${alt} · to target` : `AUTO · ${alt}`;
  }
}
