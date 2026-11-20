/**
 * OpenComp - Input Node
 * Represents an external input port inside a Group subgraph.
 */

import { Node } from '../core/Node.js';
import { BBox } from '../core/BBox.js';

export class InputNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Input', 'Tool', x, y);
    this.color = '#386350';
    this.width = 90;
    this.height = 32;

    this.addKnob('number', 'Input Port', 'text', '1');
    this.addKnob('label', 'Label', 'text', '');

    this.injectedBuffer = null;
  }

  getBBox(inputs, context) {
    if (this.injectedBuffer) {
      return this.injectedBuffer.bbox ? this.injectedBuffer.bbox.clone() : BBox.fromFormat(this.injectedBuffer.width, this.injectedBuffer.height);
    }
    return new BBox(0, 0, 0, 0);
  }

  compute(inputs, context) {
    return this.injectedBuffer || null;
  }
}

