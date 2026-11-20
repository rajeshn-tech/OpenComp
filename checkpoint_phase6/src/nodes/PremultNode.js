/**
 * OpenComp - Premult Node
 * Multiplies RGB channels by the Alpha channel (R*A, G*A, B*A), matching Foundry Nuke's Premult.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class PremultNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Premult', 'Merge', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');
    this.addKnob('alphaChannel', 'Alpha Source', 'select', 'alpha', {
      options: [
        { label: 'Alpha', value: 'alpha' },
        { label: 'Inverted Alpha', value: 'inv_alpha' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const inv = this.getKnobValue('alphaChannel') === 'inv_alpha';
    const isTiled = !!inputBuf.isTiled;

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          this._applyPremult(inTile.data, outTile.data, inTile.data.length, inv);
        }
      }
      return result;
    }

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    this._applyPremult(inputBuf.data, result.data, inputBuf.data.length, inv);
    return result;
  }

  _applyPremult(src, dst, len, inv) {
    for (let i = 0; i < len; i += 4) {
      let a = src[i + 3];
      if (inv) a = 1.0 - a;

      dst[i] = src[i] * a;
      dst[i + 1] = src[i + 1] * a;
      dst[i + 2] = src[i + 2] * a;
      dst[i + 3] = a;
    }
  }
}

