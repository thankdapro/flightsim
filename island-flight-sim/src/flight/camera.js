/**
 * Camera rig: cockpit, chase, orbit, wing and tower views.
 *
 * The cockpit view sits in the left seat and shakes with the engine, the
 * airframe buffet and every touchdown. The chase view is spring-damped so it
 * trails the aeroplane the way a camera aircraft would.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from '../core/noise.js';
import { heightAt } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';

export const VIEWS = ['cockpit', 'chase', 'orbit', 'wing', 'tower'];
export const VIEW_LABELS = {
  cockpit: 'Cockpit',
  chase: 'Follow',
  orbit: 'Orbit',
  wing: 'Wing',
  tower: 'Tower',
};

// Left seat, eye height chosen so you look *over* the engine cowling — the
// single most important measurement in a cockpit view.
const EYE = new THREE.Vector3(-0.24, 0.3, -0.28);

export class CameraRig {
  constructor(camera, aircraft) {
    this.camera = camera;
    this.ac = aircraft;
    this.mode = 'chase';
    this.reducedMotion = false;

    this.chasePos = new THREE.Vector3();
    this.chaseVel = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.orbitAngle = 0.6;
    this.orbitHeight = 0.35;
    this.orbitDist = 26;

    this.shake = 0;
    this.shakeDecay = 0;
    this.t = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._targetQ = new THREE.Quaternion();
    this.initialised = false;
    this.baseFov = 68;
  }

  setMode(m) {
    if (!VIEWS.includes(m)) return;
    this.mode = m;
    this.initialised = false;
  }

  cycle() {
    const i = VIEWS.indexOf(this.mode);
    this.setMode(VIEWS[(i + 1) % VIEWS.length]);
    return this.mode;
  }

  /** Add a one-off jolt (touchdown, crash, gust). */
  kick(amount) {
    if (this.reducedMotion) amount *= 0.25;
    this.shake = Math.min(1.4, this.shake + amount);
  }

  update(dt, ac, input, weather) {
    this.t += dt;
    const cam = this.camera;
    const pos = ac.pos;

    // Continuous vibration: engine + buffet + rolling on the ground.
    let vib = ac.rpm * 0.016 + ac.buffet * 0.06;
    if (ac.onGround && ac.groundSpeed > 1) vib += clamp(ac.groundSpeed / 60, 0, 1) * 0.03;
    if (this.reducedMotion) vib *= 0.25;
    this.shake = Math.max(0, this.shake - dt * 2.4);

    const shakeAmp = vib + this.shake * 0.35;
    const sx = Math.sin(this.t * 61) * shakeAmp + Math.sin(this.t * 27.3) * shakeAmp * 0.6;
    const sy = Math.sin(this.t * 53.7 + 1.3) * shakeAmp + Math.sin(this.t * 19.1) * shakeAmp * 0.5;
    const sz = Math.sin(this.t * 43.3 + 2.7) * shakeAmp * 0.5;

    const lookYaw = input ? input.lookYaw : 0;
    const lookPitch = input ? input.lookPitch : 0;
    const lookBehind = input && input.held ? input.held('lookBehind') : false;

    if (this.mode === 'cockpit') {
      // Eye point rides with the airframe.
      const eye = this._tmp.copy(EYE).applyQuaternion(ac.quat).add(pos);
      cam.position.copy(eye);
      cam.position.x += sx * 0.5;
      cam.position.y += sy * 0.5;
      cam.position.z += sz * 0.5;
      this._targetQ.copy(ac.quat);
      // Head movement: glance into the turn a little, plus free look.
      const bank = ac.bankAngleDeg();
      const headYaw = lookBehind ? Math.PI : lookYaw - THREE.MathUtils.degToRad(bank) * 0.12;
      const headPitch = lookPitch + clamp(ac.gLoad - 1, -0.4, 0.4) * -0.06;
      const q = this._q.setFromEuler(new THREE.Euler(headPitch, headYaw, 0, 'YXZ'));
      cam.quaternion.copy(this._targetQ).multiply(q);
      cam.fov = lerp(cam.fov, this.baseFov + clamp(ac.airspeed / 90, 0, 1) * 4, clamp(dt * 3, 0, 1));
      cam.near = 0.08;
    } else if (this.mode === 'chase') {
      // Behind and above, blended between body-axis and velocity-axis so the
      // camera does not spin wildly during aerobatics.
      const back = this._tmp.set(0, 0, 1).applyQuaternion(ac.quat);
      const upV = this._tmp2.set(0, 1, 0).applyQuaternion(ac.quat).multiplyScalar(0.35).add(new THREE.Vector3(0, 0.65, 0));
      const dist = 17 + clamp(ac.airspeed / 12, 0, 9);
      const desired = new THREE.Vector3()
        .copy(pos)
        .addScaledVector(back, dist)
        .addScaledVector(upV.normalize(), 5.2 + ac.airspeed * 0.02);
      if (!this.initialised) {
        this.chasePos.copy(desired);
        this.initialised = true;
      }
      // Critically-damped spring.
      const k = 42;
      const c = 2 * Math.sqrt(k);
      const accel = new THREE.Vector3().subVectors(desired, this.chasePos).multiplyScalar(k);
      accel.addScaledVector(this.chaseVel, -c);
      this.chaseVel.addScaledVector(accel, Math.min(dt, 0.05));
      this.chasePos.addScaledVector(this.chaseVel, Math.min(dt, 0.05));
      // Never clip through the ground.
      const gh = heightAt(this.chasePos.x, this.chasePos.z) + 2.2;
      if (this.chasePos.y < gh) {
        this.chasePos.y = gh;
        this.chaseVel.y = Math.max(0, this.chaseVel.y);
      }
      cam.position.copy(this.chasePos);
      cam.position.x += sx * 0.35;
      cam.position.y += sy * 0.35;
      this.lookAt.lerp(pos, clamp(dt * 8, 0, 1));
      const aim = this._tmp.copy(this.lookAt);
      if (lookBehind) aim.copy(pos).addScaledVector(back, 60);
      cam.lookAt(aim);
      if (lookYaw || lookPitch) {
        cam.rotateY(lookYaw * 0.6);
        cam.rotateX(lookPitch * 0.4);
      }
      cam.fov = lerp(cam.fov, 62 + clamp(ac.airspeed / 90, 0, 1) * 8, clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.16;
      const d = this.orbitDist + clamp(ac.airspeed * 0.08, 0, 12);
      cam.position.set(
        pos.x + Math.cos(this.orbitAngle) * d,
        pos.y + 6 + Math.sin(this.t * 0.2) * 2,
        pos.z + Math.sin(this.orbitAngle) * d
      );
      const gh = heightAt(cam.position.x, cam.position.z) + 2.5;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.lookAt(pos);
      cam.fov = lerp(cam.fov, 58, clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'wing') {
      const offset = this._tmp.set(6.6, 0.6, 1.4).applyQuaternion(ac.quat).add(pos);
      cam.position.lerp(offset, clamp(dt * 9, 0, 1));
      cam.position.x += sx * 0.3;
      cam.position.y += sy * 0.3;
      const aim = this._tmp2.copy(pos);
      cam.lookAt(aim);
      cam.fov = lerp(cam.fov, 64, clamp(dt * 3, 0, 1));
      cam.near = 0.2;
    } else if (this.mode === 'tower') {
      // Fixed at the control tower cab, tracking the aeroplane.
      cam.position.set(40, RUNWAY.elev + 30, -206);
      cam.lookAt(pos);
      const dist = cam.position.distanceTo(pos);
      // Zoom in as the aeroplane gets further away, like a tower controller
      // following it with binoculars.
      cam.fov = lerp(cam.fov, clamp(60 - dist / 90, 12, 60), clamp(dt * 2, 0, 1));
      cam.near = 0.5;
    }

    cam.updateProjectionMatrix();
  }
}
