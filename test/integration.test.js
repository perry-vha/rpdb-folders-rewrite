import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock.js';

let mock;
let app;
let tmp;
let moviesDir;
let base;

const j = async (route) => (await fetch(`${base}/${route}`)).json();
const exists = (...p) => fs.existsSync(path.join(...p));
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

before(async () => {
  mock = await startMock();
  process.env.RPDB_BASE_URL = mock.base;
  process.env.IMDB_SUGGEST_URL = mock.base;
  process.env.TMDB_BASE_URL = `${mock.base}/3`;
  process.env.TMDB_API_KEY = 'x';
  process.env.MDBLIST_BASE_URL = mock.base;
  process.env.RPDB_QUEUE_DELAY_MS = '0';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpdbint-'));
  moviesDir = path.join(tmp, 'Movies');
  for (const d of ['The Matrix (1999)', 'Obscure Thing (2010)', 'Alien.1979.1080p.BluRay.x264', 'Embedded [imdb-tt0111161]', 'Unknown Film (2001)']) {
    fs.mkdirSync(path.join(moviesDir, d), { recursive: true });
    fs.writeFileSync(path.join(moviesDir, d, 'movie.mkv'), 'x');
  }
  fs.writeFileSync(path.join(moviesDir, 'Interstellar.2014.2160p.mkv'), 'x');
  const { ConfigStore } = await import('../src/config.js');
  const { startServer } = await import('../src/index.js');
  const store = new ConfigStore(path.join(tmp, 'config'));
  store.data.apiKey = mock.key;
  store.data.logos = true;
  store.save();
  app = await startServer({ store, port: 0, host: '127.0.0.1', noBrowser: true });
  base = `http://127.0.0.1:${app.port}`;
});

after(async () => {
  await app?.close();
  await mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('UI and basic routes respond', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<html/i);
  assert.deepEqual(await j('needsPass'), { success: true, required: false });
  assert.deepEqual(await j('checkPass'), { success: true });
  assert.deepEqual(await j('needsUpdate').catch(() => ({ needsUpdate: false })), { needsUpdate: false });
  const s = await j('getSettings');
  assert.equal(s.success, true);
  assert.equal(s.apiKeyPrefix, 'tes');
  assert.equal(s.usePolling, 'fsevents');
  assert.match(s.webhookRadarr, /\/radarr$/);
  assert.equal((await j('getConfigPath')).path, app.ctx.store.file);
  assert.deepEqual(await j('checkRequests'), { req: 5, limit: 1000, success: true });
  const poll = await j('pollData');
  assert.equal(poll.success, true);
  const backup = await fetch(`${base}/backup.json`);
  assert.match(backup.headers.get('content-disposition'), /^attachment; filename="backup-.*";$/);
});

test('add folder validates and scans', async () => {
  assert.equal((await j('addMovieFolder?folder=' + encodeURIComponent(path.join(tmp, 'nope')))).success, false);
  const r = await j('addMovieFolder?folder=' + encodeURIComponent(moviesDir) + '&label=HI&backdropBadgePos=right-bottom');
  assert.equal(r.success, true);
  assert.equal((await j('addMovieFolder?folder=' + encodeURIComponent(moviesDir))).success, false);
  await waitFor(() => exists(moviesDir, 'Interstellar.2014.2160p.jpg'));
  await app.ctx.engine.idle();
  assert.ok(exists(moviesDir, 'The Matrix (1999)', 'poster.jpg'));
  assert.ok(exists(moviesDir, 'Alien.1979.1080p.BluRay.x264', 'poster.jpg'));
  assert.ok(exists(moviesDir, 'Embedded [imdb-tt0111161]', 'poster.jpg'));
  assert.ok(exists(moviesDir, 'Interstellar.2014.2160p.jpg'));
  assert.ok(!exists(moviesDir, 'Interstellar.2014.2160p-logo.jpg'));
  assert.ok(exists(moviesDir, 'Interstellar.2014.2160p-logo.png'));
  assert.ok(exists(moviesDir, 'The Matrix (1999)', 'logo.png'));
  assert.ok(!exists(moviesDir, 'The Matrix (1999)', 'background.jpg'));
  const c = app.ctx.store.data;
  assert.ok(c.unmatched.movie['Unknown Film (2001)']);
  assert.ok(c.missingPosters.movie['Obscure Thing (2010)']);
  assert.ok(!exists(moviesDir, 'Obscure Thing (2010)', 'poster.jpg'));
  assert.equal(c.imdbCache.movie['The Matrix (1999)'], 'tt0133093');
  assert.equal(c.backdropBadgePositions[moviesDir], 'right-bottom');
  assert.ok(mock.requests.some((u) => u.includes('/imdb/poster-default/tt0133093.jpg?label=HI')));
  assert.ok(app.ctx.engine.historyCount >= 4);
});

