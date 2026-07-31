/**
 * The aeroplane: a high-wing four-seat trainer, built entirely from lofted
 * geometry so there is no model file to download.
 *
 * Everything that moves on a real aeroplane moves here too — ailerons,
 * elevator, rudder, flaps, propeller, spinning wheels, retracting gear,
 * navigation and strobe lights — driven from the flight model each frame.
 */

import * as THREE from '../vendor/three.module.js';
import {
  airframeTexture,
  airframeNormal,
  propTexture,
  propBlurTexture,
  leatherTexture,
} from '../render/textures.js';
import { clamp, lerp } from '../core/noise.js';

/** NACA-style aerofoil outline, chord along +X, thickness along +Y. */
function aerofoil(steps = 18, thickness = 0.13, camber = 0.022) {
  const pts = [];
  const yt = (x) =>
    5 *
    thickness *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < 0.4 ? (camber / 0.16) * (2 * 0.4 * x - x * x) : (camber / 0.36) * (1 - 2 * 0.4 + 2 * 0.4 * x - x * x));
  // Upper surface, leading edge → trailing edge.
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    pts.push(new THREE.Vector2(x, yc(x) + yt(x)));
  }
  // Lower surface back to the leading edge.
  for (let i = steps - 1; i >= 1; i--) {
    const x = i / steps;
    pts.push(new THREE.Vector2(x, yc(x) - yt(x)));
  }
  return pts;
}

/**
 * Loft a wing/stabiliser from section definitions:
 *   { y, chord, offsetX, offsetY, twist }
 * where y is the spanwise station (along local +X of the returned geometry).
 */
