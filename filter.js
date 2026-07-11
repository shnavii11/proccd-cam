// ProCCD filter — real-time WebGL implementation.
// Mirrors proccd.apply_filter() order: low-res -> chromatic aberration ->
// s-curve -> split-tone -> saturate -> bloom -> chroma noise -> vignette.
//
// Multi-pass pipeline (all NPOT textures, CLAMP_TO_EDGE + LINEAR):
//   video -> [down]  FBO_base (low res, softened)
//   base  -> [tone]  FBO_tone (CA + s-curve + split-tone + saturate, full res)
//   tone  -> [bloomH] FBO_bloomH (bright-pass + horizontal blur, 1/4 res)
//   bloomH-> [bloomV] FBO_bloom  (vertical blur, 1/4 res)
//   tone + bloom -> [comp] default framebuffer (noise + vignette + screen bloom)

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const LUMA = `float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`;

// 1. low-res softening + optional horizontal-flip (front camera mirror)
const FRAG_DOWN = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;   // 1 / baseRes
uniform float u_soft;
uniform float u_flipX;  // 1.0 = mirror
void main(){
  vec2 uv = v_uv;
  uv.x = mix(uv.x, 1.0 - uv.x, u_flipX);
  vec3 b = texture2D(u_tex, uv).rgb * 0.4;
  vec2 o = u_texel * u_soft;   // gentle blur (Python uses a small 0.6px gaussian)
  b += texture2D(u_tex, uv + vec2( o.x, 0.0)).rgb * 0.15;
  b += texture2D(u_tex, uv + vec2(-o.x, 0.0)).rgb * 0.15;
  b += texture2D(u_tex, uv + vec2(0.0,  o.y)).rgb * 0.15;
  b += texture2D(u_tex, uv + vec2(0.0, -o.y)).rgb * 0.15;
  gl_FragColor = vec4(b, 1.0);
}
`;

// 2-5. chromatic aberration, s-curve, split-tone, saturate
const FRAG_TONE = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_ca, u_contrast, u_black, u_falloff, u_sat;
uniform vec3 u_shadowTint, u_highlightTint;
uniform float u_shadowStr, u_highlightStr;
${LUMA}
void main(){
  // radial channel separation about center
  vec2 dir = v_uv - 0.5;
  float r = texture2D(u_tex, 0.5 + dir / (1.0 + u_ca)).r;
  float g = texture2D(u_tex, v_uv).g;
  float b = texture2D(u_tex, 0.5 + dir / (1.0 - u_ca)).b;
  vec3 c = vec3(r, g, b);

  // s-curve + black point
  vec3 x = clamp((c - u_black) / (1.0 - u_black), 0.0, 1.0);
  x = clamp(x + u_contrast * sin((x - 0.5) * 3.14159265) * 0.5, 0.0, 1.0);
  c = x;

  // split-tone
  float L = luma(c);
  float sw = pow(clamp(1.0 - L, 0.0, 1.0), u_falloff);
  float hw = pow(clamp(L, 0.0, 1.0), u_falloff);
  c = clamp(c + u_shadowTint * sw * u_shadowStr
              + u_highlightTint * hw * u_highlightStr, 0.0, 1.0);

  // saturation
  float L2 = luma(c);
  c = clamp(vec3(L2) + (c - vec3(L2)) * u_sat, 0.0, 1.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

// 6a. bloom: bright-pass (only on horizontal pass) + separable gaussian blur
function fragBloom(horizontal) {
  return `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;    // 1 / bloomRes
