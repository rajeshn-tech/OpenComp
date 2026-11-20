/**
 * OpenComp - DeepCrop Node
 * Clips deep samples against spatial near and far depth planes [znear, zfar].
 * Correctly slices volumetric slabs, adjusting opacity according to physical depth preserved.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';

export class DeepCropNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepCrop', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Deep Image Input');

    this.addKnob('useNear', 'Use Near Clip', 'boolean', false);
    this.addKnob('znear', 'Near Plane (Z)', 'number', 1.0, { min: 0.0, max: 10000.0, step: 0.1 });

    this.addKnob('useFar', 'Use Far Clip', 'boolean', false);
    this.addKnob('zfar', 'Far Plane (Z)', 'number', 100.0, { min: 0.0, max: 10000.0, step: 0.1 });

    this.addKnob('sliceVolumetrics', 'Slice Volumetrics', 'boolean', true);
  }

  findKnobKey(key) {
    const clean = String(key).toLowerCase().replace(/_/g, '');
    if (clean === 'useznear' || clean === 'usenear') return 'useNear';
    if (clean === 'usezfar' || clean === 'usefar') return 'useFar';
    if (clean === 'znear' || clean === 'near') return 'znear';
    if (clean === 'zfar' || clean === 'far') return 'zfar';
    return super.findKnobKey(key);
  }

  compute(inputs, context = {}) {
    const deepIn = inputs && (inputs['in'] !== undefined ? inputs['in'] : (Array.isArray(inputs) ? inputs[0] : null));

    if (!(deepIn instanceof DeepPixelBuffer)) {
      return new DeepPixelBuffer(1920, 1080);
    }

    const useNear = Boolean(this.getKnobValue('useNear', context) ?? this.getKnobValue('useZNear', context) ?? this.getKnobValue('use_znear', context));
    const znear = Number(this.getKnobValue('znear', context) ?? this.getKnobValue('zNear', context)) || 1.0;

    const useFar = Boolean(this.getKnobValue('useFar', context) ?? this.getKnobValue('useZFar', context) ?? this.getKnobValue('use_zfar', context));
    const zfar = Number(this.getKnobValue('zfar', context) ?? this.getKnobValue('zFar', context)) || 100.0;

    const slice = Boolean(this.getKnobValue('sliceVolumetrics', context));

    if (!useNear && !useFar) {
      return deepIn.clone();
    }

    const W = deepIn.width;
    const H = deepIn.height;
    const totalPixels = W * H;
    const pixelLists = new Array(totalPixels);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const samples = deepIn.getSamples(x, y);
        if (samples.length === 0) {
          pixelLists[p] = [];
          continue;
        }

        const kept = [];

        for (let i = 0; i < samples.length; i++) {
          let s = samples[i];
          let zF = s.zFront;
          let zB = s.zBack;
          let r = s.r;
          let g = s.g;
          let b = s.b;
          let a = s.a;

          // Check Near Clip
          if (useNear) {
            if (zB <= znear) {
              continue; // Completely culled in front of near plane
            }
            if (zF < znear && zB > znear) {
              if (slice) {
                const totalThick = zB - zF;
                const preservedThick = zB - znear;
                const frac = totalThick > 1e-6 ? preservedThick / totalThick : 1.0;
                a = 1.0 - Math.pow(1.0 - a, frac);
                r *= frac;
                g *= frac;
                b *= frac;
                zF = znear;
              } else {
                continue;
              }
            }
          }

          // Check Far Clip
          if (useFar) {
            if (zF >= zfar) {
              continue; // Completely culled behind far plane
            }
            if (zF < zfar && zB > zfar) {
              if (slice) {
                const totalThick = zB - zF;
                const preservedThick = zfar - zF;
                const frac = totalThick > 1e-6 ? preservedThick / totalThick : 1.0;
                a = 1.0 - Math.pow(1.0 - a, frac);
                r *= frac;
                g *= frac;
                b *= frac;
                zB = zfar;
              } else {
                continue;
              }
            }
          }

          if (a > 0.00001) {
            kept.push({
              zFront: zF,
              zBack: zB,
              r,
              g,
              b,
              a
            });
          }
        }

        pixelLists[p] = kept;
      }
    }

    const outBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
    if (deepIn.metadata) {
      outBuf.metadata = JSON.parse(JSON.stringify(deepIn.metadata));
    }
    return outBuf;
  }
}
