/**
 * OpenComp - Premult Node
 * Multiplies RGB channels by the Alpha channel (R*A, G*A, B*A), matching Foundry Nuke's Premult.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

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

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    const src = inputBuf.data;
    const dst = result.data;
    const len = src.length;
    const inv = this.getKnobValue('alphaChannel') === 'inv_alpha';

    for (let i = 0; i < len; i += 4) {
      let a = src[i + 3];
      if (inv) a = 1.0 - a;

      dst[i] = src[i] * a;
      dst[i + 1] = src[i + 1] * a;
      dst[i + 2] = src[i + 2] * a;
      dst[i + 3] = a;
    }

    return result;
  }
}

