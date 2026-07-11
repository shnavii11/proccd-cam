// ProCCD Cam — camera capture, live filtered preview, recording, save/share.
import { PARAMS, scaleParams } from './params.js';
import { ProCCDFilter } from './filter.js';

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
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  resultVideo: document.getElementById('resultVideo'),
  resultImage: document.getElementById('resultImage'),
  save:   document.getElementById('save'),
  discard: document.getElementById('discard'),
  modePhoto: document.getElementById('modePhoto'),
  modeVideo: document.getElementById('modeVideo'),
};

let filter;
let camStream = null;
let facing = 'environment';   // rear by default
let mirror = false;           // mirror front camera
let stampOn = true;
let muted = false;
let intensity = 1.0;
let sheetOpen = false;   // is the post-capture preview covering the camera?
let mode = 'video';      // 'video' | 'photo'

let recorder = null, chunks = [], recStart = 0, recTimer = null, lastBlob = null, lastExt = 'mp4';

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
    filter.render(video, p, t, { flipX: mirror });
    ctx.drawImage(glCanvas, 0, 0, view.width, view.height);
    if (stampOn) drawStamp();
  }
  requestAnimationFrame(loop);
}

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
  const stream = view.captureStream(30);
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
  els.result.classList.add('open');
  sheetOpen = true;
}

// snap the current filtered frame (stamp included) to a JPEG
function capturePhoto() {
  view.toBlob(blob => {
    if (!blob) return;
    lastBlob = blob;
    lastExt = 'jpg';
    els.resultImage.src = URL.createObjectURL(blob);
    els.resultImage.hidden = false;
    els.resultVideo.hidden = true;
    els.result.classList.add('open');
    sheetOpen = true;
  }, 'image/jpeg', 0.92);
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
  els.record.classList.toggle('photo', m === 'photo');   // white shutter vs red
  els.mute.style.visibility = m === 'photo' ? 'hidden' : 'visible';
}
async function saveClip() {
  const name = `proccd_${stampText().replace(/[^0-9]/g, '')}.${lastExt}`;
  const file = new File([lastBlob], name, { type: lastBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'ProCCD clip' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
}

// ---------------------------------------------------------------- UI wiring
els.record.onclick = () => {
  if (mode === 'photo') return capturePhoto();
  (recorder && recorder.state === 'recording') ? stopRecording() : startRecording();
};
els.modePhoto.onclick = () => setMode('photo');
els.modeVideo.onclick = () => setMode('video');
els.flip.onclick = async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  await startCamera();
};
els.mute.onclick = () => {
  muted = !muted;
  els.mute.classList.toggle('off', muted);
  els.mute.textContent = muted ? '🔇' : '🔊';
};
els.stamp.onclick = () => {
  stampOn = !stampOn;
  els.stamp.classList.toggle('off', !stampOn);
};
els.intensity.oninput = e => { intensity = +e.target.value; };
els.save.onclick = saveClip;
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
