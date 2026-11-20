/**
 * OpenComp - Colorspace / OCIO Color Transform Node
 * Handles industry standard color space transforms (Linear, sRGB, Rec.709, ACEScg, Cineon Log, Alexa LogC)
 * matching Foundry Nuke's Colorspace and OCIOColorSpace nodes.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

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

    const isTiled = !!inputBuf.isTiled;

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          this._applyColorspace(inTile.data, outTile.data, inTile.data.length, inSpace, outSpace);
        }
      }
      return result;
    }

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    this._applyColorspace(inputBuf.data, result.data, inputBuf.data.length, inSpace, outSpace);
    return result;
  }

  _applyColorspace(src, dst, len, inSpace, outSpace) {
    // 1D non-linear to linear transfer
    const toLinear1D = (c, space) => {
      if (space === 'linear' || space === 'acescg') return c;
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
      return c;
    };

    // 1D linear to non-linear transfer
    const fromLinear1D = (c, space) => {
      if (space === 'linear' || space === 'acescg') return c;
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
      return c;
    };

    // 3x3 ACEScg (AP1) to Linear Rec.709 Matrix
    const acescgToLinear709 = (r, g, b) => [
      1.7048587 * r - 0.6217145 * g - 0.0832993 * b,
      -0.1300768 * r + 1.1407358 * g - 0.0105590 * b,
      -0.0239641 * r - 0.1289755 * g + 1.1528640 * b
    ];

    // 3x3 Linear Rec.709 to ACEScg (AP1) Matrix
    const linear709ToAcescg = (r, g, b) => [
      0.613097 * r + 0.339523 * g + 0.047379 * b,
      0.070194 * r + 0.916354 * g + 0.013452 * b,
      0.020616 * r + 0.109570 * g + 0.869794 * b
    ];

    for (let i = 0; i < len; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];

      // Step 1: Input Non-Linear -> Input Linear
      r = toLinear1D(r, inSpace);
      g = toLinear1D(g, inSpace);
      b = toLinear1D(b, inSpace);

      // Step 2: Gamut Transform (if either is ACEScg)
      if (inSpace === 'acescg' && outSpace !== 'acescg') {
        const conv = acescgToLinear709(r, g, b);
        r = conv[0]; g = conv[1]; b = conv[2];
      } else if (inSpace !== 'acescg' && outSpace === 'acescg') {
        const conv = linear709ToAcescg(r, g, b);
        r = conv[0]; g = conv[1]; b = conv[2];
      }

      // Step 3: Linear -> Output Non-Linear
      dst[i] = fromLinear1D(r, outSpace);
      dst[i + 1] = fromLinear1D(g, outSpace);
      dst[i + 2] = fromLinear1D(b, outSpace);
      dst[i + 3] = src[i + 3]; // Alpha preserved
    }
  }
}
