/**
 * OpenComp - Unpremult Node
 * Divides RGB channels by the Alpha channel (R/A, G/A, B/A), standard VFX implementation.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class UnpremultNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Unpremult', 'Merge', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const isTiled = !!inputBuf.isTiled;

    const outBBox = this.getBBox(inputs, context);

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      result.bbox = outBBox;
      result.copyChannelsFrom(inputBuf);
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          this._applyUnpremult(inTile.data, outTile.data, inTile.data.length);
        }
      }
      return result;
    }

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    result.bbox = outBBox;
    result.copyChannelsFrom(inputBuf);
    this._applyUnpremult(inputBuf.data, result.data, inputBuf.data.length);
    return result;
  }

  _applyUnpremult(src, dst, len) {
    const epsilon = 0.00001;
    for (let i = 0; i < len; i += 4) {
      const a = src[i + 3];
      if (a > epsilon) {
        dst[i] = src[i] / a;
        dst[i + 1] = src[i + 1] / a;
        dst[i + 2] = src[i + 2] / a;
      } else {
        dst[i] = 0;
        dst[i + 1] = 0;
        dst[i + 2] = 0;
      }
      dst[i + 3] = a;
    }
  }
}

