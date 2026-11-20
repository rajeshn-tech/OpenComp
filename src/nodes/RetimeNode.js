/**
 * OpenComp - Retime Node
 * Professional sequence retiming standard VFX implementation.
 * Supports speed scaling (slow-mo / fast-motion), reverse playback,
 * frame freezing, boundary clamp/black handling, and exact float32 linear frame blending.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class RetimeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Retime', 'Time', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Sequence');

    this.addKnob('speed', 'Speed', 'number', 1.0, { min: -10.0, max: 10.0, step: 0.1 });
    this.addKnob('reverse', 'Reverse Playback', 'boolean', false);
    this.addKnob('freezeFrame', 'Freeze At Frame (0 = Off)', 'number', 0, { min: 0, max: 10000, step: 1 });
    this.addKnob('filter', 'Interpolation Filter', 'select', 'blend', {
      options: [
        { label: 'Step (Nearest / Frame Duplication)', value: 'step' },
        { label: 'Frame Blend (Cross-Dissolve)', value: 'blend' }
      ]
    });
    this.addKnob('before', 'Before Range', 'select', 'hold', {
      options: [
        { label: 'Hold First Frame', value: 'hold' },
        { label: 'Black / Empty', value: 'black' }
      ]
    });
    this.addKnob('after', 'After Range', 'select', 'hold', {
      options: [
        { label: 'Hold Last Frame', value: 'hold' },
        { label: 'Black / Empty', value: 'black' }
      ]
    });
    this.addKnob('firstFrame', 'First Frame', 'number', 1, { min: 1, max: 10000, step: 1 });
    this.addKnob('lastFrame', 'Last Frame', 'number', 100, { min: 1, max: 10000, step: 1 });
  }

  /**
   * Compute continuous source frame number from target timeline frame
   * @param {number} targetFrame
   * @param {Object} [context={}]
   * @returns {number}
   */
  getSourceFrame(targetFrame, context = {}) {
    const freeze = Math.round(Number(this.getKnobValue('freezeFrame', context)) || 0);
    if (freeze > 0) return freeze;

    const first = Number(this.getKnobValue('firstFrame', context)) ?? 1;
    const last = Number(this.getKnobValue('lastFrame', context)) ?? 100;
    const speed = Number(this.getKnobValue('speed', context)) ?? 1.0;
    const reverse = Boolean(this.getKnobValue('reverse', context));

    let srcFrame;
    if (reverse) {
      srcFrame = last - (targetFrame - first) * Math.abs(speed);
    } else {
      srcFrame = first + (targetFrame - first) * speed;
    }

    return srcFrame;
  }

  getInputContext(inputId, context = {}) {
    const currentFrame = context.frame !== undefined ? context.frame : 1;
    const srcFrame = this.getSourceFrame(currentFrame, context);
    // Integer frame request for primary upstream pull
    return { ...context, frame: Math.round(srcFrame) };
  }

  getBBox(inputs, context = {}) {
    if (inputs instanceof BBox) return inputs.clone();
    if (Array.isArray(inputs)) {
      const f = inputs[0];
      return f instanceof BBox ? f.clone() : (f && f.bbox ? f.bbox.clone() : (f && f.width ? BBox.fromFormat(f.width, f.height) : new BBox(0, 0, 0, 0)));
    }
    const inputBuf = inputs ? (inputs['in'] || inputs['input'] || Object.values(inputs)[0]) : null;
    if (!inputBuf) return new BBox(0, 0, 0, 0);
    return inputBuf instanceof BBox ? inputBuf.clone() : (inputBuf.bbox ? inputBuf.bbox.clone() : BBox.fromFormat(inputBuf.width, inputBuf.height));
  }

  compute(inputs, context = {}) {
    const currentFrame = context.frame !== undefined ? context.frame : 1;
    const srcFrame = this.getSourceFrame(currentFrame, context);

    const first = Number(this.getKnobValue('firstFrame', context)) ?? 1;
    const last = Number(this.getKnobValue('lastFrame', context)) ?? 100;
    const beforeMode = this.getKnobValue('before', context) || 'hold';
    const afterMode = this.getKnobValue('after', context) || 'hold';
    const filter = this.getKnobValue('filter', context) || 'blend';

    // Handle out-of-range boundaries
    if (srcFrame < first) {
      if (beforeMode === 'black') {
        const ref = inputs['in'];
        return ref ? new PixelBuffer(ref.width, ref.height) : null;
      }
    } else if (srcFrame > last) {
      if (afterMode === 'black') {
        const ref = inputs['in'];
        return ref ? new PixelBuffer(ref.width, ref.height) : null;
      }
    }

    // Clamped source frame
    const clampedFrame = Math.max(first, Math.min(last, srcFrame));

    // If step filter or exact integer frame, return direct frame
    const f0 = Math.floor(clampedFrame);
    const f1 = Math.ceil(clampedFrame);
    const frac = clampedFrame - f0;

    if (filter === 'step' || frac < 1e-5 || f0 === f1) {
      const targetInt = Math.round(clampedFrame);
      // Retrieve upstream buffer evaluated at targetInt
      if (this.graph) {
        const inpConn = this.inputs.find(i => i.id === 'in')?.connection;
        if (inpConn) {
          const buf = this.graph.evaluate(inpConn.nodeId, { ...context, frame: targetInt });
          if (buf) return buf.clone();
        }
      }
      return inputs['in'] ? inputs['in'].clone() : null;
    }

    // Frame Blend (Cross-Dissolve): Linear interpolation between f0 and f1
    let buf0 = null;
    let buf1 = null;

    if (this.graph) {
      const inpConn = this.inputs.find(i => i.id === 'in')?.connection;
      if (inpConn) {
        buf0 = this.graph.evaluate(inpConn.nodeId, { ...context, frame: f0 });
        buf1 = this.graph.evaluate(inpConn.nodeId, { ...context, frame: f1 });
      }
    }

    if (!buf0 && inputs['in']) buf0 = inputs['in'];
    if (!buf1 && inputs['in']) buf1 = inputs['in'];
    if (!buf0 || !buf1) return null;

    const w = buf0.width;
    const h = buf0.height;
    const outBuf = new PixelBuffer(w, h);
    const d0 = buf0.data;
    const d1 = buf1.data;
    const out = outBuf.data;
    const len = out.length;

    const w0 = 1.0 - frac;
    const w1 = frac;

    for (let i = 0; i < len; i += 4) {
      out[i] = d0[i] * w0 + d1[i] * w1;
      out[i + 1] = d0[i + 1] * w0 + d1[i + 1] * w1;
      out[i + 2] = d0[i + 2] * w0 + d1[i + 2] * w1;
      out[i + 3] = d0[i + 3] * w0 + d1[i + 3] * w1;
    }

    outBuf.bbox = this.getBBox(inputs, context);
    outBuf.copyChannelsFrom(buf0);
    return outBuf;
  }
}
