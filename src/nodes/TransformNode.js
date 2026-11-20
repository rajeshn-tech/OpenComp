/**
 * OpenComp - Transform Node
 * 2D Translation, Rotation, Uniform/Non-uniform Scale, Center Pivot, and Bilinear Filtering.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class TransformNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Transform', 'Transform', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');

    this.addKnob('translateX', 'Translate X', 'number', 0.0, { min: -1000.0, max: 1000.0, step: 1.0 });
    this.addKnob('translateY', 'Translate Y', 'number', 0.0, { min: -1000.0, max: 1000.0, step: 1.0 });
    this.addKnob('rotate', 'Rotate (deg)', 'number', 0.0, { min: -360.0, max: 360.0, step: 0.5 });
    this.addKnob('scale', 'Scale', 'number', 1.0, { min: 0.01, max: 10.0, step: 0.01 });
    this.addKnob('scaleY', 'Scale Y (Aspect)', 'number', 1.0, { min: 0.01, max: 10.0, step: 0.01 });
    this.addKnob('centerRatio', 'Center Pivot', 'select', 'center', {
      options: [
        { label: 'Image Center (0.5, 0.5)', value: 'center' },
        { label: 'Top-Left (0.0, 0.0)', value: 'topleft' }
      ]
    });
  }

  /**
   * Compute dynamic BBox transformed by translation, rotation, and non-uniform scaling
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return new BBox(0, 0, 0, 0);

    const inBBox = inputBuf.bbox ? inputBuf.bbox.clone() : BBox.fromFormat(inputBuf.width, inputBuf.height);
    if (inBBox.isEmpty()) return inBBox;

    const tx = Number(this.getKnobValue('translateX', context)) ?? 0.0;
    const ty = Number(this.getKnobValue('translateY', context)) ?? 0.0;
    const rotDeg = Number(this.getKnobValue('rotate', context)) ?? 0.0;
    const scale = Math.max(0.0001, Number(this.getKnobValue('scale', context)) ?? 1.0);
    const scaleY = Math.max(0.0001, Number(this.getKnobValue('scaleY', context)) ?? 1.0);
    const centerMode = this.getKnobValue('centerRatio', context) || 'center';

    const w = inputBuf.width;
    const h = inputBuf.height;
    const cx = centerMode === 'center' ? w * 0.5 : 0.0;
    const cy = centerMode === 'center' ? h * 0.5 : 0.0;

    const rad = (rotDeg * Math.PI) / 180.0;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const sx = scale;
    const sy = scale * scaleY;

    // Transform 4 corners of inBBox
    const corners = [
      [inBBox.x, inBBox.y],
      [inBBox.r, inBBox.y],
      [inBBox.r, inBBox.t],
      [inBBox.x, inBBox.t]
    ];

    const transformedPoints = corners.map(([px, py]) => {
      // 1. Center relative
      const rx = (px - cx) * sx;
      const ry = (py - cy) * sy;
      // 2. Rotate
      const xRot = rx * cosA - ry * sinA;
      const yRot = rx * sinA + ry * cosA;
      // 3. Uncenter + translate
      return [xRot + cx + tx, yRot + cy + ty];
    });

    return BBox.fromPoints(transformedPoints);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return null;

    const tx = Number(this.getKnobValue('translateX', context)) ?? 0.0;
    const ty = Number(this.getKnobValue('translateY', context)) ?? 0.0;
    const rotDeg = Number(this.getKnobValue('rotate', context)) ?? 0.0;
    const scale = Math.max(0.0001, Number(this.getKnobValue('scale', context)) ?? 1.0);
    const scaleY = Math.max(0.0001, Number(this.getKnobValue('scaleY', context)) ?? 1.0);
    const centerMode = this.getKnobValue('centerRatio', context) || 'center';

    const w = inputBuf.width;
    const h = inputBuf.height;

    const outBBox = this.getBBox(inputs, context);

    // If identity transform, return clone with updated BBox
    if (tx === 0 && ty === 0 && rotDeg === 0 && scale === 1.0 && scaleY === 1.0) {
      const cloned = inputBuf.clone();
      cloned.bbox = outBBox;
      return cloned;
    }

    const cx = centerMode === 'center' ? w * 0.5 : 0.0;
    const cy = centerMode === 'center' ? h * 0.5 : 0.0;

    const rad = (-rotDeg * Math.PI) / 180.0; // Invert angle for backward lookup
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const invSx = 1.0 / scale;
    const invSy = 1.0 / (scale * scaleY);

    const result = new PixelBuffer(w, h);
    result.bbox = outBBox;
    result.copyChannelsFrom(inputBuf);
    const src = inputBuf.data;
    const dst = result.data;

    // Restrict rasterization to active format canvas intersection
    const startY = Math.max(0, Math.floor(outBBox.y));
    const endY = Math.min(h, Math.ceil(outBBox.t));
    const startX = Math.max(0, Math.floor(outBBox.x));
    const endX = Math.min(w, Math.ceil(outBBox.r));

    if (startX >= endX || startY >= endY) {
      return result; // Entire transformed image lies outside canvas
    }

    // Backward mapping for Bilinear sampling
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        // 1. Shift by translate
        const px = x - tx - cx;
        const py = y - ty - cy;

        // 2. Rotate
        const rx = px * cosA - py * sinA;
        const ry = px * sinA + py * cosA;

        // 3. Scale and un-center
        const srcX = rx * invSx + cx;
        const srcY = ry * invSy + cy;

        const outIdx = (y * w + x) * 4;

        if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
          // Bilinear interpolation
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = Math.min(w - 1, x0 + 1);
          const y1 = Math.min(h - 1, y0 + 1);

          const fx = srcX - x0;
          const fy = srcY - y0;

          const idx00 = (y0 * w + x0) * 4;
          const idx01 = (y0 * w + x1) * 4;
          const idx10 = (y1 * w + x0) * 4;
          const idx11 = (y1 * w + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const top = src[idx00 + c] * (1.0 - fx) + src[idx01 + c] * fx;
            const bottom = src[idx10 + c] * (1.0 - fx) + src[idx11 + c] * fx;
            dst[outIdx + c] = top * (1.0 - fy) + bottom * fy;
          }
        }
      }
    }

    return result;
  }
}

