/**
 * Kestrel Island Airfield — runway 09/27, taxiway, apron, terminal, control
 * tower, hangars, windsock, runway/approach lighting and a working PAPI.
 *
 * The PAPI (those four lights beside the runway) is the friendliest landing aid
 * there is: two white and two red means you are on a perfect glide path, and the
 * tutorial teaches exactly that.
 */

import * as THREE from '../vendor/three.module.js';
import { AIRPORT, heightAt } from './terrain.js';
import {
  runwayTexture,
  asphaltTexture,
  asphaltNormal,
  buildingTexture,
  hangarTexture,
  roofTexture,
  panelTexture,
} from '../render/textures.js';

const ELEV = AIRPORT.elev;
export const RUNWAY = {
  ...AIRPORT.runway,
  elev: ELEV,
  headingDeg: 90,
  // Aiming point for a runway 09 (westerly) approach.
  touchdown: new THREE.Vector3(-350, ELEV, 0),
  thresholdWest: new THREE.Vector3(-550, ELEV, 0),
  thresholdEast: new THREE.Vector3(550, ELEV, 0),
};

function pavementMaterial(repeatX, repeatY) {
  const map = asphaltTexture().clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  const nrm = asphaltNormal().clone();
  nrm.needsUpdate = true;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.92,
    metalness: 0.02,
  });
}

function slab(w, d, x, z, y, mat, rotY = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  return m;
}

export class Airport {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'airport';
    this.t = 0;
    this.lightsOn = false;

    this.buildPavement();
    this.buildBuildings();
    this.buildWindsock();
    this.buildLighting();
    this.buildClutter();

