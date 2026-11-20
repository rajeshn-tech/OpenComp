/**
 * OpenComp - Grade Node
 * High-performance implementation of Foundry Nuke's Grade algorithm.
 * Optimized with branch hoisting, transcendental power elimination for linear gamma,
 * and direct memory writing.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class GradeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Grade', 'Color', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'mask (Optional)');

    this.addKnob('blackpoint', 'Blackpoint', 'number', 0.0, { min: -1.0, max: 2.0, step: 0.005 });
    this.addKnob('whitepoint', 'Whitepoint', 'number', 1.0, { min: 0.01, max: 5.0, step: 0.01 });
    this.addKnob('lift', 'Lift', 'number', 0.0, { min: -1.0, max: 2.0, step: 0.01 });
    this.addKnob('gain', 'Gain', 'number', 1.0, { min: 0.0, max: 5.0, step: 0.01 });
    this.addKnob('multiply', 'Multiply', 'number', 1.0, { min: 0.0, max: 5.0, step: 0.01 });
    this.addKnob('offset', 'Offset', 'number', 0.0, { min: -1.0, max: 1.0, step: 0.005 });
    this.addKnob('gamma', 'Gamma', 'number', 1.0, { min: 0.1, max: 4.0, step: 0.01 });
    this.addKnob('blackClamp', 'Black Clamp', 'boolean', true);
    this.addKnob('whiteClamp', 'White Clamp', 'boolean', false);
    this.addKnob('reverse', 'Reverse', 'boolean', false);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    if (this.disabled) return inputBuf.clone();

    const maskBuf = inputs['mask'];
    const isTiled = !!inputBuf.isTiled;

    const bp = Number(this.getKnobValue('blackpoint', context)) ?? 0.0;
    const wp = Math.max(0.0001, Number(this.getKnobValue('whitepoint', context)) ?? 1.0);
    const lift = Number(this.getKnobValue('lift', context)) ?? 0.0;
    const gain = Number(this.getKnobValue('gain', context)) ?? 1.0;
    const mult = Number(this.getKnobValue('multiply', context)) ?? 1.0;
    const offset = Number(this.getKnobValue('offset', context)) ?? 0.0;
    const gamma = Math.max(0.0001, Number(this.getKnobValue('gamma', context)) ?? 1.0);
    const blackClamp = !!this.getKnobValue('blackClamp', context);
    const whiteClamp = !!this.getKnobValue('whiteClamp', context);
    const reverse = !!this.getKnobValue('reverse', context);

    // Nuke Grade mathematical terms
    const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
    const A = mult * (gain - lift) / denom;
    const B = offset + lift - A * bp;
    const invGamma = 1.0 / gamma;
    const isLinearGamma = Math.abs(gamma - 1.0) < 1e-5;

    const params = { A, B, gamma, invGamma, isLinearGamma, blackClamp, whiteClamp, reverse };

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          const maskTile = (maskBuf && maskBuf.isTiled) ? maskBuf.getTile(c, r) : null;
          this._applyGrade(inTile.data, outTile.data, maskTile ? maskTile.data : null, inTile.data.length, params);
        }
      }
      return result;
    }

    const resampledMask = (maskBuf && (maskBuf.width !== inputBuf.width || maskBuf.height !== inputBuf.height))
      ? maskBuf.resample(inputBuf.width, inputBuf.height)
      : maskBuf;

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    this._applyGrade(inputBuf.data, result.data, resampledMask ? resampledMask.data : null, inputBuf.data.length, params);
    return result;
  }

  _applyGrade(src, dst, mask, len, params) {
    const { A, B, gamma, invGamma, isLinearGamma, blackClamp, whiteClamp, reverse } = params;

    // Fast Path: Unmasked Grade
    if (!mask) {
      if (!reverse) {
        if (isLinearGamma) {
          // Ultra-fast linear grade (gain + lift + multiply without pow)
          for (let i = 0; i < len; i += 4) {
            let r = A * src[i] + B;
            let g = A * src[i + 1] + B;
            let b = A * src[i + 2] + B;
            if (blackClamp) {
              if (r < 0) r = 0;
              if (g < 0) g = 0;
              if (b < 0) b = 0;
            }
            if (whiteClamp) {
              if (r > 1) r = 1;
              if (g > 1) g = 1;
              if (b > 1) b = 1;
            }
            dst[i] = r;
            dst[i + 1] = g;
            dst[i + 2] = b;
            dst[i + 3] = src[i + 3];
          }
        } else {
          // Standard non-linear grade with gamma curve
          for (let i = 0; i < len; i += 4) {
            let r = A * src[i] + B;
            let g = A * src[i + 1] + B;
            let b = A * src[i + 2] + B;
            if (r > 0) r = Math.pow(r, invGamma); else if (blackClamp) r = 0;
            if (g > 0) g = Math.pow(g, invGamma); else if (blackClamp) g = 0;
            if (b > 0) b = Math.pow(b, invGamma); else if (blackClamp) b = 0;
            if (whiteClamp) {
              if (r > 1) r = 1;
              if (g > 1) g = 1;
              if (b > 1) b = 1;
            }
            dst[i] = r;
            dst[i + 1] = g;
            dst[i + 2] = b;
            dst[i + 3] = src[i + 3];
          }
        }
      } else {
        // Reverse Grade
        for (let i = 0; i < len; i += 4) {
          let r = src[i];
          let g = src[i + 1];
          let b = src[i + 2];
          if (!isLinearGamma) {
            if (r > 0) r = Math.pow(r, gamma);
            if (g > 0) g = Math.pow(g, gamma);
            if (b > 0) b = Math.pow(b, gamma);
          }
          if (A !== 0) {
            r = (r - B) / A;
            g = (g - B) / A;
            b = (b - B) / A;
          }
          if (blackClamp) {
            if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
          }
          if (whiteClamp) {
            if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
          }
          dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
        }
      }
      return;
    }

    // Masked Grade Path
    for (let i = 0; i < len; i += 4) {
      const maskVal = mask[i + 3];
      const invM = 1.0 - maskVal;

      for (let c = 0; c < 3; c++) {
        const origVal = src[i + c];
        let val = origVal;

        if (!reverse) {
          val = A * val + B;
          if (val > 0) {
            if (!isLinearGamma) val = Math.pow(val, invGamma);
          } else if (blackClamp) {
            val = 0;
          }
        } else {
          if (val > 0 && !isLinearGamma) val = Math.pow(val, gamma);
          if (A !== 0) val = (val - B) / A;
        }

        if (blackClamp && val < 0) val = 0;
        if (whiteClamp && val > 1) val = 1;

        dst[i + c] = origVal * invM + val * maskVal;
      }

      dst[i + 3] = src[i + 3];
    }
  }
}
