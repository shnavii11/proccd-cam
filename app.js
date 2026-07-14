// ProCCD Cam — camera capture, live filtered preview, recording, save/share.
import { PARAMS, scaleParams } from './params.js';
import { ProCCDFilter } from './filter.js';
import { initEditor, openEditor } from './editor.js';

const video   = document.getElementById('cam');        // hidden <video> (camera feed)
const glCanvas = document.getElementById('gl');        // hidden WebGL output
const view    = document.getElementById('view');       // visible 2D canvas (preview + record)
const ctx     = view.getContext('2d');

const els = {
  record: document.getElementById('record'),
  flip:   document.getElementById('flip'),
  mute:   document.getElementById('mute'),
  stamp:  document.getElementById('stamp'),
  intensity: document.getElementById('intensity'),
  timer:  document.getElementById('timer'),
  zoom:   document.getElementById('zoom'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  resultVideo: document.getElementById('resultVideo'),
  resultImage: document.getElementById('resultImage'),
  save:   document.getElementById('save'),
  discard: document.getElementById('discard'),
  modePhoto: document.getElementById('modePhoto'),
  modeVideo: document.getElementById('modeVideo'),
  modeBooth: document.getElementById('modeBooth'),
  bgBtn:  document.getElementById('bgBtn'),
  bgPanel: document.getElementById('bgPanel'),
  count:  document.getElementById('count'),
  flash:  document.getElementById('flash'),
  decorate: document.getElementById('decorate'),
};

// selectable UI backgrounds
const BGS = [
  { f: './assets/bg1.jpg', name: 'lime' },
  { f: './assets/bg2.jpg', name: 'blueberry' },
  { f: './assets/bg3.jpg', name: 'cows' },
  { f: './assets/bg4.jpg', name: 'orchid' },
  { f: './assets/bg5.jpg', name: 'glitch cat' },
  { f: './assets/bg6.jpg', name: 'street' },
  { f: './assets/bg7.jpg', name: 'corkboard' },
  { f: './assets/bg8.jpg', name: 'cat collage' },
  { f: './assets/bg9.jpg', name: 'lemon gingham' },
  { f: './assets/bg10.jpg', name: 'stamps' },
  { f: './assets/bg11.jpg', name: 'pressed flowers' },
  { f: './assets/bg12.jpg', name: 'clover lace' },
  { f: './assets/bg13.jpg', name: 'wind chimes' },
];

let filter;
let camStream = null;
let facing = 'environment';   // rear by default
let mirror = false;           // mirror front camera
let stampOn = true;
let muted = false;
let intensity = 1.0;
let sheetOpen = false;   // is the post-capture preview covering the camera?
let mode = 'video';      // 'video' | 'photo' | 'booth'
let boothRunning = false;
let curBg = 0;           // currently selected UI background index
let zoom = 1;            // digital zoom factor (1–5), pinch on the preview
const srcCanvas = document.createElement('canvas');   // holds the cropped (zoomed) frame
const srcCtx = srcCanvas.getContext('2d');

let recorder = null, chunks = [], recStart = 0, recTimer = null, lastBlob = null, lastExt = 'mp4';
let recVideoTrack = null;   // canvas capture track we manually pump frames into while recording

// ---------------------------------------------------------------- camera
async function startCamera() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  mirror = facing === 'user';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    els.status.textContent = 'Camera blocked. Allow camera access and reload. (' + e.name + ')';
    throw e;
  }
  video.srcObject = camStream;
  await video.play();
  await new Promise(r => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
  sizeCanvases();
  els.status.textContent = '';
}

// pick a portrait-friendly output size, capped for phone performance, even dims
function sizeCanvases() {
  let w = video.videoWidth || 1280, h = video.videoHeight || 720;
  const cap = 1280;
  const scale = Math.min(1, cap / Math.max(w, h));
  w = Math.round(w * scale) & ~1;
  h = Math.round(h * scale) & ~1;
  view.width = w; view.height = h;
  srcCanvas.width = w; srcCanvas.height = h;
  filter.baseShort = PARAMS.downres_short_side;
  filter.resize(w, h);
}