function loft(sections, profile) {
  const n = profile.length;
  const verts = [];
  const uvs = [];
  const idx = [];

  sections.forEach((s, si) => {
    for (let i = 0; i < n; i++) {
      const p = profile[i];
      const cos = Math.cos(s.twist || 0);
      const sin = Math.sin(s.twist || 0);
      const px = p.x * s.chord;
      const py = p.y * s.chord;
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      // local: X = span, Y = up, Z = chordwise (aft positive)
      verts.push(s.y, ry + (s.offsetY || 0), rx + (s.offsetX || 0));
      uvs.push(i / n, si / (sections.length - 1));
    }
  });

  for (let si = 0; si < sections.length - 1; si++) {
    for (let i = 0; i < n; i++) {
      const a = si * n + i;
      const b = si * n + ((i + 1) % n);
      const c = (si + 1) * n + ((i + 1) % n);
      const d = (si + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  // Cap both ends.
  const capStart = verts.length / 3;
  for (const which of [0, sections.length - 1]) {
    for (let i = 0; i < n; i++) {
      const base = which * n + i;
      verts.push(verts[base * 3], verts[base * 3 + 1], verts[base * 3 + 2]);
      uvs.push(0.5, 0.5);
    }
  }
  for (let k = 0; k < 2; k++) {
    const off = capStart + k * n;
    for (let i = 1; i < n - 1; i++) {
      if (k === 0) idx.push(off, off + i, off + i + 1);
      else idx.push(off, off + i + 1, off + i);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function metalMaterial(map, { roughness = 0.42, metalness = 0.35, color = 0xffffff } = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: airframeNormal(),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness,
    metalness,
    color,
  });
}

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  s.scale.setScalar(size);
  return s;
}

export function createAircraftModel({ livery = '#eef1f5', accent = '#c8102e' } = {}) {
  const root = new THREE.Group();
  root.name = 'aircraft';

  const skin = airframeTexture(livery, accent);
  const bodyMat = metalMaterial(skin, { roughness: 0.36, metalness: 0.4 });
  const matteMat = metalMaterial(skin, { roughness: 0.62, metalness: 0.2 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xa8c6d8,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    transmission: 0,
    side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, metalness: 0 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.75 });

  /* ---------------- Fuselage ---------------- */
  const profile = [
    [0.05, -2.55],
    [0.30, -2.42],
    [0.50, -2.15],
    [0.62, -1.7],
    [0.70, -1.1],
    [0.76, -0.3],
    [0.78, 0.45],
    [0.75, 1.15],
    [0.66, 1.95],
    [0.52, 2.7],
    [0.34, 3.35],
    [0.18, 3.85],
    [0.05, 3.95],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const fuseGeo = new THREE.LatheGeometry(profile, 26);
  fuseGeo.rotateX(Math.PI / 2); // lathe axis Y → Z, nose toward -Z
  const fuselage = new THREE.Mesh(fuseGeo, bodyMat);
  fuselage.castShadow = fuselage.receiveShadow = true;
  root.add(fuselage);

  // Cabin roof blister so the greenhouse is not a bare tube.
  const roof = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    bodyMat
  );
  // Kept aft of the eye point (z = -0.28): a blister that reaches forward of
  // the pilot's head fills the entire cockpit view with painted metal.
  roof.scale.set(1, 0.52, 1.15);
  roof.position.set(0, 0.28, 0.88);
  roof.castShadow = true;
  root.add(roof);

  // Windshield and side glass.
  const wsGeo = new THREE.SphereGeometry(0.86, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46);
  const windshield = new THREE.Mesh(wsGeo, glassMat);
  windshield.scale.set(0.96, 0.7, 1.15);
  windshield.position.set(0, 0.22, -0.62);
  windshield.rotation.x = -0.3;
  root.add(windshield);

  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.62), glassMat);
    w.position.set(side * 0.75, 0.28, -0.1);
    w.rotation.y = side * Math.PI * 0.5;
    root.add(w);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), glassMat);
    w2.position.set(side * 0.7, 0.26, 0.95);
    w2.rotation.y = side * Math.PI * 0.5;
    root.add(w2);
  }

  // Engine cowling with a slightly different sheen, plus air intakes.
  // Slightly slimmer and lower than the fuselage line, so that from the cockpit
  // it sits below the horizon instead of hiding it.
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.46, 0.9, 20), matteMat);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, -0.06, -2.05);
  cowl.castShadow = true;
  root.add(cowl);
  for (const side of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), rubber);
    intake.position.set(side * 0.3, -0.16, -2.46);
    root.add(intake);
  }

  /* ---------------- Wings ---------------- */
  const wingProfile = aerofoil(16, 0.135, 0.025);
  const wingSections = [
    { y: 0.0, chord: 1.68, offsetX: 0, offsetY: 0 },
    { y: 1.2, chord: 1.66, offsetX: 0.01, offsetY: 0.03 },
    { y: 3.6, chord: 1.44, offsetX: 0.09, offsetY: 0.11 },
    { y: 5.3, chord: 1.16, offsetX: 0.2, offsetY: 0.2 },
    { y: 5.52, chord: 1.02, offsetX: 0.28, offsetY: 0.23 },
  ];
  const wingGeo = loft(wingSections, wingProfile);

  const wings = new THREE.Group();
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, bodyMat);
    w.scale.x = side;
    w.position.set(side * 0.62, 0.72, -1.05);
    w.castShadow = w.receiveShadow = true;
    wings.add(w);
  }
  root.add(wings);

  // Wing struts (the classic high-wing braces).
  for (const side of [-1, 1]) {
    for (const [ax, az, bx, bz] of [
      [side * 0.66, -0.42, side * 3.1, -0.75],
      [side * 0.66, -0.42, side * 3.0, 0.15],
    ]) {
      const a = new THREE.Vector3(ax, -0.35, az);
      const b = new THREE.Vector3(bx, 0.66, bz);
      const dir = new THREE.Vector3().subVectors(b, a);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, dir.length(), 8), strutMat);
      strut.position.copy(a).addScaledVector(dir, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      strut.castShadow = true;
      root.add(strut);
    }
  }

  // Ailerons and flaps on hinges, so they visibly deflect.
  const surfaces = {};
  function hingedSurface(width, chord, thickness = 0.055) {
    const g = new THREE.BoxGeometry(width, thickness, chord);
    g.translate(0, 0, chord / 2);
    const m = new THREE.Mesh(g, matteMat);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(m);
    return pivot;
  }

  surfaces.aileronL = hingedSurface(1.7, 0.42);
  surfaces.aileronL.position.set(-4.35, 0.86, 0.32);
  surfaces.aileronR = hingedSurface(1.7, 0.42);
  surfaces.aileronR.position.set(4.35, 0.86, 0.32);
  surfaces.flapL = hingedSurface(2.0, 0.44);
  surfaces.flapL.position.set(-2.2, 0.83, 0.34);
  surfaces.flapR = hingedSurface(2.0, 0.44);
  surfaces.flapR.position.set(2.2, 0.83, 0.34);
  root.add(surfaces.aileronL, surfaces.aileronR, surfaces.flapL, surfaces.flapR);

  /* ---------------- Tail ---------------- */
  const tailProfile = aerofoil(12, 0.1, 0);
  const hStabGeo = loft(
    [
      { y: 0, chord: 1.0, offsetX: 0 },
      { y: 1.05, chord: 0.86, offsetX: 0.08 },
      { y: 1.75, chord: 0.7, offsetX: 0.16 },
    ],
    tailProfile
  );
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(hStabGeo, bodyMat);
    h.scale.x = side;
    h.position.set(side * 0.12, 0.14, 2.85);
    h.castShadow = true;
    root.add(h);
  }
  surfaces.elevator = hingedSurface(3.7, 0.42);
  surfaces.elevator.position.set(0, 0.2, 3.72);
  root.add(surfaces.elevator);

  const vStabGeo = loft(
    [
      { y: 0, chord: 1.5, offsetX: 0 },
      { y: 0.8, chord: 1.28, offsetX: 0.28 },
      { y: 1.55, chord: 0.98, offsetX: 0.62 },
    ],
    tailProfile
  );
  const fin = new THREE.Mesh(vStabGeo, bodyMat);
  fin.rotation.z = Math.PI / 2; // span becomes vertical
  fin.position.set(0, 0.18, 2.55);
  fin.castShadow = true;
  root.add(fin);
  // Dorsal fillet.
  const fillet = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 1.1), bodyMat);
  fillet.position.set(0, 0.42, 2.1);
  root.add(fillet);

  surfaces.rudder = (() => {
    const g = new THREE.BoxGeometry(0.06, 1.32, 0.52);
    g.translate(0, 0.66, 0.26);
    const m = new THREE.Mesh(g, matteMat);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(m);
    pivot.position.set(0, 0.3, 3.35);
    return pivot;
  })();
  root.add(surfaces.rudder);

  /* ---------------- Landing gear ---------------- */
  function wheel(radius, width) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, radius * 0.26, 8, 16), rubber);
    tyre.rotation.y = Math.PI / 2;
    g.add(tyre);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width, 12),
      new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.4, metalness: 0.6 })
    );
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    g.castShadow = true;
    return g;
  }

  const gear = { legs: [] };

  // The drawn wheels are positioned so their tyres touch exactly where
  // SPEC.gearPoints says the ground contact is — nose (0, -1.42, -1.15) and
  // mains (±1.42, -1.50, 0.42). Otherwise the aeroplane looks like it is
  // hovering or buried.
  const NOSE_R = 0.3 * 0.78 + 0.3 * 0.26; // tyre outer radius
  const MAIN_R = 0.36 * 0.78 + 0.36 * 0.26;

  // Nose gear: strut + wheel, steers with the rudder pedals.
  const noseLeg = new THREE.Group();
  noseLeg.position.set(0, -0.42, -1.15);
  const noseWheelY = -1.42 + NOSE_R - noseLeg.position.y; // local Y of the hub
  const noseStrut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, Math.abs(noseWheelY), 10),
    strutMat
  );
  noseStrut.position.y = noseWheelY / 2;
  noseStrut.castShadow = true;
  noseLeg.add(noseStrut);
  const noseSteer = new THREE.Group();
  noseSteer.position.y = noseWheelY;
  const noseWheel = wheel(0.3, 0.16);
  noseSteer.add(noseWheel);
  noseLeg.add(noseSteer);
  root.add(noseLeg);
  gear.nose = { leg: noseLeg, steer: noseSteer, wheel: noseWheel };
  gear.legs.push(noseLeg);

  // Main gear: sprung tapered legs with fairings, Cessna style.
  gear.mains = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    legGroup.position.set(side * 0.55, -0.35, 0.42);
    // Hub position in the leg's local space.
    const hubX = 1.42 - 0.55;
    const hubY = -1.5 + MAIN_R - legGroup.position.y;
    const legLen = Math.hypot(hubX, hubY);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, legLen, 8), strutMat);
    leg.geometry.translate(0, -legLen / 2, 0);
    leg.rotation.z = side * Math.atan2(hubX, -hubY);
    leg.castShadow = true;
    legGroup.add(leg);
    const w = wheel(0.36, 0.2);
    w.position.set(side * hubX, hubY, 0);
    legGroup.add(w);
    const fairing = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), matteMat);
    fairing.scale.set(0.7, 0.7, 1.5);
    fairing.position.copy(w.position);
    legGroup.add(fairing);
    root.add(legGroup);
    gear.mains.push({ group: legGroup, wheel: w, side });
    gear.legs.push(legGroup);
  }

  /* ---------------- Propeller ---------------- */
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0.02, -2.6);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 16), metalMaterial(skin, { roughness: 0.2, metalness: 0.7 }));
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.2;
  spinner.castShadow = true;
  propGroup.add(spinner);

  const bladeMat = new THREE.MeshStandardMaterial({ map: propTexture(), roughness: 0.5, metalness: 0.3 });
  const blades = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.85, 0.045), bladeMat);
    bl.geometry.translate(0, 0.92, 0);
    bl.rotation.z = i * Math.PI;
    bl.rotation.y = 0.34 * (i === 0 ? 1 : -1);
    bl.castShadow = true;
    blades.add(bl);
  }
  propGroup.add(blades);

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 2.1),
    new THREE.MeshBasicMaterial({
      map: propBlurTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  disc.position.z = -0.05;
  propGroup.add(disc);
  root.add(propGroup);

  /* ---------------- Lights ---------------- */
  const lights = {};
  lights.navLeft = glowSprite(0xff2020, 0.42);
  lights.navLeft.position.set(-5.52, 0.88, -0.6);
  lights.navRight = glowSprite(0x20ff40, 0.42);
  lights.navRight.position.set(5.52, 0.88, -0.6);
  lights.tail = glowSprite(0xffffff, 0.3);
  lights.tail.position.set(0, 0.28, 3.95);
  lights.strobeL = glowSprite(0xffffff, 0.8);
  lights.strobeL.position.set(-5.5, 0.9, -0.5);
  lights.strobeR = glowSprite(0xffffff, 0.8);
  lights.strobeR.position.set(5.5, 0.9, -0.5);
  lights.landing = glowSprite(0xfff0c0, 0.75);
  lights.landing.position.set(-1.7, 0.66, -1.5);
  for (const k in lights) root.add(lights[k]);
  // Base sizes, so the day/night scaling below has something to scale from.
  for (const k in lights) lights[k].userData.baseScale = lights[k].scale.x;

  // A real spot for the landing light so it actually lights the runway.
  const landingSpot = new THREE.SpotLight(0xfff0c8, 0, 260, 0.34, 0.45, 1.2);
  landingSpot.position.set(0, 0.4, -1.6);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, -0.3, -60);
  root.add(spotTarget);
  landingSpot.target = spotTarget;
  root.add(landingSpot);

  /* ---------------- Cabin interior (seen through the glass) ---------- */
  const seatMat = new THREE.MeshStandardMaterial({ map: leatherTexture('#2b2119'), roughness: 0.8 });
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.44), seatMat);
    seat.position.set(side * 0.3, -0.22, 0.1);
    root.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.1), seatMat);
    back.position.set(side * 0.3, 0.02, 0.34);
    root.add(back);
  }

  const state = {
    propAngle: 0,
    wheelAngle: 0,
    strobeT: 0,
    surfaces,
    gear,
    lights,
    landingSpot,
    disc,
    blades,
    propGroup,
    glassMat,
  };

  /**
   * Animate the model from the flight model's state.
   * `ctrl` carries the raw control inputs so the surfaces move with the stick.
   */
  root.userData.update = function update(dt, ac, weather) {
    const c = ac.controls;
    // In daylight, aircraft lights are barely visible; at night they are the
    // whole show. Scaling both size and opacity keeps them from looking like
    // glowing blobs stuck to the wings on a sunny afternoon.
    const dark = weather ? (weather.isNight ? 1 : weather.cond.cloud > 0.75 ? 0.55 : 0.18) : 0.5;

    // Propeller: spin, and fade in the blur disc as it speeds up.
    const rpmHz = ac.rpm * 42;
    state.propAngle += rpmHz * dt * Math.PI * 2;
    state.blades.rotation.z = state.propAngle;
    const blur = clamp((ac.rpm - 0.22) / 0.45, 0, 1);
    state.disc.material.opacity = blur * 0.5;
    state.blades.visible = blur < 0.98;

    // Control surfaces.
    const s = state.surfaces;
    s.elevator.rotation.x = lerp(s.elevator.rotation.x, -c.pitch * 0.4, clamp(dt * 12, 0, 1));
    s.rudder.rotation.y = lerp(s.rudder.rotation.y, -c.yaw * 0.42, clamp(dt * 12, 0, 1));
    const ail = c.roll * 0.36;
    s.aileronL.rotation.x = lerp(s.aileronL.rotation.x, ail, clamp(dt * 12, 0, 1));
    s.aileronR.rotation.x = lerp(s.aileronR.rotation.x, -ail, clamp(dt * 12, 0, 1));
    const flap = (ac.flaps || 0) * 0.55;
    s.flapL.rotation.x = lerp(s.flapL.rotation.x, flap, clamp(dt * 6, 0, 1));
    s.flapR.rotation.x = lerp(s.flapR.rotation.x, flap, clamp(dt * 6, 0, 1));

    // Gear: retract by folding the legs up and hiding them when stowed.
    const g = ac.gearPos;
    state.gear.nose.leg.rotation.x = (1 - g) * 1.5;
    state.gear.nose.leg.visible = g > 0.02;
    state.gear.nose.steer.rotation.y = -c.yaw * 0.5 * clamp(1 - ac.groundSpeed / 40, 0.15, 1);
    for (const m of state.gear.mains) {
      m.group.rotation.z = (1 - g) * m.side * -1.35;
      m.group.visible = g > 0.02;
    }
    // Wheels spin while rolling.
    if (ac.onGround) {
      state.wheelAngle += (ac.groundSpeed / 0.36) * dt;
      state.gear.nose.wheel.rotation.x = state.wheelAngle;
      for (const m of state.gear.mains) m.wheel.rotation.x = state.wheelAngle;
    }

    // Lights.
    state.strobeT += dt;
    const strobe = state.strobeT % 1.3 < 0.06 || (state.strobeT % 1.3 > 0.13 && state.strobeT % 1.3 < 0.19);
    const running = ac.engineOn || ac.rpm > 0.05;
    state.lights.navLeft.visible = running;
    state.lights.navRight.visible = running;
    state.lights.tail.visible = running;
    state.lights.strobeL.visible = running && strobe;
    state.lights.strobeR.visible = running && strobe;
    const wantLanding = running && (ac.gearDown || ac.agl < 400);
    state.lights.landing.visible = wantLanding;
    state.landingSpot.intensity = wantLanding ? 190 * (0.25 + dark * 0.75) : 0;

    for (const k in state.lights) {
      const l = state.lights[k];
      const base = l.userData.baseScale || 1;
      const boost = k === 'landing' ? 1.6 : 1;
      l.scale.setScalar(base * (0.55 + dark * 0.75) * boost);
      l.material.opacity = 0.35 + dark * 0.65;
    }
  };

  root.userData.parts = state;
  return root;
}
