// Decorate editor — drop the captured photo/booth strip onto a portrait 3:4 card,
// add a patterned background + draggable/resizable/rotatable stickers, flatten to one image.
// Pure DOM layers (CSS transforms) for smooth touch; rasterised to a canvas on save.

import { STICKERS } from './stickers.js';

const CARD_W = 1080, CARD_H = 1440;   // export resolution (3:4)
const CREAM = '#fbf7ef';

let opts = {};            // { bgs, getBgIndex, shareBlob }
let el = {};              // cached DOM
let layers = [];          // { node, visual, del, hnd, natW, natH, cx, cy, baseW, scale, rot, deletable, shadow }
let selected = null;
let bgIndex = -1;         // -1 = plain cream card
const bgImgCache = {};    // index -> loaded HTMLImageElement (for export)
let gesture = null;
let onBackCb = null;

// ---------------------------------------------------------------- helpers
const $ = id => document.getElementById(id);
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

// ---------------------------------------------------------------- init
export function initEditor(o) {
  opts = o;
  el = {
    root:   $('editor'),
    stage:  $('stage'),
    back:   $('edBack'),
    save:   $('edSave'),
    tabStk: $('tabStk'),
    tabBg:  $('tabBg'),
    trayStk:$('trayStk'),
    trayBg: $('trayBg'),
  };
  buildStickerTray();
  buildBgTray();

  el.back.onclick = () => close(true);
  el.save.onclick = saveComposite;
  el.tabStk.onclick = () => showTab('stk');
  el.tabBg.onclick  = () => showTab('bg');

  // tap empty card space to deselect
  el.stage.addEventListener('pointerdown', e => { if (e.target === el.stage) select(null); });

  // global drag / pinch / handle movement
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function showTab(which) {
  const stk = which === 'stk';
  el.tabStk.classList.toggle('active', stk);
  el.tabBg.classList.toggle('active', !stk);
  el.trayStk.hidden = !stk;
  el.trayBg.hidden = stk;
}

// ---------------------------------------------------------------- open / close
export async function openEditor(blob, cbs = {}) {
  onBackCb = cbs.onBack || null;
  layers = []; selected = null; gesture = null;
  el.stage.innerHTML = '';
  fitStage();
  el.root.classList.add('open');
  showTab('stk');

  // background defaults to whatever pattern the camera UI is showing
  const start = (opts.getBgIndex && opts.getBgIndex()) ?? 0;
  await setBg(start);

  // the captured photo/strip becomes the base layer (framed, slightly tilted, not deletable)
  const img = await loadImg(URL.createObjectURL(blob));
  const framed = framePhoto(img);
  const sw = el.stage.clientWidth, sh = el.stage.clientHeight;
  const ar = framed.height / framed.width;
  let baseW = Math.min(sw * 0.72, (sh * 0.82) / ar);
  addLayer(framed, {
    cx: sw / 2, cy: sh * 0.44, baseW,
    rot: -4 * Math.PI / 180, deletable: false, shadow: true,
  });
  select(null);
}

function close(goBack) {
  el.root.classList.remove('open');
  el.stage.innerHTML = '';
  layers = []; selected = null; gesture = null;
  if (goBack && onBackCb) onBackCb();
}

// ---------------------------------------------------------------- stage sizing (true 3:4)
function fitStage() {
  const availH = window.innerHeight * 0.56;
  const availW = window.innerWidth * 0.92;
  let h = availH, w = h * (CARD_W / CARD_H);
  if (w > availW) { w = availW; h = w * (CARD_H / CARD_W); }
  el.stage.style.width = Math.round(w) + 'px';
  el.stage.style.height = Math.round(h) + 'px';
}

// ---------------------------------------------------------------- backgrounds
async function setBg(i) {
  bgIndex = i;
  if (i < 0) {
    el.stage.style.background = CREAM;
  } else {
    el.stage.style.background = `url('${opts.bgs[i].f}') center / cover no-repeat`;
    if (!bgImgCache[i]) bgImgCache[i] = await loadImg(opts.bgs[i].f).catch(() => null);
  }
  [...el.trayBg.children].forEach((b, idx) =>
    b.classList.toggle('active', idx - 1 === i));   // idx 0 is the "none" chip
}

function buildBgTray() {
  const none = document.createElement('button');
  none.className = 'bg-opt none active';
  none.textContent = 'none';
  none.onclick = () => setBg(-1);
  el.trayBg.appendChild(none);
  opts.bgs.forEach((bg, i) => {
    const b = document.createElement('button');
    b.className = 'bg-opt';
    b.style.backgroundImage = `url('${bg.f}')`;
    b.title = bg.name;
    b.onclick = () => setBg(i);
    el.trayBg.appendChild(b);
  });
}

// ---------------------------------------------------------------- sticker tray
function buildStickerTray() {
  STICKERS.forEach(src => {
    const t = document.createElement('button');
    t.className = 'stk-thumb';
    const im = document.createElement('img');
    im.src = src.replace('/stickers/', '/stickers/thumbs/');   // light tray thumbnail
    im.loading = 'lazy'; im.alt = '';
    t.appendChild(im);
    t.onclick = () => addSticker(src);                         // full-res on placement
    el.trayStk.appendChild(t);
  });
}

async function addSticker(src) {
  const img = await loadImg(src);
  const sw = el.stage.clientWidth;
  const baseW = sw * 0.30;
  addLayer(img, {
    cx: el.stage.clientWidth / 2, cy: el.stage.clientHeight / 2,
    baseW, rot: 0, deletable: true, shadow: false,
  });
}

// ---------------------------------------------------------------- layers
function framePhoto(src) {
  const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
  const b = Math.round(Math.min(iw, ih) * 0.04);
  const c = document.createElement('canvas');
  c.width = iw + b * 2; c.height = ih + b * 2;
  const g = c.getContext('2d');
  const rad = Math.round(b * 0.9);
  roundRect(g, 0, 0, c.width, c.height, rad); g.fillStyle = '#fffdf8'; g.fill();
  g.save(); roundRect(g, b, b, iw, ih, Math.max(0, rad - 5)); g.clip();
  g.drawImage(src, b, b, iw, ih); g.restore();
  return c;
}

function addLayer(visual, o) {
  const natW = visual.naturalWidth || visual.width;
  const natH = visual.naturalHeight || visual.height;
  const node = document.createElement('div');
  node.className = 'layer';
  const vis = visual;                 // an <img> or <canvas> element
  vis.classList.add('layer-vis');
  node.appendChild(vis);

  let del = null;
  if (o.deletable) {
    del = document.createElement('button');
    del.className = 'del'; del.textContent = '×';
    del.addEventListener('pointerdown', e => e.stopPropagation());
    del.addEventListener('click', e => { e.stopPropagation(); removeLayer(L); });
    node.appendChild(del);
  }
  const hnd = document.createElement('button');
  hnd.className = 'hnd'; hnd.textContent = '◢';
  node.appendChild(hnd);

  const L = {
    node, visual: vis, del, hnd, natW, natH,
    cx: o.cx, cy: o.cy, baseW: o.baseW, scale: 1, rot: o.rot || 0,
    deletable: o.deletable, shadow: !!o.shadow,
  };
  node.addEventListener('pointerdown', e => beginDrag(L, e));
  hnd.addEventListener('pointerdown', e => beginHandle(L, e));
  el.stage.appendChild(node);
  layers.push(L);
  apply(L);
  select(L);
  return L;
}

function removeLayer(L) {
  L.node.remove();
  layers = layers.filter(x => x !== L);
  if (selected === L) select(null);
}

function apply(L) {
  L.node.style.left = L.cx + 'px';
  L.node.style.top = L.cy + 'px';
  L.node.style.width = L.baseW + 'px';
  L.node.style.transform = `translate(-50%,-50%) rotate(${L.rot}rad) scale(${L.scale})`;
  const inv = 1 / L.scale;
  if (L.del) L.del.style.transform = `translate(-50%,-50%) scale(${inv})`;
  L.hnd.style.transform = `translate(50%,50%) scale(${inv})`;
}

function select(L) {
  selected = L;
  layers.forEach(x => x.node.classList.toggle('sel', x === L));
  // bring stickers to front when picked (leave the base photo at the back)
  if (L && L.deletable) {
    el.stage.appendChild(L.node);
    layers = layers.filter(x => x !== L); layers.push(L);
  }
}

// ---------------------------------------------------------------- gestures
function pt(e) { return { x: e.clientX, y: e.clientY }; }

function beginDrag(L, e) {
  e.preventDefault();
  select(L);
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  if (!gesture || gesture.layer !== L || gesture.type === 'handle') {
    gesture = { type: 'drag', layer: L, pts: new Map() };
  }
  gesture.pts.set(e.pointerId, pt(e));
  if (gesture.pts.size === 2) {
    const [a, b] = [...gesture.pts.values()];
    gesture.type = 'pinch';
    gesture.d0 = Math.hypot(a.x - b.x, a.y - b.y);
    gesture.ang0 = Math.atan2(b.y - a.y, b.x - a.x);
    gesture.mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture.s0 = L.scale; gesture.r0 = L.rot; gesture.cx0 = L.cx; gesture.cy0 = L.cy;
  }
}

function beginHandle(L, e) {
  e.preventDefault(); e.stopPropagation();
  select(L);
  try { L.hnd.setPointerCapture(e.pointerId); } catch (_) {}
  const r = el.stage.getBoundingClientRect();
  const cxC = r.left + L.cx, cyC = r.top + L.cy;
  gesture = {
    type: 'handle', layer: L, cxC, cyC,
    d0: Math.hypot(e.clientX - cxC, e.clientY - cyC) || 1,
    ang0: Math.atan2(e.clientY - cyC, e.clientX - cxC),
    s0: L.scale, r0: L.rot,
  };
}

function onMove(e) {
  if (!gesture) return;
  const L = gesture.layer;
  if (gesture.type === 'handle') {
    const d = Math.hypot(e.clientX - gesture.cxC, e.clientY - gesture.cyC);
    const a = Math.atan2(e.clientY - gesture.cyC, e.clientX - gesture.cxC);
    L.scale = Math.max(0.12, gesture.s0 * d / gesture.d0);
    L.rot = gesture.r0 + (a - gesture.ang0);
    apply(L);
    return;
  }
  if (!gesture.pts.has(e.pointerId)) return;
  const prev = gesture.pts.get(e.pointerId);
  const cur = pt(e);
  gesture.pts.set(e.pointerId, cur);
  if (gesture.type === 'drag' && gesture.pts.size === 1) {
    L.cx += cur.x - prev.x; L.cy += cur.y - prev.y;
    apply(L);
  } else if (gesture.type === 'pinch' && gesture.pts.size >= 2) {
    const [a, b] = [...gesture.pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    L.scale = Math.max(0.12, gesture.s0 * d / gesture.d0);
    L.rot = gesture.r0 + (ang - gesture.ang0);
    L.cx = gesture.cx0 + (mid.x - gesture.mid0.x);
    L.cy = gesture.cy0 + (mid.y - gesture.mid0.y);
    apply(L);
  }
}

function onUp(e) {
  if (!gesture) return;
  if (gesture.type === 'handle') { gesture = null; return; }
  gesture.pts.delete(e.pointerId);
  if (gesture.pts.size === 0) gesture = null;
  else if (gesture.pts.size === 1) gesture.type = 'drag';
}

// ---------------------------------------------------------------- export
function drawCover(g, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

async function saveComposite() {
  select(null);                    // hide handles from the flatten
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext('2d');
  const sx = CARD_W / el.stage.clientWidth, sy = CARD_H / el.stage.clientHeight;

  if (bgIndex >= 0 && bgImgCache[bgIndex]) drawCover(g, bgImgCache[bgIndex], CARD_W, CARD_H);
  else { g.fillStyle = CREAM; g.fillRect(0, 0, CARD_W, CARD_H); }

  for (const L of layers) {
    const w = L.baseW * L.scale * sx;
    const h = w * (L.natH / L.natW);
    g.save();
    g.translate(L.cx * sx, L.cy * sy);
    g.rotate(L.rot);
    if (L.shadow) {
      g.shadowColor = 'rgba(0,0,0,0.30)';
      g.shadowBlur = 22 * sx; g.shadowOffsetY = 10 * sx;
    }
    g.drawImage(L.visual, -w / 2, -h / 2, w, h);
    g.restore();
  }

  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
  await opts.shareBlob(blob, 'jpg');
  close(true);                     // back to the result sheet
}
