// Decorate templates — a background + a pack of stickers, bundled together.
// Picking one sets the background and scatters the sticker pack onto the
// card at randomized spots/rotations (see applyTemplate in editor.js); the
// exact layout is different every time, the bg/sticker choice stays fixed.
import { STICKERS } from './stickers.js';

const N = STICKERS.length;
const pick = (start, step, count) =>
  Array.from({ length: count }, (_, i) => STICKERS[(start + i * step) % N]);

export const TEMPLATES = [
  { name: 'citrus',   bg: 0,  stickers: pick(2,   17, 6) },
  { name: 'berry',    bg: 1,  stickers: pick(9,   13, 6) },
  { name: 'pasture',  bg: 2,  stickers: pick(23,  11, 5) },
  { name: 'orchid',   bg: 3,  stickers: pick(31,  19, 6) },
  { name: 'glitch',   bg: 4,  stickers: pick(5,   23, 5) },
  { name: 'street',   bg: 5,  stickers: pick(47,   7, 6) },
  { name: 'corkboard',bg: 6,  stickers: pick(61,  29, 7) },
  { name: 'collage',  bg: 7,  stickers: pick(14,  31, 6) },
  { name: 'gingham',  bg: 8,  stickers: pick(38,   9, 5) },
  { name: 'stamps',   bg: 9,  stickers: pick(70,  17, 6) },
  { name: 'pressed',  bg: 10, stickers: pick(17,  37, 5) },
  { name: 'clover',   bg: 11, stickers: pick(53,  41, 6) },
  { name: 'windchime',bg: 12, stickers: pick(90,  13, 6) },
];
