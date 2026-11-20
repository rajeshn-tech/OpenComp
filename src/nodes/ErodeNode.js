/**
 * OpenComp - Erode / Dilate Node
 * Morphological filter to grow (dilate) or shrink (erode) alpha mattes and RGB channels.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class ErodeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Erode', 'Filter', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    // Positive size = Dilate (expand matte), Negative size = Erode (shrink matte)
    this.addKnob('size', 'Size (+Dilate / -Erode)', 'number', -2.0, { min: -20.0, max: 20.0, step: 0.5 });
    this.addKnob('channels', 'Channels', 'select', 'alpha', {
      options: [
        { label: 'Alpha Only', value: 'alpha' },
        { label: 'RGBA', value: 'rgba' }
      ]
    });
  }

  /**
   * Determine output dynamic BBox: expands on dilation (size > 0), contracts on erosion (size < 0)
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return new BBox(0, 0, 0, 0);

    const size = Number(this.getKnobValue('size', context)) ?? 0.0;
    const box = inputBuf.bbox ? inputBuf.bbox.clone() : BBox.fromFormat(inputBuf.width, inputBuf.height);

    if (Math.abs(size) < 0.01) return box;

    if (size > 0) {
      // Dilation: grows matte outwards by size
      const rad = Math.round(size);
      return box.expanded(rad);
    } else {
      // Erosion: shrinks matte inwards by |size|
      const rad = Math.round(Math.abs(size));
      if (box.width <= 2 * rad || box.height <= 2 * rad) {
        return new BBox(0, 0, 0, 0);
      }
      return box.expanded(-rad);
    }
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const size = Number(this.getKnobValue('size')) ?? 0.0;
    if (Math.abs(size) < 0.1) return inputBuf.clone();

    const w = inputBuf.width;
    const h = inputBuf.height;
    const radius = Math.min(25, Math.max(1, Math.round(Math.abs(size))));
    const isDilate = size > 0;
    const channels = this.getKnobValue('channels') || 'alpha';

    const src = inputBuf.data;
    const temp = new Float32Array(w * h * 4);
    const result = new PixelBuffer(w, h);
    const dst = result.data;

    // Pass 1: Horizontal min/max
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const outIdx = (rowOffset + x) * 4;

        if (channels === 'alpha') {
          let extremeA = isDilate ? -Infinity : Infinity;
          for (let k = -radius; k <= radius; k++) {
            const sx = Math.max(0, Math.min(w - 1, x + k));
            const valA = src[(rowOffset + sx) * 4 + 3];
            if (isDilate) {
              if (valA > extremeA) extremeA = valA;
            } else {
              if (valA < extremeA) extremeA = valA;
            }
          }
          temp[outIdx] = src[outIdx];
          temp[outIdx + 1] = src[outIdx + 1];
          temp[outIdx + 2] = src[outIdx + 2];
          temp[outIdx + 3] = extremeA;
        } else {
          let exR = isDilate ? -Infinity : Infinity;
          let exG = isDilate ? -Infinity : Infinity;
          let exB = isDilate ? -Infinity : Infinity;
          let exA = isDilate ? -Infinity : Infinity;
          for (let k = -radius; k <= radius; k++) {
            const sx = Math.max(0, Math.min(w - 1, x + k));
            const idx = (rowOffset + sx) * 4;
            if (isDilate) {
              if (src[idx] > exR) exR = src[idx];
              if (src[idx + 1] > exG) exG = src[idx + 1];
              if (src[idx + 2] > exB) exB = src[idx + 2];
              if (src[idx + 3] > exA) exA = src[idx + 3];
            } else {
              if (src[idx] < exR) exR = src[idx];
              if (src[idx + 1] < exG) exG = src[idx + 1];
              if (src[idx + 2] < exB) exB = src[idx + 2];
              if (src[idx + 3] < exA) exA = src[idx + 3];
            }
          }
          temp[outIdx] = exR;
          temp[outIdx + 1] = exG;
          temp[outIdx + 2] = exB;
          temp[outIdx + 3] = exA;
        }
      }
    }

    // Pass 2: Vertical min/max
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const outIdx = (y * w + x) * 4;

        if (channels === 'alpha') {
          let extremeA = isDilate ? -Infinity : Infinity;
          for (let k = -radius; k <= radius; k++) {
            const sy = Math.max(0, Math.min(h - 1, y + k));
            const valA = temp[(sy * w + x) * 4 + 3];
            if (isDilate) {
              if (valA > extremeA) extremeA = valA;
            } else {
              if (valA < extremeA) extremeA = valA;
            }
          }
          dst[outIdx] = temp[outIdx];
          dst[outIdx + 1] = temp[outIdx + 1];
          dst[outIdx + 2] = temp[outIdx + 2];
          dst[outIdx + 3] = extremeA;
        } else {
          let exR = isDilate ? -Infinity : Infinity;
          let exG = isDilate ? -Infinity : Infinity;
          let exB = isDilate ? -Infinity : Infinity;
          let exA = isDilate ? -Infinity : Infinity;
          for (let k = -radius; k <= radius; k++) {
            const sy = Math.max(0, Math.min(h - 1, y + k));
            const idx = (sy * w + x) * 4;
            if (isDilate) {
              if (temp[idx] > exR) exR = temp[idx];
              if (temp[idx + 1] > exG) exG = temp[idx + 1];
              if (temp[idx + 2] > exB) exB = temp[idx + 2];
              if (temp[idx + 3] > exA) exA = temp[idx + 3];
            } else {
              if (temp[idx] < exR) exR = temp[idx];
              if (temp[idx + 1] < exG) exG = temp[idx + 1];
              if (temp[idx + 2] < exB) exB = temp[idx + 2];
              if (temp[idx + 3] < exA) exA = temp[idx + 3];
            }
          }
          dst[outIdx] = exR;
          dst[outIdx + 1] = exG;
          dst[outIdx + 2] = exB;
          dst[outIdx + 3] = exA;
        }
      }
    }

    result.bbox = this.getBBox(inputs, context);
    result.copyChannelsFrom(inputBuf);
    return result;
  }
}

