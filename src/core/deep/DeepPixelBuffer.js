/**
 * OpenComp - DeepPixelBuffer
 * High-performance, production-grade 32-bit floating-point Deep Image Buffer.
 * Stores variable numbers of volumetric and point samples per pixel using a flat dual-array architecture:
 * - sampleOffsets: Uint32Array(width * height + 1) prefix-sum lookup table
 * - sampleData: Float32Array(totalSamples * 6) contiguous float32 array: [zFront, zBack, R, G, B, A]
 * Fully aligned with ASWF OpenEXR Deep specifications.
 */

import { BBox } from '../BBox.js';
import { PixelBuffer } from '../PixelBuffer.js';

export class DeepPixelBuffer {
  /**
   * @param {number} width Buffer width in pixels
   * @param {number} height Buffer height in pixels
   * @param {number} [initialCapacity=0] Pre-allocated sample capacity
   */
  constructor(width, height, initialCapacity = 0) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.totalPixels = this.width * this.height;

    // Prefix-sum offset table: sampleOffsets[p] to sampleOffsets[p+1] defines samples for pixel p
    this.sampleOffsets = new Uint32Array(this.totalPixels + 1);

    // Initial allocation for sample data (6 floats per sample: zFront, zBack, r, g, b, a)
    const cap = Math.max(initialCapacity, this.totalPixels);
    this.sampleCapacity = cap;
    this.sampleData = new Float32Array(cap * 6);
    this.totalSamples = 0;

    /** @type {BBox} Dynamic 2D data bounding box */
    this.bbox = new BBox(0, 0, this.width, this.height);

    /** @type {Object} Header metadata */
    this.metadata = {};