test('search, fix match, badges and styles routes', async () => {
  const s = await j('searchStrings?type=movie');
  assert.match(s.folders, /\/The Matrix \(1999\)\u200b \[Movies\]\//);
  assert.deepEqual(s.folderChoices, ['Movies', 'Unmatched', 'Missing Posters']);
  assert.equal((await fetch(`${base}/searchStrings`)).status, 400);
  const u = await j('searchStrings?type=movie&searchfolder=Unmatched');
  assert.equal(u.folders, '/Unknown Film (2001)/');
  assert.equal((await j('searchStrings?type=series')).folders, '//');

  const bad = await j('addFixMatch?type=movie&imdb=tt1&folder=' + encodeURIComponent('a/b'));
  assert.equal(bad.message, 'The folder name cannot include "/"');
  assert.match((await j('addFixMatch?type=movie&imdb=tt1&folder=Nope')).message, /could not be found within your movie folders/);
  assert.equal((await j('addFixMatch?type=movie&imdb=zzz&folder=Unknown%20Film%20(2001)')).message, 'Invalid IMDB URL / IMDB ID');
  const ok = await j('addFixMatch?type=movie&imdb=' + encodeURIComponent('https://www.imdb.com/title/tt0068646/') + '&folder=Unknown%20Film%20(2001)');
  assert.equal(ok.success, true);
  await app.ctx.engine.idle();
  assert.ok(exists(moviesDir, 'Unknown Film (2001)', 'poster.jpg'));
  assert.equal(app.ctx.store.data.overwriteMatches.movie['Unknown Film (2001)'], 'tt0068646');
  assert.ok(!app.ctx.store.data.unmatched.movie['Unknown Film (2001)']);

  const f = encodeURIComponent(moviesDir);
  await j(`editFolderLabel?folder=${f}&label=X&badges=${encodeURIComponent('ageRating=1&videoQuality=1')}&autoBadges=1&maxBadges=2`);
  const bs = await j(`getBadgeSettings?folder=${f}`);
  assert.deepEqual(bs, { success: true, label: 'X', autoBadges: 'ageRating=1&videoQuality=1', maxBadges: '2' });
  await j(`editFolderLabel?folder=${f}`);
  assert.deepEqual(await j(`getBadgeSettings?folder=${f}`), { success: true });

  await j(`editItemLabel?type=movie&folder=${encodeURIComponent('The Matrix (1999)')}&label=ITEM&badges=4k,hdr`);
  assert.equal(app.ctx.store.data.itemLabels.tt0133093, 'ITEM');
  assert.deepEqual(await j(`getBadgeSettings?type=movie&folder=${encodeURIComponent('The Matrix (1999)')}`), { success: true, label: 'ITEM', badges: '4k,hdr' });

  await j(`editFolderStyles?folder=${f}&posterTheme=blocks&posterBarPos=top&logoTheme=light-bar`);
  assert.deepEqual(await j(`getStylesSettings?folder=${f}`), { success: true, posterTheme: 'blocks', posterBarPos: 'top', logoTheme: 'light-bar' });
  await j(`editFolderStyles?folder=${f}`);
  assert.deepEqual(await j(`getStylesSettings?folder=${f}`), { success: true });
});

test('poster, preview, custom poster and scans', async () => {
  const p = await fetch(`${base}/poster?type=movie&name=${encodeURIComponent('The Matrix (1999)')}`);
  assert.equal(p.status, 200);
  assert.match(await p.text(), /imdb\/poster-default\/tt0133093\.jpg/);
  const pv = await fetch(`${base}/preview?theme=blocks&imageBackdrop=1`);
  assert.match(await pv.text(), /backdrop-default\/tt0068646\.jpg\?theme=blocks/);
  const cp = await j('custom-poster?type=movie&folder=' + encodeURIComponent('The Matrix (1999)') + '&customPoster=' + encodeURIComponent('https://img.test/a.png'));
  assert.equal(cp.success, true);
  await app.ctx.engine.idle();
  assert.ok(mock.requests.some((u) => u.includes('custom-poster/tt0133093.jpg?img=https%3A%2F%2Fimg.test%2Fa.png')));
  assert.equal((await j('runFullScan')).success, true);
  await app.ctx.engine.idle();
  assert.equal((await j('forceOverwriteScan?type=movie')).success, true);
  await app.ctx.engine.idle();
  assert.equal((await j('cancelScan')).success, true);
  assert.equal((await j('testPlex?plexHost=127.0.0.1&plexPort=1&plexToken=t&plexProtocol=http')).success, false);
});

test('chosen TMDB poster is saved, previewed, survives updates and can be reset', async () => {
  const folder = encodeURIComponent('The Matrix (1999)');
  const posterFile = path.join(moviesDir, 'The Matrix (1999)', 'poster.jpg');
  const preview = async () => (await fetch(`${base}/poster?type=movie&name=${folder}`)).text();

  assert.equal((await j(`tmdb-poster?type=movie&folder=${folder}&tmdbPoster=../../evil`)).success, false);
  assert.equal((await j(`tmdb-poster?type=movie&folder=${folder}&tmdbPoster=abc123.jpg`)).success, true);
  await app.ctx.engine.idle();
  const chosen = /tmdb-poster\/tt0133093\/abc123\.jpg/;
  assert.match(fs.readFileSync(posterFile, 'utf8'), chosen);
  assert.match(await preview(), chosen);

  assert.equal((await j(`update-ratings-poster?type=movie&folder=${folder}`)).success, true);
  await app.ctx.engine.idle();
  assert.match(fs.readFileSync(posterFile, 'utf8'), chosen);

  assert.equal((await j(`reset-poster?type=movie&folder=${folder}`)).success, true);
  await app.ctx.engine.idle();
  assert.doesNotMatch(fs.readFileSync(posterFile, 'utf8'), /tmdb-poster|custom-poster/);
  assert.match(await preview(), /imdb\/poster-default\/tt0133093\.jpg/);
});

test('create poster resolves the ID and image from IMDb URL, TMDB URL, folder match or a placeholder', async () => {
  const ratings = encodeURIComponent('imdb:9.0');
  const preview = async (qs) => (await fetch(`${base}/create-preview?mediaType=movie&ratings=${ratings}${qs}`)).text();
  assert.match(await preview(`&imdbUrl=${encodeURIComponent('https://www.imdb.com/title/tt0078748/')}`),
    /create-poster\/tt0078748\.jpg\?ratings=.*img=https%3A%2F%2Fimg\.test%2Falien\._V1_SX580\.jpg/);
  assert.match(await preview(`&tmdbUrl=${encodeURIComponent('https://www.themoviedb.org/movie/603-the-matrix')}`),
    /create-poster\/tt0133093\.jpg\?ratings=.*img=https%3A%2F%2Fimage\.tmdb\.org%2Ft%2Fp%2Fw780%2Fmatrix\.jpg/);
  assert.match(await preview(''), /create-poster\/tt2\.jpg\?ratings=/);

  const folder = encodeURIComponent('Unknown Film (2001)');
  assert.equal((await j(`create-poster?type=movie&folder=${folder}&ratings=${ratings}`)).success, true);
  await app.ctx.engine.idle();
  assert.ok(app.ctx.store.data.customPosters.tt0068646.includes('/create-poster/tt0068646.jpg?ratings='));
  assert.ok(mock.requests.some((u) => u.includes('/create-poster/tt0068646.jpg?ratings=')));

  assert.equal((await j(`submit-poster?mediaType=movie&ratings=${ratings}`)).success, true);
  const sub = new URL(mock.requests.findLast((u) => u.includes('/submit?')), 'http://x');
  const data = JSON.parse(Buffer.from(sub.searchParams.get('data'), 'base64').toString());
  assert.equal(data.imdb, undefined);
  assert.equal(data.ratings, 'imdb:9.0');
});

test('MDBList keys rotate past a rate-limited key', async () => {
  const folder = encodeURIComponent('The Matrix (1999)');
  assert.match((await j(`ratings?type=movie&name=${folder}`)).message, /MDBList API key/);
  assert.equal((await j('setMdblistKey?key=wrong')).success, false);
  assert.equal((await j('setMdblistKey?key=mdb-limited')).mdblistKeySet, true);
  assert.equal((await j('setMdblistKey?key=mdb-limited')).success, false);
  const added = await j('setMdblistKey?key=mdb-key');
  assert.deepEqual(added.mdblistKeys.map((k) => k.prefix), ['mdb', 'mdb']);
  assert.equal((await j('getSettings')).mdblistKeySet, true);
  const r = await j(`ratings?type=movie&name=${folder}`);
  assert.equal(r.success, true);
  assert.deepEqual(r.badges.map((b) => [b.key, b.value]), [['imdb', '8.7'], ['rt', '83%'], ['mdblist', '86']]);
  const s = await j('getSettings');
  assert.ok(s.mdblistKeys[0].limitedUntil > Date.now() + 3500 * 1000);
  assert.equal(s.mdblistKeys[1].limitedUntil, 0);
  assert.equal(mock.requests.filter((u) => u.startsWith('/imdb/movie/tt0133093?apikey=mdb-limited')).length, 1);
});

test('queue pauses at the title when every MDBList key is limited and resumes when a key is added', async () => {
  const engine = app.ctx.engine;
  const alien = 'Alien.1979.1080p.BluRay.x264';
  assert.equal((await j('removeMdblistKey?index=1')).mdblistKeys.length, 1);
  assert.equal((await j('setPosterEngine?engine=local')).success, true);
  engine.fetchItem('movie', alien, { overwrite: true });
  assert.ok(await waitFor(() => engine.pausedUntil > Date.now()));
  assert.equal(engine.queue[0].name, alien);
  const poll = await j('pollData');
  assert.ok(poll.mdblistPausedUntil > Date.now());
  assert.equal(poll.scanItems, 1);
  assert.equal((await j('setMdblistKey?key=mdb-key')).success, true);
  await engine.idle();
  assert.equal(engine.pausedUntil, 0);
  assert.ok(mock.requests.some((u) => u.startsWith('/imdb/movie/tt0078748?apikey=mdb-key')));
  assert.equal((await j('setPosterEngine?engine=rpdb')).success, true);
});

test('poster designer: designs, templates, live preview and local rendering', async () => {
  const folder = 'The Matrix (1999)';
  const design = encodeURIComponent(JSON.stringify({ position: 'tr', size: 'l', limit: 2 }));
  const sample = await fetch(`${base}/design-preview?design=${design}`);
  assert.equal(sample.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await sample.arrayBuffer())[0], 0xff);
  const real = await fetch(`${base}/design-preview?design=${design}&type=movie&name=${encodeURIComponent(folder)}`);
  assert.equal(real.status, 200);
  assert.ok(mock.requests.includes('/art/matrix.png'));

  assert.equal((await j(`setDesign?target=global&design=${design}`)).success, true);
  assert.equal((await j('getDesigns')).local.global.poster.position, 'tr');
  assert.equal((await j(`setDesign?target=folder&folder=${encodeURIComponent(moviesDir)}&design=${encodeURIComponent(JSON.stringify({ poster: { position: 'bl' } }))}`)).success, true);
  assert.equal((await j('getDesigns')).local.folders[moviesDir].poster.position, 'bl');
  assert.equal((await j(`setDesign?target=folder&folder=${encodeURIComponent(path.join(tmp, 'nope'))}&design=${design}`)).success, false);
  assert.equal((await j(`setDesign?target=item&type=movie&name=${encodeURIComponent(folder)}&design=${encodeURIComponent(JSON.stringify({ poster: { position: 'tl' } }))}`)).success, true);
  assert.equal((await j(`getDesigns?type=movie&name=${encodeURIComponent(folder)}`)).local.item.poster.position, 'tl');
  await j(`setDesign?target=item&type=movie&name=${encodeURIComponent(folder)}`);
  assert.equal((await j(`getDesigns?type=movie&name=${encodeURIComponent(folder)}`)).local.item, null);

  assert.equal((await j(`saveTemplate?name=Corner&design=${design}`)).success, true);
  assert.equal((await j('getDesigns')).templates.Corner.poster.position, 'tr');
  await j('deleteTemplate?name=Corner');
  assert.deepEqual((await j('getDesigns')).templates, {});
  const designs = await j('getDesigns');
  assert.equal(designs.presets['rpdb:boxes'].poster.tile, 'box');
  assert.ok(designs.rpdbSupported.includes('skew'));

  const rpdbStyles = encodeURIComponent(JSON.stringify({ posterTheme: 'boxes', posterBarPos: 'top' }));
  const rp = await fetch(`${base}/rpdb-preview?styles=${rpdbStyles}&type=movie&name=${encodeURIComponent(folder)}`);
  assert.equal(rp.headers.get('content-type'), 'image/jpeg');
  for (const kind of ['backdrop', 'logo']) {
    const r = await fetch(`${base}/design-preview?design=${design}&kind=${kind}`);
    assert.equal(r.headers.get('content-type'), kind === 'logo' ? 'image/png' : 'image/jpeg', kind);
    const rr = await fetch(`${base}/rpdb-preview?kind=${kind}&styles=${encodeURIComponent(JSON.stringify({ backdropTheme: 'blocks', logoTheme: 'boxes' }))}`);
    assert.equal(rr.headers.get('content-type'), kind === 'logo' ? 'image/png' : 'image/jpeg', `rpdb ${kind}`);
  }
  const mixed = encodeURIComponent(JSON.stringify({ poster: { layout: 'bar', icons: 'official', skew: 'left', tile: 'split' } }));
  const limited = await fetch(`${base}/design-preview?design=${mixed}&engine=rpdb`);
  assert.equal(limited.headers.get('content-type'), 'image/jpeg');
  const bp = await fetch(`${base}/badge-preview?over=1&badges=4k,us_age_rating&badgePos=right&type=movie&name=${encodeURIComponent(folder)}`);
  assert.equal(bp.headers.get('content-type'), 'image/jpeg');

  // RPDB engine: unified designs are stored as RPDB Image Styles
  const blocks = encodeURIComponent(JSON.stringify({ poster: { layout: 'badges', tile: 'block', corners: 'full', position: 'tc', arrange: 'row', fill: 'light' } }));
  assert.equal((await j(`setRpdbDesign?target=folder&folder=${encodeURIComponent(moviesDir)}&kinds=poster&design=${blocks}`)).success, true);
  const st = await j(`getStylesSettings?folder=${encodeURIComponent(moviesDir)}`);
  assert.equal(st.posterTheme, 'light-rounded-blocks');
  assert.equal(st.posterBarPos, 'top');
  assert.equal((await j('getDesigns')).rpdb.folders[moviesDir].poster.corners, 'full');
  await j(`editFolderStyles?folder=${encodeURIComponent(moviesDir)}`);

  assert.equal((await j('setPosterEngine?engine=local')).success, true);
  assert.equal((await j(`update-ratings-poster?type=movie&folder=${encodeURIComponent(folder)}`)).success, true);
  await app.ctx.engine.idle();
  const poster = fs.readFileSync(path.join(moviesDir, folder, 'poster.jpg'));
  assert.deepEqual([poster[0], poster[1]], [0xff, 0xd8]);
  assert.equal((await j('setPosterEngine?engine=rpdb')).success, true);
  await j(`setDesign?target=folder&folder=${encodeURIComponent(moviesDir)}`);
});

