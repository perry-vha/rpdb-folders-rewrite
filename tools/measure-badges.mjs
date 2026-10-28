// Measures reference badge tiles (120x82 PNGs named <tag>.png) into badge-metrics.json.
// Usage: node tools/measure-badges.mjs <refsDir>   Only gradient colours and bounding boxes are stored, never pixels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BADGES } from './badge-manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const refs = process.argv[2];
const GRADIENT_TAGS = ['hdrcolor', 'hdr10plus_colorful', 'dolbyvision', 'dolbyvisioncolor', 'dolbyvisioncoloralt', 'dv_hdr_colorful', 'hybrid_colorful'];
const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lum = (d, k) => (d[k] + d[k + 1] + d[k + 2]) / 3;
const sat = (d, k) => Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]);

function mean(d, x0, x1, y0, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = (y * 120 + x) * 4;
      r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
}

// Plate gradient: side strips at the ends, top frame strip in between (corners are rounded).
function plateStops(d) {
  const xs = Array.from({ length: 21 }, (_, i) => Math.round(3 + i * 5.7));
  return xs.map((x) => {
    const edge = x < 6 || x > 114;
    const m = edge ? mean(d, x - 1, x + 1, 38, 42) : mean(d, x - 1, x + 1, 2, 4);
    return [+(x / 120).toFixed(3), hex(...m)];
  });
}

// Bounding box [x, y, w, h] of pixels matching `hit` in a region.
function bbox(x0, x1, y0, y1, hit) {
  let a = [Infinity, -1, Infinity, -1];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (hit(x, y)) a = [Math.min(a[0], x), Math.max(a[1], x), Math.min(a[2], y), Math.max(a[3], y)];
    }
  }
  return a[1] < 0 ? null : [a[0], a[2], a[1] - a[0] + 1, a[3] - a[2] + 1];
}

const plates = {};
const boxes = {};
for (const [tag] of BADGES) {
  const file = path.join(refs, `${tag}.png`);
  if (!fs.existsSync(file)) continue;
  const c = createCanvas(120, 82);
  c.getContext('2d').drawImage(await loadImage(file), 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, 120, 82).data;
  const at = (x, y) => (y * 120 + x) * 4;
  // Main content is bright or saturated against the grey panel; skip the panel's rounded top corners.
  const main = bbox(12, 107, 10, 55, (x, y) => !((x < 15 || x > 104) && y < 13) && (lum(d, at(x, y)) > 110 || sat(d, at(x, y)) > 60));
  // Caption ink is dark relative to the plate colour in the same column.
  const plateLum = (x) => [60, 61, 79].map((y) => lum(d, at(x, y))).sort((p, q) => p - q)[1];
  const cap = bbox(5, 114, 62, 80, (x, y) => !((x < 9 || x > 110) && y > 76) && lum(d, at(x, y)) < 0.62 * plateLum(x));
  boxes[tag] = { main, cap };
  if (GRADIENT_TAGS.includes(tag)) plates[tag] = plateStops(d);
}
fs.writeFileSync(path.join(here, 'badge-metrics.json'), `${JSON.stringify({ plates, boxes })}\n`);
console.log(`plates: ${Object.keys(plates).length}, boxes: ${Object.keys(boxes).length}`);

