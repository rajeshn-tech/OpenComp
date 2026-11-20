/**
 * OpenComp - Glow Node
 * Simulates optical bloom and light dispersion around highlights with thresholding, 
 * multi-pass Gaussian diffusion, chromatic tinting, and mask isolation (industry standard Glow).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class GlowNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Glow', 'Filter', x, y);

    this.addInput('in', 'Input');
    this.addInput('mask', 'Mask');

    this.addKnob('tolerance', 'Tolerance', 'float', 0.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('brightness', 'Brightness', 'float', 1.0, { min: 0.0, max: 10.0, step: 0.1 });
    this.addKnob('size', 'Size', 'float', 15.0, { min: 0.0, max: 200.0, step: 1.0 });
    this.addKnob('tintR', 'Tint Red', 'float', 1.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('tintG', 'Tint Green', 'float', 1.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('tintB', 'Tint Blue', 'float', 1.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('effectOnly', 'Effect Only', 'boolean', false);
    this.addKnob('mix', 'Mix', 'float', 1.0, { min: 0.0, max: 1.0, step: 0.05 });
  }

  /**
   * Determine output dynamic BBox: expands input by bloom filter radius
   * @param {Object.<string, PixelBuffer>} inputBuffers 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputBuffers, context = {}) {
    const input = inputBuffers['in'] || inputBuffers['input'] || inputBuffers[0];
    if (!input) return new BBox(0, 0, 0, 0);

    const box = input.bbox ? input.bbox.clone() : BBox.fromFormat(input.width, input.height);
    const rawSize = this.getKnobValue('size', context);
    const size = Math.max(0.0, rawSize !== undefined && rawSize !== null && !isNaN(Number(rawSize)) ? Number(rawSize) : 15.0);

    if (size <= 0.01) return box;

    // Multi-pass Gaussian bloom filter support expands footprint by 2.5 * size
    const pad = Math.ceil(size * 2.5);
    return box.expanded(pad);
  }

  compute(inputBuffers, context = {}) {
    const input = inputBuffers['in'] || inputBuffers['input'] || inputBuffers[0];
    if (!input) return null;

    if (this.disabled) return input.clone();

    const w = input.width;
    const h = input.height;
    const tolerance = Number(this.getKnobValue('tolerance', context)) || 0.0;
    const brightness = Number(this.getKnobValue('brightness', context)) || 1.0;
    const rawSize = this.getKnobValue('size', context);
    const size = Math.max(0.0, rawSize !== undefined && rawSize !== null && !isNaN(Number(rawSize)) ? Number(rawSize) : 15.0);
    const tintR = Number(this.getKnobValue('tintR', context)) ?? 1.0;
    const tintG = Number(this.getKnobValue('tintG', context)) ?? 1.0;
    const tintB = Number(this.getKnobValue('tintB', context)) ?? 1.0;
    const effectOnly = !!this.getKnobValue('effectOnly', context);
    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));
    const mask = inputBuffers['mask'];

    // 1. Extract thresholded highlights above tolerance
    const highlightBuf = new PixelBuffer(w, h);
    const srcData = input.data;
    const hlData = highlightBuf.data;
    const numPixels = w * h;

    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const r = srcData[idx];
      const g = srcData[idx + 1];
      const b = srcData[idx + 2];
      const a = srcData[idx + 3];

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma > tolerance) {
        const factor = (luma - tolerance) / Math.max(0.0001, luma);
        hlData[idx] = r * factor;
        hlData[idx + 1] = g * factor;
        hlData[idx + 2] = b * factor;
        hlData[idx + 3] = a * factor;
      }
    }

    // 2. Blur highlights with separable 2-pass Gaussian kernel
    let blurredBuf = highlightBuf;
    if (size > 0.5) {
      blurredBuf = this.gaussianBlur(highlightBuf, size);
    }

    // 3. Composite glow over original
    const outBuf = new PixelBuffer(w, h);
    const outData = outBuf.data;
    const glowData = blurredBuf.data;

    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const sr = srcData[idx];
      const sg = srcData[idx + 1];
      const sb = srcData[idx + 2];
      const sa = srcData[idx + 3];

      const gr = glowData[idx] * brightness * tintR;
      const gg = glowData[idx + 1] * brightness * tintG;
      const gb = glowData[idx + 2] * brightness * tintB;
      const ga = glowData[idx + 3] * brightness;

      let finR, finG, finB, finA;
      if (effectOnly) {
        finR = gr;
        finG = gg;
        finB = gb;
        finA = ga;
      } else {
        // Glow math: Base + Glow
        finR = sr + gr;
        finG = sg + gg;
        finB = sb + gb;
        finA = Math.max(sa, ga);
      }

      // Mix with original input
      let m = mix;
      if (mask) {
        const maskAlpha = mask.data[idx + 3];
        m *= maskAlpha;
      }

      outData[idx] = sr + (finR - sr) * m;
      outData[idx + 1] = sg + (finG - sg) * m;
      outData[idx + 2] = sb + (finB - sb) * m;
      outData[idx + 3] = sa + (finA - sa) * m;
    }

    outBuf.bbox = this.getBBox(inputBuffers, context);
    outBuf.copyChannelsFrom(input);
    return outBuf;
  }

  gaussianBlur(src, radius) {
    const w = src.width;
    const h = src.height;
    const sigma = Math.max(0.1, radius / 2.0);
    const kernelSize = Math.min(61, Math.max(3, Math.ceil(sigma * 3) * 2 + 1));
    const half = Math.floor(kernelSize / 2);

    const weights = new Float32Array(kernelSize);
    let sum = 0.0;
    for (let i = 0; i < kernelSize; i++) {
      const x = i - half;
      const g = Math.exp(-(x * x) / (2.0 * sigma * sigma));
      weights[i] = g;
      sum += g;
    }
    for (let i = 0; i < kernelSize; i++) {
      weights[i] /= sum;
    }

    const temp = new PixelBuffer(w, h);
    const srcData = src.data;
    const tempData = temp.data;

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleX = Math.min(w - 1, Math.max(0, x + k - half));
          const idx = (rowOffset + sampleX) * 4;
          const wt = weights[k];
          r += srcData[idx] * wt;
          g += srcData[idx + 1] * wt;
          b += srcData[idx + 2] * wt;
          a += srcData[idx + 3] * wt;
        }
        const outIdx = (rowOffset + x) * 4;
        tempData[outIdx] = r;
        tempData[outIdx + 1] = g;
        tempData[outIdx + 2] = b;
        tempData[outIdx + 3] = a;
      }
    }

    // Vertical pass
    const dst = new PixelBuffer(w, h);
    const dstData = dst.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleY = Math.min(h - 1, Math.max(0, y + k - half));
          const idx = (sampleY * w + x) * 4;
          const wt = weights[k];
          r += tempData[idx] * wt;
          g += tempData[idx + 1] * wt;
          b += tempData[idx + 2] * wt;
          a += tempData[idx + 3] * wt;
        }
        const outIdx = (y * w + x) * 4;
        dstData[outIdx] = r;
        dstData[outIdx + 1] = g;
        dstData[outIdx + 2] = b;
        dstData[outIdx + 3] = a;
      }
    }

    return dst;
  }
}

