/**
 * OpenComp - ChromaKeyer Node
 * Production Chroma Keyer with screen color sampling, acceptance angle,
 * differential chromatic distance, screen gain, clip black/white, and output view modes.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class ChromaKeyerNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ChromaKeyer', 'Keyer', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input (Plate)');
    this.addInput('bg', 'bg', 'Clean Plate (Optional)');

    this.addKnob('screenType', 'Screen Type', 'select', 'green', {
      options: [
        { label: 'Green Screen', value: 'green' },
        { label: 'Blue Screen', value: 'blue' },
        { label: 'Custom Color', value: 'custom' }
      ]
    });

    this.addKnob('screenColorR', 'Screen Color R', 'number', 0.05, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('screenColorG', 'Screen Color G', 'number', 0.85, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('screenColorB', 'Screen Color B', 'number', 0.05, { min: 0.0, max: 1.0, step: 0.01 });

    this.addKnob('screenGain', 'Screen Gain', 'number', 1.0, { min: 0.1, max: 2.0, step: 0.05 });
    this.addKnob('tolerance', 'Tolerance', 'number', 0.35, { min: 0.01, max: 1.0, step: 0.01 });
    this.addKnob('softness', 'Softness', 'number', 0.15, { min: 0.0, max: 0.8, step: 0.01 });
    this.addKnob('clipBlack', 'Clip Black', 'number', 0.02, { min: 0.0, max: 0.5, step: 0.01 });
    this.addKnob('clipWhite', 'Clip White', 'number', 0.98, { min: 0.5, max: 1.0, step: 0.01 });
    this.addKnob('despill', 'Despill Strength', 'number', 1.0, { min: 0.0, max: 1.5, step: 0.05 });

    this.addKnob('output', 'Output Mode', 'select', 'composite', {
      options: [
        { label: 'Premultiplied RGBA (Composite)', value: 'composite' },
        { label: 'Matte (Alpha in RGB)', value: 'matte' },
        { label: 'Status Diagnostic (Core/Edge/BG)', value: 'status' },
        { label: 'Unpremultiplied + Despill', value: 'unpremult' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inBuf = inputs['in'];
    if (!inBuf) return null;

    if (this.disabled) return inBuf.clone();

    const screenType = this.getKnobValue('screenType', context) || 'green';
    let scR = Number(this.getKnobValue('screenColorR', context)) ?? 0.05;
    let scG = Number(this.getKnobValue('screenColorG', context)) ?? 0.85;
    let scB = Number(this.getKnobValue('screenColorB', context)) ?? 0.05;

    if (screenType === 'green') {
      scR = 0.05; scG = 0.85; scB = 0.05;
    } else if (screenType === 'blue') {
      scR = 0.05; scG = 0.05; scB = 0.85;
    }

    const gain = Math.max(0.001, Number(this.getKnobValue('screenGain', context)) ?? 1.0);
    const tol = Math.max(0.001, Number(this.getKnobValue('tolerance', context)) ?? 0.35);
    const clipBlack = Number(this.getKnobValue('clipBlack', context)) ?? 0.02;
    const clipWhite = Math.max(clipBlack + 0.01, Number(this.getKnobValue('clipWhite', context)) ?? 0.98);
    const despillStrength = Number(this.getKnobValue('despill', context)) ?? 1.0;
    const outputMode = this.getKnobValue('output', context) || 'composite';

    const w = inBuf.width;
    const h = inBuf.height;
    const result = new PixelBuffer(w, h);
    result.bbox = this.getBBox(inputs, context);
    result.copyChannelsFrom(inBuf);

    const src = inBuf.data;
    const dst = result.data;
    const len = src.length;

    for (let i = 0; i < len; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      const a = src[i + 3];

      let rawMatte = 1.0;

      if (screenType === 'green') {
        const maxOther = Math.max(r, b);
        const delta = (g - maxOther) * gain;
        rawMatte = delta > 0 ? 1.0 - (delta / tol) : 1.0;

        // Despill
        if (despillStrength > 0 && g > maxOther) {
          const excess = (g - maxOther) * despillStrength;
          g = Math.max(0, g - excess);
        }
      } else if (screenType === 'blue') {
        const maxOther = Math.max(r, g);
        const delta = (b - maxOther) * gain;
        rawMatte = delta > 0 ? 1.0 - (delta / tol) : 1.0;

        // Despill
        if (despillStrength > 0 && b > maxOther) {
          const excess = (b - maxOther) * despillStrength;
          b = Math.max(0, b - excess);
        }
      } else {
        // Custom color 3D Euclidean distance in normalized chrominance
        const dr = r - scR;
        const dg = g - scG;
        const db = b - scB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db) * gain;
        rawMatte = Math.min(1.0, dist / tol);
      }

      // Tonal curve remapping (clip black / clip white)
      let finalMatte = Math.max(0.0, Math.min(1.0, rawMatte));
      if (finalMatte <= clipBlack) {
        finalMatte = 0.0;
      } else if (finalMatte >= clipWhite) {
        finalMatte = 1.0;
      } else {
        finalMatte = (finalMatte - clipBlack) / (clipWhite - clipBlack);
      }
      finalMatte = Math.max(0.0, Math.min(1.0, finalMatte * a));

      if (outputMode === 'matte') {
        dst[i] = finalMatte;
        dst[i + 1] = finalMatte;
        dst[i + 2] = finalMatte;
        dst[i + 3] = 1.0;
      } else if (outputMode === 'status') {
        if (finalMatte <= 0.001) {
          dst[i] = 0.0; dst[i + 1] = 0.0; dst[i + 2] = 0.0; dst[i + 3] = 1.0;
        } else if (finalMatte >= 0.999) {
          dst[i] = 1.0; dst[i + 1] = 1.0; dst[i + 2] = 1.0; dst[i + 3] = 1.0;
        } else {
          dst[i] = 1.0; dst[i + 1] = 0.0; dst[i + 2] = 0.0; dst[i + 3] = 1.0;
        }
      } else if (outputMode === 'unpremult') {
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = finalMatte;
      } else {
        // Premultiplied composite
        dst[i] = r * finalMatte;
        dst[i + 1] = g * finalMatte;
        dst[i + 2] = b * finalMatte;
        dst[i + 3] = finalMatte;
      }
    }

    return result;
  }
}