    this.channels = ['Z', 'ZBack', 'R', 'G', 'B', 'A'];
    this.isDeep = true;
  }

  /**
   * Returns number of deep samples stored at pixel (x, y)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getSampleCount(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    const p = y * this.width + x;
    return this.sampleOffsets[p + 1] - this.sampleOffsets[p];
  }

  /**
   * Retrieves a single sample from pixel (x, y) at sample index i
   * @param {number} x
   * @param {number} y
   * @param {number} index
   * @returns {{zFront: number, zBack: number, r: number, g: number, b: number, a: number}|null}
   */
  getSample(x, y, index) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const p = y * this.width + x;
    const start = this.sampleOffsets[p];
    const count = this.sampleOffsets[p + 1] - start;
    if (index < 0 || index >= count) return null;

    const base = (start + index) * 6;
    return {
      zFront: this.sampleData[base],
      zBack: this.sampleData[base + 1],
      r: this.sampleData[base + 2],
      g: this.sampleData[base + 3],
      b: this.sampleData[base + 4],
      a: this.sampleData[base + 5]
    };
  }

  /**
   * Retrieves all samples for pixel (x, y) as an array of sample objects
   * @param {number} x
   * @param {number} y
   * @returns {Array<{zFront: number, zBack: number, r: number, g: number, b: number, a: number}>}
   */
  getSamples(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [];
    const p = y * this.width + x;
    const start = this.sampleOffsets[p];
    const end = this.sampleOffsets[p + 1];
    const count = end - start;
    const result = new Array(count);

    for (let i = 0; i < count; i++) {
      const base = (start + i) * 6;
      result[i] = {
        zFront: this.sampleData[base],
        zBack: this.sampleData[base + 1],
        r: this.sampleData[base + 2],
        g: this.sampleData[base + 3],
        b: this.sampleData[base + 4],
        a: this.sampleData[base + 5]
      };
    }
    return result;
  }

  /**
   * Sorts samples at pixel (x, y) strictly in ascending order of zFront, breaking ties by zBack
   * @param {number} x
   * @param {number} y
   */
  sortPixelSamples(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const p = y * this.width + x;
    const start = this.sampleOffsets[p];
    const count = this.sampleOffsets[p + 1] - start;
    if (count <= 1) return;

    // Small count: in-place insertion sort
    const data = this.sampleData;
    for (let i = 1; i < count; i++) {
      const curIdx = (start + i) * 6;
      const zF = data[curIdx];
      const zB = data[curIdx + 1];
      const r = data[curIdx + 2];
      const g = data[curIdx + 3];
      const b = data[curIdx + 4];
      const a = data[curIdx + 5];

      let j = i - 1;
      while (j >= 0) {
        const prevIdx = (start + j) * 6;
        const prevZF = data[prevIdx];
        const prevZB = data[prevIdx + 1];

        // Compare zFront, then zBack
        if (prevZF > zF || (prevZF === zF && prevZB > zB)) {
          // Shift forward
          const destIdx = (start + j + 1) * 6;
          data[destIdx] = prevZF;
          data[destIdx + 1] = prevZB;
          data[destIdx + 2] = data[prevIdx + 2];
          data[destIdx + 3] = data[prevIdx + 3];
          data[destIdx + 4] = data[prevIdx + 4];
          data[destIdx + 5] = data[prevIdx + 5];
          j--;
        } else {
          break;
        }
      }

      const insertIdx = (start + j + 1) * 6;
      data[insertIdx] = zF;
      data[insertIdx + 1] = zB;
      data[insertIdx + 2] = r;
      data[insertIdx + 3] = g;
      data[insertIdx + 4] = b;
      data[insertIdx + 5] = a;
    }
  }

  /**
   * Sorts samples across all pixels in the buffer
   */
  sortAllSamples() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.sortPixelSamples(x, y);
      }
    }
  }

  /**
   * Compacts internal storage array to exact total sample count
   */
  compact() {
    const requiredLength = this.totalSamples * 6;
    if (this.sampleData.length !== requiredLength) {
      const compacted = new Float32Array(requiredLength);
      compacted.set(this.sampleData.subarray(0, requiredLength));
      this.sampleData = compacted;
      this.sampleCapacity = this.totalSamples;
    }
    return this;
  }

  /**
   * Deep clone of DeepPixelBuffer
   * @returns {DeepPixelBuffer}
   */
  clone() {
    const copy = new DeepPixelBuffer(this.width, this.height, this.totalSamples);
    copy.sampleOffsets.set(this.sampleOffsets);
    copy.sampleData.set(this.sampleData.subarray(0, this.totalSamples * 6));
    copy.totalSamples = this.totalSamples;
    copy.sampleCapacity = this.totalSamples;
    copy.bbox = this.bbox ? this.bbox.clone() : new BBox(0, 0, this.width, this.height);
    copy.metadata = JSON.parse(JSON.stringify(this.metadata));
    copy.channels = [...this.channels];
    return copy;
  }

  /**
   * Factory constructing a DeepPixelBuffer from an array of per-pixel sample lists
   * @param {number} width
   * @param {number} height
   * @param {Array<Array<{zFront: number, zBack?: number, r: number, g: number, b: number, a: number}>>} pixelSamples
   * @returns {DeepPixelBuffer}
   */
  static fromSampleLists(width, height, pixelSamples) {
    const buf = new DeepPixelBuffer(width, height);
    const totalPixels = width * height;

    // 1. Calculate prefix-sum offsets
    let runningTotal = 0;
    buf.sampleOffsets[0] = 0;
    for (let p = 0; p < totalPixels; p++) {
      const samples = pixelSamples[p];
      const count = samples ? samples.length : 0;
      runningTotal += count;
      buf.sampleOffsets[p + 1] = runningTotal;
    }

    buf.totalSamples = runningTotal;
    buf.sampleCapacity = runningTotal;
    buf.sampleData = new Float32Array(runningTotal * 6);

    // 2. Populate contiguous sampleData
    let writeIdx = 0;
    for (let p = 0; p < totalPixels; p++) {
      const samples = pixelSamples[p];
      if (!samples) continue;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        buf.sampleData[writeIdx++] = Number(s.zFront ?? s.z1 ?? s.z ?? 0.0);
        buf.sampleData[writeIdx++] = Number(s.zBack ?? s.z2 ?? s.zFront ?? s.z1 ?? s.z ?? 0.0);
        buf.sampleData[writeIdx++] = Number(s.r ?? 0.0);
        buf.sampleData[writeIdx++] = Number(s.g ?? 0.0);
        buf.sampleData[writeIdx++] = Number(s.b ?? 0.0);
        buf.sampleData[writeIdx++] = Number(s.a ?? 1.0);
      }
    }

    buf.sortAllSamples();
    buf.updateBBox();
    return buf;
  }

  /**
   * Recomputes 2D data bounding box based on pixels containing non-zero opacity samples
   */
  updateBBox() {
    let minX = this.width, maxX = -1, minY = this.height, maxY = -1;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const p = y * this.width + x;
        const start = this.sampleOffsets[p];
        const count = this.sampleOffsets[p + 1] - start;
        if (count > 0) {
          // Check if any sample has non-zero alpha
          for (let i = 0; i < count; i++) {
            const alpha = this.sampleData[(start + i) * 6 + 5];
            if (alpha > 0.0001) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              break;
            }
          }
        }
      }
    }

    if (minX <= maxX && minY <= maxY) {
      this.bbox = new BBox(minX, minY, maxX + 1, maxY + 1);
    } else {
      this.bbox = new BBox(0, 0, this.width, this.height);
    }
    return this.bbox;
  }

  /**
   * Retrieves accumulated linear RGBA color vector at pixel (x, y)
   * Computed non-destructively using volumetric Beer-Lambert optical ray traversal.
   * @param {number} x
   * @param {number} y
   * @returns {number[]} [r, g, b, a]
   */
  getPixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [0, 0, 0, 0];
    const p = y * this.width + x;
    const start = this.sampleOffsets[p];
    const count = this.sampleOffsets[p + 1] - start;
    if (count === 0) return [0, 0, 0, 0];

    let accR = 0, accG = 0, accB = 0, T = 1.0;
    const data = this.sampleData;
    for (let i = 0; i < count; i++) {
      const base = (start + i) * 6;
      const r = data[base + 2];
      const g = data[base + 3];
      const b = data[base + 4];
      const a = Math.max(0.0, Math.min(1.0, data[base + 5]));
      if (a > 0.00001) {
        accR += r * T;
        accG += g * T;
        accB += b * T;
        T *= (1.0 - a);
        if (T <= 0.00001) {
          T = 0.0;
          break;
        }
      }
    }
    return [accR, accG, accB, 1.0 - T];
  }

  /**
   * Converts deep buffer to 8-bit display ImageData non-destructively for viewport rasterization.
   * Supports 'flatten' (Beer-Lambert accumulation), 'depth' (normalized depth map), and 'heatmap' (sample density).
   */
  toImageData(exposureOrOptions = 0.0, gamma = 1.0, channelMode = 'RGBA', targetImageData = null, displayMode = 'flatten') {
    let exposure = 0.0;
    let mode = displayMode;
    if (typeof exposureOrOptions === 'object' && exposureOrOptions !== null) {
      exposure = exposureOrOptions.exposure ?? 0.0;
      gamma = exposureOrOptions.gamma ?? 1.0;
      channelMode = exposureOrOptions.channelMode ?? 'RGBA';
      targetImageData = exposureOrOptions.targetImageData ?? null;
      mode = exposureOrOptions.displayMode || displayMode;
    } else {
      exposure = Number(exposureOrOptions) || 0.0;
    }

    const ImageDataType = (typeof ImageData !== 'undefined') ? ImageData : class MockImageData {
      constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
    };

    const imgData = targetImageData || new ImageDataType(this.width, this.height);
    const dst = imgData.data;
    const offsets = this.sampleOffsets;
    const data = this.sampleData;
    const totalPx = this.totalPixels;

    const exposureMult = Math.pow(2.0, exposure);
    const invGamma = 1.0 / Math.max(0.001, gamma);

    if (mode === 'heatmap') {
      for (let p = 0; p < totalPx; p++) {
        const count = offsets[p + 1] - offsets[p];
        const outIdx = p * 4;
        if (count === 0) {
          dst[outIdx] = 16; dst[outIdx + 1] = 16; dst[outIdx + 2] = 20; dst[outIdx + 3] = 255;
        } else if (count === 1) {
          dst[outIdx] = 0; dst[outIdx + 1] = 100; dst[outIdx + 2] = 255; dst[outIdx + 3] = 255;
        } else if (count === 2) {
          dst[outIdx] = 0; dst[outIdx + 1] = 220; dst[outIdx + 2] = 220; dst[outIdx + 3] = 255;
        } else if (count === 3) {
          dst[outIdx] = 50; dst[outIdx + 1] = 220; dst[outIdx + 2] = 50; dst[outIdx + 3] = 255;
        } else if (count === 4) {
          dst[outIdx] = 240; dst[outIdx + 1] = 220; dst[outIdx + 2] = 0; dst[outIdx + 3] = 255;
        } else if (count <= 7) {
          dst[outIdx] = 255; dst[outIdx + 1] = 140; dst[outIdx + 2] = 0; dst[outIdx + 3] = 255;
        } else {
          dst[outIdx] = 255; dst[outIdx + 1] = 0; dst[outIdx + 2] = 128; dst[outIdx + 3] = 255;
        }
      }
      return imgData;
    }

    if (mode === 'depth') {
      let minZ = 1e9, maxZ = -1e9;
      for (let p = 0; p < totalPx; p++) {
        const start = offsets[p];
        const count = offsets[p + 1] - start;
        if (count > 0) {
          const zF = data[start * 6];
          if (zF < minZ) minZ = zF;
          if (zF > maxZ) maxZ = zF;
        }
      }
      if (minZ >= maxZ) { minZ = 0; maxZ = 1; }
      const range = maxZ - minZ || 1.0;

      for (let p = 0; p < totalPx; p++) {
        const start = offsets[p];
        const count = offsets[p + 1] - start;
        const outIdx = p * 4;
        if (count === 0) {
          dst[outIdx] = 0; dst[outIdx + 1] = 0; dst[outIdx + 2] = 0; dst[outIdx + 3] = 255;
        } else {
          const zF = data[start * 6];
          const norm = Math.max(0, Math.min(1, (zF - minZ) / range));
          const byteVal = Math.round(norm * 255);
          dst[outIdx] = byteVal;
          dst[outIdx + 1] = byteVal;
          dst[outIdx + 2] = byteVal;
          dst[outIdx + 3] = 255;
        }
      }
      return imgData;
    }

    // Default: Beer-Lambert accumulation
    for (let p = 0; p < totalPx; p++) {
      const start = offsets[p];
      const count = offsets[p + 1] - start;
      const outIdx = p * 4;
      if (count === 0) {
        dst[outIdx] = 0; dst[outIdx + 1] = 0; dst[outIdx + 2] = 0; dst[outIdx + 3] = 0;
        continue;
      }

      let accR = 0, accG = 0, accB = 0, T = 1.0;
      for (let i = 0; i < count; i++) {
        const base = (start + i) * 6;
        const r = data[base + 2];
        const g = data[base + 3];
        const b = data[base + 4];
        const a = Math.max(0.0, Math.min(1.0, data[base + 5]));
        if (a > 0.00001) {
          accR += r * T;
          accG += g * T;
          accB += b * T;
          T *= (1.0 - a);
          if (T <= 0.00001) { T = 0.0; break; }
        }
      }

      let r = accR * exposureMult;
      let g = accG * exposureMult;
      let b = accB * exposureMult;
      let a = 1.0 - T;

      if (channelMode === 'RGB') {
        a = 1.0;
      } else if (channelMode === 'RED') {
        g = r; b = r; a = 1.0;
      } else if (channelMode === 'GREEN') {
        r = g; b = g; a = 1.0;
      } else if (channelMode === 'BLUE') {
        r = b; g = b; a = 1.0;
      } else if (channelMode === 'ALPHA') {
        r = a; g = a; b = a; a = 1.0;
      } else if (channelMode === 'LUMA') {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma; g = luma; b = luma; a = 1.0;
      }

      dst[outIdx] = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, r), invGamma) * 255)));
      dst[outIdx + 1] = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, g), invGamma) * 255)));
      dst[outIdx + 2] = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, b), invGamma) * 255)));
      dst[outIdx + 3] = Math.min(255, Math.max(0, Math.round(a * 255)));
    }

    return imgData;
  }

  /**
   * Generates a non-destructive standard 2D PixelBuffer copy with synthesized depth.Z AOV
   * @param {string} [primaryMode='first']
   * @returns {PixelBuffer}
   */
  flattenToPixelBuffer(primaryMode = 'first') {
    const out = new PixelBuffer(this.width, this.height);
    const depthAOV = new Float32Array(this.totalPixels);
    const offsets = this.sampleOffsets;
    const data = this.sampleData;
    const outData = out.data;

    for (let p = 0; p < this.totalPixels; p++) {
      const start = offsets[p];
      const count = offsets[p + 1] - start;
      if (count === 0) continue;

      let accR = 0, accG = 0, accB = 0, T = 1.0;
      let primaryZ = 0.0;
      let maxSampleAlpha = -1.0;

      for (let i = 0; i < count; i++) {
        const base = (start + i) * 6;
        const zF = data[base];
        const zB = data[base + 1];
        const r = data[base + 2];
        const g = data[base + 3];
        const b = data[base + 4];
        const a = Math.max(0.0, Math.min(1.0, data[base + 5]));

        if (a > 0.00001) {
          if (primaryMode === 'first' && primaryZ === 0.0) primaryZ = zF;
          else if (primaryMode === 'midpoint' && primaryZ === 0.0) primaryZ = (zF + zB) * 0.5;
          else if (primaryMode === 'maxAlpha' && a > maxSampleAlpha) {
            maxSampleAlpha = a;
            primaryZ = zF;
          }

          accR += r * T;
          accG += g * T;
          accB += b * T;
          T *= (1.0 - a);
          if (T <= 0.00001) { T = 0.0; break; }
        }
      }

      const outIdx = p * 4;
      outData[outIdx] = accR;
      outData[outIdx + 1] = accG;
      outData[outIdx + 2] = accB;
      outData[outIdx + 3] = 1.0 - T;
      depthAOV[p] = primaryZ;
    }

    out.setChannel('depth.Z', depthAOV);
    if (this.bbox) out.bbox = this.bbox.clone();
    if (this.metadata) out.metadata = JSON.parse(JSON.stringify(this.metadata));
    return out;
  }
}
