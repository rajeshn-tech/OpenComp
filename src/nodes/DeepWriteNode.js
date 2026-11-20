/**
 * OpenComp - DeepWrite Node
 * Serializes DeepPixelBuffers to authentic DeepScanLine OpenEXR files on disk.
 * Preserves variable sample counts, per-sample depths, and floating-point emissions.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';
import { DeepEXRBridgeClient } from '../core/deep/DeepEXRBridgeClient.js';

const path = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:path') 
  : null;

export class DeepWriteNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepWrite', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Deep Image Input');

    this.addKnob('file', 'Output File Path', 'string', '');
    this.addKnob('compression', 'Compression', 'select', 'ZIPS', {
      options: [
        { label: 'ZIPS (1 scanline zip - recommended)', value: 'ZIPS' },
        { label: 'NONE (Uncompressed)', value: 'NONE' }
      ]
    });
  }

  findKnobKey(key) {
    const clean = String(key).toLowerCase().replace(/_/g, '');
    if (clean === 'filepath' || clean === 'path') return 'file';
    return super.findKnobKey(key);
  }

  compute(inputs, context = {}) {
    const deepIn = inputs && (inputs['in'] !== undefined ? inputs['in'] : (Array.isArray(inputs) ? inputs[0] : null));

    if (!(deepIn instanceof DeepPixelBuffer)) {
      return null;
    }

    const rawFile = this.getKnobValue('file', context) || '';
    if (!rawFile || !path) {
      return deepIn; // Pass-through if no file configured or in browser
    }

    const fullPath = path.resolve(rawFile);
    const compression = this.getKnobValue('compression', context) || 'ZIPS';

    try {
      DeepEXRBridgeClient.writeDeepEXR(deepIn, fullPath, compression);
    } catch (err) {
      console.error(`DeepWriteNode error writing ${fullPath}:`, err);
    }

    return deepIn;
  }
}
