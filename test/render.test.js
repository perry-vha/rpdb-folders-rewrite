import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderPoster, pickRatings, SAMPLE_ITEMS } from '../src/compose.js';
import { sanitizeDesign, LOOK_DEFAULTS, designFromRpdb, fromRpdbStyles, toRpdbStyles } from '../src/look.js';

const grayPng = (w, h) => {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, w, h);
  return c.encode('png');
};

// Centroid of non-gray pixels as fractions of width/height (approach from openposterdb's generate.rs tests).
async function centroid(jpeg) {
  const img = await loadImage(jpeg);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  let sx = 0; let sy = 0; let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const diff = Math.max(Math.abs(data[i] - 128), Math.abs(data[i + 1] - 128), Math.abs(data[i + 2] - 128));
    if (diff > 20) { const p = i / 4; sx += p % img.width; sy += Math.floor(p / img.width); n++; }
  }
  assert.ok(n > 0, 'no badge pixels found');
  return { x: sx / n / img.width, y: sy / n / img.height, w: img.width, h: img.height };
}

const items = SAMPLE_ITEMS;
const opdb = (poster = {}, top = {}) => ({ ...top, order: 'imdb,tmdb,rt', poster: { ...LOOK_DEFAULTS.poster, ...poster } });
const render = async (poster, art, top) => renderPoster({ art: art ?? await grayPng(500, 750), items, design: opdb(poster, top), width: 500 });

test('renders a JPEG at the requested width', async () => {
  const out = await render({});
  assert.equal(out[0], 0xff);
  assert.equal(out[1], 0xd8);
  assert.equal((await loadImage(out)).width, 500);
  const placeholder = await renderPoster({ art: null, items, design: {} });
  assert.equal(placeholder[0], 0xff);
});

test('position anchors match the chosen corner or edge for every layout', async () => {
  for (const extra of [{}, { tile: 'block' }, { layout: 'bar' }]) {
    const top = await centroid(await render({ position: 'tc', ...extra }));
    assert.ok(top.y < 0.33 && top.x > 0.3 && top.x < 0.7, `tc ${JSON.stringify({ extra, top })}`);
    const bottom = await centroid(await render({ position: 'bc', ...extra }));
    assert.ok(bottom.y > 0.67 && bottom.x > 0.3 && bottom.x < 0.7, `bc ${JSON.stringify({ extra, bottom })}`);
    const left = await centroid(await render({ position: 'l', arrange: 'column', ...extra }));
    assert.ok(left.x < 0.5 && left.y > 0.2 && left.y < 0.8, `l ${JSON.stringify({ extra, left })}`);
  }
  const br = await centroid(await render({ position: 'br', arrange: 'column' }));
  assert.ok(br.x > 0.5 && br.y > 0.5, `br ${JSON.stringify(br)}`);
});

test('frames: OPDB 2:3 fits, native shape and RPDB 1:1.481', async () => {
  const square = await grayPng(600, 600);
  for (const frame of ['cover', 'pad', 'blur']) {
    const img = await loadImage(await render({ frame, limit: 0 }, square));
    assert.deepEqual([img.width, img.height], [500, 750], frame);
  }
  const native = await loadImage(await render({ frame: 'native', limit: 0 }, square));
  assert.deepEqual([native.width, native.height], [500, 500]);
  const rpdb = await loadImage(await renderPoster({ art: square, items, design: { poster: { frame: 'rpdb', imageSize: 'medium' } } }));
  assert.deepEqual([rpdb.width, rpdb.height], [580, 859]);
});

