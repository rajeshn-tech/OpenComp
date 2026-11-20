/**
 * OpenComp - Ramp Node
 * Generates linear, smooth, and radial gradient ramps standard VFX implementation generator.
 * Used for custom vignetting, light falloff, and gradient matte generation.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class RampNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Ramp', 'Image', x, y);
    this.width = 110;
    this.height = 36;

    this.addKnob('p0_x', 'Start Point X', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('p0_y', 'Start Point Y', 'number', 0.1, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('p1_x', 'End Point X', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('p1_y', 'End Point Y', 'number', 0.9, { min: 0.0, max: 1.0, step: 0.01 });

    this.addKnob('type', 'Ramp Type', 'select', 'smooth', {
      options: [
        { label: 'Linear', value: 'linear' },
        { label: 'Smooth (S-Curve)', value: 'smooth' },
        { label: 'Ease In (Smooth0)', value: 'ease_in' },
        { label: 'Ease Out (Smooth1)', value: 'ease_out' }
      ]
    });

    this.addKnob('color0', 'Start Value', 'number', 0.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('color1', 'End Value', 'number', 1.0, { min: 0.0, max: 2.0, step: 0.05 });

    this.addKnob('format', 'Format', 'select', '1920x1080', {
      options: [
        { label: '1920 x 1080 (HD)', value: '1920x1080' },
        { label: '1280 x 720 (720p)', value: '1280x720' },
        { label: '2048 x 1080 (2K DCI)', value: '2048x1080' },
        { label: '3840 x 2160 (4K UHD)', value: '3840x2160' },
        { label: '7680 x 4320 (8K UHD)', value: '7680x4320' },
        { label: '12288 x 6480 (12K DCI)', value: '12288x6480' }
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
    const result = new PixelBuffer(w, h);
    const dst = result.data;

    const p0x = (Number(this.getKnobValue('p0_x')) ?? 0.5) * w;
    const p0y = (Number(this.getKnobValue('p0_y')) ?? 0.1) * h;
    const p1x = (Number(this.getKnobValue('p1_x')) ?? 0.5) * w;
    const p1y = (Number(this.getKnobValue('p1_y')) ?? 0.9) * h;

    const rampType = this.getKnobValue('type') || 'smooth';
    const c0 = Number(this.getKnobValue('color0')) ?? 0.0;
    const c1 = Number(this.getKnobValue('color1')) ?? 1.0;

    const dx = p1x - p0x;
    const dy = p1y - p0y;
    const lenSq = dx * dx + dy * dy || 1;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        // Project (x, y) onto line segment p0 -> p1
        const vx = x - p0x;
        const vy = y - p0y;
        let t = (vx * dx + vy * dy) / lenSq;
        t = Math.max(0.0, Math.min(1.0, t));

        let val = t;
        if (rampType === 'smooth') {
          // Hermite interpolation: 3t^2 - 2t^3
          val = t * t * (3.0 - 2.0 * t);
        } else if (rampType === 'ease_in') {
          val = t * t;
        } else if (rampType === 'ease_out') {
          val = Math.sqrt(t);
        }

        const outVal = c0 * (1.0 - val) + c1 * val;
        const outIdx = (row + x) * 4;

        dst[outIdx] = outVal;
        dst[outIdx + 1] = outVal;
        dst[outIdx + 2] = outVal;
        dst[outIdx + 3] = outVal;
      }
    }

    return result;
  }
}

