/**
 * OpenComp - Output Node
 * Represents the final output port inside a Group subgraph.
 */

import { Node } from '../core/Node.js';
import { BBox } from '../core/BBox.js';

export class OutputNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Output', 'Tool', x, y);
    this.color = '#386350';
    this.width = 90;
    this.height = 32;

    this.addInput('in', 'Input', 'in');
  }

  getBBox(inputs, context) {
    if (inputs['in']) {
      return inputs['in'].bbox ? inputs['in'].bbox.clone() : BBox.fromFormat(inputs['in'].width, inputs['in'].height);
    }
    return new BBox(0, 0, 0, 0);
  }

  compute(inputs, context) {
    return inputs['in'] || null;
  }
}