test('design input is whitelisted and ratings are excluded, ordered, then limited', () => {
  const d = sanitizeDesign({ order: 'rt,bogus,imdb', exclude: 'tmdb', label: 'x'.repeat(60), textless: '1', poster: { position: 'nope', size: 9, limit: '42', fill: 'red;x', corners: 'full' } });
  assert.equal(d.poster.position, 'bc');
  assert.equal(d.poster.size, 2);
  assert.equal(d.poster.limit, 10);
  assert.equal(d.poster.fill, 'source');
  assert.equal(d.poster.corners, 'full');
  assert.equal(d.order, 'rt,imdb');
  assert.equal(d.label.length, 40);
  assert.equal(d.textless, true);
  assert.deepEqual(pickRatings(items, { order: 'rt,imdb', exclude: 'tmdb', limit: 3 }).map((b) => b.key), ['rt', 'imdb', 'rta']);
  assert.deepEqual(pickRatings(items, { limit: 0 }), []);
});

test('legacy OPDB designs convert to the unified look', () => {
  const d = sanitizeDesign({ position: 'tr', style: 'v', direction: 'v', labelStyle: 'rpdb', logoShape: 'r', size: 'xl', shape: 'p', background: 't', limit: 4, fit: 'blur', backdrop: { position: 'bl', labelStyle: 'text' } });
  assert.deepEqual([d.poster.position, d.poster.content, d.poster.arrange, d.poster.icons, d.poster.size, d.poster.corners, d.poster.fill, d.poster.opacity, d.poster.limit, d.poster.frame],
    ['tr', 'above', 'column', 'rpdb-round', 1.45, 'full', 'source', 0.47, 4, 'blur']);
  assert.deepEqual([d.backdrop.position, d.backdrop.icons], ['bl', 'text']);
});

test('RPDB preset uses RPDB\'s fixed 580x859 frame and its default bar placement', async () => {
  const out = await renderPoster({ art: await grayPng(780, 1170), items, design: designFromRpdb({}) });
  const img = await loadImage(out);
  assert.deepEqual([img.width, img.height], [580, 859]);
  const c = createCanvas(580, 859);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // Translucent dark bar covers the bottom 84px (measured from real RPDB renders)
  const bar = ctx.getImageData(3, 800, 1, 1).data;
  const art = ctx.getImageData(3, 700, 1, 1).data;
  assert.ok(bar[0] < 50 && Math.abs(art[0] - 128) < 10, `bar ${bar[0]} art ${art[0]}`);
});

test('RPDB Image Styles round-trip through the unified look; ratings follow the poster type', () => {
  const styles = { posterTheme: 'light-stripes-left', posterBarPos: 'top', posterFontWeight: '1', posterTextStyle: '1', posterLogoStyle: '1', posterBarStrokeColor: 'red' };
  const look = fromRpdbStyles(styles, 'poster');
  assert.deepEqual([look.layout, look.tile, look.skew, look.gap, look.fill, look.position, look.bold, look.numbers, look.icons, look.stroke],
    ['badges', 'block', 'left', 15, 'light', 'tc', true, 'whole', 'rpdb-round', 'red']);
  assert.deepEqual(toRpdbStyles(look, 'poster'), styles);
  assert.deepEqual(pickRatings(items, { ...designFromRpdb({}, 'poster-default'), limit: 3 }).map((r) => r.key), ['imdb', 'mc', 'rt']);
  const d = designFromRpdb({}, 'poster-rt');
  assert.deepEqual(pickRatings(items, { ...d, limit: 3 }).map((r) => r.key), ['imdb', 'rt', 'rta']);
  assert.deepEqual(pickRatings(items, { ...designFromRpdb({}, 'rating-order', 'trakt,imdb'), limit: 3 }).map((r) => r.key), ['trakt', 'imdb']);
});

test('RPDB and OPDB options combine: OPDB badges with skew, stroke, round icons and whole numbers', async () => {
  const plain = await render({});
  const mixed = await render({ skew: 'right', stroke: 'red', strokeWidth: 4, icons: 'rpdb-round', numbers: 'whole' });
  assert.notDeepEqual(plain, mixed);
  const bar = await render({ layout: 'bar', icons: 'official', position: 'tc', size: 0.85 });
  const top = await centroid(bar);
  assert.ok(top.y < 0.2, `bar at top ${JSON.stringify(top)}`);
});
