/**
 * The three missions.
 *
 *   1. Island Circuit  — take off, fly through five checkpoint rings, land.
 *   2. Mango Cay Delivery — carry supplies to the neighbouring island, drop
 *      them on the target, come home.
 *   3. Storm Approach — a crosswind landing in a thunderstorm.
 *
 * Every instruction is written the way an instructor would say it to a child:
 * one action, plainly stated, with the number that matters.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import { DELIVERY_PAD } from '../world/scenery.js';
import { heightAt } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';

const ELEV = RUNWAY.elev;
const ft = (m) => m * UNITS.FT;

/** Start-of-runway spawn, ready to go. */
export const RUNWAY_START = {
  pos: new THREE.Vector3(-470, ELEV, 0),
  headingDeg: 90,
};

const airborneOverRunway = (dist = 6500, alt = 460) => ({
  pos: new THREE.Vector3(-dist, ELEV + alt, 40),
  headingDeg: 90,
  speed: 58,
  altAGL: alt,
});

function landedAndStopped(ctx) {
  const ac = ctx.ac;
  return (
    !!ctx.data.lastTouchdown &&
    !ctx.data.lastTouchdown.crashed &&
    ac.onGround &&
    ac.groundSpeed < 2.5 &&
    ac.groundTime > 1.2
  );
}

