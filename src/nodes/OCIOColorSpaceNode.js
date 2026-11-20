/**
 * OpenComp - OCIOColorSpace Node
 * Converts an image sequence between two OpenColorIO color spaces.
 * Strictly preserves the Alpha channel and all auxiliary AOVs.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';
import { globalOCIO } from '../core/OCIOManager.js';

export class OCIOColorSpaceNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'OCIOColorSpace', 'Color', x, y);
    this.width = 130;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    const availableSpaces = globalOCIO.getColorSpaces().map(s => ({ label: s, value: s }));

    this.addKnob('in_colorspace', 'In Colorspace', 'select', 'ACEScg', { options: availableSpaces });
    this.addKnob('out_colorspace', 'Out Colorspace', 'select', 'sRGB - Texture', { options: availableSpaces });
    this.addKnob('mix', 'Mix', 'float', 1.0, { min: 0.0, max: 1.0, step: 0.01 });

    // Link compatibility alias knobs
    this.knobs['in'] = this.knobs['in_colorspace'];
    this.knobs['out'] = this.knobs['out_colorspace'];
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const inSpace = this.getKnobValue('in_colorspace', context) || 'ACEScg';
    const outSpace = this.getKnobValue('out_colorspace', context) || 'sRGB - Texture';
    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));

    if (inSpace === outSpace || mix <= 0.0) {
      return inputBuf;
    }

    // Allocate result buffer preserving tiled architecture and extra channels
    const isTiled = inputBuf instanceof TiledPixelBuffer;
    const result = PixelBuffer.createBuffer(inputBuf.width, inputBuf.height);

    if (inputBuf.extraChannels && inputBuf.extraChannels.size > 0 && result.copyChannelsFrom) {
      result.copyChannelsFrom(inputBuf);
    }
    if (inputBuf.metadata) {
      result.metadata = { ...inputBuf.metadata };
    }

    // Copy source pixel data
    if (isTiled) {
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          result.getTile(c, r).data.set(inputBuf.getTile(c, r).data);
        }
      }
    } else {
      result.data.set(inputBuf.data);
    }

    // Apply OCIO transform
    globalOCIO.transform(result, inSpace, outSpace);

    // Apply mix if < 1.0
    if (mix < 1.0) {
      const invMix = 1.0 - mix;
      if (isTiled) {
        for (let r = 0; r < result.rows; r++) {
          for (let c = 0; c < result.cols; c++) {
            const dst = result.getTile(c, r).data;
            const src = inputBuf.getTile(c, r).data;
            for (let i = 0; i < dst.length; i += 4) {
              dst[i] = src[i] * invMix + dst[i] * mix;
              dst[i + 1] = src[i + 1] * invMix + dst[i + 1] * mix;
              dst[i + 2] = src[i + 2] * invMix + dst[i + 2] * mix;
              // Alpha preserved
            }
          }
        }
      } else {
        const dst = result.data;
        const src = inputBuf.data;
        for (let i = 0; i < dst.length; i += 4) {
          dst[i] = src[i] * invMix + dst[i] * mix;
          dst[i + 1] = src[i + 1] * invMix + dst[i + 1] * mix;
          dst[i + 2] = src[i + 2] * invMix + dst[i + 2] * mix;
        }
      }
    }

    return result;
  }
}

