# ProCCD Cam — web camera app

Record video live with the ProCCD "2000S" vintage-CCD look, date + time burned
into the bottom-right. Runs in the browser (phone or laptop) — no install, no
App Store. Same recipe as `../proccd.py`, re-implemented as a real-time WebGL
shader so it runs live on a phone GPU.

## Files
- `index.html` / `style.css` — UI shell
- `params.js` — the look (ported 1:1 from `proccd.py` PARAMS) — **edit this to tune**
- `filter.js` — the 8-layer filter as a multi-pass WebGL pipeline
- `app.js` — camera, live preview, timestamp, recording, save/share
- `manifest.webmanifest` + `sw.js` — makes it an installable PWA
- `test.html` — side-by-side WebGL-vs-Python fidelity check (uses `samples/`)

## Run it locally (on your Mac)
Camera works on `localhost` without HTTPS.

```
cd ~/proccd-filter/web
python3 -m http.server 8000
```
Then open **http://localhost:8000** in Chrome or Safari. Allow the camera.
- Fidelity check page: **http://localhost:8000/test.html**

## Use it on your iPhone
The phone camera needs **HTTPS**, so use the deployed link (below), then:
Safari → open the link → Share → **Add to Home Screen**. Launch the icon → it
runs full-screen like a real app. Record, then **Save** drops it into Photos
via the share sheet.

## Deploy a free public HTTPS link (shareable)
It's a static site (no backend), so any of these work — pick one:

**Netlify (drag & drop, easiest):** go to https://app.netlify.com/drop and drag
the `web` folder onto the page. You get a `https://<name>.netlify.app` link.

**Vercel (CLI):**
```
cd ~/proccd-filter/web
npx vercel        # first run links/creates a project
npx vercel --prod # publish; prints your https URL
```

**GitHub Pages:** push this folder to a repo, enable Pages on the branch.

After any tweak to `params.js` etc., re-drag the folder (Netlify) or rerun
`npx vercel --prod`.

## Tuning the look
All knobs live in `params.js` (mirrors `proccd.py`). Open `test.html`, tweak a
value, reload, and compare against the Python reference until identical. The
on-screen **look** slider scales the whole effect 0→100% at runtime.

## Controls
- **Big red button** — start/stop recording (turns into a square while recording)
- **⟲** flip front/rear camera · **🔊** mute mic · **🕑 stamp** toggle date/time
- **look** slider — filter intensity
```
