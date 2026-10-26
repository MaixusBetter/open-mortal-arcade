// media.js - getting frames out of videos, GIFs, image sequences and the camera.
import { decodeGIF } from '../gif.js';

export const WORK_HEIGHT = 360;   // frames are worked on at this height (fighters end up ~300 px tall)

export function fitSize(w, h, height = WORK_HEIGHT) {
  const s = Math.min(1, height / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function canvas2d(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

export async function loadVideo(file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  v.src = typeof file === 'string' ? file : URL.createObjectURL(file);
  await new Promise((res, rej) => {
    v.onloadeddata = res;
    v.onerror = () => rej(new Error('This browser cannot play that video. Try an .mp4 (H.264) or .webm file, or record with the camera here.'));
  });
  if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => (v.ondurationchange = r)); v.currentTime = 0; }
  return v;
}

export function seek(v, t) {
  return new Promise(res => {
    const t2 = Math.max(0, Math.min(v.duration - 0.001, t));
    if (Math.abs(v.currentTime - t2) < 1e-4 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done); v.currentTime = t2;
  });
}

/** Grab `count` frames evenly between t0 and t1 (seconds). */
export async function framesFromVideo(v, t0, t1, count, onProgress) {
  const { w, h } = fitSize(v.videoWidth, v.videoHeight);
  const [, ctx] = canvas2d(w, h);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? t0 : t0 + (t1 - t0) * i / (count - 1);
    await seek(v, t);
    ctx.drawImage(v, 0, 0, w, h);
    out.push(ctx.getImageData(0, 0, w, h));
    onProgress && onProgress((i + 1) / count);
  }
  return { w, h, frames: out };
}

/** Animated GIF -> frames at working size, keeping transparency. */
export async function framesFromGif(file) {
  const buf = await file.arrayBuffer();
  const g = decodeGIF(buf);
  const { w, h } = fitSize(g.w, g.h);
  const [src, sctx] = canvas2d(g.w, g.h);
  const [, dctx] = canvas2d(w, h);
  const frames = []; let transparent = false;
  for (const f of g.frames) {
    sctx.putImageData(new ImageData(f.rgba, g.w, g.h), 0, 0);
    dctx.clearRect(0, 0, w, h); dctx.drawImage(src, 0, 0, w, h);
    const id = dctx.getImageData(0, 0, w, h);
    if (!transparent) for (let i = 3; i < id.data.length; i += 4 * 97) if (id.data[i] < 255) { transparent = true; break; }
    frames.push(id);
  }
  const fps = Math.round(1000 / (g.frames.reduce((a, f) => a + f.delay, 0) / Math.max(1, g.frames.length)));
  return { w, h, frames, fps, transparent };
}

/** A handful of still images (PNG with transparency, JPG...) -> frames */
export async function framesFromImages(files) {
  const bitmaps = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) bitmaps.push(await createImageBitmap(f));
  const W = Math.max(...bitmaps.map(b => b.width)), H = Math.max(...bitmaps.map(b => b.height));
  const { w, h } = fitSize(W, H);
  const [, ctx] = canvas2d(w, h);
  let transparent = false;
  const frames = bitmaps.map(b => {
    ctx.clearRect(0, 0, w, h); ctx.drawImage(b, 0, 0, b.width * w / W, b.height * h / H);
    const id = ctx.getImageData(0, 0, w, h);
    if (!transparent) for (let i = 3; i < id.data.length; i += 4 * 97) if (id.data[i] < 255) { transparent = true; break; }
    return id;
  });
  return { w, h, frames, fps: 10, transparent };
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
export async function openCamera(video, { facing = 'user' } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (window.isSecureContext) throw new Error('This browser has no camera access.');
    // phones on plain http: point them at the arcade's https address
    let secure = '';
    try {
      const info = await (await fetch('api/info')).json();
      if (info.httpsPort) secure = `https://${location.hostname}:${info.httpsPort}${location.pathname}`;
    } catch {}
    throw new Error(secure
      ? `Browsers only allow the camera on a secure page. Open ${secure} instead (tap through the warning once), or upload a video.`
      : 'Browsers only allow the camera on a secure page. Start the arcade with "Start Arcade" (it turns https on), or upload a video.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream) { if (stream) for (const t of stream.getTracks()) t.stop(); }

/** Captures `seconds` of camera at `fps`, returning working-size frames. Mirror = selfie view. */
export async function recordFrames(video, { seconds = 1.5, fps = 12, mirror = false, onFrame } = {}) {
  const { w, h } = fitSize(video.videoWidth, video.videoHeight);
  const [, ctx] = canvas2d(w, h);
  const frames = []; const n = Math.round(seconds * fps); const start = performance.now();
  for (let i = 0; i < n; i++) {
    const due = start + i * 1000 / fps;
    await new Promise(r => setTimeout(r, Math.max(0, due - performance.now())));
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0);
    ctx.drawImage(video, 0, 0, w, h);
    frames.push(ctx.getImageData(0, 0, w, h));
    onFrame && onFrame(i, n);
  }
  return { w, h, frames, fps };
}

/** Median of several camera frames = a clean picture of the empty background. */
export async function capturePlate(video, { count = 9, mirror = false } = {}) {
  const shot = await recordFrames(video, { seconds: count / 9, fps: 9, mirror });
  return medianImage(shot.frames, shot.w, shot.h);
}

export function medianImage(frames, w, h) {
  const out = new ImageData(w, h); const n = frames.length; const vals = new Uint8Array(n);
  for (let i = 0; i < w * h * 4; i++) {
    if ((i & 3) === 3) { out.data[i] = 255; continue; }
    for (let k = 0; k < n; k++) vals[k] = frames[k].data[i];
    vals.sort(); out.data[i] = vals[n >> 1];
  }
  return out;
}
