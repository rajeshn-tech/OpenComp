/**
 * OpenComp - Write Node
 * Renders and exports composited frames to PNG, WebP, or JPEG formats.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { ImageIO } from '../core/ImageIO.js';
import { globalOCIO } from '../core/OCIOManager.js';

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
    this.addKnob('compression', 'EXR Compression', 'select', 'none', {
      options: [
        { label: 'Uncompressed (NONE)', value: 'none' },
        { label: 'DWAA Lossy 32-scanline (DWAA)', value: 'dwaa' },
        { label: 'DWAB Lossy 256-scanline (DWAB)', value: 'dwab' },
        { label: 'ZIP Lossless (ZIP)', value: 'zip' }
      ]
    });
    this.addKnob('compressionQuality', 'DWAA/B Quality', 'number', 45.0, { min: 1.0, max: 500.0, step: 1.0 });
    this.addKnob('channels', 'Channels', 'select', 'all', {
      options: [
        { label: 'All Channels & AOVs', value: 'all' },
        { label: 'RGBA Only', value: 'rgba' },
        { label: 'RGB Only', value: 'rgb' }
      ]
    });
    this.addKnob('quality', 'Quality', 'number', 0.95, { min: 0.1, max: 1.0, step: 0.05 });

    const csOptions = [
      { label: 'default (linear)', value: 'default' },
      ...globalOCIO.getColorSpaces().map(s => ({ label: s, value: s }))
    ];
    this.addKnob('colorspace', 'Colorspace', 'select', 'default', { options: csOptions });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;
    return inputBuf; // Pass-through
  }

  /**
   * Trigger frame download or file export
   * @param {import('../core/PixelBuffer.js').PixelBuffer} buffer 
   * @param {string|null} outPath
   */
  exportFrame(buffer, outPath = null) {
    if (!buffer) return null;

    const filePrefix = this.getKnobValue('filePrefix') || 'render';
    const fileType = this.getKnobValue('fileType') || 'image/png';
    const quality = Number(this.getKnobValue('quality')) ?? 0.95;
    const compression = this.getKnobValue('compression') || 'none';
    const compQuality = Number(this.getKnobValue('compressionQuality')) || 45.0;
    const channelsMode = this.getKnobValue('channels') || 'all';
    const isHalf = (this.getKnobValue('datatype') !== '32bit_float');
    const cs = this.getKnobValue('colorspace') || 'default';

    // Apply output color space transform if non-default
    let processedBuf = buffer;
    if (cs !== 'default' && cs !== 'linear' && cs !== 'raw' && cs !== globalOCIO.getWorkingSpace()) {
      processedBuf = new PixelBuffer(buffer.width, buffer.height);
      if (buffer.extraChannels && processedBuf.copyChannelsFrom) {
        processedBuf.copyChannelsFrom(buffer);
      }
      processedBuf.data.set(buffer.data);
      globalOCIO.transform(processedBuf, globalOCIO.getWorkingSpace(), cs);
    }

    if (fileType === 'image/exr') {
      let exportBuf = processedBuf;
      if (channelsMode === 'rgba' && processedBuf.extraChannels && processedBuf.extraChannels.size > 0) {
        exportBuf = new PixelBuffer(processedBuf.width, processedBuf.height);
        exportBuf.data.set(processedBuf.data);
      }

      let exrBytes = null;
      if (compression !== 'none' && ImageIO.isNode && ImageIO.isNode()) {
        exrBytes = ImageIO.writeEXRViaBridgeSync(exportBuf, isHalf, compression, compQuality, outPath);
      } else {
        exrBytes = ImageIO.writeEXR(exportBuf, isHalf);
        if (outPath && ImageIO.isNode && ImageIO.isNode()) {
          const fs = (typeof process !== 'undefined' && process.getBuiltinModule) 
            ? process.getBuiltinModule('node:fs') 
            : null;
          if (fs) {
            fs.writeFileSync(outPath, exrBytes);
            return { status: 'ok', path: outPath, size: exrBytes.length };
          }
        }
      }

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
      canvas.width = processedBuf.width;
      canvas.height = processedBuf.height;
      const ctx = canvas.getContext('2d');

      const imgData = processedBuf.toImageData(0.0, 1.0, 'RGBA');
      ctx.putImageData(imgData, 0, 0);

      const ext = fileType === 'image/jpeg' ? 'jpg' : fileType === 'image/webp' ? 'webp' : 'png';
      const link = document.createElement('a');
      link.download = `${filePrefix}.${ext}`;
      link.href = canvas.toDataURL(fileType, quality);
      link.click();
    }
  }
}

