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
    let strokeObj = stroke;
    if (Array.isArray(stroke)) {
      strokeObj = new PaintStroke('clone');
      for (const p of stroke) {
        strokeObj.addPoint(p.x, p.y, p.pressure !== undefined ? p.pressure : 1.0);
      }
    } else if (stroke && !(stroke instanceof PaintStroke) && typeof stroke.serialize !== 'function') {
      strokeObj = PaintStroke.deserialize ? PaintStroke.deserialize(stroke) : new PaintStroke(stroke.type || 'brush');
    }
    this.strokes.push(strokeObj);
    this.markDirty();
    return strokeObj;
  }

  getStroke(id) {
    return this.strokes.find(s => s.id === id) || null;
  }

  insertStroke(stroke, index) {
    let strokeObj = stroke;
    if (stroke && !(stroke instanceof PaintStroke) && typeof stroke.serialize !== 'function') {
      strokeObj = PaintStroke.deserialize ? PaintStroke.deserialize(stroke) : new PaintStroke(stroke.type || 'brush');
    }
    const idx = Math.max(0, Math.min(this.strokes.length, index));
    this.strokes.splice(idx, 0, strokeObj);
    this.markDirty();
    return strokeObj;
  }

  moveStroke(id, direction) {
    const idx = this.strokes.findIndex(s => s.id === id);
    if (idx < 0) return false;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= this.strokes.length) return false;
    const [item] = this.strokes.splice(idx, 1);
    this.strokes.splice(targetIdx, 0, item);
    this.markDirty();
    return true;
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
      if (inputBuf.isTiled) {
        for (let r = 0; r < result.rows; r++) {
          for (let c = 0; c < result.cols; c++) {
            const sData = inputBuf.tiles[r][c].data;
            const dData = result.tiles[r][c].data;
            const len = dData.length;
            for (let i = 0; i < len; i++) {
              dData[i] = sData[i] * (1.0 - globalOpacity) + dData[i] * globalOpacity;
            }
          }
        }
      } else {
        // Blend back towards original base
        const src = inputBuf.data;
        const dst = result.data;
        const len = dst.length;
        for (let i = 0; i < len; i++) {
          dst[i] = src[i] * (1.0 - globalOpacity) + dst[i] * globalOpacity;
        }
      }
    }

    return result;
  }

  serialize() {
    const data = super.serialize();
    data.strokes = (this.strokes || []).map(s => (s && typeof s.serialize === 'function') ? s.serialize() : s);
    return data;
  }

  deserialize(data) {
    super.deserialize(data);
    if (data.strokes && Array.isArray(data.strokes)) {
      this.strokes = data.strokes.map(sd => PaintStroke.deserialize(sd));
    }
  }
}

