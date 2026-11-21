// Decorate templates, in two families:
//  - scrapbook: a patterned background + a scattered pack of stickers (original
//    motifs mixed with a few of the existing sticker set), applied with
//    randomized position/size/rotation (see applyTemplate in editor.js).
//  - moody: a dark gradient backdrop + one handwritten-style caption layer
//    over a desaturated/grainy photo — no stickers. The caption is typed by
//    the user when the template is picked (it's personal, so nothing preset).
import { STICKERS } from './stickers.js';
import { MOTIFS } from './motifs.js';

const N = STICKERS.length;
const pick = (start, step, count) =>
  Array.from({ length: count }, (_, i) => STICKERS[(start + i * step) % N]);
const motif = (start, step, count) =>
  Array.from({ length: count }, (_, i) => MOTIFS[(start + i * step) % MOTIFS.length]);

export const SCRAPBOOK_TEMPLATES = [
  { name: 'citrus',    family: 'scrapbook', bg: 0,  stickers: [...motif(0, 3, 8), ...pick(2, 17, 2)] },
  { name: 'berry',     family: 'scrapbook', bg: 1,  stickers: [...motif(1, 4, 9), ...pick(9, 13, 2)] },
  { name: 'pasture',   family: 'scrapbook', bg: 2,  stickers: [...motif(2, 5, 6), ...pick(23, 11, 2)] },
  { name: 'orchid',    family: 'scrapbook', bg: 3,  stickers: [...motif(5, 6, 7), ...pick(31, 19, 2)] },
  { name: 'glitch',    family: 'scrapbook', bg: 4,  stickers: [...motif(12, 13, 5), ...pick(5, 23, 2)] },
  { name: 'street',    family: 'scrapbook', bg: 5,  stickers: [...motif(6, 7, 8), ...pick(47, 7, 2)] },
  { name: 'corkboard', family: 'scrapbook', bg: 6,  stickers: [...motif(8, 9, 9), ...pick(61, 29, 2)] },
  { name: 'collage',   family: 'scrapbook', bg: 7,  stickers: [...motif(0, 6, 7), ...pick(14, 31, 2)] },
  { name: 'gingham',   family: 'scrapbook', bg: 8,  stickers: [...motif(10, 11, 6), ...pick(38, 9, 2)] },
  { name: 'stamps',    family: 'scrapbook', bg: 9,  stickers: [...motif(3, 4, 8), ...pick(70, 17, 2)] },
  { name: 'pressed',   family: 'scrapbook', bg: 10, stickers: [...motif(5, 2, 6), ...pick(17, 37, 2)] },
  { name: 'clover',    family: 'scrapbook', bg: 11, stickers: [...motif(9, 8, 7), ...pick(53, 41, 2)] },
  { name: 'windchime', family: 'scrapbook', bg: 12, stickers: [...motif(1, 14, 8), ...pick(90, 13, 2)] },
];

// dark/grainy backdrops for the moody family — plain top-to-bottom gradients
// (stored as stops so the exact same gradient can be rasterised onto the
// export canvas, not just shown as a CSS background in the live preview).
export const MOODY_TEMPLATES = [
  {
    name: 'after dark', family: 'moody',
    stops: [[0, '#2a2f26'], [0.55, '#11140f'], [1, '#060705']],
    photoFilter: 'grayscale(.35) contrast(1.15) brightness(.85) sepia(.08)',
  },
  {
    name: 'streetlight', family: 'moody',
    stops: [[0, '#3a3320'], [0.55, '#171408'], [1, '#040403']],
    photoFilter: 'grayscale(.25) contrast(1.1) brightness(.9) sepia(.15) saturate(1.1)',
  },
  {
    name: 'blue hour', family: 'moody',
    stops: [[0, '#141c2b'], [0.6, '#0a0d16'], [1, '#05060a']],
    photoFilter: 'grayscale(.4) contrast(1.2) brightness(.82) saturate(1.05)',
  },
];

export const cssGradient = stops =>
  `linear-gradient(180deg, ${stops.map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(', ')})`;
export function canvasGradient(ctx, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach(([p, c]) => g.addColorStop(p, c));
  return g;
}