test('settings round trip and password gating', async () => {
  await j('setSettings?overwrite=1&overwritePeriod=overwrite-bimonthly&backdrops=1&moviePosterLang=fr&retryFrequency=2&usePolling=1');
  const s = await j('getSettings');
  assert.equal(s.overwrite, true);
  assert.equal(s.minOverwritePeriod, 1209600000);
  assert.equal(s.moviePosterLang, 'fr');
  assert.equal(s.usePolling, 'polling');
  assert.ok(app.ctx.store.data.lastOverwrite.movie > 0);
  assert.equal((await j('savePass?newpass=')).success, false);
  assert.equal((await j('savePass?newpass=secret')).success, true);
  const denied = await fetch(`${base}/getSettings`);
  assert.equal(denied.status, 500);
  assert.equal(await denied.text(), 'Password Incorrect');
  assert.equal((await fetch(`${base}/getSettings?pass=secret`)).status, 200);
  assert.deepEqual(await j('needsPass'), { success: true, required: true });
  assert.deepEqual(await j('checkPass?pass=wrong'), { success: false });
});

test('webhooks', async () => {
  const post = (route, body, headers = {}) => fetch(`${base}/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const auth = { authorization: `Basic ${Buffer.from('rpdb:secret').toString('base64')}` };
  assert.equal((await post('radarr', {}, { authorization: `Basic ${Buffer.from('rpdb:bad').toString('base64')}` })).status, 500);
  const t = await post('radarr', { eventType: 'Test' }, auth);
  assert.equal(await t.text(), 'Test event is not useful');
  const dir = 'Webhook Movie (2012)';
  fs.mkdirSync(path.join(moviesDir, dir));
  const ok = await post('radarr', { eventType: 'Download', movie: { folderPath: `/elsewhere/${dir}` } }, auth);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'Success');
  const missing = await post('radarr', { eventType: 'Download', movie: { folderPath: '/elsewhere/Nothing' } }, auth);
  assert.equal(missing.status, 500);
  assert.equal(await missing.text(), 'Path inaccessible');
  assert.equal((await fetch(`${base}/radarr`)).status, 404);
});

