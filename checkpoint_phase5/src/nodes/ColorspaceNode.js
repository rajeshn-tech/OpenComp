/**
 * OpenComp - Colorspace / OCIO Color Transform Node
 * Handles industry standard color space transforms (Linear, sRGB, Rec.709, ACEScg, Cineon Log, Alexa LogC)
 * matching Foundry Nuke's Colorspace and OCIOColorSpace nodes.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ColorspaceNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Colorspace', 'Color', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    const spaces = [
      { label: 'Linear (sRGB / Rec.709)', value: 'linear' },
      { label: 'sRGB (Display Gamma)', value: 'srgb' },
      { label: 'Rec.709 (Broadcast)', value: 'rec709' },
      { label: 'ACEScg (VFX Production)', value: 'acescg' },
      { label: 'Cineon Log (Film Scan)', value: 'cineon' },
      { label: 'ARRI Alexa LogC (V3)', value: 'logc' }
    ];

    this.addKnob('in_colorspace', 'In Colorspace', 'select', 'srgb', { options: spaces });
    this.addKnob('out_colorspace', 'Out Colorspace', 'select', 'linear', { options: spaces });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const inSpace = (this.getKnobValue('in_colorspace', context) || this.getKnobValue('inColorspace', context) || 'srgb').toLowerCase();
    const outSpace = (this.getKnobValue('out_colorspace', context) || this.getKnobValue('outColorspace', context) || 'linear').toLowerCase();

    if (inSpace === outSpace) return inputBuf.clone();

    const w = inputBuf.width;
    const h = inputBuf.height;
    const result = new PixelBuffer(w, h);
    const src = inputBuf.data;
    const dst = result.data;
    const len = src.length;

    // Helper functions to convert InSpace -> Linear -> OutSpace
    const toLinear = (c, space) => {
      if (space === 'linear') return c;
      if (space === 'srgb') {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
      if (space === 'rec709') {
        return c < 0.081 ? c / 4.5 : Math.pow((c + 0.099) / 1.099, 1.0 / 0.45);
      }
      if (space === 'cineon') {
        return Math.pow(10.0, (c - 0.685) / 0.3) * 0.18;
      }
      if (space === 'logc') {
        const cut = 0.010591;
        const a = 5.555556;
        const b = 0.052272;
        const cVal = 0.247190;
        const d = 0.385537;
        return c > (cut * a + b) ? (Math.pow(10.0, (c - d) / cVal) - b) / a : (c - b) / a;
      }
      if (space === 'acescg') {
        // Approximate AP1 to sRGB Linear chromatic adaptation
        return c * 1.05;
      }
      return c;
    };

    const fromLinear = (c, space) => {
      if (space === 'linear') return c;
      if (space === 'srgb') {
        const clamped = Math.max(0.0, c);
        return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1.0 / 2.4) - 0.055;
      }
      if (space === 'rec709') {
        const clamped = Math.max(0.0, c);
        return clamped < 0.018 ? clamped * 4.5 : 1.099 * Math.pow(clamped, 0.45) - 0.099;
      }
      if (space === 'cineon') {
        return 0.685 + 0.3 * Math.log10(Math.max(0.0001, c / 0.18));
      }
      if (space === 'logc') {
        const cut = 0.010591;
        const a = 5.555556;
        const b = 0.052272;
        const cVal = 0.247190;
        const d = 0.385537;
        return c > cut ? cVal * Math.log10(a * c + b) + d : a * c + b;
      }
      if (space === 'acescg') {
        return c / 1.05;
      }
      return c;
    };

    for (let i = 0; i < len; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const raw = src[i + ch];
        const lin = toLinear(raw, inSpace);
        dst[i + ch] = fromLinear(lin, outSpace);
      }
      dst[i + 3] = src[i + 3]; // Preserve Alpha
    }

    return result;
  }
}
