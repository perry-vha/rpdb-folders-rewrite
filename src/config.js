import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteFileSync, isDocker, log } from './util.js';

export const STYLE_SUFFIXES = [
  'Theme', 'Size', 'BarPos', 'FontSize', 'FontWeight', 'TextStyle', 'LogoStyle', 'BarOpacity', 'BarColor',
  'FontColor', 'BarPadding', 'BarMargin', 'BarRoundness', 'BarStrokeColor', 'BarStrokeWidth', 'BarStrokeSide',
  'BarSkewDirection',
];
export const IMAGE_KINDS = ['poster', 'backdrop', 'logo'];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Per-folder style maps, e.g. posterTheme; per-item maps, e.g. itemPosterTheme.
export function styleKeys(item = false) {
  const keys = [];
  for (const k of IMAGE_KINDS) for (const s of STYLE_SUFFIXES) keys.push(item ? `item${cap(k)}${s}` : `${k}${s}`);
  keys.push(item ? 'itemBackdropCertPos' : 'backdropCertPos');
  return keys;
}

export const FOLDER_BADGE_KEYS = {
  label: 'labels', badges: 'badges', autoBadges: 'autoBadges', badgePos: 'badgePositions',
  backdropBadgePos: 'backdropBadgePositions', maxBadges: 'maxBadges', backdropMaxBadges: 'backdropMaxBadges',
  badgeSize: 'badgeSizes',
};
export const ITEM_BADGE_KEYS = {
  label: 'itemLabels', badges: 'itemBadges', autoBadges: 'itemAutoBadges', badgePos: 'itemBadgePositions',
  backdropBadgePos: 'itemBackdropBadgePositions', maxBadges: 'itemMaxBadges',
  backdropMaxBadges: 'itemBackdropMaxBadges', badgeSize: 'itemBadgeSizes',
};

export function defaultConfig() {
  const both = (v) => ({ movie: structuredClone(v), series: structuredClone(v) });
  const cfg = {
    port: 8750, host: false, checkFullUpdate: 3600000, fullUpdate: 604800000, overwrite: false,
    minOverwritePeriod: 2505600000, overwriteLast2Years: false, noPostersToEmptyFolders: false, apiKey: '', tmdbKey: '', historyCount: 0,
    backdrops: false, logos: false, scanOrder: 'imdb-tmdb', cacheMatches: true, pass: false, watchFolderDepth: 0,
    movieTextless: false, seriesTextless: false, moviePosterType: 'poster-default', seriesPosterType: 'poster-default',
    movieRatingOrder: '', seriesRatingOrder: '', backdropsBadges: false, updateTransitionMay: true,
    ignoreInitialScan: false, usePolling: false, pollingInterval: 100, baseUrl: '/', checkForLocalImdbId: false,
    overwriteProbeData: false, plexDelayType: false, plexRefreshDelay: 0, plexTodHour: 1, plexTodMin: 0,
    plexTodAmPm: 'AM', plexDetect: 1, useWebhook: false, webhookDelay: 0, retryFrequency: 1, lastRetryMonth: -1,
    retryNewerThanMonths: 6, tmdbKey: '', clientId: '', mdblistKeys: [],
    posterEngine: 'rpdb', localDesign: null, folderDesigns: {}, itemDesigns: {}, designTemplates: {},
    lastOverwrite: { movie: 0, series: 0 }, lastFullUpdate: { movie: 0, series: 0 },
    mediaFolders: both([]), overwriteMatches: both({}), imdbCache: both({}), unmatched: both({}),
    missingPosters: both({}), posterLang: { movie: 'en', series: 'en' }, posterSecLang: { movie: 'en', series: 'en' },
    plex: { protocol: 'https', host: '', port: '32400', token: '' },
    defaultBadges: { dolbyvision: 'dolbyvision', hdr: 'hdrcolor', remux: 'remuxgold' },
    customPosters: {},
  };
  for (const m of [...Object.values(FOLDER_BADGE_KEYS), ...Object.values(ITEM_BADGE_KEYS), ...styleKeys(false), ...styleKeys(true)]) {
    cfg[m] = {};
  }
  return cfg;
}

export function getConfigDir() {
  if (process.env.RPDB_CONFIG_DIR) return process.env.RPDB_CONFIG_DIR;
  if (isDocker()) return '/rpdb/config';
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'RPDB-Folders');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'RPDB-Folders');
  return path.join(os.homedir(), '.config', 'RPDB-Folders');
}

export function getMountsDir() {
  return process.env.RPDB_MOUNTS_DIR || '/rpdb/mounts';
}

// Fill in keys that are missing from a stored config (one level deep for objects).
export function mergeDefaults(stored, defaults = defaultConfig()) {
  const out = { ...defaults };
  if (!stored || typeof stored !== 'object') return out;
  for (const [k, v] of Object.entries(stored)) {
    const d = defaults[k];
    if (d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...d, ...v };
    } else out[k] = v;
  }
  return out;
}

export class ConfigStore {
  constructor(dir = getConfigDir()) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    fs.mkdirSync(dir, { recursive: true });
    let stored = null;
    if (fs.existsSync(this.file)) {
      try {
        stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (e) {
        const bak = `${this.file}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.file, bak);
        log(`Config file could not be parsed, saved a copy to ${bak} and starting fresh`);
      }
    }
    this.data = mergeDefaults(stored);
    if ('mdblistKey' in this.data) {
      const old = this.data.mdblistKey;
      if (old && !this.data.mdblistKeys.includes(old)) this.data.mdblistKeys.unshift(old);
      delete this.data.mdblistKey;
    }
    if (!this.data.clientId) this.data.clientId = crypto.randomUUID();
    this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    atomicWriteFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
