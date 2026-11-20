/**
 * OpenComp - DeepToImage Node
 * Converts a multi-sample DeepPixelBuffer into an industry-standard 2D PixelBuffer
 * by simulating optical ray traversal and Beer-Lambert front-to-back volumetric accumulation.
 * Emits flattened 32-bit linear floating-point RGBA and synthesizes primary depth.Z AOV.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class DeepToImageNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepToImage', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Deep Image Input');

    this.addKnob('primaryDepth', 'Primary Depth Mode', 'select', 'first', {
      options: [
        { label: 'First Hit (Front-most)', value: 'first' },
        { label: 'Midpoint (Volumetric Center)', value: 'midpoint' },
        { label: 'Max Alpha (Dense Core)', value: 'maxAlpha' }
      ]
    });

    this.addKnob('earlyTermination', 'Early Opacity Cutoff', 'boolean', true);
    this.addKnob('cutoffThreshold', 'Cutoff Transmittance', 'number', 0.00001, { min: 0.0, max: 0.01, step: 0.00001 });
  }

  getBBox(inputs, context = {}) {
    const deepIn = inputs && (inputs['in'] || (Array.isArray(inputs) ? inputs[0] : null));
    if (deepIn instanceof DeepPixelBuffer && deepIn.bbox) {
      return deepIn.bbox.clone();
    }
    return new BBox(0, 0, 1920, 1080);
  }

  compute(inputs, context = {}) {
    const deepIn = inputs && (inputs['in'] || (Array.isArray(inputs) ? inputs[0] : null));

    if (!(deepIn instanceof DeepPixelBuffer)) {
      // If already a standard PixelBuffer, pass through
      if (deepIn instanceof PixelBuffer) {
        return deepIn.clone();
      }
      return new PixelBuffer(1920, 1080);
    }

    const W = deepIn.width;
    const H = deepIn.height;
    const out = new PixelBuffer(W, H);
    const depthAOV = new Float32Array(W * H);

    const primaryMode = this.getKnobValue('primaryDepth', context) || 'first';
    const earlyTerm = this.getKnobValue('earlyTermination', context) !== false;
    const threshold = Number(this.getKnobValue('cutoffThreshold', context)) || 0.00001;

    const offsets = deepIn.sampleOffsets;
    const data = deepIn.sampleData;
    const outData = out.data;

    let minX = W, maxX = -1, minY = H, maxY = -1;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const start = offsets[p];
        const end = offsets[p + 1];
        const count = end - start;

        if (count === 0) {
          depthAOV[p] = 0.0;
          continue;
        }

        let accR = 0.0;
        let accG = 0.0;
        let accB = 0.0;
        let T = 1.0; // Transmittance (1.0 = fully transparent, 0.0 = fully opaque)

        let primaryZ = 0.0;
        let maxSampleAlpha = -1.0;

        for (let i = 0; i < count; i++) {
          const base = (start + i) * 6;
          const zF = data[base];
          const zB = data[base + 1];
          const r = data[base + 2];
          const g = data[base + 3];
          const b = data[base + 4];
          const a = Math.max(0.0, Math.min(1.0, data[base + 5]));

          if (a > 0.00001) {
            // Track primary depth
            if (primaryMode === 'first' && primaryZ === 0.0) {
              primaryZ = zF;
            } else if (primaryMode === 'midpoint' && primaryZ === 0.0) {
              primaryZ = (zF + zB) * 0.5;
            } else if (primaryMode === 'maxAlpha' && a > maxSampleAlpha) {
              maxSampleAlpha = a;
              primaryZ = zF;
            }

            // Beer-Lambert front-to-back accumulation
            accR += r * T;
            accG += g * T;
            accB += b * T;

            T *= (1.0 - a);

            // Early ray termination
            if (earlyTerm && T <= threshold) {
              T = 0.0;
              break;
            }
          }
        }

        const finalAlpha = Math.max(0.0, Math.min(1.0, 1.0 - T));
        const outIdx = p * 4;

        outData[outIdx] = accR;
        outData[outIdx + 1] = accG;
        outData[outIdx + 2] = accB;
        outData[outIdx + 3] = finalAlpha;
        depthAOV[p] = primaryZ;

        if (finalAlpha > 0.0001) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    out.setChannel('depth.Z', depthAOV);

    if (minX <= maxX && minY <= maxY) {
      out.bbox = new BBox(minX, minY, maxX + 1, maxY + 1);
    } else {
      out.bbox = new BBox(0, 0, W, H);
    }

    if (deepIn.metadata) {
      out.metadata = JSON.parse(JSON.stringify(deepIn.metadata));
    }

    return out;
  }
}

