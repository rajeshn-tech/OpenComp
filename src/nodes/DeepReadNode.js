/**
 * OpenComp - DeepRead Node
 * Ingests multi-sample DeepScanLine OpenEXR image files.
 * Preserves variable per-pixel sample counts and floating-point precision.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { DeepPixelBuffer } from '../core/deep/DeepPixelBuffer.js';
import { DeepEXRBridgeClient } from '../core/deep/DeepEXRBridgeClient.js';

const fs = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:fs') 
  : null;
const path = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:path') 
  : null;

export class DeepReadNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'DeepRead', 'Deep', x, y);
    this.width = 110;
    this.height = 38;

    this.addKnob('file', 'File Path', 'string', '');
    this.cachedDeepBuffer = null;
    this.cachedFilePath = null;
  }

  findKnobKey(key) {
    const clean = String(key).toLowerCase().replace(/_/g, '');
    if (clean === 'filepath' || clean === 'path') return 'file';
    return super.findKnobKey(key);
  }

  compute(inputs, context = {}) {
    const rawFile = this.getKnobValue('file', context) || '';
    if (!rawFile || !path || !fs) {
      return new DeepPixelBuffer(1920, 1080);
    }

    const fullPath = path.resolve(rawFile);
    if (this.cachedDeepBuffer && this.cachedFilePath === fullPath) {
      return this.cachedDeepBuffer;
    }

    if (!fs.existsSync(fullPath)) {
      console.warn(`DeepReadNode: File not found: ${fullPath}`);
      return new DeepPixelBuffer(1920, 1080);
    }

    try {
      const deepBuf = DeepEXRBridgeClient.readDeepEXR(fullPath);
      this.cachedDeepBuffer = deepBuf;
      this.cachedFilePath = fullPath;
      return deepBuf;
    } catch (err) {
      console.error(`DeepReadNode error reading ${fullPath}:`, err);
      return new DeepPixelBuffer(1920, 1080);
    }
  }
}
