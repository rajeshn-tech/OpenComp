/**
 * OpenComp - Switch Node
 * Selects between multiple alternate inputs based on the 'which' index knob.
 * Supports discrete switching or linear blend interpolation between consecutive inputs.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

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

  compute(inputs, context = {}) {
    const which = Number(this.getKnobValue('which', context)) || 0.0;
    const blend = !!this.getKnobValue('blend', context);

    if (!blend) {
      const idx = Math.max(0, Math.min(4, Math.round(which)));
      const selectedBuf = inputs[String(idx)];
      if (selectedBuf) return selectedBuf.clone();

      // Fallback: return first available input
      for (let i = 0; i <= 4; i++) {
        if (inputs[String(i)]) return inputs[String(i)].clone();
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
    if (!bufA) return bufB.clone();
    if (!bufB || frac <= 0.001) return bufA.clone();

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

    return outBuf;
  }
}

