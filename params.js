// The ProCCD "2000S" recipe — ported 1:1 from proccd.py PARAMS.
// This is the single source of truth for the look. Tweak, reload, compare.
// Every value here maps to a uniform in the WebGL shaders (see filter.js).
export const PARAMS = {
  // 1. low-res softening: render into a short-side=480 buffer, then blow back up
  downres_short_side: 560,   // base render height. lower = mushier / more retro
  softness: 0.35,            // extra blur after upscale (kept low; bilinear already softens)

  // 2. split-tone: RGB nudges pushed into shadows / highlights
  shadow_tint:    [-0.05, 0.00, 0.10],  // blue into the darks
  highlight_tint: [ 0.10, 0.04, -0.07], // amber/orange into the lights
  shadow_strength: 0.55,
  highlight_strength: 0.65,
  tone_falloff: 1.4,         // how tightly tints hug the extremes

  // 3. contrast + color
  contrast: 0.30,            // S-curve amount (0 = none)
  black_point: 0.04,         // crush shadows below this to black
  saturation: 1.45,          // >1 punchier

  // 4. highlight bloom / halation
  bloom_threshold: 0.72,     // only pixels brighter than this bloom
  bloom_radius: 14,          // glow blur radius (px, at full res)
  bloom_strength: 0.55,      // how much glow screens back on top

  // 5. chromatic aberration (radial channel separation)
  ca_amount: 0.004,          // ~0.004 = subtle fringing

  // 6. chroma noise (cheap-sensor colored speckle)
  noise_sigma: 0.045,        // strength
  noise_scale: 2,            // coarseness of the blotches
  noise_shadow_bias: 1.3,    // more speckle in the darks

  // 7. vignette
  vignette_strength: 0.35,   // 0 = off, 1 = heavy dark corners

  // 8. date/time stamp (drawn on the 2D compositor, not in GL)
  stamp_color: [255, 150, 40], // classic orange dot-matrix
  stamp_scale: 0.038,          // text height as fraction of frame height
};

// Master intensity dial (0..1) for the on-screen slider. Scales the "extra"
// effects toward a clean image at 0 and full ProCCD at 1, by interpolating the
// strength-like params from neutral. Structure/order of the pipeline is fixed.
export function scaleParams(p, k) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const s = { ...p };
  s.softness            = lerp(0, p.softness, k);
  s.shadow_strength     = lerp(0, p.shadow_strength, k);
  s.highlight_strength  = lerp(0, p.highlight_strength, k);
  s.contrast            = lerp(0, p.contrast, k);
  s.saturation          = lerp(1, p.saturation, k);
  s.bloom_strength      = lerp(0, p.bloom_strength, k);
  s.ca_amount           = lerp(0, p.ca_amount, k);
  s.noise_sigma         = lerp(0, p.noise_sigma, k);
  s.vignette_strength   = lerp(0, p.vignette_strength, k);
  return s;
}
