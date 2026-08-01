# Island Flight Simulator

A browser flight simulator you can install and play offline. Learn to fly in the
tutorial, complete the missions, and land in anything from a blue-bird day to a
thunderstorm — across five very different places to fly.

Built with three.js. **Every texture and every sound in the game is generated in
code at load time** — there are no image or audio files to download, which is why
the whole thing is a few hundred kilobytes and works identically offline.

No build step. No `npm install`. No bundler. Serve the folder and it runs.

---

## Running it locally

The game is made of ES modules, so it must be served over HTTP. Opening
`index.html` straight from Finder or Explorer will **not** work — browsers block
module imports from `file://` URLs.

**Easiest way** (Python 3 is pre-installed on macOS and Linux):

```bash
python3 serve.py
```

That starts a server on <http://localhost:8807> and opens your browser. Press
Ctrl+C to stop it. To use a different port: `python3 serve.py 3000`.

**With Node.js instead:**

```bash
npx serve .
```

**With any other web server:** point it at this folder.

Requires a browser with WebGL 2: Chrome, Edge, Firefox, or Safari 16+.

### Hosting it

Every path in the game is relative, so it works unchanged from a subdirectory —
including GitHub Pages at `https://<user>.github.io/island-flight-sim/`. Enable
Pages on the `main` branch, root folder, and that is the whole deployment.

Add `?dev=1` to the URL to disable and clear the service worker. Do this while
you are editing: cache-first offline serving is exactly what you want for
players and exactly what you do not want when you are changing files.

---

## Installing it as an app (offline play)

1. Open the game in Chrome or Edge.
2. Click **Install / Download game** on the start screen, or use the install
   icon in the address bar.
3. On iPhone/iPad: Share → *Add to Home Screen*.

Once installed it runs from your dock or home screen in its own window with no
internet connection at all. The service worker (`sw.js`) caches every file on
first load, so even without installing, a second visit works offline.

---

## Controls

| Action | Keys |
| --- | --- |
| Pitch down / up | `W` / `S` |
| Roll left / right | `A` / `D` |
| Rudder left / right | `Q` / `E` |
| More power / less power | `Shift` / `Ctrl` (or `↑` / `↓`) |
| Wheel brakes | `Space` |
| Landing gear | `G` |
| Flaps down / up | `F` / `V` |
| Start / stop engine | `I` |
| **Autopilot on / off** | `P` |
| **Guidance lines on / off** | `N` |
| Change camera | `C` |
| Look behind | `B` (hold) |
| **Hide / show the whole interface** | `U` |
| Release cargo | `X` |
| Show controls | `H` |
| Mute | `M` |
| Pause | `Esc` |

Every key can be reassigned in **Settings → Controls**. Mouse flying and
gamepads are supported too (Settings → Flying).

**How do I slow down?** Hold `Ctrl` (or `↓`) to reduce power. `Space` is the
wheel brakes and only works on the ground. `F` lowers the flaps, which lets you
fly slowly on the approach.

---

## What is in the game

### Five maps

Chosen from **Choose Map** on the start screen. Every map keeps the *same
runway* — 09/27, 1,100 m of tarmac, 14 m above the sea — so the tutorial, the
missions and the landing scoring work identically wherever you go. What changes
is the land around it.

| Map | Difficulty | |
| --- | --- | --- |
| Kestrel Island | ●○○○○ Gentle | Tropical, rolling hills. Where everyone learns. |
| Harrier Flats | ●○○○○ Very gentle | A huge green plain with nothing to hit. |
| Coral Atoll | ●●○○○ Easy | Flat sandy cays; long water crossings between them. |
| Aurora Fjords | ●●●●○ Hard | Cold, steep ridges running down to the shoreline. |
| Ember Isle | ●●●●● Expert | A volcano beside the field and strong, shifting wind. |

### Flying

- **Tutorial** — nine guided steps from starting the engine to landing.
- **Island Circuit** — take off, fly five checkpoint rings, land.
- **Delivery** — carry supplies to the outlying strip, drop them on target, come home.
- **Storm Approach** — a 24 kt crosswind landing in a thunderstorm.
- **Free Flight** — any time of day, any weather, any wind.

**Autopilot** (`P`) holds the wings level, holds your height and tracks the
current mission waypoint. Touching the stick hands control straight back. It
will not engage on the ground, it climbs rather than fly you into terrain, and
it deliberately will not land for you.

**Guidance lines** (`N`) are two glowing rails running from your wingtips to
wherever you are going. Keep them even and you are pointing the right way. They
fade out on short final so they are never between you and the runway.

**Random winds** (Settings → Flying, off by default) makes the wind wander
around the speed and direction you chose, with a gust rolling through every
half-minute or so and a callout on the HUD when one arrives.

Weather covers midday / sunset / night crossed with clear / cloudy / rainy /
stormy, with adjustable wind speed and direction, real crosswind effects,
turbulence, drifting clouds and lightning.

Two flight models: **simplified** (the aeroplane levels its wings, holds its
height, coordinates the rudder and refuses to stall) and **realistic** (all of
that switched off).

---

## Project layout

