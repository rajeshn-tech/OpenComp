/**
 * OpenComp - Constant Node
 * Generates a solid floating-point color canvas of specified format.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ConstantNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Constant', 'Image', x, y);
    this.width = 110;
    this.height = 38;

    this.addKnob('colorR', 'Red', 'number', 0.0, { min: 0.0, max: 2.0, step: 0.01 });
    this.addKnob('colorG', 'Green', 'number', 0.0, { min: 0.0, max: 2.0, step: 0.01 });
    this.addKnob('colorB', 'Blue', 'number', 0.0, { min: 0.0, max: 2.0, step: 0.01 });
    this.addKnob('colorA', 'Alpha', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('format', 'Format', 'select', '1920x1080', {
      options: [
        { label: '1920 x 1080 (HD)', value: '1920x1080' },
        { label: '1280 x 720 (720p)', value: '1280x720' },
        { label: '2048 x 1080 (2K DCI)', value: '2048x1080' },
        { label: '3840 x 2160 (4K UHD)', value: '3840x2160' },
        { label: '4096 x 2160 (4K DCI)', value: '4096x2160' },
        { label: '7680 x 4320 (8K UHD)', value: '7680x4320' },
        { label: '8192 x 4320 (8K DCI)', value: '8192x4320' },
        { label: '12288 x 6480 (12K DCI)', value: '12288x6480' },
        { label: '15360 x 8640 (16K UHD Tiled)', value: '15360x8640' }
      ]
    });
  }

  compute(inputs, context = {}) {
    let w = 1920;
    let h = 1080;
    const format = String(this.getKnobValue('format', context) || '1920x1080');
    if (format.includes('x')) {
      const parts = format.split('x').map(Number);
      if (!isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
        w = parts[0];
        h = parts[1];
      }
    }
    const buf = PixelBuffer.createBuffer(w, h);

    const r = Number(this.getKnobValue('colorR', context)) ?? 0.0;
    const g = Number(this.getKnobValue('colorG', context)) ?? 0.0;
    const b = Number(this.getKnobValue('colorB', context)) ?? 0.0;
    const a = Number(this.getKnobValue('colorA', context)) ?? 1.0;

    buf.fill(r, g, b, a);
    return buf;
  }
}