export const MISSIONS = [
  {
    id: 'circuit',
    name: 'Island Circuit',
    short: 'Checkpoint flight',
    difficulty: 'Easy',
    icon: '◎',
    blurb:
      'Take off from Kestrel Island, fly through five glowing rings around the island, then come back and land.',
    reward: 'Teaches turning, altitude control and the landing pattern.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 110 },
    spawn: RUNWAY_START,
    parTime: 300,
    steps: [
      {
        id: 'brief',
        text: 'Welcome aboard! Push the throttle up with Shift and roll down the runway.',
        hint: 'Hold Shift for full power. Space is the brakes if you need to stop.',
        atc: {
          text: 'Skylark one seven two, Kestrel Tower, runway zero nine, cleared for take-off, wind one one zero at six.',
          voice: 'tower',
        },
        targetLabel: 'Runway 09',
        target: () => RUNWAY.thresholdEast,
        check: (ctx) => ctx.ac.ias * UNITS.KTS > 35,
      },
      {
        id: 'rotate',
        text: 'At 55 knots, pull back gently with S to lift off.',
        hint: 'Watch the airspeed. When it passes 55, ease back on S.',
        // agl is in metres.
        check: (ctx) => ctx.ac.agl > 10 && ctx.ac.airborneTime > 1.5,
      },
      {
        id: 'climb',
        text: 'Climb to 1,500 feet and gently level off.',
        hint: 'Nose slightly up, full power, and let the altimeter wind up to 1,500.',
        atc: {
          text: 'Skylark one seven two, radar contact, climb and maintain one thousand five hundred feet.',
          voice: 'approach',
        },
        check: (ctx) => ft(ctx.ac.alt) > 1400,
      },
      {
        id: 'rings',
        text: 'Fly through the blue rings. Turn with A and D.',
        hint: 'Lean into the turn with A or D, then centre the controls again.',
        targetLabel: 'Next ring',
        gates: [
          { pos: new THREE.Vector3(1500, ELEV + 470, -260), heading: 90, radius: 40 },
          { pos: new THREE.Vector3(2400, ELEV + 520, 1500), heading: 160, radius: 40 },
          { pos: new THREE.Vector3(500, ELEV + 620, 2500), heading: 250, radius: 40 },
          { pos: new THREE.Vector3(-1800, ELEV + 560, 1400), heading: 320, radius: 40 },
          { pos: new THREE.Vector3(-2200, ELEV + 430, -700), heading: 30, radius: 40 },
        ],
      },
      {
        id: 'downwind',
        text: 'Nicely flown! Now head back to the airfield and line up with runway 09 from the west.',
        hint: 'The runway numbers 09 mean you land heading east. Aim for the green threshold lights.',
        atc: {
          text: 'Skylark one seven two, cleared to land runway zero nine. Report on final.',
          voice: 'tower',
        },
        targetLabel: 'Runway 09 threshold',
        target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1600, 200, 0)),
        check: (ctx) =>
          ctx.ac.pos.x < RUNWAY.thresholdWest.x - 400 &&
          ctx.ac.pos.x > RUNWAY.thresholdWest.x - 3800 &&
          Math.abs(ctx.ac.pos.z) < 700 &&
          Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 55,
      },
      {
        id: 'land',
        text: 'Reduce power, keep the two white and two red PAPI lights, and land on the runway.',
        hint: 'Pull the power back with Ctrl. Aim just past the white bars, then flare gently.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx, result) => {
      ctx.sim.speak('Skylark one seven two, nicely done. Taxi to the apron at your convenience.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const timeScore = Math.max(0, 1 - ctx.elapsed / 600);
      return Math.round((l ? l.score : 40) * 0.7 + timeScore * 30);
    },
  },

  {
    id: 'delivery',
    name: 'Mango Cay Delivery',
    short: 'Island delivery',
    difficulty: 'Medium',
    icon: '▣',
    blurb:
      'The village on Mango Cay needs medical supplies. Fly the crate 8 km south-east, drop it on the yellow target, then fly home and land.',
    reward: 'Teaches navigation, descending and flying accurately.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 11, windDirDeg: 140 },
    spawn: RUNWAY_START,
    parTime: 420,
    onStart: (ctx) => {
      ctx.sim.hasCargo = true;
      ctx.data.dropped = false;
    },
    steps: [
      {
        id: 'load',
        text: 'The supply crate is loaded. Take off from runway 09 and turn south-east toward Mango Cay.',
        hint: 'Full power with Shift, pull back at 55 knots, then turn right with D.',
        atc: {
          text: 'Skylark one seven two, Kestrel Tower, cleared for take-off runway zero nine. Mango Cay is waiting on you.',
          voice: 'tower',
        },
        targetLabel: 'Mango Cay',
        target: () => DELIVERY_PAD,
        check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
      },
      {
        id: 'cruise',
        text: 'Fly to Mango Cay. Climb to about 2,000 feet on the way.',
        hint: 'Follow the arrow at the top of the screen. It always points to the island.',
        targetLabel: 'Mango Cay',
        target: () => DELIVERY_PAD,
        check: (ctx) => ctx.ac.pos.distanceTo(DELIVERY_PAD) < 1500,
      },
      {
        id: 'descend',
        text: 'Now come down low over the target — below 500 feet above the ground.',
        hint: 'Ease the power back with Ctrl and let the nose drop slightly.',
        atc: {
          text: 'Sea Bird, this is Mango Cay village. We can hear you. Drop when you are ready, over.',
          voice: 'village',
        },
        targetLabel: 'Drop target',
        target: () => DELIVERY_PAD,
        check: (ctx) =>
          ft(ctx.ac.agl) < 520 && ctx.ac.pos.distanceTo(DELIVERY_PAD) < 420,
      },
      {
        id: 'drop',
        text: 'Press X to release the crate right over the yellow target!',
        hint: 'Fly across the middle of the ring and press X. Slower is more accurate.',
        targetLabel: 'Drop target',
        target: () => DELIVERY_PAD,
        check: (ctx) => {
          const crate = ctx.sim.crate;
          if (!crate || !crate.landed) return false;
          const d = crate.group.position.distanceTo(DELIVERY_PAD);
          ctx.data.dropDistance = d;
          if (d > 90) {
            // Missed: give them another crate and another go.
            ctx.sim.notify('The crate missed the target — here is another one. Try again!', 'warn');
            ctx.sim.removeCrate();
            ctx.sim.hasCargo = true;
            return false;
          }
          ctx.sim.notify(`Crate delivered — ${Math.round(d)} m from the middle!`, 'good');
          return true;
        },
      },
      {
        id: 'home',
        text: 'Great drop! Now fly home to Kestrel Island and land on runway 09.',
        hint: 'Turn back to the north-west and follow the arrow home.',
        atc: {
          text: 'Sea Bird, supplies received, thank you! Safe flight home.',
          voice: 'village',
        },
        targetLabel: 'Kestrel Island',
        target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
        check: (ctx) =>
          ctx.ac.pos.x < RUNWAY.thresholdWest.x - 300 &&
          ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 4200 &&
          Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 60,
      },
      {
        id: 'land',
        text: 'Land on runway 09 and bring the aeroplane to a stop.',
        hint: 'Two white and two red on the PAPI means a perfect glide path.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        atc: { text: 'Skylark one seven two, cleared to land runway zero nine.', voice: 'tower' },
        check: landedAndStopped,
      },
    ],
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const acc = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 90) : 0.4;
      return Math.round((l ? l.score : 40) * 0.5 + acc * 35 + Math.max(0, 1 - ctx.elapsed / 700) * 15);
    },
  },

  {
    id: 'storm',
    name: 'Storm Approach',
    short: 'Safe landing in bad weather',
    difficulty: 'Hard',
    icon: '⚡',
    blurb:
      'You are already airborne west of the island and a thunderstorm has rolled in. Strong wind is pushing you sideways. Fly a careful approach and land safely.',
    reward: 'Teaches crosswind landings and staying calm in rough air.',
    weather: { time: 'sunset', condition: 'stormy', windSpeedKts: 24, windDirDeg: 352 },
    spawn: airborneOverRunway(6800, 470),
    parTime: 260,
    steps: [
      {
        id: 'brief',
        text: 'The wind is pushing you from the left. Point the nose slightly left of the runway to stay lined up.',
        hint: 'Small, gentle inputs. Let the aeroplane settle between corrections.',
        atc: {
          text: 'Skylark one seven two, Kestrel Tower, wind three five zero at two four, gusting. Runway zero nine, cleared to land. Caution, wind shear reported on final.',
          voice: 'tower',
          urgency: 1,
        },
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: (ctx) => ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 4200,
      },
      {
        id: 'final',
        text: 'Follow the PAPI lights: two white and two red. Keep the wings level.',
        hint: 'All red means too low — add power. All white means too high — reduce power.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: (ctx) => ft(ctx.ac.agl) < 220 && ctx.ac.pos.x > RUNWAY.thresholdWest.x - 1400,
      },
      {
        id: 'land',
        text: 'Straighten the nose just before the wheels touch, and land!',
        hint: 'A firm landing is fine in this weather — just keep it on the runway.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak(
        'Skylark one seven two, that was a fine job in this weather. Welcome back to Kestrel.',
        'tower'
      );
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const base = l ? l.score : 30;
      return Math.round(base * 0.85 + 15);
    },
  },
];

export function findMission(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

/** Free flight is a mission with no steps — just the sky and the island. */
export const FREE_FLIGHT = {
  id: 'free',
  name: 'Free Flight',
  steps: [],
  failOnCrash: false,
};