uniform float u_radius;  // texels
uniform float u_threshold;
uniform float u_bright;  // 1.0 on H pass (apply threshold), 0.0 on V pass
${LUMA}
void main(){
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  vec2 axis = ${horizontal ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)'};
  for (int i = -8; i <= 8; i++){
    float fi = float(i);
    vec2 uv = v_uv + axis * (fi / 8.0 * u_radius) * u_texel;
    vec3 c = texture2D(u_tex, uv).rgb;
    if (u_bright > 0.5) {
      float m = clamp((luma(c) - u_threshold) / (1.0 - u_threshold), 0.0, 1.0);
      c *= m;
    }
    float w = exp(-fi * fi / 16.0);
    sum += c * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}
`;
}

// 7-8. composite: screen-blend bloom, chroma noise, vignette
const FRAG_COMP = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;    // FBO_tone
uniform sampler2D u_bloom;  // FBO_bloom
uniform float u_bloomStr;
uniform float u_noiseSigma, u_noiseBias, u_coarse;
uniform vec2 u_res;
uniform float u_time;
uniform float u_vig;
${LUMA}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1,0));
  float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main(){
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec3 bl = texture2D(u_bloom, v_uv).rgb;
  c = 1.0 - (1.0 - c) * (1.0 - bl * u_bloomStr);      // screen blend

  // fine chroma grain — matches proccd.py: ~half-res, gaussian-ish, shadow-biased,
  // re-seeded by time so it shimmers frame-to-frame like a real CCD.
  vec2 np = v_uv * u_res / u_coarse;   // u_coarse = noise_scale (2) -> ~2px blotches
  vec3 n;
  n.r = vnoise(np + vec2(u_time * 13.0, 0.0)) + vnoise(np * 1.7 + vec2(0.0, u_time * 9.0) +  5.0) - 1.0;
  n.g = vnoise(np + vec2(0.0, u_time * 7.0) + 37.0) + vnoise(np * 1.7 + vec2(u_time * 6.0, 0.0) + 21.0) - 1.0;
  n.b = vnoise(np + vec2(u_time * 5.0, u_time * 3.0) + 91.0) + vnoise(np * 1.7 + vec2(0.0, u_time * 4.0) + 63.0) - 1.0;
  float w = 1.0 + (1.0 - luma(c)) * (u_noiseBias - 1.0);
  c += n * u_noiseSigma * 1.0 * w;

  // vignette
  vec2 d = (v_uv - 0.5) * 2.0;
  float dist = length(d) / 1.41421356;
  c *= 1.0 - u_vig * pow(clamp(dist, 0.0, 1.0), 2.2);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// ---------------------------------------------------------------- GL helpers
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  p._loc = {};
  return p;
}
function loc(gl, p, name) {
  if (!(name in p._loc)) p._loc[name] = gl.getUniformLocation(p, name);
  return p._loc[name];
}
function makeTex(gl, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function makeFBO(gl, w, h) {
  const tex = makeTex(gl, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

// ---------------------------------------------------------------- the filter
export class ProCCDFilter {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true, // so drawImage() onto 2D canvas grabs the frame
      antialias: false, alpha: false,
    });
    if (!gl) throw new Error('WebGL not supported on this device.');
    this.gl = gl;
    this.canvas = canvas;

    // fullscreen quad
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this.pDown  = program(gl, FRAG_DOWN);
    this.pTone  = program(gl, FRAG_TONE);
    this.pBloomH = program(gl, fragBloom(true));
    this.pBloomV = program(gl, fragBloom(false));
    this.pComp  = program(gl, FRAG_COMP);

    this.videoTex = makeTex(gl, 2, 2);
    this.W = this.H = 0;
    this.baseShort = 480;   // low-res base height; set from PARAMS.downres_short_side
  }

  // (re)allocate framebuffers for a given output size
  resize(w, h) {
    if (w === this.W && h === this.H) return;
    const gl = this.gl;
    this.W = this.canvas.width = w;
    this.H = this.canvas.height = h;
    const baseH = Math.min(this.baseShort, h);
    const baseW = Math.max(1, Math.round(w * baseH / h));
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    [this.fboBase, this.fboTone, this.fboBH, this.fboBloom].forEach(f => {
      if (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    });
    this.fboBase  = makeFBO(gl, baseW, baseH);
    this.fboTone  = makeFBO(gl, w, h);
    this.fboBH    = makeFBO(gl, bw, bh);
    this.fboBloom = makeFBO(gl, bw, bh);
  }

  _drawQuad(prog) {
    const gl = this.gl;
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  _bindOut(fbo) {
    const gl = this.gl;
    if (fbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb); gl.viewport(0, 0, fbo.w, fbo.h); }
    else     { gl.bindFramebuffer(gl.FRAMEBUFFER, null);   gl.viewport(0, 0, this.W, this.H); }
  }
  _bindTex(prog, unit, name, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc(gl, prog, name), unit);
  }

  // render one frame. `source` is a <video>, <img>, or <canvas>. p = params, t = seconds.
  render(source, p, t, { flipX = false } = {}) {
    const gl = this.gl;
    this.params = p;

    // upload the source frame (flip Y so it's upright)
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // don't let the browser apply the source's color profile — match PIL's raw sRGB
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // --- pass 1: low-res softening -> base
    this._bindOut(this.fboBase);
    gl.useProgram(this.pDown);
    this._bindTex(this.pDown, 0, 'u_tex', this.videoTex);
    gl.uniform2f(loc(gl, this.pDown, 'u_texel'), 1 / this.fboBase.w, 1 / this.fboBase.h);
    gl.uniform1f(loc(gl, this.pDown, 'u_soft'), p.softness);
    gl.uniform1f(loc(gl, this.pDown, 'u_flipX'), flipX ? 1 : 0);
    this._drawQuad(this.pDown);

    // --- pass 2: tone (CA + s-curve + split-tone + saturate) -> tone
    this._bindOut(this.fboTone);
    gl.useProgram(this.pTone);
    this._bindTex(this.pTone, 0, 'u_tex', this.fboBase.tex);
    gl.uniform1f(loc(gl, this.pTone, 'u_ca'), p.ca_amount);
    gl.uniform1f(loc(gl, this.pTone, 'u_contrast'), p.contrast);
    gl.uniform1f(loc(gl, this.pTone, 'u_black'), p.black_point);
    gl.uniform1f(loc(gl, this.pTone, 'u_falloff'), p.tone_falloff);
    gl.uniform1f(loc(gl, this.pTone, 'u_sat'), p.saturation);
    gl.uniform3fv(loc(gl, this.pTone, 'u_shadowTint'), p.shadow_tint);
    gl.uniform3fv(loc(gl, this.pTone, 'u_highlightTint'), p.highlight_tint);
    gl.uniform1f(loc(gl, this.pTone, 'u_shadowStr'), p.shadow_strength);
    gl.uniform1f(loc(gl, this.pTone, 'u_highlightStr'), p.highlight_strength);
    this._drawQuad(this.pTone);

    // --- pass 3: bloom bright-pass + horizontal blur -> bloomH
    const radius = p.bloom_radius * this.fboBH.w / this.W; // scale to 1/4-res texels
    this._bindOut(this.fboBH);
    gl.useProgram(this.pBloomH);
    this._bindTex(this.pBloomH, 0, 'u_tex', this.fboTone.tex);
    gl.uniform2f(loc(gl, this.pBloomH, 'u_texel'), 1 / this.fboBH.w, 1 / this.fboBH.h);
    gl.uniform1f(loc(gl, this.pBloomH, 'u_radius'), radius);
    gl.uniform1f(loc(gl, this.pBloomH, 'u_threshold'), p.bloom_threshold);
    gl.uniform1f(loc(gl, this.pBloomH, 'u_bright'), 1);
    this._drawQuad(this.pBloomH);

    // --- pass 4: bloom vertical blur -> bloom
    this._bindOut(this.fboBloom);
    gl.useProgram(this.pBloomV);
    this._bindTex(this.pBloomV, 0, 'u_tex', this.fboBH.tex);
    gl.uniform2f(loc(gl, this.pBloomV, 'u_texel'), 1 / this.fboBloom.w, 1 / this.fboBloom.h);
    gl.uniform1f(loc(gl, this.pBloomV, 'u_radius'), radius);
    gl.uniform1f(loc(gl, this.pBloomV, 'u_threshold'), 0);
    gl.uniform1f(loc(gl, this.pBloomV, 'u_bright'), 0);
    this._drawQuad(this.pBloomV);

    // --- pass 5: composite -> screen
    this._bindOut(null);
    gl.useProgram(this.pComp);
    this._bindTex(this.pComp, 0, 'u_tex', this.fboTone.tex);
    this._bindTex(this.pComp, 1, 'u_bloom', this.fboBloom.tex);
    gl.uniform1f(loc(gl, this.pComp, 'u_bloomStr'), p.bloom_strength);
    gl.uniform1f(loc(gl, this.pComp, 'u_noiseSigma'), p.noise_sigma);
    gl.uniform1f(loc(gl, this.pComp, 'u_noiseBias'), p.noise_shadow_bias);
    gl.uniform1f(loc(gl, this.pComp, 'u_coarse'), p.noise_scale);
    gl.uniform2f(loc(gl, this.pComp, 'u_res'), this.W, this.H);
    gl.uniform1f(loc(gl, this.pComp, 'u_time'), t);
    gl.uniform1f(loc(gl, this.pComp, 'u_vig'), p.vignette_strength);
    this._drawQuad(this.pComp);
  }
}
