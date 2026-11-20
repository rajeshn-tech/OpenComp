/**
 * OpenComp - DeepMerge Node
 * Interleaved depth-aware merging of two DeepPixelBuffers.
 * Sorts all samples by zFront and applies optional dropHidden transmittance culling
 * to eliminate occluded samples behind opaque geometry.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';

export class DeepMergeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepMerge', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('B', 'B', 'Deep Stream B (Base / Background)');
    this.addInput('A', 'A', 'Deep Stream A (Foreground / Over)');

    this.addKnob('dropHidden', 'Drop Hidden (Occlusion Culling)', 'boolean', true);
    this.addKnob('cutoffThreshold', 'Cutoff Threshold', 'number', 0.00001, { min: 0.0, max: 0.01, step: 0.00001 });
  }

  compute(inputs, context = {}) {
    const deepB = inputs && (inputs['B'] !== undefined ? inputs['B'] : (Array.isArray(inputs) ? inputs[0] : null));
    const deepA = inputs && (inputs['A'] !== undefined ? inputs['A'] : (Array.isArray(inputs) ? inputs[1] : null));

    if (!(deepA instanceof DeepPixelBuffer) && !(deepB instanceof DeepPixelBuffer)) {
      return new DeepPixelBuffer(1920, 1080);
    }
    if (!(deepA instanceof DeepPixelBuffer)) return deepB.clone();
    if (!(deepB instanceof DeepPixelBuffer)) return deepA.clone();

    const W = Math.max(deepA.width, deepB.width);
    const H = Math.max(deepA.height, deepB.height);
    const totalPixels = W * H;

    const dropHidden = this.getKnobValue('dropHidden', context) !== false;
    const cutoff = Number(this.getKnobValue('cutoffThreshold', context)) || 0.00001;

    const pixelLists = new Array(totalPixels);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;

        // Retrieve samples from A
        const samplesA = (x < deepA.width && y < deepA.height) ? deepA.getSamples(x, y) : [];
        // Tag stream precedence: stream A has precedence 0, stream B has precedence 1
        for (let i = 0; i < samplesA.length; i++) {
          samplesA[i].stream = 0;
        }

        // Retrieve samples from B
        const samplesB = (x < deepB.width && y < deepB.height) ? deepB.getSamples(x, y) : [];
        for (let i = 0; i < samplesB.length; i++) {
          samplesB[i].stream = 1;
        }

        const combined = samplesA.concat(samplesB);
        if (combined.length === 0) {
          pixelLists[p] = [];
          continue;
        }

        // Sort ascending: zFront, then zBack, then stream A before B
        combined.sort((s1, s2) => {
          if (s1.zFront !== s2.zFront) return s1.zFront - s2.zFront;
          if (s1.zBack !== s2.zBack) return s1.zBack - s2.zBack;
          return s1.stream - s2.stream;
        });

        // Filter / drop hidden
        if (dropHidden) {
          const visible = [];
          let T = 1.0;
          for (let i = 0; i < combined.length; i++) {
            const s = combined[i];
            visible.push(s);
            T *= (1.0 - s.a);
            if (T <= cutoff) {
              break; // Drop all subsequent hidden samples
            }
          }
          pixelLists[p] = visible;
        } else {
          pixelLists[p] = combined;
        }
      }
    }

    const merged = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
    return merged;
  }
}

