/**
 * OpenComp - EdgeBlur Node
 * Softens only the edges of an alpha matte or composite without blurring the core.
 * Essential in Foundry Nuke for hair, spill cleanup, and edge integration.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class EdgeBlurNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'EdgeBlur', 'Filter', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    this.addKnob('size', 'Blur Size', 'number', 3.0, { min: 0.0, max: 20.0, step: 0.5 });
    this.addKnob('edgeWidth', 'Edge Width', 'number', 2.0, { min: 1.0, max: 10.0, step: 0.5 });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const size = Number(this.getKnobValue('size')) ?? 3.0;
    const edgeW = Number(this.getKnobValue('edgeWidth')) ?? 2.0;
    if (size <= 0.01) return inputBuf.clone();

    const w = inputBuf.width;
    const h = inputBuf.height;
    const src = inputBuf.data;
    const result = new PixelBuffer(w, h);
    const dst = result.data;

    // 1. Compute Alpha Gradient / Edge Detect
    const edgeMatte = new Float32Array(w * h);
    const radius = Math.round(edgeW);

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const aL = src[(row + (x - 1)) * 4 + 3];
        const aR = src[(row + (x + 1)) * 4 + 3];
        const aT = src[((y - 1) * w + x) * 4 + 3];
        const aB = src[((y + 1) * w + x) * 4 + 3];

        const dx = (aR - aL) * 0.5;
        const dy = (aB - aT) * 0.5;
        const grad = Math.min(1.0, Math.sqrt(dx * dx + dy * dy) * 4.0);
        edgeMatte[row + x] = grad;
      }
    }

    // 2. Perform Box Blur on input
    const blurRadius = Math.round(size);
    const temp = new Float32Array(w * h * 4);

    // Horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let k = -blurRadius; k <= blurRadius; k++) {
          const sx = Math.max(0, Math.min(w - 1, x + k));
          const idx = (row + sx) * 4;
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          a += src[idx + 3];
          count++;
        }
        const outIdx = (row + x) * 4;
        temp[outIdx] = r / count;
        temp[outIdx + 1] = g / count;
        temp[outIdx + 2] = b / count;
        temp[outIdx + 3] = a / count;
      }
    }

    // Vertical + Mix with original based on edgeMatte
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let k = -blurRadius; k <= blurRadius; k++) {
          const sy = Math.max(0, Math.min(h - 1, y + k));
          const idx = (sy * w + x) * 4;
          r += temp[idx];
          g += temp[idx + 1];
          b += temp[idx + 2];
          a += temp[idx + 3];
          count++;
        }

        const outIdx = (y * w + x) * 4;
        const origR = src[outIdx];
        const origG = src[outIdx + 1];
        const origB = src[outIdx + 2];
        const origA = src[outIdx + 3];

        const blurredR = r / count;
        const blurredG = g / count;
        const blurredB = b / count;
        const blurredA = a / count;

        const weight = edgeMatte[y * w + x];

        dst[outIdx] = origR * (1.0 - weight) + blurredR * weight;
        dst[outIdx + 1] = origG * (1.0 - weight) + blurredG * weight;
        dst[outIdx + 2] = origB * (1.0 - weight) + blurredB * weight;
        dst[outIdx + 3] = origA * (1.0 - weight) + blurredA * weight;
      }
    }

    return result;
  }
}

