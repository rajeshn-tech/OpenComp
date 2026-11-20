/**
 * OpenComp - MatteControl Node
 * Fine-tunes matte boundaries through morphological erosion/dilation,
 * Gaussian edge blurring, black/white point remapping, gamma, and inversion (industry standard MatteControl).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class MatteControlNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'MatteControl', 'Keyer', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'Mask (Optional)');

    this.addKnob('blackPoint', 'Black Point', 'number', 0.0, { min: 0.0, max: 0.5, step: 0.01 });
    this.addKnob('whitePoint', 'White Point', 'number', 1.0, { min: 0.5, max: 1.0, step: 0.01 });
    this.addKnob('gamma', 'Gamma', 'number', 1.0, { min: 0.2, max: 3.0, step: 0.05 });
    this.addKnob('erode', 'Erode / Dilate', 'number', 0.0, { min: -20.0, max: 20.0, step: 0.5 });
    this.addKnob('blur', 'Blur', 'number', 0.0, { min: 0.0, max: 50.0, step: 0.5 });
    this.addKnob('invert', 'Invert Matte', 'boolean', false);
    this.addKnob('mix', 'Mix', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
  }

  compute(inputs, context = {}) {
    const inBuf = inputs['in'];
    if (!inBuf) return null;

    if (this.disabled) return inBuf.clone();

    const w = inBuf.width;
    const h = inBuf.height;
    const len = w * h;

    const bp = Number(this.getKnobValue('blackPoint', context)) ?? 0.0;
    const wp = Math.max(bp + 0.001, Number(this.getKnobValue('whitePoint', context)) ?? 1.0);
    const gamma = Math.max(0.001, Number(this.getKnobValue('gamma', context)) ?? 1.0);
    const invGamma = 1.0 / gamma;
    const erode = Number(this.getKnobValue('erode', context)) ?? 0.0;
    const blurSize = Math.max(0.0, Number(this.getKnobValue('blur', context)) ?? 0.0);
    const invert = !!this.getKnobValue('invert', context);
    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));

    const result = inBuf.clone();
    result.bbox = this.getBBox(inputs, context);

    // Extract initial alpha channel
    let alpha = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      alpha[i] = inBuf.data[i * 4 + 3];
    }

    // 1. Morphological Erosion (< 0) or Dilation (> 0)
    const erodeRadius = Math.round(erode);
    if (erodeRadius !== 0) {
      const radius = Math.abs(erodeRadius);
      const isDilate = erodeRadius > 0;
      const morphed = new Float32Array(len);

      for (let y = 0; y < h; y++) {
        const yMin = Math.max(0, y - radius);
        const yMax = Math.min(h - 1, y + radius);

        for (let x = 0; x < w; x++) {
          const xMin = Math.max(0, x - radius);
          const xMax = Math.min(w - 1, x + radius);

          let extreme = isDilate ? -Infinity : Infinity;

          for (let ny = yMin; ny <= yMax; ny++) {
            const rowOffset = ny * w;
            for (let nx = xMin; nx <= xMax; nx++) {
              const val = alpha[rowOffset + nx];
              if (isDilate) {
                if (val > extreme) extreme = val;
              } else {
                if (val < extreme) extreme = val;
              }
            }
          }
          morphed[y * w + x] = extreme;
        }
      }
      alpha = morphed;
    }

    // 2. Gaussian Edge Blurring
    if (blurSize >= 0.5) {
      const bRad = Math.round(blurSize);
      const kernel = this._make1DGaussianKernel(bRad);
      const temp = new Float32Array(len);

      // Horizontal pass
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let sum = 0.0;
          for (let k = -bRad; k <= bRad; k++) {
            const sx = Math.max(0, Math.min(w - 1, x + k));
            sum += alpha[row + sx] * kernel[k + bRad];
          }
          temp[row + x] = sum;
        }
      }

      // Vertical pass
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let sum = 0.0;
          for (let k = -bRad; k <= bRad; k++) {
            const sy = Math.max(0, Math.min(h - 1, y + k));
            sum += temp[sy * w + x] * kernel[k + bRad];
          }
          alpha[row + x] = sum;
        }
      }
    }

    // 3. Tonal curve remapping (Black Point, White Point, Gamma, Invert, Mix)
    const dst = result.data;
    const src = inBuf.data;

    for (let i = 0; i < len; i++) {
      let a = alpha[i];

      // Black / White Point remapping
      if (a <= bp) a = 0.0;
      else if (a >= wp) a = 1.0;
      else a = (a - bp) / (wp - bp);

      // Gamma curve
      if (a > 0.0 && a < 1.0 && Math.abs(gamma - 1.0) > 1e-4) {
        a = Math.pow(a, invGamma);
      }

      if (invert) a = 1.0 - a;
      a = Math.max(0.0, Math.min(1.0, a));

      // Mix with original
      const origA = src[i * 4 + 3];
      dst[i * 4 + 3] = origA * (1.0 - mix) + a * mix;
    }

    return result;
  }

  _make1DGaussianKernel(radius) {
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    const sigma = Math.max(0.5, radius * 0.5);
    const twoSigmaSq = 2.0 * sigma * sigma;
    let sum = 0.0;

    for (let i = -radius; i <= radius; i++) {
      const val = Math.exp(-(i * i) / twoSigmaSq);
      kernel[i + radius] = val;
      sum += val;
    }
    const invSum = 1.0 / sum;
    for (let i = 0; i < size; i++) {
      kernel[i] *= invSum;
    }
    return kernel;
  }
}

