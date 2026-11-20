/**
 * OpenComp - Write Node
 * Renders and exports composited frames to PNG, WebP, or JPEG formats.
 */

import { Node } from '../core/Node.js';
import { ImageIO } from '../core/ImageIO.js';

export class WriteNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Write', 'Image', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');

    this.addKnob('filePrefix', 'File Prefix', 'text', 'render_comp_v01');
    this.addKnob('fileType', 'Format', 'select', 'image/exr', {
      options: [
        { label: 'OpenEXR (.exr)', value: 'image/exr' },
        { label: 'PNG (Lossless 24/32-bit)', value: 'image/png' },
        { label: 'JPEG (Standard)', value: 'image/jpeg' },
        { label: 'WebP (High Efficiency)', value: 'image/webp' }
      ]
    });
    this.addKnob('datatype', 'EXR Data Type', 'select', '16bit_half', {
      options: [
        { label: '16-bit Half Float (HALF)', value: '16bit_half' },
        { label: '32-bit Full Float (FLOAT)', value: '32bit_float' }
      ]
    });
    this.addKnob('quality', 'Quality', 'number', 0.95, { min: 0.1, max: 1.0, step: 0.05 });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;
    return inputBuf; // Pass-through
  }

  /**
   * Trigger frame download or file export
   * @param {import('../core/PixelBuffer.js').PixelBuffer} buffer 
   */
  exportFrame(buffer) {
    if (!buffer) return;

    const filePrefix = this.getKnobValue('filePrefix') || 'render';
    const fileType = this.getKnobValue('fileType') || 'image/png';
    const quality = Number(this.getKnobValue('quality')) ?? 0.95;

    if (fileType === 'image/exr') {
      const isHalf = (this.getKnobValue('datatype') !== '32bit_float');
      const exrBytes = ImageIO.writeEXR(buffer, isHalf);
      if (typeof document !== 'undefined') {
        const blob = new Blob([exrBytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${filePrefix}.exr`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
      return exrBytes;
    }

    // Render to offline canvas for PNG / WebP / JPEG
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      const ctx = canvas.getContext('2d');

      const imgData = buffer.toImageData(0.0, 1.0, 'RGBA');
      ctx.putImageData(imgData, 0, 0);

      const ext = fileType === 'image/jpeg' ? 'jpg' : fileType === 'image/webp' ? 'webp' : 'png';
      const link = document.createElement('a');
      link.download = `${filePrefix}.${ext}`;
      link.href = canvas.toDataURL(fileType, quality);
      link.click();
    }
  }
}

