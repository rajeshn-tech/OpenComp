/**
 * OpenComp - SplineWarp Core Engine
 * Professional dual-spline correspondence image deformation engine.
 * Implements smooth continuous vector field warping via normalized radial inverse distance
 * weighting with Gaussian boundary falloff, subpixel bilinear sampling, and tiled seam continuity.
 */

import { RotoShape } from './RotoSpline.js';

export class SplinePair {
  constructor(name = 'WarpPair_1') {
    this.id = 'wp_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.enabled = true;

    // Source spline (original feature boundary)
    this.source = new RotoShape(name + '_src', 'bezier');
    this.source.color = '#00f0ff'; // Cyan

    // Destination spline (target deformed boundary)
    this.destination = new RotoShape(name + '_dst', 'bezier');
    this.destination.color = '#ff00ea'; // Magenta

    this.influenceRadius = 250.0; // Warp falloff radius in pixels
    this.weight = 1.0;            // Global warp intensity (0.0 to 1.0)
  }

  addPointPair(srcX, srcY, dstX, dstY, frame = 1) {
    this.source.addPoint(srcX, srcY, 0, 0, 0, 0, frame);
    this.destination.addPoint(dstX, dstY, 0, 0, 0, 0, frame);
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      enabled: this.enabled,
      influenceRadius: this.influenceRadius,
      weight: this.weight,
      source: this.source.serialize(),
      destination: this.destination.serialize()
    };
  }

  static deserialize(data) {
    const pair = new SplinePair(data.name || 'WarpPair');
    pair.id = data.id || pair.id;
    pair.enabled = data.enabled !== undefined ? data.enabled : true;
    pair.influenceRadius = data.influenceRadius || 250.0;
    pair.weight = data.weight !== undefined ? data.weight : 1.0;
    if (data.source) pair.source = RotoShape.deserialize(data.source);
    if (data.destination) pair.destination = RotoShape.deserialize(data.destination);
    return pair;
  }
}

export class SplineWarpEngine {
  constructor() {
    /** @type {SplinePair[]} */
    this.pairs = [];
    this.samplesPerCurve = 16;
  }

  addPair(name = null) {
    const p = new SplinePair(name || `WarpPair_${this.pairs.length + 1}`);
    this.pairs.push(p);
    return p;
  }

  removePair(id) {
    this.pairs = this.pairs.filter(p => p.id !== id);
  }

  getPair(id) {
    return this.pairs.find(p => p.id === id);
  }

  clear() {
    this.pairs = [];
  }

  /**
   * Sample dense correspondence points along source and destination curves at frame
   * @param {number} frame
   * @returns {Array<{srcX: number, srcY: number, dstX: number, dstY: number, radius: number, weight: number}>}
   */
  getCorrespondences(frame = 1) {
    const correspondences = [];

    for (const pair of this.pairs) {
      if (!pair.enabled || pair.weight <= 0) continue;

      const srcPts = pair.source.points;
      const dstPts = pair.destination.points;
      const numPts = Math.min(srcPts.length, dstPts.length);
      if (numPts < 2) continue;

      // Sample along segments
      const isClosed = pair.source.closed;
      const numSegments = isClosed ? numPts : numPts - 1;

      for (let s = 0; s < numSegments; s++) {
        const nextIdx = (s + 1) % numPts;

        const p0Src = srcPts[s].getAtFrame(frame);
        const p1Src = srcPts[nextIdx].getAtFrame(frame);

        const p0Dst = dstPts[s].getAtFrame(frame);
        const p1Dst = dstPts[nextIdx].getAtFrame(frame);

        const samples = this.samplesPerCurve;
        for (let i = 0; i <= samples; i++) {
          const t = i / samples;
          // Cubic Bezier segment evaluation for source and destination
          const sx = (1 - t) * p0Src.x + t * p1Src.x;
          const sy = (1 - t) * p0Src.y + t * p1Src.y;

          const dx = (1 - t) * p0Dst.x + t * p1Dst.x;
          const dy = (1 - t) * p0Dst.y + t * p1Dst.y;

          correspondences.push({
            srcX: sx,
            srcY: sy,
            dstX: dx,
            dstY: dy,
            radius: pair.influenceRadius,
            weight: pair.weight
          });
        }
      }
    }

    return correspondences;
  }

