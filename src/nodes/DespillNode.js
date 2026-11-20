/**
 * OpenComp - Despill Node
 * Dedicated color spill suppression node targeting green and blue screen bounce
 * using industry-standard algorithms (Average, Max, Red-Dominant, Blue-Dominant).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class DespillNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Despill', 'Keyer', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'Mask (Optional)');

    this.addKnob('screenType', 'Screen Type', 'select', 'green', {
      options: [
        { label: 'Green Spill', value: 'green' },
        { label: 'Blue Spill', value: 'blue' }
      ]
    });

    this.addKnob('algorithm', 'Algorithm', 'select', 'average', {
      options: [
        { label: 'Average (R + B) / 2', value: 'average' },
        { label: 'Max (max(R, B))', value: 'max' },
        { label: 'Red Dominant (0.7 R + 0.3 B)', value: 'red_dominant' },
        { label: 'Blue Dominant (0.7 B + 0.3 R)', value: 'blue_dominant' }
      ]
    });

    this.addKnob('spillStrength', 'Spill Strength', 'number', 1.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('mix', 'Mix', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
  }

  compute(inputs, context = {}) {
    const inBuf = inputs['in'];
    if (!inBuf) return null;

    if (this.disabled) return inBuf.clone();

    const maskBuf = inputs['mask'];
    const screenType = this.getKnobValue('screenType', context) || 'green';
    const algo = this.getKnobValue('algorithm', context) || 'average';
    const strength = Math.max(0.0, Number(this.getKnobValue('spillStrength', context)) ?? 1.0);
    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));

    const w = inBuf.width;
    const h = inBuf.height;
    const len = w * h * 4;

    const resampledMask = (maskBuf && (maskBuf.width !== w || maskBuf.height !== h))
      ? maskBuf.resample(w, h)
      : maskBuf;

    const result = new PixelBuffer(w, h);
    result.bbox = this.getBBox(inputs, context);
    result.copyChannelsFrom(inBuf);

    const src = inBuf.data;
    const dst = result.data;
    const mask = resampledMask ? resampledMask.data : null;

    for (let i = 0; i < len; i += 4) {
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const a = src[i + 3];

      let newR = r;
      let newG = g;
      let newB = b;

      if (screenType === 'green') {
        let limit = 0.0;
        if (algo === 'average') limit = (r + b) * 0.5;
        else if (algo === 'max') limit = Math.max(r, b);
        else if (algo === 'red_dominant') limit = r * 0.7 + b * 0.3;
        else if (algo === 'blue_dominant') limit = b * 0.7 + r * 0.3;

        if (g > limit) {
          const excess = (g - limit) * strength;
          newG = Math.max(0.0, g - excess);
        }
      } else {
        // Blue screen
        let limit = 0.0;
        if (algo === 'average') limit = (r + g) * 0.5;
        else if (algo === 'max') limit = Math.max(r, g);
        else if (algo === 'red_dominant') limit = r * 0.7 + g * 0.3;
        else if (algo === 'blue_dominant') limit = g * 0.7 + r * 0.3;

        if (b > limit) {
          const excess = (b - limit) * strength;
          newB = Math.max(0.0, b - excess);
        }
      }

      // Mix and mask weighting
      let effectiveMix = mix;
      if (mask) {
        effectiveMix *= mask[i + 3];
      }

      dst[i] = r * (1.0 - effectiveMix) + newR * effectiveMix;
      dst[i + 1] = g * (1.0 - effectiveMix) + newG * effectiveMix;
      dst[i + 2] = b * (1.0 - effectiveMix) + newB * effectiveMix;
      dst[i + 3] = a; // Alpha unchanged
    }

    return result;
  }
}