// ---------------------------------------------------------------- timestamp
function stampText() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function drawStamp() {
  const h = view.height;
  const size = Math.max(12, Math.round(h * PARAMS.stamp_scale));
  ctx.font = `bold ${size}px "Courier New", Menlo, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const timeStr = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const x = view.width - Math.round(view.width * 0.04);
  const yTime = view.height - Math.round(h * 0.05);   // bottom line = time
  const yDate = yTime - Math.round(size * 1.25);       // date sits above it
  const [r, g, b] = PARAMS.stamp_color;
  ctx.fillStyle = 'rgba(120,40,0,0.9)';                // faint shadow
  ctx.fillText(dateStr, x + 2, yDate + 2);
  ctx.fillText(timeStr, x + 2, yTime + 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;               // orange dot-matrix
  ctx.fillText(dateStr, x, yDate);
  ctx.fillText(timeStr, x, yTime);
}

// ---------------------------------------------------------------- render loop
function loop() {
  if (!sheetOpen && video.readyState >= 2 && filter.W) {
    const t = performance.now() / 1000;
    const p = scaleParams(PARAMS, intensity);
    let source = video;
    if (zoom > 1.001) {                       // digital zoom: crop the centre of the frame
      const vw = video.videoWidth, vh = video.videoHeight;
      const sw = vw / zoom, sh = vh / zoom;
      srcCtx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, srcCanvas.width, srcCanvas.height);
      source = srcCanvas;
    }
    filter.render(source, p, t, { flipX: mirror });
    ctx.drawImage(glCanvas, 0, 0, view.width, view.height);
    if (stampOn) drawStamp();
    if (recVideoTrack) recVideoTrack.requestFrame();   // hand the recorder this frame
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- pinch-to-zoom
const zoomPtrs = new Map();
let zoomStartDist = 0, zoomStart = 1, zoomHideT = null, lastTap = 0, pinchActive = false;
function showZoom() {
  els.zoom.textContent = zoom.toFixed(1) + '×';
  els.zoom.hidden = false;
  clearTimeout(zoomHideT);
  zoomHideT = setTimeout(() => { if (zoom <= 1.001) els.zoom.hidden = true; }, 1200);
}
function setZoom(z) { zoom = Math.min(5, Math.max(1, z)); showZoom(); }
view.addEventListener('pointerdown', e => {
  if (sheetOpen) return;
  zoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (zoomPtrs.size === 2) {
    pinchActive = true;
    const [a, b] = [...zoomPtrs.values()];
    zoomStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomStart = zoom;
  }
});
view.addEventListener('pointermove', e => {
  if (!zoomPtrs.has(e.pointerId)) return;
  zoomPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (zoomPtrs.size >= 2 && zoomStartDist) {
    const [a, b] = [...zoomPtrs.values()];
    setZoom(zoomStart * Math.hypot(a.x - b.x, a.y - b.y) / zoomStartDist);
  }
});
function endZoom(e) {
  zoomPtrs.delete(e.pointerId);
  if (zoomPtrs.size < 2) zoomStartDist = 0;
  if (zoomPtrs.size === 0) {
    if (!pinchActive) {                         // genuine solo tap -> allow double-tap reset
      const now = Date.now();
      if (now - lastTap < 300) setZoom(1);
      lastTap = now;
    }
    pinchActive = false;
  }
}
view.addEventListener('pointerup', endZoom);
view.addEventListener('pointercancel', endZoom);

// ---------------------------------------------------------------- recording
function pickMime() {
  const cands = [
    'video/mp4;codecs=h264,aac', 'video/mp4',
    'video/webm;codecs=h264', 'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  for (const m of cands) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function startRecording() {
  // iOS Safari stops feeding the recorder's video track after ~10s when the browser
  // auto-pulls frames (captureStream(30)) — audio keeps going, video dies. Fix: pump
  // frames manually via captureStream(0) + track.requestFrame() each rendered frame.
  // Fall back to auto-capture on browsers that don't support requestFrame().
  let stream = view.captureStream(0);
  recVideoTrack = stream.getVideoTracks()[0];
  if (!recVideoTrack || typeof recVideoTrack.requestFrame !== 'function') {
    recVideoTrack = null;                 // no manual pumping available
    stream = view.captureStream(30);      // let the browser pull frames instead
  }
  if (!muted) {
    const a = camStream.getAudioTracks()[0];
    if (a) stream.addTrack(a);
  }
  const mime = pickMime();
  lastExt = mime.includes('mp4') ? 'mp4' : 'webm';
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : {});
  chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = finishRecording;
  recorder.start();
  recStart = Date.now();
  els.record.classList.add('recording');
  view.classList.add('rec-on');           // obvious red border while filming
  els.timer.textContent = '● 00:00';
  els.timer.hidden = false;
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    els.timer.textContent = `● ${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}
function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recVideoTrack = null;
  clearInterval(recTimer);
  els.record.classList.remove('recording');
  view.classList.remove('rec-on');
  els.timer.hidden = true;
}
function finishRecording() {
  lastBlob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'video/mp4' });
  // ignore accidental taps (too-short clip) — just go back to the camera
  if (Date.now() - recStart < 500 || lastBlob.size < 2000) { lastBlob = null; return; }
  els.resultVideo.src = URL.createObjectURL(lastBlob);
  els.resultVideo.hidden = false;
  els.resultImage.hidden = true;
  els.decorate.hidden = true;            // decorate is photos/strips only
  els.result.classList.add('open');
  sheetOpen = true;
}

