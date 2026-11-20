/**
 * OpenComp - EdgeExtend Node
 * Smears and extends valid foreground colors outward across semi-transparent 
 * and transparent edge pixels to eliminate dark, white, and colored edge fringes (industry standard EdgeExtend).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class EdgeExtendNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'EdgeExtend', 'Keyer', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');

    this.addKnob('slices', 'Slices / Dilations', 'number', 4, { min: 1, max: 16, step: 1 });
    this.addKnob('edgeAlpha', 'Edge Alpha Threshold', 'number', 0.1, { min: 0.01, max: 0.9, step: 0.01 });
    this.addKnob('outputMode', 'Output Mode', 'select', 'premultiplied', {
      options: [
        { label: 'Premultiplied (Clean Fringe)', value: 'premultiplied' },
        { label: 'Unpremultiplied Extended RGB', value: 'extended_rgb' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inBuf = inputs['in'];
    if (!inBuf) return null;

    if (this.disabled) return inBuf.clone();

    const w = inBuf.width;
    const h = inBuf.height;
    const len = w * h;

    const slices = Math.max(1, Math.min(16, Math.round(Number(this.getKnobValue('slices', context)) ?? 4)));
    const edgeAlpha = Math.max(0.001, Number(this.getKnobValue('edgeAlpha', context)) ?? 0.1);
    const mode = this.getKnobValue('outputMode', context) || 'premultiplied';

    const result = new PixelBuffer(w, h);
    result.bbox = this.getBBox(inputs, context);
    result.copyChannelsFrom(inBuf);

    const src = inBuf.data;
    const dst = result.data;

    // Working buffers: RGB un-premultiplied color and mask of valid pixels
    let curR = new Float32Array(len);
    let curG = new Float32Array(len);
    let curB = new Float32Array(len);
    let valid = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      const a = src[idx + 3];
      if (a >= edgeAlpha) {
        // Un-premultiply opaque/solid core
        const invA = 1.0 / Math.max(0.001, a);
        curR[i] = src[idx] * invA;
        curG[i] = src[idx + 1] * invA;
        curB[i] = src[idx + 2] * invA;
        valid[i] = 1;
      } else {
        curR[i] = src[idx];
        curG[i] = src[idx + 1];
        curB[i] = src[idx + 2];
        valid[i] = 0;
      }
    }

    // Iterative 8-neighbor color smearing / dilation
    for (let s = 0; s < slices; s++) {
      const nextR = new Float32Array(curR);
      const nextG = new Float32Array(curG);
      const nextB = new Float32Array(curB);
      const nextValid = new Uint8Array(valid);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (valid[idx] === 1) continue; // Already valid

          // Sample 8-neighbors
          let sumR = 0.0, sumG = 0.0, sumB = 0.0, count = 0;

          const y0 = Math.max(0, y - 1);
          const y1 = Math.min(h - 1, y + 1);
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(w - 1, x + 1);

          for (let ny = y0; ny <= y1; ny++) {
            const row = ny * w;
            for (let nx = x0; nx <= x1; nx++) {
              const nIdx = row + nx;
              if (valid[nIdx] === 1) {
                sumR += curR[nIdx];
                sumG += curG[nIdx];
                sumB += curB[nIdx];
                count++;
              }
            }
          }

          if (count > 0) {
            const invCount = 1.0 / count;
            nextR[idx] = sumR * invCount;
            nextG[idx] = sumG * invCount;
            nextB[idx] = sumB * invCount;
            nextValid[idx] = 1;
          }
        }
      }

      curR = nextR;
      curG = nextG;
      curB = nextB;
      valid = nextValid;
    }

    // Write output
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      const origA = src[idx + 3];

      if (mode === 'extended_rgb') {
        dst[idx] = curR[i];
        dst[idx + 1] = curG[i];
        dst[idx + 2] = curB[i];
        dst[idx + 3] = origA;
      } else {
        // Re-premultiply by original alpha matte
        dst[idx] = curR[i] * origA;
        dst[idx + 1] = curG[i] * origA;
        dst[idx + 2] = curB[i] * origA;
        dst[idx + 3] = origA;
      }
    }

    return result;
  }
}