    scene.add(this.group);
  }

  buildPavement() {
    // Runway. The texture's long axis is rotated onto the world X axis so the
    // painted numbers, threshold bars and centreline land where they belong.
    const rwTex = runwayTexture();
    const rwMat = new THREE.MeshStandardMaterial({
      map: rwTex,
      normalMap: asphaltNormal(),
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.9,
      metalness: 0.02,
    });
    this.runwayMat = rwMat;
    const rgeo = new THREE.PlaneGeometry(RUNWAY.halfWidth * 2, RUNWAY.length);
    rgeo.rotateX(-Math.PI / 2);
    const runway = new THREE.Mesh(rgeo, rwMat);
    runway.rotation.y = Math.PI / 2;
    runway.position.set(RUNWAY.cx, ELEV + 0.06, RUNWAY.cz);
    runway.receiveShadow = true;
    this.group.add(runway);

    // Slightly raised shoulder so the runway does not look pasted on.
    const shoulderMat = pavementMaterial(40, 6);
    this.group.add(slab(RUNWAY.length + 40, 62, 0, 0, ELEV + 0.02, shoulderMat));

    const taxiMat = pavementMaterial(40, 3);
    this.group.add(slab(880, 24, 0, -95, ELEV + 0.05, taxiMat));
    this.group.add(slab(24, 95, -430, -47, ELEV + 0.05, taxiMat));
    this.group.add(slab(24, 95, 0, -47, ELEV + 0.05, taxiMat));

    const apronMat = pavementMaterial(18, 6);
    this.group.add(slab(360, 80, -80, -150, ELEV + 0.05, apronMat));

    // Yellow taxi centreline paint.
    const paint = new THREE.MeshBasicMaterial({ color: 0xd9c02a, transparent: true, opacity: 0.85 });
    const stripe = (w, d, x, z) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, paint);
      m.position.set(x, ELEV + 0.07, z);
      this.group.add(m);
    };
    stripe(860, 0.7, 0, -95);
    stripe(0.7, 95, -430, -47);
    stripe(0.7, 95, 0, -47);
    for (let i = 0; i < 4; i++) stripe(0.7, 60, -220 + i * 90, -140);
  }

  buildBuildings() {
    const terminalTex = buildingTexture(0);
    terminalTex.repeat.set(3, 1);
    const terminalMat = new THREE.MeshStandardMaterial({
      map: terminalTex,
      roughness: 0.8,
      metalness: 0.05,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofTexture(),
      roughness: 0.9,
    });

    // Terminal.
    const term = new THREE.Mesh(new THREE.BoxGeometry(88, 13, 26), terminalMat);
    term.position.set(-60, ELEV + 6.5, -212);
    term.castShadow = term.receiveShadow = true;
    this.group.add(term);
    const termRoof = new THREE.Mesh(new THREE.BoxGeometry(92, 1.4, 30), roofMat);
    termRoof.position.set(-60, ELEV + 13.8, -212);
    termRoof.castShadow = true;
    this.group.add(termRoof);

    // Control tower: shaft + glazed cab + railing.
    const shaftMat = new THREE.MeshStandardMaterial({
      map: buildingTexture(2),
      roughness: 0.85,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.4, 26, 16), shaftMat);
    shaft.position.set(40, ELEV + 13, -206);
    shaft.castShadow = shaft.receiveShadow = true;
    this.group.add(shaft);
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0x9fd8ef,
      roughness: 0.08,
      metalness: 0.5,
      transparent: true,
      opacity: 0.72,
    });
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 7, 7, 16), cabMat);
    cab.position.set(40, ELEV + 29, -206);
    cab.castShadow = true;
    this.group.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 0.8, 16), roofMat);
    cabRoof.position.set(40, ELEV + 32.8, -206);
    this.group.add(cabRoof);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x35ff6a })
    );
    beacon.position.set(40, ELEV + 34, -206);
    this.group.add(beacon);
    this.beacon = beacon;

    // Hangars: corrugated arch sheds with open fronts.
    const hangarMat = new THREE.MeshStandardMaterial({
      map: hangarTexture(),
      roughness: 0.68,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });
    const hangarTexRepeat = hangarMat.map.clone();
    hangarTexRepeat.needsUpdate = true;
    hangarTexRepeat.wrapS = hangarTexRepeat.wrapT = THREE.RepeatWrapping;
    hangarTexRepeat.repeat.set(4, 2);
    hangarMat.map = hangarTexRepeat;

    for (let i = 0; i < 2; i++) {
      const x = -250 + i * 130;
      const arch = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 18, 44, 20, 1, true, 0, Math.PI),
        hangarMat
      );
      arch.rotation.z = Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      arch.position.set(x, ELEV + 0.2, -250);
      arch.castShadow = arch.receiveShadow = true;
      this.group.add(arch);
      // Back wall.
      const back = new THREE.Mesh(new THREE.CircleGeometry(18, 20, 0, Math.PI), hangarMat);
      back.position.set(x, ELEV + 0.2, -272);
      back.castShadow = true;
      this.group.add(back);
      // Dark interior so the opening does not look like a hole in the sky.
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(17.6, 20, 0, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0x14171c })
      );
      inner.position.set(x, ELEV + 0.2, -271.5);
      this.group.add(inner);
    }

    // Fuel farm.
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.45, metalness: 0.6 });
    for (let i = 0; i < 2; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 12, 18), tankMat);
      tank.rotation.z = Math.PI / 2;
      tank.position.set(120 + i * 16, ELEV + 5, -250);
      tank.castShadow = tank.receiveShadow = true;
      this.group.add(tank);
    }
  }

  buildWindsock() {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c9, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 10), poleMat);
    pole.position.y = 4.5;
    pole.castShadow = true;
    g.add(pole);

    // Striped sock, built from alternating cone frustums.
    this.sockPivot = new THREE.Group();
    this.sockPivot.position.y = 9;
    g.add(this.sockPivot);
    const colors = [0xf05a28, 0xf2f2f2, 0xf05a28, 0xf2f2f2, 0xf05a28];
    let z = 0;
    for (let i = 0; i < colors.length; i++) {
      const r0 = 1.05 - i * 0.13;
      const r1 = 1.05 - (i + 1) * 0.13;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, 1.3, 12, 1, true),
        new THREE.MeshStandardMaterial({
          color: colors[i],
          roughness: 0.75,
          side: THREE.DoubleSide,
        })
      );
      seg.rotation.x = Math.PI / 2;
      seg.position.z = z + 0.65;
      z += 1.3;
      this.sockPivot.add(seg);
    }

    g.position.set(-500, heightAt(-500, -60), -60);
    this.group.add(g);
    this.windsock = g;
  }

  buildLighting() {
    // Runway edge lights + threshold lights, drawn as small emissive spheres
    // with an additive glow sprite each. Instanced, so it stays cheap.
    const positions = [];
    const colors = [];
    const step = 60;
    for (let x = -RUNWAY.length / 2; x <= RUNWAY.length / 2 + 1; x += step) {
      for (const z of [-RUNWAY.halfWidth - 1.5, RUNWAY.halfWidth + 1.5]) {
        // Last 600 m of runway 09 shows amber, like the real thing.
        const amber = x > RUNWAY.length / 2 - 300;
        positions.push([x, ELEV + 0.45, z]);
        colors.push(amber ? new THREE.Color(0xffb347) : new THREE.Color(0xfff4de));
      }
    }
    // Thresholds: green on the approach end, red on the far end.
    for (let i = -2; i <= 2; i++) {
      positions.push([-RUNWAY.length / 2 - 2, ELEV + 0.45, i * 7]);
      colors.push(new THREE.Color(0x2bff6a));
      positions.push([RUNWAY.length / 2 + 2, ELEV + 0.45, i * 7]);
      colors.push(new THREE.Color(0xff3b30));
    }
    // Approach lead-in lights out over the water for runway 09.
    for (let i = 1; i <= 8; i++) {
      positions.push([-RUNWAY.length / 2 - i * 60, ELEV + 0.6, 0]);
      colors.push(new THREE.Color(0xffffff));
    }

    const geo = new THREE.SphereGeometry(0.42, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, positions.length);
    const dummy = new THREE.Object3D();
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(positions.length * 3), 3);
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, colors[i]);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    inst.visible = false;
    this.group.add(inst);
    this.runwayLights = inst;

    // Glow halos (additive) so lights read from far away at night.
    const glowTex = makeGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xfff0cf,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    this.glowGroup = new THREE.Group();
    positions.forEach((p, i) => {
      const s = new THREE.Sprite(glowMat.clone());
      s.material.color.copy(colors[i]);
      s.position.set(p[0], p[1], p[2]);
      s.scale.setScalar(7);
      this.glowGroup.add(s);
    });
    this.glowGroup.visible = false;
    this.group.add(this.glowGroup);

    // PAPI: four lights on the left of runway 09, 350 m in from the threshold.
    this.papi = [];
    const papiGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.5, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 })
      );
      box.position.set(-350, ELEV + 0.75, -32 - i * 6);
      box.castShadow = true;
      papiGroup.add(box);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lens.position.set(-351.3, ELEV + 0.85, -32 - i * 6);
      lens.rotation.y = -Math.PI / 2;
      papiGroup.add(lens);
      const glow = new THREE.Sprite(glowMat.clone());
      glow.position.copy(lens.position);
      glow.scale.setScalar(6);
      papiGroup.add(glow);
      this.papi.push({ lens, glow });
    }
    this.group.add(papiGroup);
  }

  buildClutter() {
    // Baggage carts, cones and a fuel truck — small props that make the apron
    // feel used rather than empty.
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf0561d, roughness: 0.8 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 8), coneMat);
      c.position.set(-240 + i * 26, ELEV + 0.55, -118);
      c.castShadow = true;
      this.group.add(c);
    }
    const truckBody = new THREE.Mesh(
      new THREE.BoxGeometry(7, 2.6, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.5, metalness: 0.3 })
    );
    truckBody.position.set(30, ELEV + 1.9, -160);
    truckBody.castShadow = true;
    this.group.add(truckBody);
    const cabMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 2.5),
      new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.6 })
    );
    cabMesh.position.set(25.4, ELEV + 1.7, -160);
    cabMesh.castShadow = true;
    this.group.add(cabMesh);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.95 });
    for (const [wx, wz] of [[27, -158.8], [27, -161.2], [33, -158.8], [33, -161.2]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 12), wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, ELEV + 0.62, wz);
      this.group.add(w);
    }
  }

  /** Toggle the airfield lighting (night / low visibility). */
  setLightsOn(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    this.runwayLights.visible = on;
    this.glowGroup.visible = on;
  }

  /**
   * Update the PAPI from the aircraft position: it compares the actual glide
   * angle to the ideal 3° and lights red/white accordingly.
   * Returns a short human hint for the HUD.
   */
  updatePapi(aircraftPos) {
    const td = RUNWAY.touchdown;
    const dx = td.x - aircraftPos.x;
    const dz = td.z - aircraftPos.z;
    const dist = Math.hypot(dx, dz);
    const alt = aircraftPos.y - ELEV;
    // Only meaningful on a westerly approach within ~12 km.
    const approaching = aircraftPos.x < td.x && dist < 12000 && dist > 120 && alt > 3;
    let whites = 0;
    if (approaching) {
      const angle = (Math.atan2(alt, dist) * 180) / Math.PI;
      // 4 bars: each covers ~0.33° around the 3° path.
      const thresholds = [2.5, 2.83, 3.17, 3.5];
      whites = thresholds.filter((t) => angle > t).length;
    }
    this.papi.forEach((p, i) => {
      const white = i < whites;
      const col = white ? 0xffffff : 0xff2d20;
      p.lens.material.color.setHex(col);
      p.glow.material.color.setHex(col);
      p.glow.material.opacity = this.lightsOn ? 0.9 : 0.5;
    });
    if (!approaching) return null;
    if (whites === 4) return { state: 'high', text: 'Too high — ease off and descend' };
    if (whites === 0) return { state: 'low', text: 'Too low — add power!' };
    if (whites === 2) return { state: 'good', text: 'On the perfect glide path' };
    return { state: whites > 2 ? 'slightlyHigh' : 'slightlyLow', text: whites > 2 ? 'A little high' : 'A little low' };
  }

  update(dt, weather) {
    this.t += dt;
    // Windsock points downwind and lifts as the wind increases.
    const fromRad = THREE.MathUtils.degToRad(weather.windDirDeg);
    // Sock tail points the way the wind is going.
    this.sockPivot.rotation.y = -fromRad + Math.PI;
    const lift = Math.min(1, weather.windSpeedKts / 15);
    this.sockPivot.rotation.x = (1 - lift) * 1.15 + Math.sin(this.t * 3.2) * 0.05 * lift;
    // Rotating green beacon.
    this.beacon.visible = this.lightsOn && Math.sin(this.t * 3) > 0;
    this.setLightsOn(weather.isNight || weather.cond.cloud > 0.8);
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
