/**
 * OpenComp - Planar Tracker Node
 * Production 4-corner perspective planar tracking standard VFX implementation.
 * Features multi-point planar homography estimation, perspective deformation,
 * occlusion resistance, stabilization, and direct export to CornerPin2D.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';
import { PlanarTrackerEngine } from '../core/PlanarTrackerEngine.js';
import { CornerPinNode } from './CornerPinNode.js';

export class PlanarTrackerNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'PlanarTracker', 'Transform', x, y);
    this.width = 120;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate');

    this.addKnob('transformMode', 'Transform Mode', 'select', 'none', {
      options: [
        { label: 'None (Pass-through)', value: 'none' },
        { label: 'Stabilize Plane', value: 'stabilize' },
        { label: 'Matchmove Plane', value: 'matchmove' }
      ]
    });

    this.addKnob('referenceFrame', 'Reference Frame', 'number', 1, { min: 1, max: 10000, step: 1 });
    this.addKnob('gridDensity', 'Grid Density', 'select', '4x4', {
      options: [
        { label: '3 x 3 Features', value: '3x3' },
        { label: '4 x 4 Features (Standard)', value: '4x4' },
        { label: '5 x 5 Features (Dense)', value: '5x5' }
      ]
    });
    this.addKnob('rangeStart', 'Range Start', 'number', 1, { min: 1, max: 10000, step: 1 });
    this.addKnob('rangeEnd', 'Range End', 'number', 100, { min: 1, max: 10000, step: 1 });

    this.engine = new PlanarTrackerEngine();
  }

  get currentCorners() {
    return this.engine.getCornersAtFrame(1);
  }

  set currentCorners(pts) {
    if (Array.isArray(pts) && pts.length === 4) {
      this.engine.setCorners(pts[0], pts[1], pts[2], pts[3], 1);
    }
  }

  get referenceCorners() {
    const rf = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);
    return this.engine.getCornersAtFrame(rf);
  }

  set referenceCorners(pts) {
    const rf = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);
    if (Array.isArray(pts) && pts.length === 4) {
      this.engine.setCorners(pts[0], pts[1], pts[2], pts[3], rf);
    }
  }

  setCorners(p1, p2, p3, p4, frame = 1) {
    this.engine.setCorners(p1, p2, p3, p4, frame);
    this.markDirty();
  }

  getCornersAtFrame(frame) {
    return this.engine.getCornersAtFrame(frame);
  }

  trackStep(currBuffer, prevFrame, targetFrame) {
    const res = this.engine.trackStep(currBuffer, prevFrame, targetFrame);
    this.markDirty();
    return res;
  }

  async trackSequence(getBufferAtFrame, startFrame, endFrame, progressCallback = null) {
    const direction = startFrame <= endFrame ? 1 : -1;
    const refFrame = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);

    const refBuf = await getBufferAtFrame(refFrame);
    if (refBuf) {
      this.engine.initPlanarFeatures(refBuf, refFrame);
    }

    let prevF = startFrame;
    for (let f = startFrame + direction; direction > 0 ? f <= endFrame : f >= endFrame; f += direction) {
      const curBuf = await getBufferAtFrame(f);
      if (!curBuf) break;

      this.trackStep(curBuf, prevF, f);
      prevF = f;

      if (progressCallback) {
        progressCallback(f, endFrame);
      }
    }
  }

  /**
   * Export tracked 4 corners to CornerPin knob values
   * @param {number} frame
   * @param {number} [width]
   * @param {number} [height]
   */
  exportCornerPinKnobs(frame, width = 1920, height = 1080) {
    const [p1, p2, p3, p4] = this.getCornersAtFrame(frame);
    return {
      to1_x: p1.x / width,
      to1_y: p1.y / height,
      to2_x: p2.x / width,
      to2_y: p2.y / height,
      to3_x: p3.x / width,
      to3_y: p3.y / height,
      to4_x: p4.x / width,
      to4_y: p4.y / height
    };
  }

  getBBox(inputs, context = {}) {
    let inBBox = null;
    if (inputs instanceof BBox) inBBox = inputs.clone();
    else if (Array.isArray(inputs)) {
      const f = inputs[0];
      inBBox = f instanceof BBox ? f.clone() : (f && f.bbox ? f.bbox.clone() : (f && f.width ? BBox.fromFormat(f.width, f.height) : new BBox(0, 0, 0, 0)));
    } else if (inputs && typeof inputs === 'object') {
      const b = inputs['in'] || inputs['input'] || Object.values(inputs)[0];
      inBBox = b instanceof BBox ? b.clone() : (b && b.bbox ? b.bbox.clone() : (b && b.width ? BBox.fromFormat(b.width, b.height) : new BBox(0, 0, 0, 0)));
    }
    if (!inBBox) inBBox = new BBox(0, 0, 0, 0);

    const mode = this.getKnobValue('transformMode', typeof context === 'object' ? context : { frame: context });
    if (mode === 'none') return inBBox;

    const frame = typeof context === 'number' ? context : (context && context.frame !== undefined ? context.frame : 1);
    const [p1, p2, p3, p4] = this.getCornersAtFrame(frame);

    return BBox.fromPoints([
      [p1.x, p1.y],
      [p2.x, p2.y],
      [p3.x, p3.y],
      [p4.x, p4.y]
    ]).union(inBBox);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return null;

    const mode = this.getKnobValue('transformMode', context) || 'none';
    if (mode === 'none') {
      const out = inputBuf.clone();
      out.bbox = this.getBBox(inputs, context);
      return out;
    }

    const frame = context.frame !== undefined ? context.frame : 1;
    const refFrame = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);

    const [p1Cur, p2Cur, p3Cur, p4Cur] = this.getCornersAtFrame(frame);
    const [p1Ref, p2Ref, p3Ref, p4Ref] = this.getCornersAtFrame(refFrame);

    const w = inputBuf.width;
    const h = inputBuf.height;
    const outBuf = new PixelBuffer(w, h);
    const src = inputBuf.data;
    const dst = outBuf.data;

    let Hinv = null;
    if (mode === 'stabilize') {
      // Maps current planar coordinates back to reference planar coordinates
      Hinv = CornerPinNode.computeHomography(p1Cur, p2Cur, p3Cur, p4Cur, p1Ref, p2Ref, p3Ref, p4Ref);
    } else if (mode === 'matchmove') {
      // Maps reference planar coordinates into current planar coordinates
      Hinv = CornerPinNode.computeHomography(p1Ref, p2Ref, p3Ref, p4Ref, p1Cur, p2Cur, p3Cur, p4Cur);
    }

    if (!Hinv) return inputBuf.clone();

    // Bilinear perspective sampling
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      for (let x = 0; x < w; x++) {
        const Z = Hinv[6] * x + Hinv[7] * y + Hinv[8];
        if (Math.abs(Z) < 1e-6) continue;

        const srcX = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / Z;
        const srcY = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / Z;

        const outIdx = rowOffset + x * 4;

        if (srcX >= 0 && srcX < w - 1 && srcY >= 0 && srcY < h - 1) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const fx = srcX - x0;
          const fy = srcY - y0;
          const ifx = 1.0 - fx;
          const ify = 1.0 - fy;

          const idx00 = (y0 * w + x0) * 4;
          const idx10 = (y0 * w + x1) * 4;
          const idx01 = (y1 * w + x0) * 4;
          const idx11 = (y1 * w + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const top = src[idx00 + c] * ifx + src[idx10 + c] * fx;
            const bot = src[idx01 + c] * ifx + src[idx11 + c] * fx;
            dst[outIdx + c] = top * ify + bot * fy;
          }
        }
      }
    }

    outBuf.bbox = this.getBBox(inputs, context);
    outBuf.copyChannelsFrom(inputBuf);
    return outBuf;
  }

  drawOverlay(ctx, zoom, panX, panY, context = {}) {
    const frame = context.frame !== undefined ? context.frame : 1;
    const [p1, p2, p3, p4] = this.getCornersAtFrame(frame);

    const s1 = { x: p1.x * zoom + panX, y: p1.y * zoom + panY };
    const s2 = { x: p2.x * zoom + panX, y: p2.y * zoom + panY };
    const s3 = { x: p3.x * zoom + panX, y: p3.y * zoom + panY };
    const s4 = { x: p4.x * zoom + panX, y: p4.y * zoom + panY };

    ctx.save();

    // 1. Planar Outer Polygon
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.lineTo(s3.x, s3.y);
    ctx.lineTo(s4.x, s4.y);
    ctx.closePath();
    ctx.stroke();

    // 2. Internal Grid Lines (4x4)
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const u = i / 4.0;
      // Vertical grid line
      const t1x = (1 - u) * s1.x + u * s2.x;
      const t1y = (1 - u) * s1.y + u * s2.y;
      const t2x = (1 - u) * s4.x + u * s3.x;
      const t2y = (1 - u) * s4.y + u * s3.y;
      ctx.beginPath();
      ctx.moveTo(t1x, t1y);
      ctx.lineTo(t2x, t2y);
      ctx.stroke();

      // Horizontal grid line
      const h1x = (1 - u) * s1.x + u * s4.x;
      const h1y = (1 - u) * s1.y + u * s4.y;
      const h2x = (1 - u) * s2.x + u * s3.x;
      const h2y = (1 - u) * s2.y + u * s3.y;
      ctx.beginPath();
      ctx.moveTo(h1x, h1y);
      ctx.lineTo(h2x, h2y);
      ctx.stroke();
    }

    // 3. Corner Handles with numbers
    const corners = [s1, s2, s3, s4];
    const labels = ['1 (BL)', '2 (BR)', '3 (TR)', '4 (TL)'];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText(labels[i], c.x + 8, c.y + 3);
    }

    ctx.restore();
  }

  serialize() {
    const base = super.serialize();
    base.engine = this.engine.serialize();
    return base;
  }

  deserialize(data) {
    super.deserialize(data);
    if (data.engine) {
      this.engine = PlanarTrackerEngine.deserialize(data.engine);
    }
  }
}
