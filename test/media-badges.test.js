import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resolveBadgeTags, layoutBadges, parseBadgePos, posterBadgeMetrics } from '../src/media-badges.js';
import { renderPoster, renderBackdrop, renderLogo, SAMPLE_ITEMS } from '../src/compose.js';
import { LOOK_DEFAULTS, designFromRpdb } from '../src/look.js';

const grayPng = (w, h) => {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, w, h);
  return c.encode('png');
};
async function pixels(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  return { w: img.width, h: img.height, at: (x, y) => Array.from(data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)), data };
}
const isGray = ([r, g, b]) => Math.max(Math.abs(r - 128), Math.abs(g - 128), Math.abs(b - 128)) < 12;
// IMDb yellow, present in the RPDB-like IMDb icon
const yellowCount = ({ data }) => {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 150 && data[i + 2] < 90) n++;
  return n;
};

test('badge tags resolve to icon files, including RPDB server-side tags', () => {
  const info = { certification: 'PG-13', commonsense: 16, language: 'pt', country: 'BR' };
  assert.deepEqual(resolveBadgeTags('4k,hdrcolor,nope,4k', info), ['badges/4k.png', 'badges/hdrcolor.png']);
  assert.deepEqual(resolveBadgeTags('us_age_rating,us_age_rating_gold,commonsense,commonsensegold', info),
    ['badges/pg_13.png', 'badges/pg_13_gold.png', 'badges/age16.png', 'badges/age16gold.png']);
  assert.deepEqual(resolveBadgeTags('us_age_rating', { certification: 'TV-MA' }), ['badges/tv_ma.png']);
  assert.deepEqual(resolveBadgeTags('auto_lang', info), ['flags/br.png']);
  assert.deepEqual(resolveBadgeTags('auto_lang_no_en', { language: 'en' }), []);
  assert.deepEqual(resolveBadgeTags('country.US,country.en_GB', {}), ['flags/us.png', 'flags/gb.png']);
  assert.deepEqual(resolveBadgeTags('us_age_rating,commonsense', {}), []);
});

test('badge layout matches RPDB renders measured at 580x859', () => {
  const metrics = posterBadgeMetrics(580, false);
  const at = (pos, inset) => layoutBadges(3, { W: 580, H: 859, metrics, anchor: parseBadgePos(pos), inset }).map((r) => [r.x, r.y]);
  assert.deepEqual(at('left'), [[15, 15], [15, 117], [15, 219]]);
  assert.deepEqual(at('center'), [[89, 15], [230, 15], [371, 15]]);
  assert.deepEqual(at('right'), [[444, 15], [444, 117], [444, 219]]);
  // RPDB's default bottom bar (84px) pushes bottom badges up
  assert.deepEqual(at('bottom|left', { bottom: 84 }), [[15, 474], [15, 576], [15, 678]]);
  assert.deepEqual(at('bottom|center', { bottom: 84 }).map(([, y]) => y), [678, 678, 678]);
  const small = layoutBadges(1, { W: 580, H: 859, metrics: posterBadgeMetrics(580, true), anchor: parseBadgePos('left') })[0];
  assert.deepEqual([small.w, small.h], [87, 59]);
});

const look = (poster) => ({ order: 'imdb,tmdb,rt', poster: { ...LOOK_DEFAULTS.poster, ...poster } });

test('local engine offers the RPDB-like icon pack in square and round', async () => {
  const imdb = { imdb: SAMPLE_ITEMS.imdb };
  const art = await grayPng(580, 870);
  const draw = (icons) => renderPoster({ art, items: imdb, design: look({ icons, fill: 'dark' }), width: 580 });
  const square = await pixels(await draw('rpdb'));
  const round = await pixels(await draw('rpdb-round'));
  assert.ok(yellowCount(square) > 300, 'square IMDb icon drawn');
  assert.ok(yellowCount(round) > 200, 'round IMDb icon drawn');
  assert.notEqual(yellowCount(square), yellowCount(round));
  assert.equal(yellowCount(await pixels(await draw('text'))), 0);
});

test('local posters draw media badges and skip the label when badges are shown', async () => {
  const art = await grayPng(580, 870);
  const design = look({ position: 'bc' });
  const media = { files: ['badges/4k.png'], pos: 'right' };
  const withBadges = await pixels(await renderPoster({ art, items: {}, design, width: 580, media, label: 'HELLO' }));
  assert.ok(!isGray(withBadges.at(504, 56)), 'badge drawn top right');
  assert.ok(isGray(withBadges.at(290, 40)), 'label not drawn');
  const labelOnly = await pixels(await renderPoster({ art, items: {}, design, width: 580, label: 'HELLO' }));
  assert.ok(!isGray(labelOnly.at(290, 40)), 'label drawn');
});

test('media badges move clear of ratings anchored on the same edge', async () => {
  const art = await grayPng(580, 870);
  const out = await pixels(await renderPoster({ art, items: { imdb: SAMPLE_ITEMS.imdb }, design: look({ position: 'tl', arrange: 'column' }), width: 580, media: { files: ['badges/4k.png'], pos: 'left' } }));
  // The rating badge occupies the top-left corner; the 4K tile starts beside it.
  let x = 30;
  while (x < 400 && !isGray(out.at(x, 50))) x++;
  while (x < 400 && isGray(out.at(x, 50))) x++;
  assert.ok(x > 100 && x < 300, `badge beside ratings at x=${x}`);
});

test('backdrops keep the art aspect at the target width and logos are transparent PNGs', async () => {
  const backdrop = await loadImage(await renderBackdrop({ art: await grayPng(780, 439), items: SAMPLE_ITEMS, design: {}, width: 1920 }));
  assert.deepEqual([backdrop.width, backdrop.height], [1920, 1081]);
  const logoSrc = createCanvas(400, 100);
  logoSrc.getContext('2d').fillStyle = '#fff';
  logoSrc.getContext('2d').fillRect(0, 0, 400, 100);
  const logoBuf = await renderLogo({ logo: await logoSrc.encode('png'), items: SAMPLE_ITEMS, design: {}, width: 780 });
  assert.deepEqual([...logoBuf.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  const logo = await pixels(logoBuf);
  assert.ok(logo.h > 195, 'ratings below the logo');
  assert.equal(logo.at(0, logo.h - 1)[3], 0, 'transparent corner');
  const bare = await loadImage(await renderLogo({ logo: await logoSrc.encode('png'), items: {}, design: {}, width: 780 }));
  assert.deepEqual([bare.width, bare.height], [780, 195]);
});

test('RPDB bar preset uses the recreated icons and RPDB badge rules', async () => {
  const art = await grayPng(780, 1170);
  const design = designFromRpdb({});
  const plain = await pixels(await renderPoster({ art, items: SAMPLE_ITEMS, design, label: 'HELLO' }));
  assert.ok(yellowCount(plain) > 200, 'IMDb icon from the recreated pack');
  assert.ok(!isGray(plain.at(500, 40)), 'label bar at the top');
  const badged = await pixels(await renderPoster({ art, items: SAMPLE_ITEMS, design, label: 'HELLO', media: { files: ['badges/4k.png'], pos: 'bottom|left' } }));
  assert.ok(isGray(badged.at(500, 40)), 'no label with badges');
  assert.ok(!isGray(badged.at(75, 719)), '4K tile above the bar');
  assert.ok(isGray(badged.at(75, 765)), 'gap between tile and bar');
});
