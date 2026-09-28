// @ts-check
/**
 * Real-time enhancement renderer for photos, video and live camera.
 *
 *   const r = createFilterRenderer(canvas, { fit: 'contain' });
 *   r.setSource(imgOrVideoOrCanvas); r.setParams(profile.media); r.setView({ zoom: 2, panX: 0, panY: 0 });
 *
 * Backends: WebGL2 -> WebGL1 -> 2D canvas (CPU reference pipeline from filter-math.js for stills;
 * ctx.filter approximation for video and during gestures). `backend` tells which one is active.
 *
 * GPU pipeline at OUTPUT resolution (canvas CSS size × devicePixelRatio, capped by opts.maxPixels):
 *   sharpenAmount == 0 : one fused pass  source --(fit+zoom+pan, colour stage, tone stage)--> screen
 *   sharpenAmount  > 0 : pass 1  source --(fit+zoom+pan, colour stage)--> FBO A (RGBA8, sRGB-encoded)
 *                        pass 2  A --(horizontal Gaussian, linear-sampled taps)--> FBO B
 *                        pass 3  B --(vertical Gaussian)--> FBO C
 *                        pass 4  A, C --(unsharp combine, tone stage)--> screen
 * The order of operations is documented (and implemented on the CPU) in filter-math.js.
 * Effective magnification = params.zoom × view.zoom (viewers that manage zoom themselves pass params.zoom = 1).
 *
 * Only same-origin / blob: / data: media (or MediaStreams) are accepted as sources.
 */
import {
  sanitizeParams, isIdentityMatrix, isNeutralParams, toColumnMajor, linearSampleKernel, processImageData,
  cssFilterApprox, MAX_KERNEL_PAIRS,
} from './filter-math.js';
import { identityView, fitScale, imageRect, isSafeMediaUrl } from './view-math.js';

/** @typedef {import('./filter-math.js').RenderParams} RenderParams */
/** @typedef {import('./filter-math.js').SanitizedParams} SanitizedParams */
/** @typedef {import('./view-math.js').View} View */
/** @typedef {import('./view-math.js').Fit} Fit */
/** @typedef {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement|ImageBitmap|OffscreenCanvas} RenderSource */
/** @typedef {'webgl2'|'webgl'|'2d'|'none'} Backend */

/**
 * @typedef {Object} FilterRendererOptions
 * @property {'webgl2'|'webgl'|'2d'} [preferBackend]  Highest backend to try (default 'webgl2').
 * @property {number[]} [background]      Letterbox colour, sRGB 0..1 (default black).
 * @property {Fit} [fit]                  'contain' (default) or 'cover'.
 * @property {number} [maxPixels]         Cap on output pixels (default 4.2 M).
 * @property {number} [maxSourceSize]     Stills larger than this (px, longest side) are downscaled before upload (default 4096).
 * @property {boolean} [autoResize]       Observe the canvas size (default true).
 * @property {boolean} [preserveDrawingBuffer]  Default false.
 * @property {(err: unknown) => void} [onError]
 */

/**
 * @typedef {Object} FilterRenderer
 * @property {boolean} supported
 * @property {Backend} backend
 * @property {(src: RenderSource|null) => void} setSource
 * @property {(p: Partial<RenderParams>|null) => void} setParams
 * @property {(v: Partial<View>) => void} setView
 * @property {() => View} getView
 * @property {() => ({width: number, height: number}|null)} getSourceSize
 * @property {() => void} render
 * @property {() => void} resize
 * @property {(o?: {type?: string, quality?: number, maxSize?: number}) => Promise<Blob|null>} exportBlob
 * @property {() => void} destroy
 */

const KERNEL_VEC4 = MAX_KERNEL_PAIRS / 2;

const VERT = `
attribute vec2 a_pos;
uniform float u_flipY;
varying vec2 v_uv;
void main() {
  vec2 uv = a_pos * 0.5 + 0.5;
  v_uv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flipY));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
`;

// Steps 1 (+geometry): fit/zoom/pan, edge-extended sampling, alpha composited onto white. a = inside image.
const SAMPLE_GLSL = `
uniform sampler2D u_src;
uniform vec2 u_dstSize;
uniform vec2 u_srcSize;
uniform float u_scale;
uniform vec2 u_center;
vec4 sampleSource() {
  vec2 p = v_uv * u_dstSize - 0.5 * u_dstSize;
  vec2 suv = u_center + p / (u_scale * u_srcSize);
  vec2 ins = step(vec2(0.0), suv) * step(suv, vec2(1.0));
  vec4 c = texture2D(u_src, clamp(suv, 0.0, 1.0));
  c.rgb = c.rgb * c.a + (1.0 - c.a);
  return vec4(c.rgb, ins.x * ins.y);
}`;

