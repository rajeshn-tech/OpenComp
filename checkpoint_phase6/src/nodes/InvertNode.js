/**
 * OpenComp - Invert Node
 * Inverts RGB, Alpha, or all channels.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class InvertNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Invert', 'Color', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');

    this.addKnob('channels', 'Channels', 'select', 'rgb', {
      options: [
        { label: 'RGB Only', value: 'rgb' },
        { label: 'RGBA (All)', value: 'rgba' },
        { label: 'Alpha Only', value: 'alpha' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const channels = this.getKnobValue('channels') || 'rgb';
    const isTiled = !!inputBuf.isTiled;

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          this._applyInvert(inTile.data, outTile.data, inTile.data.length, channels);
        }
      }
      return result;
    }

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    this._applyInvert(inputBuf.data, result.data, inputBuf.data.length, channels);
    return result;
  }

  _applyInvert(src, dst, len, channels) {
    const invRGB = (channels === 'rgb' || channels === 'rgba');
    const invAlpha = (channels === 'alpha' || channels === 'rgba');
    for (let i = 0; i < len; i += 4) {
      dst[i] = invRGB ? 1.0 - src[i] : src[i];
      dst[i + 1] = invRGB ? 1.0 - src[i + 1] : src[i + 1];
      dst[i + 2] = invRGB ? 1.0 - src[i + 2] : src[i + 2];
      dst[i + 3] = invAlpha ? 1.0 - src[i + 3] : src[i + 3];
    }
  }
}

