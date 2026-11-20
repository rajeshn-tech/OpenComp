/**
 * OpenComp - FrameHold Node
 * Freezes the input image sequence at a specified frame number.
 * Essential for paint clean plates, matte paintings, and stereoscopic alignment.
 */

import { Node } from '../core/Node.js';

export class FrameHoldNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'FrameHold', 'Time', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate');

    this.addKnob('firstFrame', 'First Frame', 'number', 1, { min: 1, max: 10000, step: 1 });
  }

  getInputContext(inputId, context) {
    const holdFrame = Math.round(Number(this.getKnobValue('firstFrame', context)) || 1);
    return { ...context, frame: holdFrame };
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;
    return inputBuf.clone();
  }
}