// Steps 2–4: colour matrix in linear light.
const COLOR_GLSL = `
uniform mat3 u_matrix;
uniform float u_useMatrix;
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
vec3 linearToSrgb(vec3 l) {
  vec3 lo = l * 12.92;
  vec3 hi = 1.055 * pow(max(l, vec3(1e-6)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), l));
}
vec3 colorStage(vec3 c) {
  if (u_useMatrix < 0.5) return c;
  return linearToSrgb(clamp(u_matrix * srgbToLinear(c), 0.0, 1.0));
}`;

// Steps 7–14: tone stage in sRGB-encoded space.
const TONE_GLSL = `
uniform float u_warmth;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_invert;
uniform vec3 u_tint;
uniform vec3 u_background;
vec3 toneStage(vec3 c) {
  c *= vec3(1.0, 1.0 - 0.12 * u_warmth, 1.0 - 0.5 * u_warmth);
  c *= u_brightness;
  c = (c - 0.5) * u_contrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(l) + (c - vec3(l)) * u_saturation;
  c = clamp(c, 0.0, 1.0);
  c = mix(c, 1.0 - c, u_invert);
  return clamp(c * u_tint, 0.0, 1.0);
}`;

const FRAG_DIRECT = `${FRAG_HEAD}${SAMPLE_GLSL}${COLOR_GLSL}${TONE_GLSL}
void main() {
  vec4 s = sampleSource();
  vec3 c = toneStage(colorStage(s.rgb));
  gl_FragColor = vec4(mix(u_background, c, s.a), 1.0);
}`;

const FRAG_COLOR = `${FRAG_HEAD}${SAMPLE_GLSL}${COLOR_GLSL}
void main() {
  vec4 s = sampleSource();
  gl_FragColor = vec4(colorStage(s.rgb), s.a);
}`;

const FRAG_BLUR = `${FRAG_HEAD}
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform float u_center;
uniform vec4 u_kernel[${KERNEL_VEC4}];
uniform int u_count;
void main() {
  vec4 sum = texture2D(u_tex, v_uv) * u_center;
  for (int i = 0; i < ${KERNEL_VEC4}; i++) {
    if (i >= u_count) break;
    vec4 k = u_kernel[i];
    vec2 o1 = u_step * k.x;
    vec2 o2 = u_step * k.z;
    sum += (texture2D(u_tex, v_uv + o1) + texture2D(u_tex, v_uv - o1)) * k.y;
    sum += (texture2D(u_tex, v_uv + o2) + texture2D(u_tex, v_uv - o2)) * k.w;
  }
  gl_FragColor = sum;
}`;

const FRAG_COMBINE = `${FRAG_HEAD}${TONE_GLSL}
uniform sampler2D u_orig;
uniform sampler2D u_blur;
uniform float u_amount;
void main() {
  vec4 o = texture2D(u_orig, v_uv);
  vec3 b = texture2D(u_blur, v_uv).rgb;
  vec3 c = clamp(o.rgb + u_amount * (o.rgb - b), 0.0, 1.0);
  gl_FragColor = vec4(mix(u_background, toneStage(c), step(0.5, o.a)), 1.0);
}`;

/** @typedef {WebGLRenderingContext|WebGL2RenderingContext} GL */
/** @typedef {{prog: WebGLProgram, shaders: WebGLShader[], loc: Record<string, WebGLUniformLocation|null>, aPos: number}} Program */
/** @typedef {{tex: WebGLTexture, fbo: WebGLFramebuffer, w: number, h: number}} Target */
/** @typedef {{a: Target, b: Target, c: Target}} TargetSet */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {FilterRendererOptions} [options]
 * @returns {FilterRenderer}
 */
