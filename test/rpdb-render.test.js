import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ratingItems, pickRatings, createPosterScores, renderBackdrop, renderLogo, renderPoster } from '../src/compose.js';
import { parsePosterTemplate, storedStyles } from '../src/local-poster.js';
import { designFromRpdb, rpdbOrder, sanitizeDesign, LOOK_DEFAULTS } from '../src/look.js';
import { customPosterTemplate, tmdbPosterTemplate, createPosterTemplate, createPosterQuery } from '../src/rpdb.js';

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
  return { w: img.width, h: img.height, at: (x, y) => Array.from(data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)) };
}
const isGrayish = ([r, g, b]) => Math.max(Math.abs(r - 128), Math.abs(g - 128), Math.abs(b - 128)) < 12;

// MDBList values for The Godfather (Oct 2026); RPDB showed 91 / 92 / 91, 16+ and R.
const GODFATHER = {
  imdb: { value: 9.2, score: 92 }, metacritic: { value: 100, score: 100 }, metacriticuser: { value: 9.2, score: 92 }, trakt: { value: 88, score: 88 },
  tomatoes: { value: 97, score: 97 }, popcorn: { value: 98, score: 98 }, tmdb: { value: 86, score: 86 }, letterboxd: { value: 4.5, score: 90 }, rogerebert: { value: 4, score: null },
};
const INFO = { certification: 'R', commonsense: 16 };
const text = (list) => list.map((r) => r.text || Math.round(r.n));
const pickOrder = (scores, posterType, order, info) => pickRatings(ratingItems({ scores, info }), { ...rpdbOrder(posterType, order), limit: 3 });

test('RPDB\'s own rating sources match its renders', () => {
  assert.deepEqual(text(pickOrder(GODFATHER, 'rating-order', 'overall-rating,critics-rating,audience-rating', INFO)), [91, 92, 91]);
  assert.deepEqual(text(pickOrder(GODFATHER, 'rating-order', 'commonsense,us-age,rogerebert', INFO)), ['16+', 'R', 4]);
  // Inception: RPDB showed 85 / 80 / 87
  const inception = { imdb: { score: 88 }, metacritic: { score: 74 }, metacriticuser: { score: 88 }, trakt: { score: 87 }, tomatoes: { score: 86 }, popcorn: { score: 91 }, tmdb: { score: 83 }, letterboxd: { score: 84 }, rogerebert: { value: 4 } };
  assert.deepEqual(text(pickOrder(inception, 'rating-order', 'overall-rating,critics-rating,audience-rating')), [85, 80, 87]);
  assert.deepEqual(pickOrder(GODFATHER, 'rating-order', 'commonsense,us-age', {}), []);
});

test('Create Poster ratings and certifications map to scores', () => {
  const { scores, force } = createPosterScores({ ratings: 'mal:8.5|imdb:9.0|mc:81|rt:55|rtaudience:90|mcaudience:7.5', rtCert: '1', mcCert: '1', rtAudienceCert: '-1' });
  assert.deepEqual(scores, { myanimelist: { value: 8.5 }, imdb: { value: 9 }, metacritic: { score: 81 }, tomatoes: { score: 55 }, popcorn: { score: 90 }, metacriticuser: { score: 75 } });
  assert.deepEqual(force, { rt: 1, mc: 1, rta: -1 });
});

test('legacy "RPDB styles" designs convert from the stored Image Styles', () => {
  const d = sanitizeDesign({ ratingStyle: 'rpdb', position: 'tl' }, { fromRpdb: () => designFromRpdb({ posterTheme: 'boxes', backdropCertPos: 'right', logoBarPos: 'top-left' }) });
  assert.deepEqual([d.poster.tile, d.poster.icons, d.backdrop.certBadges, d.logo.position, d.logo.arrange], ['box', 'none', 'right', 'tl', 'row']);
});

test('item styles beat folder styles for every image kind', () => {
  const cfg = { posterTheme: { '/m': 'blocks' }, itemPosterTheme: { tt1: 'boxes' }, backdropCertPos: { '/m': 'right' }, logoBarPos: { '/m': 'top' } };
  assert.deepEqual(storedStyles(cfg, 'tt1', '/m'), { posterTheme: 'boxes', backdropCertPos: 'right', logoBarPos: 'top' });
});

test('saved poster choices are parsed for the local engine', () => {
  assert.deepEqual(parsePosterTemplate(tmdbPosterTemplate('/abc.jpg')), { kind: 'tmdb', file: 'abc.jpg' });
  assert.deepEqual(parsePosterTemplate(customPosterTemplate('https://x.test/a.jpg')), { kind: 'custom', img: 'https://x.test/a.jpg' });
  assert.equal(parsePosterTemplate(customPosterTemplate('file:///etc/passwd')), null);
  const created = parsePosterTemplate(createPosterTemplate('poster-certs', 'tt2', createPosterQuery({ ratings: 'imdb:9.0', img: 'https://x.test/b.jpg', rtCert: '1' })));
  assert.equal(created.kind, 'create');
  assert.equal(created.posterType, 'poster-certs');
  assert.equal(created.img, 'https://x.test/b.jpg');
  assert.equal(created.query.ratings, 'imdb:9.0');
  assert.equal(created.query.rtCert, '1');
});