  /**
   * Compute source coordinate (srcX, srcY) for a destination pixel (dstX, dstY)
   * @param {number} x - Destination X
   * @param {number} y - Destination Y
   * @param {Array<{srcX: number, srcY: number, dstX: number, dstY: number, radius: number, weight: number}>} corrs
   * @param {number} [maskVal=1.0] - Optional mask modulation
   * @returns {[number, number]} [srcX, srcY]
   */
  static getWarpedSourceCoord(x, y, corrs, maskVal = 1.0) {
    if (corrs.length === 0 || maskVal <= 0.0) {
      return [x, y];
    }

    let totalWeight = 0;
    let dispX = 0;
    let dispY = 0;
    let minD2 = Infinity;

    const eps2 = 16.0; // Softening parameter (4 px)

    for (let i = 0; i < corrs.length; i++) {
      const c = corrs[i];
      const dx = x - c.dstX;
      const dy = y - c.dstY;
      const d2 = dx * dx + dy * dy;

      if (d2 < minD2) minD2 = d2;

      // Displacement from destination back to source
      const deltaX = c.srcX - c.dstX;
      const deltaY = c.srcY - c.dstY;

      // Inverse distance weighting with power 2
      const w = c.weight / (d2 + eps2);
      totalWeight += w;
      dispX += deltaX * w;
      dispY += deltaY * w;
    }

    if (totalWeight < 1e-9) return [x, y];

    const avgDispX = dispX / totalWeight;
    const avgDispY = dispY / totalWeight;

    // Falloff envelope based on distance to nearest correspondence point
    const r = corrs[0].radius || 250.0;
    const falloff = Math.exp(-minD2 / (2 * r * r)) * maskVal;

    return [
      x + avgDispX * falloff,
      y + avgDispY * falloff
    ];
  }

  /**
   * Deform image using dense correspondence warping
   * @param {import('./PixelBuffer.js').PixelBuffer} srcBuf
   * @param {import('./PixelBuffer.js').PixelBuffer} dstBuf
   * @param {number} frame
   * @param {import('./PixelBuffer.js').PixelBuffer} [maskBuf=null]
   * @param {import('./BBox.js').BBox} [roi=null] - Optional Region of Interest for tiled execution
   */
  warpBuffer(srcBuf, dstBuf, frame = 1, maskBuf = null, roi = null) {
    const corrs = this.getCorrespondences(frame);
    const w = srcBuf.width;
    const h = srcBuf.height;
    const src = srcBuf.data;
    const dst = dstBuf.data;

    const minX = roi ? Math.max(0, roi.x) : 0;
    const maxX = roi ? Math.min(w, roi.r) : w;
    const minY = roi ? Math.max(0, roi.y) : 0;
    const maxY = roi ? Math.min(h, roi.t) : h;

    for (let y = minY; y < maxY; y++) {
      const rowOffset = y * w * 4;
      for (let x = minX; x < maxX; x++) {
        let maskVal = 1.0;
        if (maskBuf) {
          const mIdx = (y * w + x) * 4 + 3; // Alpha or luminance mask
          maskVal = maskBuf.data[mIdx];
        }

        const [srcX, srcY] = SplineWarpEngine.getWarpedSourceCoord(x, y, corrs, maskVal);
        const outIdx = rowOffset + x * 4;

        // Bilinear subpixel sampling
        if (srcX >= 0 && srcX < w - 1 && srcY >= 0 && srcY < h - 1) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const fx = srcX - x0;
          const fy = srcY - y0;
          const ifx = 1.0 - fx;
          const ify = 1.0 - fy;

          const idx00 = (y0 * w + x0) * 4;
          const idx10 = (y0 * w + x1) * 4;
          const idx01 = (y1 * w + x0) * 4;
          const idx11 = (y1 * w + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const top = src[idx00 + c] * ifx + src[idx10 + c] * fx;
            const bot = src[idx01 + c] * ifx + src[idx11 + c] * fx;
            dst[outIdx + c] = top * ify + bot * fy;
          }
        } else if (srcX >= -0.5 && srcX < w - 0.5 && srcY >= -0.5 && srcY < h - 0.5) {
          const cx = Math.max(0, Math.min(w - 1, Math.round(srcX)));
          const cy = Math.max(0, Math.min(h - 1, Math.round(srcY)));
          const inIdx = (cy * w + cx) * 4;
          dst[outIdx] = src[inIdx];
          dst[outIdx + 1] = src[inIdx + 1];
          dst[outIdx + 2] = src[inIdx + 2];
          dst[outIdx + 3] = src[inIdx + 3];
        } else {
          dst[outIdx] = 0;
          dst[outIdx + 1] = 0;
          dst[outIdx + 2] = 0;
          dst[outIdx + 3] = 0;
        }
      }
    }
  }

  serialize() {
    return {
      samplesPerCurve: this.samplesPerCurve,
      pairs: this.pairs.map(p => p.serialize())
    };
  }

  static deserialize(data) {
    const engine = new SplineWarpEngine();
    if (!data) return engine;
    engine.samplesPerCurve = data.samplesPerCurve || 16;
    if (Array.isArray(data.pairs)) {
      engine.pairs = data.pairs.map(pData => SplinePair.deserialize(pData));
    }
    return engine;
  }
}