// show an image blob (photo or booth strip) in the result sheet
function showResultImage(blob) {
  if (!blob) return;
  lastBlob = blob;
  lastExt = 'jpg';
  els.resultImage.src = URL.createObjectURL(blob);
  els.resultImage.hidden = false;
  els.resultVideo.hidden = true;
  els.decorate.hidden = false;           // photos & booth strips can be decorated
  els.result.classList.add('open');
  sheetOpen = true;
}

// snap the current filtered frame (stamp included) to a JPEG
function capturePhoto() {
  view.toBlob(blob => showResultImage(blob), 'image/jpeg', 0.92);
}

// ---- photo booth: 4 shots on a countdown -> collage strip ----
const wait = ms => new Promise(r => setTimeout(r, ms));

function snapFrame() {
  const c = document.createElement('canvas');
  c.width = view.width; c.height = view.height;
  c.getContext('2d').drawImage(view, 0, 0);
  return c;
}
async function countdown(n) {
  els.count.hidden = false;
  for (let k = n; k >= 1; k--) { els.count.textContent = k; await wait(750); }
  els.count.hidden = true;
}
async function flashOnce() {
  els.flash.hidden = false; await wait(120); els.flash.hidden = true;
}
function buildStrip(frames) {
  const fw = frames[0].width, fh = frames[0].height;
  const pad = Math.round(fw * 0.05);
  const footer = Math.round(fh * 0.22);
  const W = fw + pad * 2, H = fh * 4 + pad * 5 + footer;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fbf7ef'; g.fillRect(0, 0, W, H);         // creamy photobooth strip
  frames.forEach((f, i) => g.drawImage(f, pad, pad + i * (fh + pad), fw, fh));
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  g.textAlign = 'center';
  g.fillStyle = '#ff9628';
  g.font = `bold ${Math.round(footer * 0.34)}px "Courier New", monospace`;
  g.fillText('ProCCD', W / 2, H - footer * 0.5);
  g.fillStyle = '#555';
  g.font = `bold ${Math.round(footer * 0.24)}px "Courier New", monospace`;
  g.fillText(dateStr, W / 2, H - footer * 0.16);
  return c;
}
async function runBooth() {
  if (boothRunning) return;
  boothRunning = true;
  els.record.classList.add('busy');
  const frames = [];
  try {
    for (let i = 0; i < 4; i++) {
      await countdown(3);
      frames.push(snapFrame());
      await flashOnce();
      await wait(400);
    }
    await new Promise(res =>
      buildStrip(frames).toBlob(b => { showResultImage(b); res(); }, 'image/jpeg', 0.92));
  } finally {
    boothRunning = false;
    els.record.classList.remove('busy');
  }
}

