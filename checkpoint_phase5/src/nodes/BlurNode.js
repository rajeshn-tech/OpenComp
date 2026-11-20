/**
 * OpenComp - High-Performance Separable Gaussian Blur Node
 * Exact Foundry Nuke Gaussian convolution with separable horizontal and vertical passes,
 * boundary clamping, energy conservation, channel masking, and memory recycling.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { globalBufferPool } from '../core/BufferPool.js';

export class BlurNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Blur', 'Filter', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'mask (Optional)');

    this.addKnob('size', 'Size', 'number', 15.0, { min: 0.0, max: 150.0, step: 0.5 });
    this.addKnob('aspectRatio', 'Aspect Ratio', 'number', 1.0, { min: 0.1, max: 10.0, step: 0.1 });
    this.addKnob('channels', 'Channels', 'select', 'rgba', {
      options: [
        { label: 'RGBA', value: 'rgba' },
        { label: 'RGB', value: 'rgb' },
        { label: 'Alpha Only', value: 'alpha' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    if (this.disabled) return inputBuf.clone();

    const size = Math.max(0, Number(this.getKnobValue('size', context)) ?? 0.0);
    if (size <= 0.001) return inputBuf.clone();

    const maskBuf = inputs['mask'];
    const resampledMask = (maskBuf && (maskBuf.width !== inputBuf.width || maskBuf.height !== inputBuf.height))
      ? maskBuf.resample(inputBuf.width, inputBuf.height)
      : maskBuf;

    const aspect = Number(this.getKnobValue('aspectRatio', context)) ?? 1.0;
    const radiusX = Math.max(0, Math.round(size * aspect));
    const radiusY = Math.max(0, Math.round(size));
    const w = inputBuf.width;
    const h = inputBuf.height;
    const channels = (this.getKnobValue('channels', context) || 'rgba').toLowerCase();

    const doRGB = (channels === 'rgba' || channels === 'rgb');
    const doAlpha = (channels === 'rgba' || channels === 'alpha');

    const src = inputBuf.data;
    const result = new PixelBuffer(w, h);
    const dst = result.data;
    const mask = resampledMask ? resampledMask.data : null;

    // Acquire scratch memory from global pool
    const temp = globalBufferPool.acquireForImage(w, h);

    try {
      // 1. Generate 1D Gaussian kernels normalized to sum to 1.0
      const kernelX = this.makeGaussianKernel(radiusX);
      const kernelY = this.makeGaussianKernel(radiusY);

      // 2. Horizontal Pass: src -> temp (with clamp to edge)
      const kLenX = kernelX.length;
      for (let y = 0; y < h; y++) {
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          let kIdx = 0;
          for (let k = -radiusX; k <= radiusX; k++) {
            const sampleX = Math.max(0, Math.min(w - 1, x + k));
            const idx = (rowOffset + sampleX) * 4;
            const wt = kernelX[kIdx++];
            r += src[idx] * wt;
            g += src[idx + 1] * wt;
            b += src[idx + 2] * wt;
            a += src[idx + 3] * wt;
          }
          const outIdx = (rowOffset + x) * 4;
          temp[outIdx] = r;
          temp[outIdx + 1] = g;
          temp[outIdx + 2] = b;
          temp[outIdx + 3] = a;
        }
      }

      // 3. Vertical Pass: temp -> dst (Cache-friendly row accumulation)
      const rowElements = w * 4;
      for (let y = 0; y < h; y++) {
        const dstRowOffset = y * rowElements;
        dst.fill(0, dstRowOffset, dstRowOffset + rowElements);

        let kIdx = 0;
        for (let k = -radiusY; k <= radiusY; k++) {
          const sampleY = Math.max(0, Math.min(h - 1, y + k));
          const srcRowOffset = sampleY * rowElements;
          const wt = kernelY[kIdx++];

          for (let i = 0; i < rowElements; i++) {
            dst[dstRowOffset + i] += temp[srcRowOffset + i] * wt;
          }
        }
      }

      // 4. Channel isolation
      if (!doRGB) {
        const total = w * h * 4;
        for (let i = 0; i < total; i += 4) {
          dst[i] = src[i];
          dst[i + 1] = src[i + 1];
          dst[i + 2] = src[i + 2];
        }
      }
      if (!doAlpha) {
        const total = w * h * 4;
        for (let i = 0; i < total; i += 4) {
          dst[i + 3] = src[i + 3];
        }
      }

      // 5. Mask blending
      if (mask) {
        const total = w * h * 4;
        for (let i = 0; i < total; i += 4) {
          const m = mask[i + 3];
          if (m < 0.999) {
            dst[i] = src[i] * (1.0 - m) + dst[i] * m;
            dst[i + 1] = src[i + 1] * (1.0 - m) + dst[i + 1] * m;
            dst[i + 2] = src[i + 2] * (1.0 - m) + dst[i + 2] * m;
            dst[i + 3] = src[i + 3] * (1.0 - m) + dst[i + 3] * m;
          }
        }
      }
    } finally {
      globalBufferPool.release(temp);
    }

    return result;
  }

  makeGaussianKernel(radius) {
    if (radius <= 0) return new Float32Array([1.0]);
    const sigma = Math.max(0.1, radius / 2.5);
    const len = radius * 2 + 1;
    const kernel = new Float32Array(len);
    let sum = 0.0;

    for (let i = -radius; i <= radius; i++) {
      const val = Math.exp(-(i * i) / (2.0 * sigma * sigma));
      kernel[i + radius] = val;
      sum += val;
    }

    for (let i = 0; i < len; i++) {
      kernel[i] /= sum;
    }

    return kernel;
  }
}
