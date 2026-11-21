// Original, hand-drawn-in-code sticker motifs (stars, gems, pearls, buttons,
// goldfish, pretzels) — simple flat SVG shapes with a white die-cut outline,
// built as data URIs so there are no external image files and nothing is
// copied from reference photos. Used by the "scrapbook" template family.
const svg = (inner, vb = 100) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${inner}</svg>`
  );

function star5(cx, cy, rOuter, rInner, rot = -90) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (rot + i * 36) * Math.PI / 180;
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1) + ' ';
  }
  return d + 'Z';
}
function starSticker(fill) {
  return svg(`<path d="${star5(50, 50, 46, 18)}" fill="#fff"/>
    <path d="${star5(50, 50, 40, 15)}" fill="${fill}" stroke="#2a2a2a" stroke-width="1.5" stroke-linejoin="round"/>`);
}
function sparkleSticker(fill) {
  return svg(`<path d="${star5(50, 50, 46, 8)}" fill="#fff"/>
    <path d="${star5(50, 50, 38, 5)}" fill="${fill}"/>`);
}
function gemSticker(fill, light) {
  return svg(`<path d="M8,38 L50,8 L92,38 L74,92 L26,92 Z" fill="#fff"/>
    <path d="M14,40 L50,14 L86,40 L72,86 L28,86 Z" fill="${fill}" stroke="#2a2a2a" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M26,40 L50,22 L50,40 Z" fill="${light}" opacity=".85"/>
    <path d="M14,40 L50,40 L28,86 Z" fill="${fill}" opacity=".85"/>
    <path d="M86,40 L50,40 L72,86 Z" fill="#000" opacity=".12"/>`);
}
function pearlSticker() {
  return svg(`<circle cx="50" cy="50" r="46" fill="#fff"/>
    <circle cx="50" cy="50" r="40" fill="#f3e9f2" stroke="#2a2a2a" stroke-width="1.5"/>
    <ellipse cx="38" cy="36" rx="12" ry="8" fill="#fff" opacity=".9"/>`);
}
function buttonSticker(fill) {
  return svg(`<circle cx="50" cy="50" r="46" fill="#fff"/>
    <circle cx="50" cy="50" r="40" fill="${fill}" stroke="#2a2a2a" stroke-width="1.5"/>
    <circle cx="38" cy="38" r="5" fill="#2a2a2a"/><circle cx="62" cy="38" r="5" fill="#2a2a2a"/>
    <circle cx="38" cy="62" r="5" fill="#2a2a2a"/><circle cx="62" cy="62" r="5" fill="#2a2a2a"/>`);
}
function goldfishSticker() {
  return svg(`<g stroke="#fff" stroke-width="7" stroke-linejoin="round">
      <path d="M12,50 C20,28 46,18 62,24 C58,34 58,40 62,50 C58,60 58,66 62,76 C46,82 20,72 12,50 Z" fill="#ff8a3d"/>
      <path d="M62,24 L92,14 L80,38 Z" fill="#ff8a3d"/>
      <path d="M62,76 L90,86 L80,62 Z" fill="#ff8a3d"/>
    </g>
    <circle cx="26" cy="44" r="4" fill="#2a2a2a"/>`);
}
function pretzelSticker() {
  return svg(`<path d="M50,10 C20,10 10,34 24,46 C12,54 14,78 34,80 C44,81 46,70 50,62
      C54,70 56,81 66,80 C86,78 88,54 76,46 C90,34 80,10 50,10 Z"
      fill="#c88a4a" stroke="#fff" stroke-width="6"/>
    <circle cx="36" cy="30" r="2.4" fill="#fff6e6"/><circle cx="52" cy="24" r="2.4" fill="#fff6e6"/>
    <circle cx="66" cy="32" r="2.4" fill="#fff6e6"/><circle cx="44" cy="68" r="2.4" fill="#fff6e6"/>
    <circle cx="58" cy="68" r="2.4" fill="#fff6e6"/>`);
}

export const MOTIFS = [
  starSticker('#ffd23f'), starSticker('#ff6f91'), starSticker('#8ecae6'),
  sparkleSticker('#fff4c2'), sparkleSticker('#ffd23f'),
  gemSticker('#ff8fb1', '#ffd2e2'), gemSticker('#9fe0c7', '#d6fff0'), gemSticker('#b8a6ff', '#e4dbff'),
  pearlSticker(), pearlSticker(),
  buttonSticker('#fff1c2'), buttonSticker('#ffe2ea'),
  goldfishSticker(), goldfishSticker(),
  pretzelSticker(),
];
