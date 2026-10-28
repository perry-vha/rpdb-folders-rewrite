import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock.js';

let mock;
let app;
let tmp;
let base;
const j = async (route) => (await fetch(`${base}/${route}`)).json();
const tmdbCalls = () => mock.requests.filter((r) => r.startsWith('/3/') && !r.startsWith('/3/configuration'));

before(async () => {
  mock = await startMock();
  process.env.RPDB_BASE_URL = mock.base;
  process.env.IMDB_SUGGEST_URL = mock.base;
  process.env.TMDB_BASE_URL = `${mock.base}/3`;
  delete process.env.TMDB_API_KEY;
  process.env.RPDB_QUEUE_DELAY_MS = '0';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpdbtmdb-'));
  const movies = path.join(tmp, 'Movies');
  fs.mkdirSync(path.join(movies, 'The Matrix (1999)'), { recursive: true });
  const { ConfigStore } = await import('../src/config.js');
  const { startServer } = await import('../src/index.js');
  const store = new ConfigStore(path.join(tmp, 'config'));
  store.data.apiKey = mock.key;
  store.data.ignoreInitialScan = true;
  store.data.mediaFolders.movie = [movies];
  store.save();
  app = await startServer({ store, port: 0, host: '127.0.0.1', noBrowser: true });
  base = `http://127.0.0.1:${app.port}`;
});

after(async () => {
  await app?.close();
  await mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('without a TMDB key, matching uses IMDb only and never calls TMDB', async () => {
  const { matcher } = app.ctx;
  assert.equal(matcher.hasTmdb(), false);
  app.ctx.store.data.scanOrder = 'tmdb';
  const r = await matcher.match({ type: 'movie', name: 'The Matrix (1999)' });
  assert.equal(r.imdb, 'tt0133093');
  assert.equal(r.how, 'imdb');
  const tagged = await matcher.match({ type: 'movie', name: 'The Matrix (1999) [tmdb-603]' });
  assert.equal(tagged.imdb, 'tt0133093');
  assert.deepEqual(tmdbCalls(), []);
  app.ctx.store.data.scanOrder = 'imdb-tmdb';
});

test('Load Posters explains that a TMDB key is needed', async () => {
  const r = await j(`poster-choices?type=movie&name=${encodeURIComponent('The Matrix (1999)')}`);
  assert.equal(r.success, false);
  assert.match(r.message, /TMDB API key/);
});

test('setTmdbKey validates, saves and clears the key without exposing it', async () => {
  assert.equal((await j('getSettings')).tmdbKeySet, false);
  const bad = await j('setTmdbKey?key=bad');
  assert.equal(bad.success, false);
  assert.equal(app.ctx.store.data.tmdbKey, '');

  assert.deepEqual(await j('setTmdbKey?key=good-v3-key'), { success: true, tmdbKeySet: true });
  const s = await j('getSettings');
  assert.equal(s.tmdbKeySet, true);
  assert.equal(s.tmdbKeyFromEnv, false);
  assert.ok(!JSON.stringify(s).includes('good-v3-key'));
  assert.equal(app.ctx.matcher.hasTmdb(), true);
  assert.ok(mock.requests.some((u) => u.startsWith('/3/configuration?api_key=good-v3-key')));

  assert.equal((await j('setTmdbKey?key=eyJbad')).success, false);
  assert.equal((await j('setTmdbKey?key=eyJgood')).success, true);
  assert.ok(mock.requests.some((u) => /^\/3\/configuration\??$/.test(u)), 'v4 tokens are sent as a header, not in the URL');
  assert.ok(!mock.requests.some((u) => u.includes('eyJgood')));

  assert.deepEqual(await j('setTmdbKey?key='), { success: true, tmdbKeySet: false });
  assert.equal(app.ctx.matcher.hasTmdb(), false);
});
