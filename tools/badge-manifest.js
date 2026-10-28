// Badge tags from the RPDB API docs (https://rpdb.apidoc.io/#badges): [tag, main text, caption, tier].
// Tiers: g gold, s silver, b bronze, m multicolor.
const AGE = [['g', 'G'], ['pg', 'PG'], ['pg_13', 'PG-13'], ['r', 'R'], ['nc_17', 'NC-17'], ['nr', 'NR'],
  ['tv_y', 'TV-Y'], ['tv_y7', 'TV-Y7'], ['tv_g', 'TV-G'], ['tv_pg', 'TV-PG'], ['tv_14', 'TV-14'], ['tv_ma', 'TV-MA']];

const audio = (prefix, label, chans, cap) => chans.map((c) => [`${prefix}${c.replace('.', '')}${cap ? cap.tag : ''}`, `${label}${c}`, cap ? cap.text : c === '2.0' ? 'STEREO' : 'SURROUND', 's']);

export const BADGES = [
  ['4k', '4K', 'ULTRA HD', 'g'], ['4kupscaled', '4K', 'UPSCALED', 's'], ['2k', '2K', 'QUAD HD', 'g'], ['5k', '5K', 'ULTRA HD', 'g'],
  ['8k', '8K', 'ULTRA HD', 'g'], ['1080p', '1080p', 'FULL HD', 'g'], ['720p', '720p', 'HD', 's'], ['720pgold', '720p', 'HD', 'g'],
  ['576p', '576p', 'SD', 'b'], ['480p', '480p', 'SD', 'b'], ['360p', '360p', 'SD', 'b'], ['240p', '240p', 'SD', 'b'],
  ['hd', 'HD', 'MEDIUM QUALITY', 's'], ['sd', 'SD', 'LOW QUALITY', 'b'], ['3d', '3D', 'STEREOSCOPIC', 'g'],
  ['hdrcolor', 'HDR', 'TRUE COLOR', 'm'], ['hdr', 'HDR', 'TRUE COLOR', 's'], ['hdr10plus', 'HDR10+', 'TRUE COLOR', 's'],
  ['hdr10plus_colorful', 'HDR10+', 'TRUE COLOR', 'm'],
  ['dolbyvision', 'DV', 'DOLBY VISION', 'm'], ['dolbyvisioncolor', 'DV', 'DOLBY VISION', 'm'], ['dolbyvisioncoloralt', 'DV', 'DOLBY VISION', 'm'],
  ['dv_hdr_gold', 'DV/HDR', 'TRUE COLOR', 'g'], ['dv_hdr_colorful', 'DV/HDR', 'TRUE COLOR', 'm'],
  ['hybrid_gold', 'HYBRID', 'TRUE COLOR', 'g'], ['hybrid_colorful', 'HYBRID', 'TRUE COLOR', 'm'],
  ['imaxgold', 'IMAX', 'WIDESCREEN', 'g'], ['imax', 'IMAX', 'WIDESCREEN', 's'],
  ['remuxgold', 'REMUX', 'LOSSLESS', 'g'], ['remux', 'REMUX', 'LOSSLESS', 's'],
  ['bluray', 'BluRay', 'FORMAT', 's'], ['dvd', 'DVD', 'FORMAT', 's'], ['web', 'WEB', 'FORMAT', 's'],
  ['mkv', 'MKV', 'MATROSKA', 's'], ['mp4', 'MP4', 'MPEG-4', 's'], ['avi', 'AVI', 'A/V INTERLEAVE', 's'],
  ['h264', 'h264', 'AVC', 's'], ['h265', 'h265', 'HEVC', 's'], ['h266', 'h266', 'VVC', 's'],
  ...audio('audio', '', ['2.0', '5.1', '7.1']),
  ...audio('dd', 'DD', ['2.0', '5.1']),
  ...audio('ddp', 'DDP', ['2.0', '5.1', '7.1']),
  ...['5.1', '7.1'].flatMap((c) => [['lossless', 'LOSSLESS'], ['surround', 'SURROUND']].map(([t, text]) => [`truehd${c.replace('.', '')}${t}`, `TrueHD${c}`, text, 's'])),
  ...['5.1', '7.1'].flatMap((c) => [['lossless', 'LOSSLESS'], ['surround', 'SURROUND']].map(([t, text]) => [`pcm${c.replace('.', '')}${t}`, `PCM${c}`, text, 's'])),
  ['atmos3dsound', 'Atmos', '3D SOUND', 's'], ['atmossurround', 'Atmos', 'SURROUND', 's'],
  ['5stars', '5 ✯', 'PERFECT', 'g'], ['4stars', '4 ✯', 'GREAT', 's'], ['3stars', '3 ✯', 'GOOD', 's'], ['2stars', '2 ✯', 'BAD', 'b'], ['1stars', '1 ✯', 'HORRIBLE', 'b'],
  ['cannesnominee', 'NOMINEE', 'CANNES', 's'], ['canneswinner', 'WINNER', 'CANNES', 'g'],
  ['emmynominee', 'NOMINEE', 'EMMYS', 's'], ['emmywinner', 'WINNER', 'EMMYS', 'g'],
  ['goldenglobesnominee', 'NOMINEE', 'GOLDEN GLOBES', 's'], ['goldenglobeswinner', 'WINNER', 'GOLDEN GLOBES', 'g'],
  ['oscarsnominee', 'NOMINEE', 'OSCARS', 's'], ['oscarswinner', 'WINNER', 'OSCARS', 'g'],
  ['sundancenominee', 'NOMINEE', 'SUNDANCE', 's'], ['sundancewinner', 'WINNER', 'SUNDANCE', 'g'],
  ['criterion', 'C', 'CRITERION', 'g'], ['mastersofthecinema', 'Masters of Cinema', 'CLASSICS', 'g'],
  ['directorscut', "DIRECTOR'S CUT", 'SPECIAL EDITION', 'g'], ['extendedcut', 'EXTENDED CUT', 'SPECIAL EDITION', 'g'],
  ...AGE.flatMap(([tag, text]) => [[tag, text, 'CERTIFICATION', 's'], [`${tag}_gold`, text, 'CERTIFICATION', 'g']]),
  ...Array.from({ length: 17 }, (_, i) => i + 2).flatMap((n) => [[`age${n}`, `age ${n}+`, 'COMMON SENSE', 's'], [`age${n}gold`, `age ${n}+`, 'COMMON SENSE', 'g']]),
];
