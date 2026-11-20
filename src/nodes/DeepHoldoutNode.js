/**
 * OpenComp - DeepHoldout Node
 * Applies volumetric 3D holdouts by attenuating samples in the primary deep stream
 * by the cumulative transmittance through occluding holdout geometry.
 * Produces seamless, anti-aliased holdouts without 2D matte fringing or 3D mesh intersection artifacts.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';

export class DeepHoldoutNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepHoldout', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Primary Deep Stream (Beauty)');
    this.addInput('holdout', 'holdout', 'Holdout Geometry Deep Stream');

    this.addKnob('cutoffThreshold', 'Cutoff Threshold', 'number', 0.00001, { min: 0.0, max: 0.01, step: 0.00001 });
  }

  compute(inputs, context = {}) {
    const deepIn = inputs && (inputs['in'] !== undefined ? inputs['in'] : (Array.isArray(inputs) ? inputs[0] : null));
    const deepHoldout = inputs && (inputs['holdout'] !== undefined ? inputs['holdout'] : (Array.isArray(inputs) ? inputs[1] : null));

    if (!(deepIn instanceof DeepPixelBuffer)) {
      return new DeepPixelBuffer(1920, 1080);
    }
    if (!(deepHoldout instanceof DeepPixelBuffer)) {
      return deepIn.clone();
    }

    const W = deepIn.width;
    const H = deepIn.height;
    const totalPixels = W * H;

    const cutoff = Number(this.getKnobValue('cutoffThreshold', context)) || 0.00001;
    const pixelLists = new Array(totalPixels);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const samplesIn = deepIn.getSamples(x, y);
        if (samplesIn.length === 0) {
          pixelLists[p] = [];
          continue;
        }

        const samplesHoldout = (x < deepHoldout.width && y < deepHoldout.height)
          ? deepHoldout.getSamples(x, y)
          : [];

        if (samplesHoldout.length === 0) {
          pixelLists[p] = samplesIn;
          continue;
        }

        // For each sample in primary stream, calculate transmittance through holdout
        const attenuated = [];

        for (let i = 0; i < samplesIn.length; i++) {
          const sA = samplesIn[i];
          const zA = sA.zFront;

          let holdoutT = 1.0;

          for (let j = 0; j < samplesHoldout.length; j++) {
            const sB = samplesHoldout[j];
            if (sB.zFront >= zA) {
              // Holdout sample is behind this primary sample; does not occlude it
              break;
            }

            if (sB.zBack <= zA) {
              // Entire holdout sample is in front
              holdoutT *= (1.0 - sB.a);
            } else {
              // Volumetric holdout slab partially overlaps
              const totalThick = sB.zBack - sB.zFront;
              const frac = totalThick > 1e-6 ? (zA - sB.zFront) / totalThick : 1.0;
              const slabAlpha = 1.0 - Math.pow(1.0 - sB.a, frac);
              holdoutT *= (1.0 - slabAlpha);
            }

            if (holdoutT <= cutoff) {
              holdoutT = 0.0;
              break;
            }
          }

          if (holdoutT > cutoff) {
            attenuated.push({
              zFront: sA.zFront,
              zBack: sA.zBack,
              r: sA.r * holdoutT,
              g: sA.g * holdoutT,
              b: sA.b * holdoutT,
              a: sA.a * holdoutT
            });
          }
        }

        pixelLists[p] = attenuated;
      }
    }

    const outBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
    if (deepIn.metadata) {
      outBuf.metadata = JSON.parse(JSON.stringify(deepIn.metadata));
    }
    return outBuf;
  }
}

