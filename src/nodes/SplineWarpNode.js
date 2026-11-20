/**
 * OpenComp - SplineWarp Node
 * Professional dual-spline correspondence deformation node standard VFX implementation.
 * Provides interactive spline-driven image warping, facial re-shaping,
 * boundary distortion, feather controls, and mask modulation.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';
import { SplineWarpEngine } from '../core/SplineWarpEngine.js';

export class SplineWarpNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'SplineWarp', 'Transform', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate');
    this.addInput('mask', 'mask', 'Warp Mask');

    this.addKnob('warp', 'Warp Intensity', 'number', 1.0, { min: 0.0, max: 2.0, step: 0.05 });
    this.addKnob('falloff', 'Falloff Radius (px)', 'number', 200.0, { min: 10.0, max: 1000.0, step: 10.0 });
    this.addKnob('boundaryPadding', 'Boundary Padding (px)', 'number', 64.0, { min: 0.0, max: 512.0, step: 8.0 });

    this.engine = new SplineWarpEngine();
  }

  addPair(name = null) {
    const pair = this.engine.addPair(name);
    pair.influenceRadius = Number(this.getKnobValue('falloff')) || 200.0;
    pair.weight = Number(this.getKnobValue('warp')) || 1.0;
    this.markDirty();
    return pair;
  }

  removePair(id) {
    this.engine.removePair(id);
    this.markDirty();
  }

  getPair(id) {
    return this.engine.getPair(id);
  }

  getAllPairs() {
    return this.engine.pairs;
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

    const frame = typeof context === 'number' ? context : (context && context.frame !== undefined ? context.frame : 1);
    const padding = Number(this.getKnobValue('boundaryPadding', typeof context === 'object' ? context : { frame: context })) || 64.0;

    const points = [
      [inBBox.x, inBBox.y],
      [inBBox.r, inBBox.t]
    ];

    for (const pair of this.engine.pairs) {
      if (!pair.enabled) continue;
      for (const pt of pair.source.points) {
        const p = pt.getAtFrame(frame);
        points.push([p.x - padding, p.y - padding], [p.x + padding, p.y + padding]);
      }
      for (const pt of pair.destination.points) {
        const p = pt.getAtFrame(frame);
        points.push([p.x - padding, p.y - padding], [p.x + padding, p.y + padding]);
      }
    }

    return BBox.fromPoints(points);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return null;

    const maskBuf = inputs['mask'] || null;
    const frame = context.frame !== undefined ? context.frame : 1;

    // Sync global knobs to spline pairs
    const globalWarp = Number(this.getKnobValue('warp', context)) ?? 1.0;
    const globalFalloff = Number(this.getKnobValue('falloff', context)) ?? 200.0;

    for (const pair of this.engine.pairs) {
      pair.weight = globalWarp;
      pair.influenceRadius = globalFalloff;
    }

    const w = inputBuf.width;
    const h = inputBuf.height;
    const outBuf = new PixelBuffer(w, h);

    // If no pairs or warp is 0, return input clone
    if (this.engine.pairs.length === 0 || globalWarp <= 0.0) {
      const out = inputBuf.clone();
      out.bbox = this.getBBox(inputs, context);
      return out;
    }

    // Warp buffer
    this.engine.warpBuffer(inputBuf, outBuf, frame, maskBuf, null);

    outBuf.bbox = this.getBBox(inputs, context);
    outBuf.copyChannelsFrom(inputBuf);
    return outBuf;
  }

  drawOverlay(ctx, zoom, panX, panY, context = {}) {
    const frame = context.frame !== undefined ? context.frame : 1;

    ctx.save();

    for (const pair of this.engine.pairs) {
      if (!pair.enabled) continue;

      const srcPts = pair.source.points;
      const dstPts = pair.destination.points;
      const numPts = Math.min(srcPts.length, dstPts.length);
      if (numPts === 0) continue;

      // 1. Draw Connecting Displacement Vectors (Yellow dashed)
      ctx.strokeStyle = 'rgba(255, 230, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let i = 0; i < numPts; i++) {
        const sp = srcPts[i].getAtFrame(frame);
        const dp = dstPts[i].getAtFrame(frame);
        const sx = sp.x * zoom + panX;
        const sy = sp.y * zoom + panY;
        const dx = dp.x * zoom + panX;
        const dy = dp.y * zoom + panY;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(dx, dy);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 2. Draw Source Spline (Cyan)
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < numPts; i++) {
        const sp = srcPts[i].getAtFrame(frame);
        const sx = sp.x * zoom + panX;
        const sy = sp.y * zoom + panY;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      if (pair.source.closed && numPts > 2) ctx.closePath();
      ctx.stroke();

      // 3. Draw Destination Spline (Magenta)
      ctx.strokeStyle = '#ff00ea';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < numPts; i++) {
        const dp = dstPts[i].getAtFrame(frame);
        const dx = dp.x * zoom + panX;
        const dy = dp.y * zoom + panY;
        if (i === 0) ctx.moveTo(dx, dy);
        else ctx.lineTo(dx, dy);
      }
      if (pair.destination.closed && numPts > 2) ctx.closePath();
      ctx.stroke();

      // 4. Draw Control Point Handles
      for (let i = 0; i < numPts; i++) {
        const sp = srcPts[i].getAtFrame(frame);
        const dp = dstPts[i].getAtFrame(frame);

        // Source handle (Cyan circle)
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(sp.x * zoom + panX, sp.y * zoom + panY, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Destination handle (Magenta square)
        ctx.fillStyle = '#ff00ea';
        ctx.fillRect(dp.x * zoom + panX - 4, dp.y * zoom + panY - 4, 8, 8);
      }
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
      this.engine = SplineWarpEngine.deserialize(data.engine);
    }
  }
}
