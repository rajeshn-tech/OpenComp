/**
 * OpenComp - Crop Node
 * Crops the image to a defined bounding rectangle with soft boundary roll-off 
 * and optional format dimension reframing (Foundry Nuke Crop).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class CropNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Crop', 'Transform', x, y);

    this.addInput('in', 'Input');

    this.addKnob('boxX', 'Box X', 'float', 0.0);
    this.addKnob('boxY', 'Box Y', 'float', 0.0);
    this.addKnob('boxR', 'Box R', 'float', 1920.0);
    this.addKnob('boxT', 'Box T', 'float', 1080.0);
    this.addKnob('softness', 'Softness', 'float', 0.0, { min: 0.0, max: 100.0, step: 1.0 });
    this.addKnob('reformat', 'Reformat', 'boolean', false);
    this.addKnob('blackOutside', 'Black Outside', 'boolean', true);
  }

  compute(inputBuffers, context = {}) {
    const input = inputBuffers['in'] || inputBuffers['input'] || inputBuffers[0];
    if (!input) return null;

    if (this.disabled) return input.clone();

    const w = input.width;
    const h = input.height;

    let x0 = Number(this.getKnobValue('boxX', context)) || 0.0;
    let y0 = Number(this.getKnobValue('boxY', context)) || 0.0;
    let x1 = Number(this.getKnobValue('boxR', context)) ?? w;
    let y1 = Number(this.getKnobValue('boxT', context)) ?? h;
    const softness = Math.max(0.0, Number(this.getKnobValue('softness', context)) || 0.0);
    const reformat = !!this.getKnobValue('reformat', context);
    const blackOutside = this.getKnobValue('blackOutside', context) !== false;

    // Ensure proper ordering
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }

    if (reformat) {
      // Reformat to new dimension
      const newW = Math.max(1, Math.round(x1 - x0));
      const newH = Math.max(1, Math.round(y1 - y0));
      const outBuf = new PixelBuffer(newW, newH);
      const outData = outBuf.data;
      const srcData = input.data;

      const originX = Math.round(x0);
      const originY = Math.round(y0);

      for (let y = 0; y < newH; y++) {
        const srcY = originY + y;
        for (let x = 0; x < newW; x++) {
          const srcX = originX + x;
          const outIdx = (y * newW + x) * 4;

          if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
            const srcIdx = (srcY * w + srcX) * 4;
            let edgeDist = softness > 0 ? Math.min(x, newW - 1 - x, y, newH - 1 - y) : softness;
            let factor = softness > 0 ? Math.min(1.0, edgeDist / softness) : 1.0;

            outData[outIdx] = srcData[srcIdx] * factor;
            outData[outIdx + 1] = srcData[srcIdx + 1] * factor;
            outData[outIdx + 2] = srcData[srcIdx + 2] * factor;
            outData[outIdx + 3] = srcData[srcIdx + 3] * factor;
          }
        }
      }
      return outBuf;
    } else {
      // In-place masking with preserved resolution
      const outBuf = new PixelBuffer(w, h);
      const outData = outBuf.data;
      const srcData = input.data;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const inside = (x >= x0 && x <= x1 && y >= y0 && y <= y1);

          if (inside) {
            let factor = 1.0;
            if (softness > 0) {
              const distX = Math.min(x - x0, x1 - x);
              const distY = Math.min(y - y0, y1 - y);
              const minDist = Math.min(distX, distY);
              factor = Math.max(0.0, Math.min(1.0, minDist / softness));
            }
            outData[idx] = srcData[idx] * factor;
            outData[idx + 1] = srcData[idx + 1] * factor;
            outData[idx + 2] = srcData[idx + 2] * factor;
            outData[idx + 3] = srcData[idx + 3] * factor;
          } else if (!blackOutside) {
            outData[idx] = srcData[idx];
            outData[idx + 1] = srcData[idx + 1];
            outData[idx + 2] = srcData[idx + 2];
            outData[idx + 3] = srcData[idx + 3];
          }
        }
      }
      return outBuf;
    }
  }
}