const items = ratingItems({ scores: GODFATHER, info: INFO });
const rpdb = (styles) => designFromRpdb(styles);

test('RPDB-style backdrops: 16:9 sizes, right-top rating column and certification badges', async () => {
  const art = await grayPng(1280, 720);
  const medium = await pixels(await renderBackdrop({ art, items, design: rpdb({}) }));
  assert.deepEqual([medium.w, medium.h], [1920, 1080]);
  const panel = medium.at(1780, 300);
  assert.ok(panel[0] < 90, `column panel darkens the art: ${panel}`);
  assert.ok(medium.at(1000, 600)[0] > 120, 'art untouched elsewhere');
  assert.ok(!isGrayish(medium.at(99, 86)), 'certification badge top left');
  const small = await loadImage(await renderBackdrop({ art, items, design: rpdb({ backdropSize: 'small' }) }));
  assert.deepEqual([small.width, small.height], [1280, 720]);
  const left = await pixels(await renderBackdrop({ art, items, design: rpdb({ backdropBarPos: 'left-bottom' }) }));
  assert.ok(left.at(60, 1000)[0] < 90, 'column moved to bottom left');
  assert.ok(left.at(1780, 300)[0] > 120);
});

test('RPDB-style logos: fixed canvas, transparent background, ratings strip', async () => {
  const src = createCanvas(600, 150);
  src.getContext('2d').fillStyle = '#fff';
  src.getContext('2d').fillRect(0, 0, 600, 150);
  const logo = await src.encode('png');
  const out = await pixels(await renderLogo({ logo, items, design: rpdb({}) }));
  assert.deepEqual([out.w, out.h], [780, 244]);
  assert.equal(out.at(2, 2)[3], 0, 'transparent corner');
  assert.equal(out.at(390, 80)[3], 255, 'logo above the strip');
  const large = await loadImage(await renderLogo({ logo, items, design: rpdb({ logoSize: 'large' }) }));
  assert.deepEqual([large.width, large.height], [1722, 539]);
  const top = await pixels(await renderLogo({ logo, items, design: rpdb({ logoBarPos: 'top' }) }));
  assert.equal(top.at(390, 236)[3], 255, 'logo moved below a top strip');
  // OPDB badges on RPDB's fixed logo canvas
  const mixed = await loadImage(await renderLogo({ logo, items, design: { logo: { ...LOOK_DEFAULTS.logo, frame: 'fixed' } } }));
  assert.deepEqual([mixed.width, mixed.height], [780, 244]);
});

test('RPDB poster sizes follow the Size style', async () => {
  const art = await grayPng(500, 750);
  const large = await loadImage(await renderPoster({ art, items, design: rpdb({ posterSize: 'large' }) }));
  assert.deepEqual([large.width, large.height], [1280, 1896]);
});

// Observed on RPDB with a 6-source rating order: poster rows keep 3, side bars / backdrops show all, logos drop what does not fit.
test('many ratings are limited, not shrunk, as RPDB does', () => {
  const six = 'imdb,tmdb,trakt,letterboxd,tomatoes-critics,metacritic-critics';
  assert.equal(designFromRpdb({}, 'rating-order', six).poster.limit, 3);
  assert.equal(designFromRpdb({ posterBarPos: 'left-center' }, 'rating-order', six).poster.limit, 6);
  assert.equal(designFromRpdb({}, 'rating-order', six).backdrop.limit, 6);
  assert.equal(designFromRpdb({}, 'rating-order', six).logo.limit, 6);
  assert.equal(designFromRpdb({}, 'rating-order', six).poster.certIcons, true);
  assert.equal(designFromRpdb({}, 'poster-default').poster.certIcons, false);
});

test('logo strips drop ratings that do not fit instead of shrinking them', async () => {
  const many = { ...items };
  const design = designFromRpdb({}, 'rating-order', 'imdb,tmdb,trakt,letterboxd,tomatoes-critics,metacritic-critics');
  const out = await pixels(await renderLogo({ logo: null, items: many, design }));
  // First drawn column of the 84px strip (780 wide), then the icon there must keep its 40px height
  let x0 = 0;
  while (x0 < 780 && ![...Array(84).keys()].some((dy) => out.at(x0, 160 + dy)[3] > 0)) x0++;
  let opaque = 0;
  for (let y = 160; y < 244; y++) if (out.at(x0 + 20, y)[3] > 0) opaque++;
  assert.ok(x0 < 200 && opaque >= 30, `first rating icon at full size (x0=${x0}, rows=${opaque})`);
});
