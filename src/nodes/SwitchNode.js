/**
 * OpenComp - Switch Node
 * Selects between multiple alternate inputs based on the 'which' index knob.
 * Supports discrete switching or linear blend interpolation between consecutive inputs.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class SwitchNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Switch', 'Merge', x, y);
    this.width = 110;
    this.height = 38;

    // Up to 5 selectable inputs (0 through 4)
    this.addInput('0', '0', 'Input 0');
    this.addInput('1', '1', 'Input 1');
    this.addInput('2', '2', 'Input 2');
    this.addInput('3', '3', 'Input 3');
    this.addInput('4', '4', 'Input 4');

    this.addKnob('which', 'Which', 'number', 0.0, { min: 0.0, max: 4.0, step: 0.05 });
    this.addKnob('blend', 'Blend Fractional', 'boolean', false);
  }

  /**
   * Determine output dynamic BBox: returns active input's BBox or blend union
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const which = Number(this.getKnobValue('which', context)) || 0.0;
    const blend = !!this.getKnobValue('blend', context);

    if (!blend) {
      const idx = Math.max(0, Math.min(4, Math.round(which)));
      const selectedBuf = inputs[String(idx)];
      if (selectedBuf) {
        return selectedBuf.bbox ? selectedBuf.bbox.clone() : BBox.fromFormat(selectedBuf.width, selectedBuf.height);
      }
      for (let i = 0; i <= 4; i++) {
        if (inputs[String(i)]) {
          const b = inputs[String(i)];
          return b.bbox ? b.bbox.clone() : BBox.fromFormat(b.width, b.height);
        }
      }
      return new BBox(0, 0, 0, 0);
    }

    // Blend: union of input A and input B
    const idxA = Math.max(0, Math.min(4, Math.floor(which)));
    const idxB = Math.max(0, Math.min(4, Math.ceil(which)));
    const bufA = inputs[String(idxA)];
    const bufB = inputs[String(idxB)];

    if (!bufA && !bufB) return new BBox(0, 0, 0, 0);
    if (!bufA) return bufB.bbox ? bufB.bbox.clone() : BBox.fromFormat(bufB.width, bufB.height);
    if (!bufB) return bufA.bbox ? bufA.bbox.clone() : BBox.fromFormat(bufA.width, bufA.height);

    const boxA = bufA.bbox ? bufA.bbox.clone() : BBox.fromFormat(bufA.width, bufA.height);
    const boxB = bufB.bbox ? bufB.bbox.clone() : BBox.fromFormat(bufB.width, bufB.height);
    return boxA.union(boxB);
  }

  compute(inputs, context = {}) {
    const which = Number(this.getKnobValue('which', context)) || 0.0;
    const blend = !!this.getKnobValue('blend', context);

    if (!blend) {
      const idx = Math.max(0, Math.min(4, Math.round(which)));
      const selectedBuf = inputs[String(idx)];
      if (selectedBuf) {
        const res = selectedBuf.clone();
        res.bbox = this.getBBox(inputs, context);
        return res;
      }

      // Fallback: return first available input
      for (let i = 0; i <= 4; i++) {
        if (inputs[String(i)]) {
          const res = inputs[String(i)].clone();
          res.bbox = this.getBBox(inputs, context);
          return res;
        }
      }
      return null;
    }

    // Fractional blend between floor(which) and ceil(which)
    const idxA = Math.max(0, Math.min(4, Math.floor(which)));
    const idxB = Math.max(0, Math.min(4, Math.ceil(which)));
    const frac = which - idxA;

    const bufA = inputs[String(idxA)];
    const bufB = inputs[String(idxB)];

    if (!bufA && !bufB) return null;
    if (!bufA) {
      const res = bufB.clone();
      res.bbox = this.getBBox(inputs, context);
      return res;
    }
    if (!bufB || frac <= 0.001) {
      const res = bufA.clone();
      res.bbox = this.getBBox(inputs, context);
      return res;
    }

    const w = bufA.width;
    const h = bufA.height;
    const outBuf = new PixelBuffer(w, h);
    const outData = outBuf.data;
    const dataA = bufA.data;
    const dataB = (bufB.width === w && bufB.height === h) ? bufB.data : bufB.resample(w, h).data;
    const totalPixels = w * h;

    const weightB = frac;
    const weightA = 1.0 - frac;

    for (let i = 0; i < totalPixels * 4; i += 4) {
      outData[i]     = dataA[i]     * weightA + dataB[i]     * weightB;
      outData[i + 1] = dataA[i + 1] * weightA + dataB[i + 1] * weightB;
      outData[i + 2] = dataA[i + 2] * weightA + dataB[i + 2] * weightB;
      outData[i + 3] = dataA[i + 3] * weightA + dataB[i + 3] * weightB;
    }

    outBuf.bbox = this.getBBox(inputs, context);
    return outBuf;
  }
}