```
index.html              page shell and loading screen
manifest.webmanifest    PWA manifest
sw.js                   service worker — precaches everything for offline play
serve.py                tiny local web server
styles/main.css         all interface styling
icons/                  generated app icons
tools/build-zip.sh      builds the in-game "Download source ZIP" file
tests/selftest.js       headless self-test (see below)
src/
  main.js               entry point: renderer, game states, frame loop
  core/
    noise.js            deterministic PRNG + value/fractal noise
    storage.js          settings, progress and best scores in localStorage
  render/
    textures.js         every texture in the game, drawn with Canvas 2D
  world/
    maps.js             the five maps, as pure data
    weather.js          time of day, conditions, wind, gusts, random winds
    sky.js              sky dome shader, sun, stars, image-based lighting
    terrain.js          island height function, mesh chunks, ground queries
    water.js            ocean planes and coastline foam
    airport.js          runway, taxiways, buildings, lighting, working PAPI
    scenery.js          trees, town, lighthouse, delivery pad, boats
    clouds.js           instanced billboard clouds and overcast decks
    precip.js           rain
  aircraft/
    physics.js          6-DOF flight model, landing gear, landing scoring
    model.js            the aeroplane, lofted from aerofoil sections
    cockpit.js          cockpit interior and the live instrument panel
  flight/
    input.js            remappable keyboard, mouse flying, gamepad
    camera.js           cockpit / follow / orbit / wing / tower views
    autopilot.js        wings-level, height-hold and waypoint tracking
  audio/
    index.js            facade over the whole audio system
    mixer.js            AudioContext, five volume buses, noise sources
    engine.js           piston engine and propeller synthesis
    ambience.js         slipstream, rain, thunder, tyres, gear
    atc.js              radio: formant chatter, squelch, static, interference
    alerts.js           stall warner, gear horn, chimes
    music.js            ambient pad
  game/
    runner.js           drives the tutorial and the missions
    missions.js         the missions
    tutorial.js         the flight-school lesson
    markers.js          checkpoint rings and the cargo crate
    navguide.js         the wingtip guidance rails
    atc-director.js     decides when ATC should speak
  ui/
    hud.js              heads-up display
    menus.js            start screen, maps, missions, settings, credits
    credits.js          asset credits and licences
```

### How the world works

There is one analytic height function, `heightAt(x, z)` in `world/terrain.js`.
It drives the terrain mesh, the aircraft's ground collision and where every tree
and building is placed — which is why the wheels always touch exactly the ground
you can see. A map is pure data: a list of islands with a shape profile, a
colour palette and a scenery plan. `applyMap(id)` swaps it, and the world is
rebuilt around it.

---

## Running the self-test

The game ships with a headless test suite that flies it for you — take-off,
climb, turns, stalls, landings in calm air and in an 18 kt crosswind with rain,
all twelve weather combinations, every camera, the tutorial, the missions, save
data and the offline plumbing.

Open the game, then in the browser console:

```js
const { runSelfTest } = await import('./tests/selftest.js');
const results = await runSelfTest(window.__sim);
console.table(results.checks);
```

`window.__sim` also exposes `step(seconds)`, `snapshot()`, `key(code, down)` and
`override` for driving the simulator by hand — the flight model can be driven
entirely without a window.

---

## Known limitations

- In a 14 kt or stronger crosswind the landing roll-out drifts off the
  centreline if you never touch the rudder. It will not crash you, but you do
  have to steer.
- The autopilot does not fly approaches or land.
- Shadows and image-based lighting are disabled on the *low* graphics preset.

---

## Licence

Code and generated assets: **CC0 1.0** (public domain) — copy it, change it,
share it, use it in your own projects. Full text in [LICENSE](LICENSE).

Bundled three.js (`src/vendor/three.module.js`) remains under its own **MIT**
licence; the full text is in `src/vendor/three.LICENSE`.

Asset-by-asset credits are in the in-game **Credits & licences** screen.

### A note on the ATC voices

**The default has no text-to-speech, no AI-generated voice, and bundles no
recordings.** The radio calls are indistinct formant-filtered chatter — the
acoustic shape of speech without any words — pushed through a realistic radio
chain (300–2800 Hz band, soft clipping, squelch bursts, relay clicks,
heterodyne interference and dropouts). The words are shown as subtitles.

**Settings → Sound → ATC voices** offers three options:

| Option | What it does |
| --- | --- |
| **Radio chatter** (default) | The synthesised voice described above. No TTS. |
| **Your device's speech voice** | Your operating system's own speech synthesiser. This **is** text-to-speech, which is why it is opt-in and not the default. Nothing is generated by a model and nothing is downloaded — it is the same voice your computer already uses. |
| **Recordings I have added myself** | Plays clips you put in `assets/atc/`. The game ships with none. |

The synthesised radio and the recordings both run through the same radio chain,
so a real clip sits in the same acoustic space as everything else. Any line you
have not recorded falls back to the synthesised voice.

To add recordings, see [`assets/atc/README.md`](assets/atc/README.md) — it
covers the manifest format, offline caching, and which licences are safe to
redistribute.
