/**
 * Cockpit interior with live instruments.
 *
 * The panel is a canvas texture: all the static artwork (bezels, tick marks,
 * arcs, lettering) is painted once into an offscreen layer, then every frame we
 * blit that layer and draw only the needles on top. That keeps a full
 * six-instrument panel plus radio stack at well under a millisecond a frame.
 */

import * as THREE from '../vendor/three.module.js';
import { panelTexture, panelNormal, leatherTexture, dropletTexture } from '../render/textures.js';
import { clamp, lerp } from '../core/noise.js';
import { UNITS } from './physics.js';

const CW = 1600;
const CH = 800;

const FACE = '#0e1013';
const TEXT = '#e8eaee';
const DIM = '#9aa0a8';

function ring(ctx, x, y, r) {
  // Metal bezel with a highlight, then the dark instrument face.
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, '#6a7078');
  g.addColorStop(0.45, '#3b4046');
  g.addColorStop(1, '#22262b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r + 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FACE;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r - 1, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();
}

function label(ctx, x, y, text, size = 15, color = DIM, align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function arc(ctx, x, y, r, a0, a1, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

function needle(ctx, x, y, angle, len, width, color, tail = 0.18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-width, -len * tail);
  ctx.lineTo(-width * 0.45, -len);
  ctx.lineTo(width * 0.45, -len);
  ctx.lineTo(width, -len * tail);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const GAUGE = {
  asi: { x: 200, y: 218, r: 108 },
  ai: { x: 448, y: 218, r: 116 },
  alt: { x: 700, y: 218, r: 108 },
  turn: { x: 200, y: 470, r: 100 },
  hdg: { x: 448, y: 470, r: 108 },
  vsi: { x: 700, y: 470, r: 100 },
  tach: { x: 930, y: 470, r: 92 },
  fuel: { x: 930, y: 218, r: 92 },
};

export class InstrumentPanel {
  constructor(highContrast = false) {
    this.highContrast = highContrast;
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = CW;
    this.staticLayer.height = CH;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.acc = 0;
    this.drawStatic();
    // Smoothed instrument values — real needles have inertia.
    this.smooth = { ias: 0, alt: 0, vs: 0, hdg: 90, rpm: 0, pitch: 0, bank: 0, slip: 0, fuel: 1 };
  }

  drawStatic() {
    const ctx = this.staticLayer.getContext('2d');
    // Panel base.
    ctx.fillStyle = '#1b1e22';
    ctx.fillRect(0, 0, CW, CH);
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);
    // Screw heads at the corners of the instrument cluster.
    ctx.fillStyle = '#43484f';
    for (const [sx, sy] of [[60, 60], [CW - 60, 60], [60, CH - 60], [CW - 60, CH - 60]]) {
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---- Airspeed indicator: 40–170 kt over 300° ---- */
    {
      const { x, y, r } = GAUGE.asi;
      ring(ctx, x, y, r);
      const a = (kt) => (-140 + ((kt - 40) / 130) * 300) * (Math.PI / 180);
      arc(ctx, x, y, r - 14, a(48), a(90), '#e8eaee', 7); // white (flap) arc
      arc(ctx, x, y, r - 24, a(55), a(130), '#3ec96a', 9); // green normal range
      arc(ctx, x, y, r - 24, a(130), a(160), '#f2c53d', 9); // yellow caution
      arc(ctx, x, y, r - 24, a(160), a(170), '#e8402a', 9); // red line
      ctx.strokeStyle = TEXT;
      for (let kt = 40; kt <= 170; kt += 10) {
        const ang = a(kt);
        const major = kt % 20 === 0;
        ctx.lineWidth = major ? 3 : 1.6;
        const r0 = r - (major ? 32 : 26);
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * r0, y - Math.cos(ang) * r0);
        ctx.lineTo(x + Math.sin(ang) * (r - 12), y - Math.cos(ang) * (r - 12));
        ctx.stroke();
        if (major) {
          const rt = r - 50;
          label(ctx, x + Math.sin(ang) * rt, y - Math.cos(ang) * rt, String(kt), 19, TEXT);
        }
      }
      label(ctx, x, y + 44, 'AIRSPEED', 13, DIM);
      label(ctx, x, y + 62, 'KNOTS', 11, DIM);
    }

    /* ---- Attitude indicator: just the bezel and the fixed aircraft ---- */
    {
      const { x, y, r } = GAUGE.ai;
      ring(ctx, x, y, r);
      label(ctx, x, y + r + 26, 'ATTITUDE', 13, DIM);
    }

    /* ---- Altimeter ---- */
    {
      const { x, y, r } = GAUGE.alt;
      ring(ctx, x, y, r);
      ctx.strokeStyle = TEXT;
      for (let i = 0; i < 50; i++) {
        const ang = (i / 50) * Math.PI * 2;
        const major = i % 5 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = r - (major ? 30 : 22);
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * r0, y - Math.cos(ang) * r0);
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        if (major) {
          const rt = r - 50;
          label(ctx, x + Math.sin(ang) * rt, y - Math.cos(ang) * rt, String(i / 5), 20, TEXT);
        }
      }
      label(ctx, x, y + 46, 'ALTITUDE', 13, DIM);
      label(ctx, x, y + 63, 'FEET', 11, DIM);
    }

    /* ---- Turn coordinator ---- */
    {
      const { x, y, r } = GAUGE.turn;
      ring(ctx, x, y, r);
      ctx.strokeStyle = TEXT;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        for (const off of [0.42, 0.72]) {
          const ang = s * off;
          ctx.beginPath();
          ctx.moveTo(x + Math.sin(ang) * (r - 26), y - Math.cos(ang) * (r - 26));
          ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
          ctx.stroke();
        }
      }
      label(ctx, x, y - 46, 'L        R', 15, DIM);
      // Slip/skid tube.
      ctx.strokeStyle = '#2b3037';
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.arc(x, y + 8, r - 34, Math.PI * 0.30, Math.PI * 0.70);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        const ang = Math.PI * 0.5 + s * 0.12;
        const rr = r - 34;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * (rr - 12), y + 8 + Math.sin(ang) * (rr - 12));
        ctx.lineTo(x + Math.cos(ang) * (rr + 12), y + 8 + Math.sin(ang) * (rr + 12));
        ctx.stroke();
      }
      label(ctx, x, y + r + 24, 'TURN & SLIP', 13, DIM);
    }

    /* ---- Heading indicator: only the bezel + lubber line ---- */
    {
      const { x, y, r } = GAUGE.hdg;
      ring(ctx, x, y, r);
      ctx.fillStyle = '#f2c53d';
      ctx.beginPath();
      ctx.moveTo(x, y - r + 4);
      ctx.lineTo(x - 9, y - r + 22);
      ctx.lineTo(x + 9, y - r + 22);
      ctx.closePath();
      ctx.fill();
      label(ctx, x, y + r + 26, 'HEADING', 13, DIM);
    }

    /* ---- Vertical speed ---- */
    {
      const { x, y, r } = GAUGE.vsi;
      ring(ctx, x, y, r);
      const a = (v) => (v / 2000) * 150 * (Math.PI / 180) + Math.PI / 2;
      ctx.strokeStyle = TEXT;
      for (let v = -2000; v <= 2000; v += 250) {
        const ang = a(v) - Math.PI / 2;
        const major = v % 500 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = r - (major ? 28 : 20);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
        ctx.lineTo(x + Math.cos(ang) * (r - 8), y + Math.sin(ang) * (r - 8));
        ctx.stroke();
        if (major && v % 1000 === 0) {
          const rt = r - 48;
          label(ctx, x + Math.cos(ang) * rt, y + Math.sin(ang) * rt, String(Math.abs(v / 100)), 17, TEXT);
        }
      }
      label(ctx, x, y + 44, 'CLIMB', 13, DIM);
      label(ctx, x, y + 61, '100 FT/MIN', 10, DIM);
      arc(ctx, x, y, r - 14, a(-300) - Math.PI / 2, a(300) - Math.PI / 2, 'rgba(62,201,106,0.55)', 5);
    }

    /* ---- Tachometer ---- */
    {
      const { x, y, r } = GAUGE.tach;
      ring(ctx, x, y, r);
      const a = (rpm) => (-135 + (rpm / 2700) * 270) * (Math.PI / 180);
      arc(ctx, x, y, r - 20, a(2100), a(2500), '#3ec96a', 8);
      arc(ctx, x, y, r - 20, a(2500), a(2700), '#e8402a', 8);
      ctx.strokeStyle = TEXT;
      for (let rpm = 0; rpm <= 2700; rpm += 300) {
        const ang = a(rpm);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * (r - 28), y - Math.cos(ang) * (r - 28));
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        label(ctx, x + Math.sin(ang) * (r - 46), y - Math.cos(ang) * (r - 46), String(rpm / 100), 15, TEXT);
      }
      label(ctx, x, y + 40, 'RPM x100', 12, DIM);
    }

    /* ---- Fuel + engine ---- */
    {
      const { x, y, r } = GAUGE.fuel;
      ring(ctx, x, y, r);
      const a = (f) => (-120 + f * 240) * (Math.PI / 180);
      arc(ctx, x, y, r - 20, a(0), a(0.15), '#e8402a', 8);
      arc(ctx, x, y, r - 20, a(0.15), a(1), '#3ec96a', 8);
      ctx.strokeStyle = TEXT;
      for (const [f, t] of [[0, 'E'], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, 'F']]) {
        const ang = a(f);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * (r - 28), y - Math.cos(ang) * (r - 28));
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        label(ctx, x + Math.sin(ang) * (r - 46), y - Math.cos(ang) * (r - 46), t, 16, TEXT);
      }
      label(ctx, x, y + 40, 'FUEL', 12, DIM);
    }

    /* ---- Radio stack + annunciators on the right ---- */
    {
      const x0 = 1080;
      ctx.fillStyle = '#14171b';
      ctx.strokeStyle = '#3a4046';
      ctx.lineWidth = 3;
      const box = (x, y, w, h, r2 = 8) => {
        ctx.beginPath();
        ctx.moveTo(x + r2, y);
        ctx.arcTo(x + w, y, x + w, y + h, r2);
        ctx.arcTo(x + w, y + h, x, y + h, r2);
        ctx.arcTo(x, y + h, x, y, r2);
        ctx.arcTo(x, y, x + w, y, r2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      // COM radio.
      box(x0, 90, 460, 118);
      label(ctx, x0 + 20, 118, 'COM 1', 15, DIM, 'left');
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 54px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('118.30', x0 + 20, 175);
      label(ctx, x0 + 300, 118, 'STBY', 13, DIM, 'left');
      ctx.fillStyle = '#8fa2b4';
      ctx.font = '700 30px "Courier New", monospace';
      ctx.fillText('121.90', x0 + 300, 172);

      // Transponder.
      box(x0, 228, 460, 96);
      label(ctx, x0 + 20, 252, 'XPDR', 14, DIM, 'left');
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 44px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('1200', x0 + 20, 297);
      label(ctx, x0 + 250, 252, 'ALT', 14, DIM, 'left');

      // Annunciator panel frame.
      box(x0, 344, 460, 210);
      label(ctx, x0 + 230, 366, 'ANNUNCIATORS', 12, DIM);

      // Placards.
      label(ctx, x0 + 230, 600, 'N172SK  ·  SKYLARK 172', 16, '#c9ced6');
      label(ctx, x0 + 230, 628, 'ISLAND FLIGHT ACADEMY', 12, DIM);
      // Throttle / mixture quadrant markings.
      box(x0 - 40, 660, 540, 110);
      label(ctx, x0 - 10, 690, 'THROTTLE', 12, DIM, 'left');
      label(ctx, x0 + 250, 690, 'FLAPS', 12, DIM, 'left');
      label(ctx, x0 + 390, 690, 'GEAR', 12, DIM, 'left');
    }

    // Left placards.
    label(ctx, 90, 690, 'FLAPS  0  10  20  30', 14, DIM, 'left');
    label(ctx, 90, 716, 'GEAR  DOWN / UP  (G)', 14, DIM, 'left');
    label(ctx, 90, 742, 'BRAKES  SPACE', 14, DIM, 'left');
  }

  /** Redraw the moving parts. Called at ~30 Hz. */
  render(ac, weather) {
    const ctx = this.ctx;
    const r = ac.readouts();
    const s = this.smooth;
    const k = 0.28;
    s.ias = lerp(s.ias, r.iasKts, k);
    s.alt = lerp(s.alt, r.altFt, k);
    s.vs = lerp(s.vs, r.vsFpm, 0.18);
    // Heading needs wrap-aware smoothing.
    let dh = ((r.heading - s.hdg + 540) % 360) - 180;
    s.hdg = (s.hdg + dh * k + 360) % 360;
    s.rpm = lerp(s.rpm, r.rpm * 2700, k);
    s.pitch = lerp(s.pitch, r.pitch, 0.35);
    s.bank = lerp(s.bank, r.bank, 0.35);
    s.slip = lerp(s.slip, r.slip, 0.2);
    s.fuel = lerp(s.fuel, r.fuelPct, 0.1);

    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(this.staticLayer, 0, 0);

    /* Airspeed needle. */
    {
      const { x, y, r: rr } = GAUGE.asi;
      const kt = clamp(s.ias, 0, 175);
      const ang = ((-140 + ((kt - 40) / 130) * 300) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 16, 6, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Attitude indicator. */
    {
      const { x, y, r: rr } = GAUGE.ai;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, rr - 6, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate((-s.bank * Math.PI) / 180);
      const pxPerDeg = 3.1;
      const off = s.pitch * pxPerDeg;
      // Sky and ground.
      ctx.fillStyle = '#2f7fc4';
      ctx.fillRect(-rr * 2, -rr * 2 + off, rr * 4, rr * 2);
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(-rr * 2, off, rr * 4, rr * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-rr * 2, off);
      ctx.lineTo(rr * 2, off);
      ctx.stroke();
      // Pitch ladder.
      ctx.lineWidth = 2;
      ctx.font = '600 13px Arial';
      ctx.textAlign = 'center';
      for (let d = -30; d <= 30; d += 5) {
        if (d === 0) continue;
        const yy = off - d * pxPerDeg;
        const w = d % 10 === 0 ? 40 : 20;
        ctx.beginPath();
        ctx.moveTo(-w, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
        if (d % 10 === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(Math.abs(d)), -w - 16, yy + 4);
          ctx.fillText(String(Math.abs(d)), w + 16, yy + 4);
        }
      }
      ctx.restore();

      // Bank scale + fixed aircraft symbol.
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = '#f2f4f6';
      ctx.lineWidth = 2.5;
      for (const d of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
        const a = (d * Math.PI) / 180;
        const len = d % 30 === 0 ? 16 : 9;
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * (rr - 8), -Math.cos(a) * (rr - 8));
        ctx.lineTo(Math.sin(a) * (rr - 8 - len), -Math.cos(a) * (rr - 8 - len));
        ctx.stroke();
      }
      // Roll pointer.
      const ba = (-s.bank * Math.PI) / 180;
      ctx.fillStyle = '#f2c53d';
      ctx.beginPath();
      ctx.moveTo(Math.sin(ba) * (rr - 26), -Math.cos(ba) * (rr - 26));
      ctx.lineTo(Math.sin(ba) * (rr - 26) - 8, -Math.cos(ba) * (rr - 26) + 14);
      ctx.lineTo(Math.sin(ba) * (rr - 26) + 8, -Math.cos(ba) * (rr - 26) + 14);
      ctx.closePath();
      ctx.fill();
      // Aircraft symbol.
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-52, 0);
      ctx.lineTo(-16, 0);
      ctx.moveTo(16, 0);
      ctx.lineTo(52, 0);
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* Altimeter: hundreds needle, thousands needle, digital window. */
    {
      const { x, y, r: rr } = GAUGE.alt;
      const alt = s.alt;
      const hundreds = ((alt % 1000) / 1000) * Math.PI * 2;
      const thousands = ((alt % 10000) / 10000) * Math.PI * 2;
      // Digital window.
      ctx.fillStyle = '#05070a';
      ctx.fillRect(x + 18, y - 14, 74, 28);
      ctx.strokeStyle = '#4a5058';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 18, y - 14, 74, 28);
      ctx.fillStyle = '#e8eaee';
      ctx.font = '700 21px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.max(0, Math.round(alt))).padStart(5, ' '), x + 88, y + 1);
      needle(ctx, x, y, thousands, rr - 48, 8, '#f4f6f8', 0.22);
      needle(ctx, x, y, hundreds, rr - 16, 5.5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Turn coordinator: little aircraft banks with roll, ball shows slip. */
    {
      const { x, y, r: rr } = GAUGE.turn;
      ctx.save();
      ctx.translate(x, y - 6);
      // Right turn (positive rate) banks the miniature aeroplane right, which
      // on a canvas means a positive (clockwise) rotation.
      ctx.rotate(clamp((ac.turnRate / 3) * 0.35, -0.8, 0.8));
      ctx.strokeStyle = '#f4f6f8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-rr * 0.55, 0);
      ctx.lineTo(rr * 0.55, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -rr * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Slip ball.
      const ballAng = Math.PI * 0.5 + clamp(s.slip, -1, 1) * 0.19;
      const br = rr - 34;
      ctx.fillStyle = '#1b1e22';
      ctx.beginPath();
      ctx.arc(x + Math.cos(ballAng) * br, y + 8 + Math.sin(ballAng) * br, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8dce2';
      ctx.beginPath();
      ctx.arc(x + Math.cos(ballAng) * br, y + 8 + Math.sin(ballAng) * br, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Heading indicator: rotating compass card. */
    {
      const { x, y, r: rr } = GAUGE.hdg;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, rr - 4, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#0b0d10';
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate((-s.hdg * Math.PI) / 180);
      ctx.strokeStyle = '#e8eaee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) {
        const a = (d * Math.PI) / 180;
        const major = d % 30 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = rr - (major ? 30 : 22);
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
        ctx.lineTo(Math.sin(a) * (rr - 10), -Math.cos(a) * (rr - 10));
        ctx.stroke();
        if (major) {
          const t = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
          ctx.save();
          ctx.translate(Math.sin(a) * (rr - 52), -Math.cos(a) * (rr - 52));
          ctx.rotate(a);
          ctx.fillStyle = d % 90 === 0 ? '#ffd23f' : '#e8eaee';
          ctx.font = `700 ${d % 90 === 0 ? 22 : 18}px Arial`;
          ctx.fillText(t, 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
      // Fixed aeroplane silhouette.
      ctx.strokeStyle = '#f4f6f8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y + 24);
      ctx.moveTo(x - 20, y - 2);
      ctx.lineTo(x + 20, y - 2);
      ctx.moveTo(x - 9, y + 18);
      ctx.lineTo(x + 9, y + 18);
      ctx.stroke();
      // Digital heading.
      ctx.fillStyle = '#05070a';
      ctx.fillRect(x - 34, y + rr - 44, 68, 26);
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 20px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(s.hdg)).padStart(3, '0') + '°', x, y + rr - 30);
    }

    /* Vertical speed. */
    {
      const { x, y, r: rr } = GAUGE.vsi;
      const v = clamp(s.vs, -2100, 2100);
      const ang = (v / 2000) * 150 * (Math.PI / 180);
      needle(ctx, x, y, ang + Math.PI / 2, rr - 14, 5.5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Tachometer. */
    {
      const { x, y, r: rr } = GAUGE.tach;
      const ang = ((-135 + (clamp(s.rpm, 0, 2700) / 2700) * 270) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 14, 5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Fuel. */
    {
      const { x, y, r: rr } = GAUGE.fuel;
      const ang = ((-120 + clamp(s.fuel, 0, 1) * 240) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 14, 5, s.fuel < 0.15 ? '#ff5a3c' : '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9ced6';
      ctx.font = '700 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(r.fuelL)} L`, x, y + 62);
    }

    /* Annunciator lamps. */
    {
      const x0 = 1080;
      const lamps = [
        ['STALL', ac.stalled, '#ff3b30'],
        ['GEAR UP', !r.gearDown && r.gearPos < 0.05, '#ffb020'],
        ['GEAR DOWN', r.gearDown && r.gearPos > 0.95, '#3ec96a'],
        ['LOW FUEL', r.fuelPct < 0.15, '#ff3b30'],
        ['BRAKES', r.brakes > 0.5, '#ffb020'],
        ['ENGINE', !r.engineOn, '#ff3b30'],
      ];
      ctx.textAlign = 'center';
      lamps.forEach((l, i) => {
        const lx = x0 + 20 + (i % 2) * 230;
        const ly = 388 + Math.floor(i / 2) * 54;
        ctx.fillStyle = l[1] ? l[2] : '#242830';
        ctx.strokeStyle = '#3a4046';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(lx, ly, 200, 42, 6) : ctx.rect(lx, ly, 200, 42);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = l[1] ? '#101216' : '#6d747d';
        ctx.font = '700 17px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(l[0], lx + 100, ly + 22);
      });

      // Throttle / flap / gear position bars.
      const barY = 712;
      const bar = (bx, w, frac, color) => {
        ctx.fillStyle = '#0c0e12';
        ctx.fillRect(bx, barY, w, 26);
        ctx.fillStyle = color;
        ctx.fillRect(bx + 2, barY + 2, (w - 4) * clamp(frac, 0, 1), 22);
        ctx.strokeStyle = '#3a4046';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, barY, w, 26);
      };
      bar(x0 + 60, 170, r.throttle, '#3ec96a');
      bar(x0 + 300, 70, ac.flaps || 0, '#4a9fe0');
      bar(x0 + 420, 70, r.gearPos, r.gearPos > 0.95 ? '#3ec96a' : '#ffb020');
    }

    this.texture.needsUpdate = true;
  }

  update(dt, ac, weather) {
    this.acc += dt;
    if (this.acc >= 1 / 30) {
      this.acc = 0;
      this.render(ac, weather);
    }
  }
}

/**
 * Build the physical cockpit: panel shell, glareshield, yoke, throttle lever,
 * door frames, seats and the rain-streaked windshield overlay.
 */
export function createCockpit({ highContrast = false } = {}) {
  const group = new THREE.Group();
  group.name = 'cockpit';
  // Lifted with the eye point (see EYE in flight/camera.js) so the panel keeps
  // its framing: top of the panel roughly 20 degrees below the horizon, which is
  // what you see from the left seat of a real high-wing trainer.
  group.position.y = 0.29;

  const panel = new InstrumentPanel(highContrast);

  const shellMat = new THREE.MeshStandardMaterial({
    map: panelTexture(),
    normalMap: panelNormal(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.78,
    metalness: 0.06,
    color: 0x8f949c,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    map: leatherTexture('#241c15'),
    roughness: 0.85,
  });

  // Instrument panel face.
  const faceGeo = new THREE.PlaneGeometry(1.42, 0.71);
  const face = new THREE.Mesh(
    faceGeo,
    new THREE.MeshStandardMaterial({
      map: panel.texture,
      roughness: 0.42,
      metalness: 0.05,
      emissive: 0xffffff,
      emissiveMap: panel.texture,
      emissiveIntensity: 0.22,
    })
  );
  face.position.set(0, -0.26, -0.92);
  face.rotation.x = 0.2;
  group.add(face);
  group.userData.panelFace = face;

  // Panel shell / coaming around it.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.9, 0.3), shellMat);
  shell.position.set(0, -0.40, -1.10);
  group.add(shell);

  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.1, 0.34), trimMat);
  glare.position.set(0, 0.02, -1.0);
  glare.rotation.x = -0.22;
  group.add(glare);

  // Windscreen posts and roof.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), shellMat);
    post.position.set(side * 0.72, 0.35, -0.78);
    post.rotation.x = -0.28;
    post.rotation.z = side * 0.12;
    group.add(post);
    const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 1.5), shellMat);
    side1.position.set(side * 0.78, -0.1, 0.05);
    group.add(side1);
  }
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.7), trimMat);
  roofPanel.position.set(0, 0.62, 0.1);
  group.add(roofPanel);
  const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.06), trimMat);
  bulkhead.position.set(0, 0.06, 1.0);
  group.add(bulkhead);

  // Floor and rudder pedals.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.8), trimMat);
  floor.position.set(0, -0.95, -0.1);
  group.add(floor);
  const pedals = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7, metalness: 0.3 })
    );
    p.position.set(side * 0.2, -0.78, -0.86);
    p.rotation.x = -0.5;
    group.add(p);
    pedals.push({ mesh: p, side });
  }

  // Yoke: column, hub and horns. Moves with the controls.
  const yoke = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10),
    new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.6 })
  );
  column.rotation.x = Math.PI / 2;
  column.position.z = 0.2;
  yoke.add(column);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.5, metalness: 0.3 });
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), hubMat);
  yoke.add(hub);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.017, 8, 14, Math.PI * 1.1), hubMat);
    horn.rotation.y = Math.PI / 2;
    horn.rotation.z = side > 0 ? -Math.PI * 0.55 : Math.PI * 0.45;
    horn.position.x = side * 0.02;
    yoke.add(horn);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), hubMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.19, 0, 0);
    yoke.add(grip);
  }
  yoke.position.set(-0.22, -0.36, -0.55);
  group.add(yoke);

  // Throttle quadrant.
  const quadrant = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), shellMat);
  quadrant.position.set(0.12, -0.56, -0.78);
  group.add(quadrant);
  const throttleLever = new THREE.Group();
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.7 }));
  lever.position.y = 0.1;
  throttleLever.add(lever);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.55 })
  );
  knob.position.y = 0.2;
  throttleLever.add(knob);
  throttleLever.position.set(0.06, -0.58, -0.74);
  group.add(throttleLever);

  const mixture = throttleLever.clone();
  mixture.position.x = 0.18;
  mixture.children[1].material = new THREE.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.5 });
  group.add(mixture);

  // Rain on the windscreen (only visible when it is actually raining).
  const dropMat = new THREE.MeshBasicMaterial({
    map: dropletTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const droplets = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), dropMat);
  droplets.position.set(0, 0.02, -0.62);
  droplets.renderOrder = 20;
  group.add(droplets);

  let t = 0;
  group.userData.update = (dt, ac, weather) => {
    t += dt;
    panel.update(dt, ac, weather);
    const c = ac.controls;
    // Yoke: rotate for aileron, push/pull for elevator.
    yoke.rotation.z = lerp(yoke.rotation.z, -c.roll * 0.8, clamp(dt * 10, 0, 1));
    yoke.position.z = lerp(yoke.position.z, -0.55 - c.pitch * 0.06, clamp(dt * 10, 0, 1));
    throttleLever.rotation.x = lerp(throttleLever.rotation.x, 0.5 - c.throttle * 0.9, clamp(dt * 8, 0, 1));
    for (const p of pedals) {
      p.mesh.position.z = -0.86 + c.yaw * p.side * 0.05;
    }
    // Rain streaks slide across the glass, faster when you fly faster.
    const rain = weather.cond.rain;
    dropMat.opacity = rain * 0.55;
    if (rain > 0.01) {
      dropMat.map.offset.y = (t * (0.05 + ac.airspeed * 0.004)) % 1;
      dropMat.map.offset.x = Math.sin(t * 0.4) * 0.02;
    }
  };
  group.userData.panel = panel;

  return group;
}
