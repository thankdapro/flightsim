/**
 * Local save data: settings, mission progress and best landing scores.
 * Everything lives in localStorage, so it survives offline and needs no server.
 */

const SETTINGS_KEY = 'islandsim.settings.v1';
const PROGRESS_KEY = 'islandsim.progress.v1';

export const DEFAULT_SETTINGS = {
  quality: 'high',
  // Which of the five places you are flying. See world/maps.js.
  map: 'kestrel',
  flightMode: 'simplified',
  volumes: { master: 0.85, engine: 0.8, environment: 0.7, atc: 0.85, alerts: 0.9, music: 0.35 },
  // Sound starts off so the game never surprises anyone with noise; there is
  // a one-click toggle on the start screen and in Settings → Sound.
  muted: true,
  music: true,
  subtitles: true,
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  mouseFlying: false,
  invertMouse: false,
  sensitivity: 1,
  gamepad: true,
  showHints: true,
  guidance: true,
  // Wandering wind with occasional gusts. Off while you are learning.
  randomWinds: false,
  atcChatter: true,
  weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 },
};

export const DEFAULT_PROGRESS = {
  tutorialComplete: false,
  missions: {}, // id -> { complete, bestScore, bestTime }
  bestLanding: null, // { score, vsFpm, date }
  landings: 0,
  flights: 0,
  takeoffs: 0,
  crashes: 0,
  hoursFlown: 0,
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k in extra) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  }
  return out;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return deepMerge(fallback, JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data — using defaults.', e);
    return { ...fallback };
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Could not save data (storage may be full or blocked).', e);
    return false;
  }
}

export function loadSettings() {
  return read(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(s) {
  return write(SETTINGS_KEY, s);
}

export function loadProgress() {
  return read(PROGRESS_KEY, DEFAULT_PROGRESS);
}

export function saveProgress(p) {
  return write(PROGRESS_KEY, p);
}

export function recordLanding(progress, grade) {
  progress.landings++;
  if (!grade.crashed && (!progress.bestLanding || grade.score > progress.bestLanding.score)) {
    progress.bestLanding = {
      score: grade.score,
      vsFpm: grade.vsFpm,
      date: new Date().toISOString().slice(0, 10),
    };
  }
  saveProgress(progress);
  return progress;
}

export function recordMission(progress, id, { score = 0, time = 0 } = {}) {
  const prev = progress.missions[id] || { complete: false, bestScore: 0, bestTime: null };
  progress.missions[id] = {
    complete: true,
    bestScore: Math.max(prev.bestScore, score),
    bestTime: prev.bestTime === null ? time : Math.min(prev.bestTime, time),
  };
  saveProgress(progress);
  return progress;
}

export function resetAll() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem('islandsim.bindings.v1');
  } catch (e) {
    /* ignore */
  }
}
