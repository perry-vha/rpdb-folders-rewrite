import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, defaultConfig, mergeDefaults, styleKeys } from '../src/config.js';
import { parseArgs } from '../src/index.js';
import { remoteUrls } from '../src/remote.js';
import { nextTimeOfDay } from '../src/plex.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpdbcfg-'));

test('defaults match the spec', () => {
  const c = defaultConfig();
  assert.equal(c.port, 8750);
  assert.equal(c.minOverwritePeriod, 2505600000);
  assert.equal(c.scanOrder, 'imdb-tmdb');
  assert.deepEqual(c.mediaFolders, { movie: [], series: [] });
  assert.deepEqual(c.defaultBadges, { dolbyvision: 'dolbyvision', hdr: 'hdrcolor', remux: 'remuxgold' });
  assert.equal(c.pass, false);
  assert.ok('posterBarSkewDirection' in c && 'itemLogoTheme' in c && 'backdropCertPos' in c);
  assert.equal(styleKeys(true).length, 52);
});

test('store creates, persists atomically and reloads', () => {
  const dir = tmp();
  const s = new ConfigStore(dir);
  s.data.apiKey = 'abc';
  s.data.mediaFolders.movie.push('/x');
  s.save();
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
  const s2 = new ConfigStore(dir);
  assert.equal(s2.data.apiKey, 'abc');
  assert.deepEqual(s2.data.mediaFolders.movie, ['/x']);
  assert.ok(s2.data.clientId);
  assert.equal(s2.data.clientId, s.data.clientId);
});

test('missing keys are merged from defaults; corrupt files are preserved', () => {
  const merged = mergeDefaults({ apiKey: 'z', mediaFolders: { movie: ['/a'] } });
  assert.deepEqual(merged.mediaFolders, { movie: ['/a'], series: [] });
  assert.equal(merged.port, 8750);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
  const s = new ConfigStore(dir);
  assert.equal(s.data.port, 8750);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('corrupt')));
});

test('CLI argument parsing', () => {
  assert.deepEqual(parseArgs(['--no-browser', '--host="10.0.0.5"', '--remote=full-scan']), {
    noBrowser: true, host: '10.0.0.5', remote: 'full-scan', port: undefined,
  });
  assert.equal(parseArgs([]).noBrowser, false);
});

test('remote command URLs', () => {
  const cfg = { pass: 'p w', mediaFolders: { movie: ['/m1', '/m 2'], series: ['/s'] } };
  assert.deepEqual(remoteUrls('full-scan', cfg), ['http://127.0.0.1:8750/runFullScan?pass=p%20w']);
  assert.deepEqual(remoteUrls('movie-scan', cfg), [
    'http://127.0.0.1:8750/runFullScan?folder=%2Fm1&type=movie&pass=p%20w',
    'http://127.0.0.1:8750/runFullScan?folder=%2Fm%202&type=movie&pass=p%20w',
  ]);
  assert.deepEqual(remoteUrls('overwrite-tv-scan', { mediaFolders: { series: ['/s'] } }), [
    'http://127.0.0.1:8750/forceOverwriteScan?folder=%2Fs&type=series',
  ]);
  assert.deepEqual(remoteUrls('force-overwrite-scan', { pass: false }), ['http://127.0.0.1:8750/forceOverwriteScan']);
});

test('plex time-of-day scheduling', () => {
  const now = new Date(2026, 0, 10, 12, 0, 0);
  assert.equal(nextTimeOfDay(1, 30, 'AM', now).getDate(), 11);
  assert.equal(nextTimeOfDay(1, 30, 'PM', now).getHours(), 13);
  assert.equal(nextTimeOfDay(12, 0, 'AM', now).getHours(), 0);
});
