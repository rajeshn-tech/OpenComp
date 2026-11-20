/**
 * OpenComp - Reformat Node
 * Resizes, crops, and reformats plates matching Foundry Nuke's Reformat node.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ReformatNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Reformat', 'Transform', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    this.addKnob('format', 'Target Format', 'select', '1920x1080', {
      options: [
        { label: '1920 x 1080 (HD 1080p)', value: '1920x1080' },
        { label: '3840 x 2160 (4K UHD)', value: '3840x2160' },
        { label: '2048 x 1080 (2K DCI)', value: '2048x1080' },
        { label: '4096 x 2160 (4K DCI)', value: '4096x2160' },
        { label: '7680 x 4320 (8K UHD)', value: '7680x4320' },
        { label: '8192 x 4320 (8K DCI)', value: '8192x4320' },
        { label: '12288 x 6480 (12K DCI)', value: '12288x6480' },
        { label: '1280 x 720 (720p HD)', value: '1280x720' },
        { label: '1080 x 1080 (Square 1:1)', value: '1080x1080' }
      ]
    });

    this.addKnob('resizeType', 'Resize Mode', 'select', 'fit', {
      options: [
        { label: 'Fit (Letterbox / Pillarbox)', value: 'fit' },
        { label: 'Fill (Crop to Cover)', value: 'fill' },
        { label: 'Distort (Stretch to Match)', value: 'distort' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const format = this.getKnobValue('format') || '1920x1080';
    const [targetW, targetH] = format.split('x').map(Number);
    const mode = this.getKnobValue('resizeType') || 'fit';

    if (inputBuf.width === targetW && inputBuf.height === targetH) {
      return inputBuf.clone();
    }

    const result = new PixelBuffer(targetW, targetH);
    const src = inputBuf.data;
    const dst = result.data;
    const srcW = inputBuf.width;
    const srcH = inputBuf.height;

    let scaleX = targetW / srcW;
    let scaleY = targetH / srcH;
    let offsetX = 0;
    let offsetY = 0;

    if (mode === 'fit') {
      const scale = Math.min(scaleX, scaleY);
      scaleX = scale;
      scaleY = scale;
      offsetX = (targetW - srcW * scale) * 0.5;
      offsetY = (targetH - srcH * scale) * 0.5;
    } else if (mode === 'fill') {
      const scale = Math.max(scaleX, scaleY);
      scaleX = scale;
      scaleY = scale;
      offsetX = (targetW - srcW * scale) * 0.5;
      offsetY = (targetH - srcH * scale) * 0.5;
    }

    // Inverse sampling with bilinear interpolation
    for (let y = 0; y < targetH; y++) {
      const srcY = (y - offsetY) / scaleY;
      if (srcY < 0 || srcY >= srcH) continue;

      const y0 = Math.floor(srcY);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const wy = srcY - y0;

      for (let x = 0; x < targetW; x++) {
        const srcX = (x - offsetX) / scaleX;
        if (srcX < 0 || srcX >= srcW) continue;

        const x0 = Math.floor(srcX);
        const x1 = Math.min(srcW - 1, x0 + 1);
        const wx = srcX - x0;

        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = (y0 * srcW + x1) * 4;
        const idx01 = (y1 * srcW + x0) * 4;
        const idx11 = (y1 * srcW + x1) * 4;

        const outIdx = (y * targetW + x) * 4;

        for (let c = 0; c < 4; c++) {
          const top = src[idx00 + c] * (1 - wx) + src[idx10 + c] * wx;
          const bottom = src[idx01 + c] * (1 - wx) + src[idx11 + c] * wx;
          dst[outIdx + c] = top * (1 - wy) + bottom * wy;
        }
      }
    }

    return result;
  }
}