// ---- selectable UI backgrounds (persisted in localStorage) ----
function setBackground(i) {
  const bg = BGS[i] || BGS[0];
  curBg = (i >= 0 && i < BGS.length) ? i : 0;
  document.body.style.background =
    `linear-gradient(rgba(8,10,24,.34), rgba(8,10,24,.34)), url('${bg.f}') center / cover no-repeat`;
  localStorage.setItem('proccd_bg', curBg);
  [...els.bgPanel.children].forEach((b, idx) => b.classList.toggle('active', idx === curBg));
}
function buildBgPanel() {
  BGS.forEach((bg, i) => {
    const b = document.createElement('button');
    b.className = 'bg-thumb';
    b.style.backgroundImage = `url('${bg.f}')`;
    b.title = bg.name;
    b.onclick = () => setBackground(i);
    els.bgPanel.appendChild(b);
  });
  let saved = parseInt(localStorage.getItem('proccd_bg'), 10);
  if (!(saved >= 0 && saved < BGS.length)) saved = 0;
  setBackground(saved);
}

function closeSheet() {
  els.result.classList.remove('open');
  els.resultVideo.pause();
  els.resultVideo.removeAttribute('src');
  els.resultVideo.load();
  els.resultImage.removeAttribute('src');
  lastBlob = null;
  sheetOpen = false;
}

function setMode(m) {
  if (recorder && recorder.state === 'recording') stopRecording();
  mode = m;
  els.modePhoto.classList.toggle('active', m === 'photo');
  els.modeVideo.classList.toggle('active', m === 'video');
  els.modeBooth.classList.toggle('active', m === 'booth');
  els.record.classList.toggle('photo', m !== 'video');   // white shutter for photo & booth
  els.mute.style.visibility = m === 'video' ? 'visible' : 'hidden';
}
// share to Photos (iOS share sheet) or download — reused by clips, photos, decorated cards
async function shareOrDownload(blob, ext) {
  const name = `proccd_${stampText().replace(/[^0-9]/g, '')}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'ProCCD' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
}
function saveClip() { if (lastBlob) shareOrDownload(lastBlob, lastExt); }

// open the decorate editor on the current photo/strip; hide the sheet meanwhile
function openDecorate() {
  if (!lastBlob) return;
  els.result.classList.remove('open');     // reveal the editor (camera stays paused)
  openEditor(lastBlob, { onBack: () => els.result.classList.add('open') });
}

// ---------------------------------------------------------------- UI wiring
els.record.onclick = () => {
  if (mode === 'photo') return capturePhoto();
  if (mode === 'booth') return runBooth();
  (recorder && recorder.state === 'recording') ? stopRecording() : startRecording();
};
els.modePhoto.onclick = () => setMode('photo');
els.modeVideo.onclick = () => setMode('video');
els.modeBooth.onclick = () => setMode('booth');
els.bgBtn.onclick = () => els.bgPanel.classList.toggle('open');
els.flip.onclick = async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  zoom = 1; els.zoom.hidden = true;
  await startCamera();
};
els.mute.onclick = () => {
  muted = !muted;
  els.mute.classList.toggle('off', muted);
  els.mute.textContent = muted ? 'muted' : 'mic';
};
els.stamp.onclick = () => {
  stampOn = !stampOn;
  els.stamp.classList.toggle('off', !stampOn);
};
els.intensity.oninput = e => { intensity = +e.target.value; };
els.save.onclick = saveClip;
els.decorate.onclick = openDecorate;
els.discard.onclick = closeSheet;
// tap anywhere except the Save/Retake buttons to go back to the camera
els.result.onclick = e => { if (!e.target.closest('.sheet-actions')) closeSheet(); };

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    filter = new ProCCDFilter(glCanvas);
  } catch (e) {
    els.status.textContent = e.message;
    return;
  }
  buildBgPanel();
  initEditor({ bgs: BGS, getBgIndex: () => curBg, shareBlob: shareOrDownload });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.status.textContent = 'This browser has no camera API. Open in Safari or Chrome over https.';
    return;
  }
  await startCamera();
  requestAnimationFrame(loop);
})();

// register the service worker for installability (ignore failures / file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
