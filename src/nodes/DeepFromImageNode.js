/**
 * OpenComp - DeepFromImage Node
 * Converts a standard 2D PixelBuffer + depth channel into a 1-sample-per-pixel DeepPixelBuffer.
 * Preserves high-dynamic-range float32 RGB and Alpha values at exact pixel depths.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class DeepFromImageNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepFromImage', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', '2D Image Plate');
    this.addInput('depth', 'depth', 'Optional 2D Depth Map');

    this.addKnob('defaultDepth', 'Default Depth (Z)', 'number', 5.0, { min: 0.1, max: 10000.0, step: 0.1 });
    this.addKnob('depthChannel', 'Depth Channel', 'select', 'depth.Z', {
      options: [
        { label: 'depth.Z', value: 'depth.Z' },
        { label: 'Z', value: 'Z' },
        { label: 'Red (Luma Depth)', value: 'red' },
        { label: 'Alpha', value: 'alpha' }
      ]
    });
    this.addKnob('keepZeroAlpha', 'Keep Zero Alpha Samples', 'boolean', false);
  }

  compute(inputs, context = {}) {
    const imgIn = inputs && (inputs['in'] || (Array.isArray(inputs) ? inputs[0] : null));
    const depthIn = inputs && (inputs['depth'] || (Array.isArray(inputs) ? inputs[1] : null));

    if (!(imgIn instanceof PixelBuffer)) {
      if (imgIn instanceof DeepPixelBuffer) {
        return imgIn.clone();
      }
      return new DeepPixelBuffer(1920, 1080);
    }

    const W = imgIn.width;
    const H = imgIn.height;
    const totalPixels = W * H;

    const defaultDepth = Number(this.getKnobValue('defaultDepth', context)) || 5.0;
    const depthChanName = this.getKnobValue('depthChannel', context) || 'depth.Z';
    const keepZeroAlpha = Boolean(this.getKnobValue('keepZeroAlpha', context));

    // Resolve depth buffer source
    let depthArray = null;
    if (depthIn instanceof PixelBuffer) {
      depthArray = depthIn.getChannel(depthChanName) || depthIn.getChannel('depth.Z') || depthIn.getChannel('Z');
      if (!depthArray && depthChanName === 'red') {
        depthArray = new Float32Array(totalPixels);
        for (let i = 0; i < totalPixels; i++) depthArray[i] = depthIn.data[i * 4];
      }
    }

    if (!depthArray) {
      depthArray = imgIn.getChannel(depthChanName) || imgIn.getChannel('depth.Z') || imgIn.getChannel('Z');
    }

    const imgData = imgIn.data;
    const pixelLists = new Array(totalPixels);

    for (let p = 0; p < totalPixels; p++) {
      const cIdx = p * 4;
      const r = imgData[cIdx];
      const g = imgData[cIdx + 1];
      const b = imgData[cIdx + 2];
      const a = imgData[cIdx + 3];

      if (a > 0.00001 || keepZeroAlpha) {
        let z = defaultDepth;
        if (depthArray && depthArray.length > p) {
          const val = depthArray[p];
          if (val > 0.0001) z = val;
        }

        pixelLists[p] = [{
          zFront: z,
          zBack: z,
          r,
          g,
          b,
          a
        }];
      } else {
        pixelLists[p] = [];
      }
    }

    const deepBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
    if (imgIn.metadata) {
      deepBuf.metadata = JSON.parse(JSON.stringify(imgIn.metadata));
    }
    return deepBuf;
  }
}

