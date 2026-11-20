/**
 * OpenComp - Unpremult Node
 * Divides RGB channels by the Alpha channel (R/A, G/A, B/A), matching Foundry Nuke's Unpremult.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

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

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    const src = inputBuf.data;
    const dst = result.data;
    const len = src.length;
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

    return result;
  }
}

