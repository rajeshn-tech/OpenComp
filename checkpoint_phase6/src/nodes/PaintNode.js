/**
 * OpenComp - Paint Node
 * Non-destructive manual paint, clone-stamping, wire/rig cleanup,
 * and temporal clean-plate restoration node.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { PaintStroke } from '../core/PaintStroke.js';

export class PaintNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Paint', 'Filter', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate');
    this.addInput('clean', 'clean', 'Clean Plate (Optional)');

    /** @type {PaintStroke[]} */
    this.strokes = [];

    this.addKnob('opacity', 'Global Opacity', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.05 });
  }

  addStroke(stroke) {
    this.strokes.push(stroke);
    this.markDirty();
    return stroke;
  }

  removeStroke(id) {
    const idx = this.strokes.findIndex(s => s.id === id);
    if (idx >= 0) {
      this.strokes.splice(idx, 1);
      this.markDirty();
      return true;
    }
    return false;
  }

  clearStrokes() {
    this.strokes = [];
    this.markDirty();
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    const cleanBuf = inputs['clean'];
    const w = inputBuf ? inputBuf.width : 1920;
    const h = inputBuf ? inputBuf.height : 1080;
    const frame = context && context.frame !== undefined ? context.frame : 1;

    // Clone base plate
    const result = inputBuf ? inputBuf.clone() : new PixelBuffer(w, h);
    if (!inputBuf) {
      result.data.fill(0.0);
    }

    if (this.strokes.length === 0) {
      return result;
    }

    const globalOpacity = Number(this.getKnobValue('opacity')) ?? 1.0;

    // Render each active stroke in chronological order
    for (const stroke of this.strokes) {
      if (stroke.isValidAtFrame(frame)) {
        stroke.render(result, inputBuf, cleanBuf);
      }
    }

    if (globalOpacity < 0.999 && inputBuf) {
      // Blend back towards original base
      const src = inputBuf.data;
      const dst = result.data;
      const len = dst.length;
      for (let i = 0; i < len; i++) {
        dst[i] = src[i] * (1.0 - globalOpacity) + dst[i] * globalOpacity;
      }
    }

    return result;
  }

  serialize() {
    const data = super.serialize();
    data.strokes = this.strokes.map(s => s.serialize());
    return data;
  }

  deserialize(data) {
    if (data.strokes && Array.isArray(data.strokes)) {
      this.strokes = data.strokes.map(sd => PaintStroke.deserialize(sd));
    }
  }
}

