/**
 * OpenComp - ColorLookup (Curves) Node
 * Implements professional tonal response curves and S-curve contrast grading.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ColorLookupNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ColorLookup', 'Color', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'mask (Optional)');

    this.addKnob('curvePreset', 'Curve Profile', 'select', 's_curve', {
      options: [
        { label: 'S-Curve (Cinematic Contrast)', value: 's_curve' },
        { label: 'Highlights Roll-off (Filmic)', value: 'film_highlight' },
        { label: 'Shadows Lift', value: 'shadow_lift' },
        { label: 'High Contrast Punch', value: 'high_contrast' }
      ]
    });

    this.addKnob('contrast', 'Contrast Strength', 'number', 1.0, { min: 0.0, max: 2.5, step: 0.05 });
    this.addKnob('pivot', 'Contrast Pivot', 'number', 0.18, { min: 0.01, max: 0.8, step: 0.01 }); // 18% gray pivot
    this.addKnob('shadowWarmth', 'Shadow Tint', 'number', 0.0, { min: -0.2, max: 0.2, step: 0.01 });
    this.addKnob('highlightCool', 'Highlight Tint', 'number', 0.0, { min: -0.2, max: 0.2, step: 0.01 });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const maskBuf = inputs['mask'];
    const resampledMask = (maskBuf && (maskBuf.width !== inputBuf.width || maskBuf.height !== inputBuf.height))
      ? maskBuf.resample(inputBuf.width, inputBuf.height)
      : maskBuf;

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    const src = inputBuf.data;
    const dst = result.data;
    const mask = resampledMask ? resampledMask.data : null;
    const len = src.length;

    const profile = this.getKnobValue('curvePreset') || 's_curve';
    const contrast = Number(this.getKnobValue('contrast')) ?? 1.0;
    const pivot = Number(this.getKnobValue('pivot')) ?? 0.18;
    const shadowWarmth = Number(this.getKnobValue('shadowWarmth')) ?? 0.0;
    const highlightCool = Number(this.getKnobValue('highlightCool')) ?? 0.0;

    // Fast LUT generation for tonal curve mapping (4096 samples for subpixel precision)
    const lutSize = 4096;
    const lut = new Float32Array(lutSize);
    for (let k = 0; k < lutSize; k++) {
      let x = k / 1024.0; // Map 0.0 to 4.0 linear range
      if (profile === 's_curve') {
        // Sigmoid contrast centered around 18% gray pivot
        const normalized = x / Math.max(0.001, pivot * 2.0);
        const s = normalized <= 0 ? 0 : Math.pow(normalized, contrast);
        lut[k] = s * (pivot * 2.0);
      } else if (profile === 'film_highlight') {
        // Soft shoulder compression: x / (1 + x)
        lut[k] = x / (1.0 + 0.3 * x);
      } else if (profile === 'shadow_lift') {
        lut[k] = x + 0.04 * Math.exp(-x * 4.0);
      } else if (profile === 'high_contrast') {
        lut[k] = Math.pow(Math.max(0, x), 1.35);
      } else {
        lut[k] = x;
      }
    }

    const sampleLut = (val) => {
      const idx = Math.max(0, Math.min(lutSize - 1, Math.round(val * 1024.0)));
      return lut[idx];
    };

    for (let i = 0; i < len; i += 4) {
      const maskVal = mask ? mask[i + 3] : 1.0;

      for (let c = 0; c < 3; c++) {
        const origVal = src[i + c];
        let val = sampleLut(origVal);

        // Warm shadows, cool highlights
        if (c === 0 && origVal < pivot) val += shadowWarmth * (pivot - origVal); // Red in shadows
        if (c === 2 && origVal > pivot) val += highlightCool * (origVal - pivot); // Blue in highlights

        dst[i + c] = origVal * (1.0 - maskVal) + val * maskVal;
      }

      dst[i + 3] = src[i + 3];
    }

    return result;
  }
}