export function createFilterRenderer(canvas, options = {}) {
  const opts = {
    preferBackend: /** @type {'webgl2'|'webgl'|'2d'} */ ('webgl2'),
    background: [0, 0, 0],
    fit: /** @type {Fit} */ ('contain'),
    maxPixels: 4_200_000,
    maxSourceSize: 4096,
    autoResize: true,
    preserveDrawingBuffer: false,
    onError: /** @type {((err: unknown) => void)|undefined} */ (undefined),
    ...options,
  };
  const bg = opts.background.map((x) => Math.min(1, Math.max(0, Number(x) || 0)));
  const bgCss = `rgb(${bg.map((x) => Math.round(x * 255)).join(' ')})`;
  const win = canvas.ownerDocument.defaultView || window;

  /** @type {SanitizedParams} */
  let params = sanitizeParams(null);
  let matrixCM = toColumnMajor(params.colorMatrix);
  let useMatrix = 0;
  /** @type {View} */
  let view = identityView();
  /** @type {RenderSource|null} */
  let source = null;
  /** @type {'none'|'video'|'still'} */
  let kind = 'none';
  /** @type {RenderSource|null} what is actually uploaded for stills (may be a downscaled canvas) */
  let uploadSrc = null;
  /** @type {HTMLCanvasElement|null} */
  let downscaled = null;
  let srcDirty = false;
  let destroyed = false;
  let rafId = 0;
  let lastInteraction = 0;
  let fullRenderTimer = 0;
  /** @type {Array<() => void>} per-source listeners */
  let sourceCleanups = [];

  /** @type {Backend} */
  let backend = 'none';
  /** @type {GL|null} */
  let gl = null;
  let isGL2 = false;
  let contextLost = false;
  /** @type {null|{vbuf: WebGLBuffer, programs: Record<'direct'|'color'|'blur'|'combine', Program>, srcTex: WebGLTexture, targets: TargetSet|null, maxTex: number, maxViewport: number}} */
  let res = null;
  /** @type {CanvasRenderingContext2D|null} */
  let ctx2d = null;
  /** @type {{sigma: number, center: number, data: Float32Array, count: number}|null} */
  let kernelCache = null;

  const report = (/** @type {unknown} */ err) => {
    if (opts.onError) opts.onError(err); else console.warn('[filter-renderer]', err);
  };

  // ---------- backend selection ----------
  /** @type {WebGLContextAttributes} */
  const attrs = {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'default',
  };
  if (opts.preferBackend === 'webgl2') {
    gl = /** @type {WebGL2RenderingContext|null} */ (canvas.getContext('webgl2', attrs));
    if (gl) { backend = 'webgl2'; isGL2 = true; }
  }
  if (!gl && opts.preferBackend !== '2d') {
    gl = /** @type {WebGLRenderingContext|null} */ (canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs));
    if (gl) backend = 'webgl';
  }
  if (gl) {
    if (gl.isContextLost()) contextLost = true;
    else {
      try { res = createResources(gl); } catch (err) { report(err); backend = 'none'; gl = null; }
    }
  } else {
    ctx2d = canvas.getContext('2d', { alpha: false });
    if (ctx2d) backend = '2d';
  }
  canvas.dataset.vaBackend = backend;

  // ---------- GL helpers ----------
  /** @param {GL} g @param {number} type @param {string} src */
  function compile(g, type, src) {
    const sh = /** @type {WebGLShader} */ (g.createShader(type));
    g.shaderSource(sh, src);
    g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS) && !g.isContextLost()) {
      const log = g.getShaderInfoLog(sh);
      g.deleteShader(sh);
      throw new Error(`shader compile failed: ${log}`);
    }
    return sh;
  }

  /** @param {GL} g @param {string} fragSrc @returns {Program} */
  function link(g, fragSrc) {
    const vs = compile(g, g.VERTEX_SHADER, VERT);
    const fs = compile(g, g.FRAGMENT_SHADER, fragSrc);
    const prog = /** @type {WebGLProgram} */ (g.createProgram());
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.bindAttribLocation(prog, 0, 'a_pos');
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS) && !g.isContextLost()) {
      throw new Error(`program link failed: ${g.getProgramInfoLog(prog)}`);
    }
    /** @type {Record<string, WebGLUniformLocation|null>} */
    const loc = {};
    const n = g.getProgramParameter(prog, g.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = g.getActiveUniform(prog, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      loc[name] = g.getUniformLocation(prog, info.name);
    }
    return { prog, shaders: [vs, fs], loc, aPos: 0 };
  }

  /** @param {GL} g */
  function createTexture(g) {
    const tex = /** @type {WebGLTexture} */ (g.createTexture());
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return tex;
  }

  /** @param {GL} g */
  function createResources(g) {
    const vbuf = /** @type {WebGLBuffer} */ (g.createBuffer());
    g.bindBuffer(g.ARRAY_BUFFER, vbuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const programs = {
      direct: link(g, FRAG_DIRECT),
      color: link(g, FRAG_COLOR),
      blur: link(g, FRAG_BLUR),
      combine: link(g, FRAG_COMBINE),
    };
    const srcTex = createTexture(g);
    const vp = g.getParameter(g.MAX_VIEWPORT_DIMS);
    return {
      vbuf, programs, srcTex, targets: null,
      maxTex: Number(g.getParameter(g.MAX_TEXTURE_SIZE)) || 4096,
      maxViewport: Math.min(Number(vp?.[0]) || 4096, Number(vp?.[1]) || 4096),
    };
  }

  /** @param {GL} g @param {Target|null} t @param {number} w @param {number} h @returns {Target} */
  function sizeTarget(g, t, w, h) {
    const tex = t ? t.tex : createTexture(g);
    const fbo = t ? t.fbo : /** @type {WebGLFramebuffer} */ (g.createFramebuffer());
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    const status = g.checkFramebufferStatus(g.FRAMEBUFFER);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    if (status !== g.FRAMEBUFFER_COMPLETE && !g.isContextLost()) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    return { tex, fbo, w, h };
  }

  /** @param {GL} g @param {Target|null|undefined} t */
  function freeTarget(g, t) {
    if (!t) return;
    g.deleteFramebuffer(t.fbo);
    g.deleteTexture(t.tex);
  }

  /** @param {GL} g @param {number} w @param {number} h @param {TargetSet|null} set @returns {TargetSet} */
  function ensureTargets(g, w, h, set) {
    if (set && set.a.w === w && set.a.h === h) return set;
    return {
      a: sizeTarget(g, set ? set.a : null, w, h),
      b: sizeTarget(g, set ? set.b : null, w, h),
      c: sizeTarget(g, set ? set.c : null, w, h),
    };
  }

  function freeResources() {
    if (!gl || !res) return;
    const g = gl;
    for (const p of Object.values(res.programs)) {
      p.shaders.forEach((s) => { g.detachShader(p.prog, s); g.deleteShader(s); });
      g.deleteProgram(p.prog);
    }
    if (res.targets) { freeTarget(g, res.targets.a); freeTarget(g, res.targets.b); freeTarget(g, res.targets.c); }
    g.deleteTexture(res.srcTex);
    g.deleteBuffer(res.vbuf);
    res = null;
  }

  // ---------- source handling ----------
  const sizeScratch = { width: 0, height: 0 };
  /** Current source size (a reused object: copy it before keeping it). */
  function sourceSize() {
    const s = /** @type {any} */ (source);
    if (!s) return null;
    const w = kind === 'video' ? s.videoWidth : (s.naturalWidth ?? s.width);
    const h = kind === 'video' ? s.videoHeight : (s.naturalHeight ?? s.height);
    if (!(w > 0 && h > 0)) return null;
    sizeScratch.width = w;
    sizeScratch.height = h;
    return sizeScratch;
  }

  function sourceReady() {
    const s = /** @type {any} */ (source);
    if (!s) return false;
    if (kind === 'video') return s.readyState >= 2 && s.videoWidth > 0;
    if (typeof s.complete === 'boolean' && !s.complete) return false;
    return !!sourceSize();
  }

  /** @param {RenderSource} s */
  function isSafeSource(s) {
    const any = /** @type {any} */ (s);
    const origin = win.location.origin;
    if (typeof any.videoWidth === 'number') {
      if (any.srcObject) return true;
      const url = any.currentSrc || any.src;
      return !url || isSafeMediaUrl(url, origin);
    }
    if (typeof any.naturalWidth === 'number') {
      const url = any.currentSrc || any.src;
      return !url || isSafeMediaUrl(url, origin);
    }
    return true; // canvases / bitmaps: a tainted canvas makes texImage2D/getImageData throw SecurityError
  }

  /** Downscale huge stills (GPU memory, MAX_TEXTURE_SIZE) once, with high-quality smoothing. */
  function prepareStill() {
    const size = sourceSize();
    if (!size || !source) { uploadSrc = source; return; }
    const limit = Math.min(opts.maxSourceSize, res ? res.maxTex : opts.maxSourceSize);
    const longest = Math.max(size.width, size.height);
    if (longest <= limit) { uploadSrc = source; releaseDownscaled(); return; }
    const k = limit / longest;
    const c = downscaled || canvas.ownerDocument.createElement('canvas');
    c.width = Math.max(1, Math.round(size.width * k));
    c.height = Math.max(1, Math.round(size.height * k));
    const cx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(/** @type {CanvasImageSource} */ (source), 0, 0, c.width, c.height);
    downscaled = c;
    uploadSrc = c;
  }

  function releaseDownscaled() {
    if (downscaled) { downscaled.width = 0; downscaled.height = 0; downscaled = null; }
  }

  function clearSourceListeners() {
    sourceCleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    sourceCleanups = [];
  }

  /** @param {EventTarget} t @param {string} type @param {EventListener} fn */
  function listen(t, type, fn) {
    t.addEventListener(type, fn);
    sourceCleanups.push(() => t.removeEventListener(type, fn));
  }

  /** @param {HTMLVideoElement} v */
  function watchVideo(v) {
    const onChange = () => {
      if (!isSafeSource(v)) { report(new DOMException('Cross-origin media is not allowed', 'SecurityError')); setSource(null); return; }
      requestRender();
    };
    ['loadedmetadata', 'loadeddata', 'seeked', 'resize', 'emptied'].forEach((e) => listen(v, e, onChange));
    const vAny = /** @type {any} */ (v);
    let vfcId = 0;
    let loopRaf = 0;
    let vfcSeen = false;
    const hasVfc = typeof vAny.requestVideoFrameCallback === 'function';
    const onFrame = () => {
      vfcId = 0;
      if (destroyed || source !== v) return;
      vfcSeen = true;
      renderNow();
      vfcId = vAny.requestVideoFrameCallback(onFrame);
    };
    const rafTick = () => {
      loopRaf = 0;
      if (destroyed || source !== v || v.paused || v.ended) return;
      renderNow();
      loopRaf = win.requestAnimationFrame(rafTick);
    };
    const startRaf = () => { if (!loopRaf) loopRaf = win.requestAnimationFrame(rafTick); };
    let probe = 0;
    const onPlay = () => {
      if (!hasVfc) { startRaf(); return; }
      // Some engines do not present frames of detached/hidden videos: fall back to rAF if no callback arrives.
      win.clearTimeout(probe);
      probe = win.setTimeout(() => { if (!vfcSeen && !v.paused) startRaf(); }, 400);
    };
    if (hasVfc) vfcId = vAny.requestVideoFrameCallback(onFrame);
    listen(v, 'play', onPlay);
    listen(v, 'playing', onPlay);
    if (!v.paused) onPlay();
    sourceCleanups.push(() => {
      win.clearTimeout(probe);
      if (vfcId && typeof vAny.cancelVideoFrameCallback === 'function') vAny.cancelVideoFrameCallback(vfcId);
      if (loopRaf) win.cancelAnimationFrame(loopRaf);
      vfcId = 0; loopRaf = 0;
    });
  }

  /** @param {RenderSource|null} src */
  function setSource(src) {
    if (destroyed) return;
    clearSourceListeners();
    releaseDownscaled();
    source = null; uploadSrc = null; kind = 'none';
    if (src) {
      if (!isSafeSource(src)) {
        report(new DOMException('Cross-origin media is not allowed', 'SecurityError'));
      } else {
        source = src;
        const any = /** @type {any} */ (src);
        kind = typeof any.videoWidth === 'number' ? 'video' : 'still';
        if (kind === 'video') watchVideo(/** @type {HTMLVideoElement} */ (src));
        else if (typeof any.complete === 'boolean' && !any.complete) {
          const onLoad = () => { srcDirty = true; if (kind === 'still') prepareStill(); requestRender(); };
          listen(/** @type {HTMLImageElement} */ (src), 'load', onLoad);
        } else prepareStill();
      }
    }
    srcDirty = true;
    requestRender();
  }

  /** @returns {boolean} true when the texture holds the current frame */
  function uploadIfNeeded() {
    if (!gl || !res || !source) return false;
    if (kind === 'still' && !srcDirty) return true;
    const g = gl;
    const up = kind === 'still' ? (uploadSrc || source) : source;
    g.bindTexture(g.TEXTURE_2D, res.srcTex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, /** @type {any} */ (up));
    } catch (err) {
      report(err);
      setSource(null);
      return false;
    }
    let mip = false;
    if (kind === 'still') {
      const w = /** @type {any} */ (up).width; const h = /** @type {any} */ (up).height;
      const pot = (/** @type {number} */ n) => n > 0 && (n & (n - 1)) === 0;
      const imgW = /** @type {any} */ (up).naturalWidth ?? w; const imgH = /** @type {any} */ (up).naturalHeight ?? h;
      mip = isGL2 || (pot(imgW) && pot(imgH));
      if (mip) g.generateMipmap(g.TEXTURE_2D);
    }
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR);
    srcDirty = false;
    return true;
  }

  // ---------- rendering ----------
  function outputDpr() {
    const cw = canvas.clientWidth;
    return cw > 0 && canvas.width > 0 ? canvas.width / cw : (win.devicePixelRatio || 1);
  }

  /** @param {number} sigma */
  function kernelFor(sigma) {
    const key = Math.round(sigma * 1000) / 1000;
    if (kernelCache && kernelCache.sigma === key) return kernelCache;
    const { center, offsets, weights } = linearSampleKernel(key);
    const data = kernelCache ? kernelCache.data : new Float32Array(KERNEL_VEC4 * 4);
    data.fill(0);
    for (let i = 0; i < offsets.length; i++) { data[i * 2] = offsets[i]; data[i * 2 + 1] = weights[i]; }
    kernelCache = { sigma: key, center, data, count: Math.ceil(offsets.length / 2) };
    return kernelCache;
  }

  /** @param {GL} g @param {Program} p @param {WebGLFramebuffer|null} fbo @param {number} w @param {number} h @param {number} flip */
  function begin(g, p, fbo, w, h, flip) {
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.viewport(0, 0, w, h);
    g.useProgram(p.prog);
    g.uniform1f(p.loc.u_flipY, flip);
  }

  /** @param {GL} g */
  function draw(g) {
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  /** @param {GL} g @param {Program} p @param {number} w @param {number} h @param {number} zoom @param {View} v */
  function setSampleUniforms(g, p, w, h, zoom, v) {
    const size = /** @type {{width: number, height: number}} */ (sourceSize());
    const sw = uploadSrc && kind === 'still' && downscaled ? downscaled.width : size.width;
    const sh = uploadSrc && kind === 'still' && downscaled ? downscaled.height : size.height;
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, /** @type {any} */ (res).srcTex);
    g.uniform1i(p.loc.u_src, 0);
    g.uniform2f(p.loc.u_dstSize, w, h);
    g.uniform2f(p.loc.u_srcSize, sw, sh);
    g.uniform1f(p.loc.u_scale, fitScale(sw, sh, w, h, opts.fit) * zoom);
    g.uniform2f(p.loc.u_center, 0.5 + v.panX, 0.5 + v.panY);
    g.uniformMatrix3fv(p.loc.u_matrix, false, matrixCM);
    g.uniform1f(p.loc.u_useMatrix, useMatrix);
  }

  /** @param {GL} g @param {Program} p */
  function setToneUniforms(g, p) {
    g.uniform1f(p.loc.u_warmth, params.warmth);
    g.uniform1f(p.loc.u_brightness, params.brightness);
    g.uniform1f(p.loc.u_contrast, params.contrast);
    g.uniform1f(p.loc.u_saturation, params.saturation);
    g.uniform1f(p.loc.u_invert, params.invert ? 1 : 0);
    g.uniform3f(p.loc.u_tint, params.tint[0], params.tint[1], params.tint[2]);
    g.uniform3f(p.loc.u_background, bg[0], bg[1], bg[2]);
  }

  /**
   * @param {GL} g
   * @param {WebGLFramebuffer|null} outFbo  null = screen
   * @param {number} w @param {number} h
   * @param {TargetSet|null} targets  required when sharpening
   * @param {number} zoom  total magnification
   * @param {View} v
   * @param {number} sigma  device px
   * @param {number} flip   1 for the screen, 0 for FBOs (row 0 = top)
   */
  function runPipeline(g, outFbo, w, h, targets, zoom, v, sigma, flip) {
    const P = /** @type {NonNullable<typeof res>} */ (res).programs;
    g.bindBuffer(g.ARRAY_BUFFER, /** @type {any} */ (res).vbuf);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.disable(g.BLEND);
    if (params.sharpenAmount <= 0 || !targets) {
      begin(g, P.direct, outFbo, w, h, flip);
      setSampleUniforms(g, P.direct, w, h, zoom, v);
      setToneUniforms(g, P.direct);
      draw(g);
      return;
    }
    // pass 1: geometry + colour -> A
    begin(g, P.color, targets.a.fbo, w, h, 0);
    setSampleUniforms(g, P.color, w, h, zoom, v);
    draw(g);
    // pass 2/3: separable Gaussian A -> B -> C
    const k = kernelFor(sigma);
    begin(g, P.blur, targets.b.fbo, w, h, 0);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, targets.a.tex);
    g.uniform1i(P.blur.loc.u_tex, 0);
    g.uniform1f(P.blur.loc.u_center, k.center);
    g.uniform4fv(P.blur.loc.u_kernel, k.data);
    g.uniform1i(P.blur.loc.u_count, k.count);
    g.uniform2f(P.blur.loc.u_step, 1 / w, 0);
    draw(g);
    begin(g, P.blur, targets.c.fbo, w, h, 0);
    g.bindTexture(g.TEXTURE_2D, targets.b.tex);
    g.uniform2f(P.blur.loc.u_step, 0, 1 / h);
    draw(g);
    // pass 4: unsharp combine + tone -> output
    begin(g, P.combine, outFbo, w, h, flip);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, targets.a.tex);
    g.uniform1i(P.combine.loc.u_orig, 0);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, targets.c.tex);
    g.uniform1i(P.combine.loc.u_blur, 1);
    g.uniform1f(P.combine.loc.u_amount, params.sharpenAmount);
    setToneUniforms(g, P.combine);
    draw(g);
    g.activeTexture(g.TEXTURE0);
  }

  function renderGL() {
    if (!gl || !res || contextLost) return;
    const g = gl;
    const w = canvas.width; const h = canvas.height;
    if (!w || !h) return;
    if (!sourceReady() || !uploadIfNeeded()) {
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.viewport(0, 0, w, h);
      g.clearColor(bg[0], bg[1], bg[2], 1);
      g.clear(g.COLOR_BUFFER_BIT);
      return;
    }
    if (params.sharpenAmount > 0) {
      try { res.targets = ensureTargets(g, w, h, res.targets); } catch (err) { report(err); return; }
    }
    runPipeline(g, null, w, h, res.targets, params.zoom * view.zoom, view, params.sharpenSigmaPx * outputDpr(), 1);
  }

  function render2D() {
    if (!ctx2d) return;
    const c = ctx2d;
    const w = canvas.width; const h = canvas.height;
    if (!w || !h) return;
    c.save();
    c.filter = 'none';
    c.fillStyle = bgCss;
    c.fillRect(0, 0, w, h);
    const size = sourceSize();
    if (!source || !size || !sourceReady()) { c.restore(); return; }
    const r = imageRect({ zoom: params.zoom * view.zoom, panX: view.panX, panY: view.panY }, size.width, size.height, w, h, opts.fit);
    const drawSrc = /** @type {CanvasImageSource} */ (kind === 'still' && uploadSrc ? uploadSrc : source);
    const neutral = isNeutralParams(params);
    const interacting = performance.now() - lastInteraction < 250;
    const quick = kind === 'video' || interacting || neutral;
    if (quick) {
      if (!neutral && 'filter' in c) c.filter = cssFilterApprox(params);
      c.fillStyle = '#fff';
      c.fillRect(r.x, r.y, r.w, r.h);
      c.drawImage(drawSrc, r.x, r.y, r.w, r.h);
      c.restore();
      if (kind === 'still' && interacting && !neutral) {
        win.clearTimeout(fullRenderTimer);
        fullRenderTimer = win.setTimeout(() => requestRender(), 280);
      }
      return;
    }
    const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w)); const y1 = Math.min(h, Math.ceil(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) { c.restore(); return; }
    c.fillStyle = '#fff';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.imageSmoothingQuality = 'high';
    c.drawImage(drawSrc, r.x, r.y, r.w, r.h);
    try {
      const img = c.getImageData(x0, y0, x1 - x0, y1 - y0);
      processImageData(img.data, img.width, img.height, params, params.sharpenSigmaPx * outputDpr());
      c.putImageData(img, x0, y0);
    } catch (err) {
      report(err);
    }
    c.restore();
  }

  function renderNow() {
    if (destroyed) return;
    if (backend === '2d') render2D(); else renderGL();
  }

  function requestRender() {
    if (destroyed || rafId) return;
    rafId = win.requestAnimationFrame(() => { rafId = 0; renderNow(); });
  }

  // ---------- size ----------
  /** @type {{w: number, h: number}|null} device-pixel size reported by ResizeObserver */
  let observedDevice = null;

  function resize() {
    if (destroyed) return;
    const dpr = win.devicePixelRatio || 1;
    const cssW = canvas.clientWidth; const cssH = canvas.clientHeight;
    let w = observedDevice ? observedDevice.w : Math.round(cssW * dpr);
    let h = observedDevice ? observedDevice.h : Math.round(cssH * dpr);
    if (!(w > 0 && h > 0)) return;
    const maxDim = res ? Math.min(res.maxTex, res.maxViewport) : 8192;
    let k = Math.min(1, Math.sqrt(opts.maxPixels / (w * h)), maxDim / w, maxDim / h);
    if (k < 1) { w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k)); }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    renderNow(); // re-draw synchronously: resizing clears the canvas
  }

  /** @type {ResizeObserver|null} */
  let ro = null;
  if (opts.autoResize && typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      const dp = /** @type {any} */ (e).devicePixelContentBoxSize?.[0];
      observedDevice = dp ? { w: Math.round(dp.inlineSize), h: Math.round(dp.blockSize) } : null;
      resize();
    });
    try { ro.observe(canvas, { box: /** @type {any} */ ('device-pixel-content-box') }); } catch { ro.observe(canvas); }
  }
  const onWinResize = () => { observedDevice = null; resize(); };
  if (opts.autoResize) win.addEventListener('resize', onWinResize);

  // ---------- context loss ----------
  /** @param {Event} e */
  const onLost = (e) => {
    e.preventDefault();
    contextLost = true;
    res = null; // GPU objects are gone with the context
    kernelCache = null;
  };
  const onRestored = () => {
    if (destroyed || !gl) return;
    contextLost = false;
    try { res = createResources(gl); } catch (err) { report(err); return; }
    srcDirty = true;
    if (kind === 'still') prepareStill();
    renderNow();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // ---------- export ----------
  /** @param {{type?: string, quality?: number, maxSize?: number}} [o] */
  async function exportBlob({ type = 'image/png', quality = 0.92, maxSize = 4096 } = {}) {
    if (destroyed || !source || !sourceReady()) return null;
    const size = /** @type {{width: number, height: number}} */ (sourceSize());
    const limit = Math.min(maxSize, res ? Math.min(res.maxTex, res.maxViewport) : maxSize, backend === '2d' ? 2048 : Infinity);
    const k = Math.min(1, limit / Math.max(size.width, size.height));
    const w = Math.max(1, Math.round(size.width * k)); const h = Math.max(1, Math.round(size.height * k));
    // Keep the sharpening band the user sees at zoom 1: sigma(device px) / (device px per source px) × export scale.
    const fitNow = fitScale(size.width, size.height, canvas.width || w, canvas.height || h, 'contain') || k;
    const sigma = (params.sharpenSigmaPx * outputDpr() / fitNow) * k;
    const doc = canvas.ownerDocument;
    const out = doc.createElement('canvas');
    out.width = w; out.height = h;
    const octx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
    if (gl && res && !contextLost) {
      const g = gl;
      if (!uploadIfNeeded()) return null;
      /** @type {TargetSet|null} */ let set = null;
      /** @type {Target|null} */ let dst = null;
      try {
        set = params.sharpenAmount > 0 ? ensureTargets(g, w, h, null) : null;
        dst = sizeTarget(g, null, w, h);
        runPipeline(g, dst.fbo, w, h, set, 1, identityView(), sigma, 0);
        const px = new Uint8Array(w * h * 4);
        g.bindFramebuffer(g.FRAMEBUFFER, dst.fbo);
        g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        octx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h), 0, 0);
      } finally {
        if (set) { freeTarget(g, set.a); freeTarget(g, set.b); freeTarget(g, set.c); }
        freeTarget(g, dst);
        renderNow();
      }
    } else {
      octx.fillStyle = '#fff';
      octx.fillRect(0, 0, w, h);
      octx.drawImage(/** @type {CanvasImageSource} */ (source), 0, 0, w, h);
      const img = octx.getImageData(0, 0, w, h);
      processImageData(img.data, w, h, params, sigma);
      octx.putImageData(img, 0, 0);
    }
    const blob = await new Promise((resolve) => out.toBlob(resolve, type, quality));
    out.width = 0; out.height = 0;
    return /** @type {Blob|null} */ (blob);
  }

  // ---------- public API ----------
  /** @param {Partial<RenderParams>|null} p */
  function setParams(p) {
    params = sanitizeParams(p);
    matrixCM = toColumnMajor(params.colorMatrix);
    useMatrix = isIdentityMatrix(params.colorMatrix) ? 0 : 1;
    requestRender();
  }

  /** @param {Partial<View>} v */
  function setView(v) {
    const zoom = Number(v?.zoom);
    view = {
      zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(50, zoom) : view.zoom,
      panX: Number.isFinite(Number(v?.panX)) ? Number(v.panX) : view.panX,
      panY: Number.isFinite(Number(v?.panY)) ? Number(v.panY) : view.panY,
    };
    lastInteraction = performance.now();
    requestRender();
  }

  function destroy() {
    if (destroyed) return;
    clearSourceListeners();
    destroyed = true;
    if (rafId) win.cancelAnimationFrame(rafId);
    win.clearTimeout(fullRenderTimer);
    rafId = 0;
    ro?.disconnect();
    win.removeEventListener('resize', onWinResize);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    if (gl && !contextLost) {
      freeResources();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    releaseDownscaled();
    gl = null; ctx2d = null; res = null;
    source = null; uploadSrc = null; kind = 'none';
    delete canvas.dataset.vaBackend;
  }

  const api = {
    supported: backend !== 'none',
    get backend() { return backend; },
    setSource,
    setParams,
    setView,
    getView: () => ({ ...view }),
    getSourceSize: () => { const sz = sourceSize(); return sz ? { ...sz } : null; },
    render: renderNow,
    resize,
    exportBlob,
    destroy,
  };
  resize();
  return api;
}
