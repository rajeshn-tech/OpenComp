/**
 * OpenComp - ChannelMerge Node
 * Performs channel-level mathematical and boolean operations between two streams
 * (union, intersection, in, out, stencil, mask, absminus, plus, minus, mult, divide, min, max),
 * targeting any arbitrary channel or AOV with mix blending and mask gating (industry standard ChannelMerge).
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class ChannelMergeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ChannelMerge', 'Channel', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('B', 'B', 'Background (B)');
    this.addInput('A', 'A', 'Foreground (A)');
    this.addInput('mask', 'mask', 'Mask (Optional)');

    this.addKnob('operation', 'Operation', 'select', 'union', {
      options: [
        { label: 'union', value: 'union' },
        { label: 'intersection', value: 'intersection' },
        { label: 'in', value: 'in' },
        { label: 'out', value: 'out' },
        { label: 'stencil', value: 'stencil' },
        { label: 'mask', value: 'mask' },
        { label: 'absminus', value: 'absminus' },
        { label: 'plus', value: 'plus' },
        { label: 'minus', value: 'minus' },
        { label: 'multiply', value: 'multiply' },
        { label: 'divide', value: 'divide' },
        { label: 'min', value: 'min' },
        { label: 'max', value: 'max' }
      ]
    });

    this.addKnob('A', 'A Channel', 'string', 'rgba.alpha');
    this.addKnob('B', 'B Channel', 'string', 'rgba.alpha');
    this.addKnob('output', 'Output Channel', 'string', 'rgba.alpha');

    this.addKnob('mix', 'Mix', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('bbox', 'Set BBox To', 'select', 'union', {
      options: [
        { label: 'union (default)', value: 'union' },
        { label: 'intersection', value: 'intersection' },
        { label: 'B', value: 'B' },
        { label: 'A', value: 'A' }
      ]
    });

    this.addKnob('maskChannel', 'Mask Channel', 'select', 'alpha', {
      options: [
        { label: 'Alpha', value: 'alpha' },
        { label: 'Luminance', value: 'luma' }
      ]
    });
    this.addKnob('invertMask', 'Invert Mask', 'boolean', false);
  }

  /**
   * Determine output dynamic BBox according to bbox knob (union, intersection, B, A)
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const bufB = inputs['B'];
    const bufA = inputs['A'];

    if (!bufB && !bufA) return new BBox(0, 0, 0, 0);
    if (!bufB && bufA) return bufA.bbox ? bufA.bbox.clone() : BBox.fromFormat(bufA.width, bufA.height);
    if (bufB && !bufA) return bufB.bbox ? bufB.bbox.clone() : BBox.fromFormat(bufB.width, bufB.height);

    const boxB = bufB.bbox ? bufB.bbox.clone() : BBox.fromFormat(bufB.width, bufB.height);
    const boxA = bufA.bbox ? bufA.bbox.clone() : BBox.fromFormat(bufA.width, bufA.height);
    const mode = this.getKnobValue('bbox', context) || 'union';

    if (mode === 'intersection') {
      return boxB.intersect(boxA);
    } else if (mode === 'B') {
      return boxB;
    } else if (mode === 'A') {
      return boxA;
    }
    // Default: union
    return boxB.union(boxA);
  }

  compute(inputs, context = {}) {
    const bufB = inputs['B'];
    const bufA = inputs['A'];
    const bufMask = inputs['mask'];

    if (this.disabled) {
      if (bufB) return bufB.clone();
      if (bufA) return bufA.clone();
      return null;
    }

    if (!bufB && !bufA) return null;
    if (!bufB && bufA) return bufA.clone();
    if (bufB && !bufA) return bufB.clone();

    const w = bufB.width;
    const h = bufB.height;
    const len = w * h;

    const outBBox = this.getBBox(inputs, context);

    const result = bufB.clone();
    result.bbox = outBBox;

    const resampledA = (bufA.width === w && bufA.height === h) ? bufA : bufA.resample(w, h);
    const resampledMask = (bufMask && (bufMask.width !== w || bufMask.height !== h))
      ? bufMask.resample(w, h)
      : bufMask;

    const op = this.getKnobValue('operation', context) || 'union';
    const chAName = String(this.getKnobValue('A', context) || 'rgba.alpha').trim();
    const chBName = String(this.getKnobValue('B', context) || 'rgba.alpha').trim();
    const outChName = String(this.getKnobValue('output', context) || 'rgba.alpha').trim();
    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));
    const maskChan = this.getKnobValue('maskChannel', context) || 'alpha';
    const invertMask = !!this.getKnobValue('invertMask', context);

    const dataA = this._getChannelData(resampledA, chAName, len) || new Float32Array(len);
    const dataB = this._getChannelData(bufB, chBName, len) || new Float32Array(len);
    const origOut = this._getChannelData(result, outChName, len) || new Float32Array(len);

    const mergedData = new Float32Array(len);

    // Apply channel operation
    for (let i = 0; i < len; i++) {
      const a = dataA[i];
      const b = dataB[i];
      let res = 0.0;

      switch (op) {
        case 'union':
          // Standard union: a + b - a * b
          res = a + b - a * b;
          break;
        case 'intersection':
          res = a * b;
          break;
        case 'in':
          res = a * b;
          break;
        case 'out':
          res = a * (1.0 - b);
          break;
        case 'stencil':
          res = b * (1.0 - a);
          break;
        case 'mask':
          res = b * a;
          break;
        case 'absminus':
          res = Math.abs(a - b);
          break;
        case 'plus':
          res = a + b;
          break;
        case 'minus':
          res = b - a;
          break;
        case 'multiply':
          res = a * b;
          break;
        case 'divide':
          res = a / Math.max(0.000001, b);
          break;
        case 'min':
          res = Math.min(a, b);
          break;
        case 'max':
          res = Math.max(a, b);
          break;
        default:
          res = a + b - a * b;
          break;
      }

      // Mix blending
      if (resampledMask || mix < 0.9999) {
        let m = mix;
        if (resampledMask) {
          const idx = i * 4;
          const mData = resampledMask.data;
          let maskVal = (maskChan === 'luma')
            ? (0.2126 * mData[idx] + 0.7152 * mData[idx + 1] + 0.0722 * mData[idx + 2])
            : mData[idx + 3];
          if (invertMask) maskVal = 1.0 - maskVal;
          m *= Math.max(0.0, Math.min(1.0, maskVal));
        }
        mergedData[i] = origOut[i] * (1.0 - m) + res * m;
      } else {
        mergedData[i] = res;
      }
    }

    this._setChannelData(result, outChName, mergedData);
    return result;
  }

  _getChannelData(buf, chName, len) {
    if (!buf || !chName) return null;
    const clean = chName.trim();
    const lower = clean.toLowerCase();

    if (lower === 'rgba.alpha' || lower === 'alpha' || lower === 'a' || lower === 'rgba.a') {
      return buf.getChannel('A');
    }
    if (lower === 'rgba.red' || lower === 'red' || lower === 'r' || lower === 'rgba.r') {
      return buf.getChannel('R');
    }
    if (lower === 'rgba.green' || lower === 'green' || lower === 'g' || lower === 'rgba.g') {
      return buf.getChannel('G');
    }
    if (lower === 'rgba.blue' || lower === 'blue' || lower === 'b' || lower === 'rgba.b') {
      return buf.getChannel('B');
    }

    if (lower === '0' || lower === 'zero') return new Float32Array(len);
    if (lower === '1' || lower === 'one' || lower === 'white') {
      const arr = new Float32Array(len);
      arr.fill(1.0);
      return arr;
    }

    if (buf.hasChannel && buf.hasChannel(clean)) {
      return buf.getChannel(clean);
    }
    return null;
  }

  _setChannelData(buf, chName, data) {
    if (!buf || !chName || !data) return;
    const clean = chName.trim();
    const lower = clean.toLowerCase();

    if (lower === 'rgba.alpha' || lower === 'alpha' || lower === 'a' || lower === 'rgba.a') {
      buf.setChannel('A', data);
      return;
    }
    if (lower === 'rgba.red' || lower === 'red' || lower === 'r' || lower === 'rgba.r') {
      buf.setChannel('R', data);
      return;
    }
    if (lower === 'rgba.green' || lower === 'green' || lower === 'g' || lower === 'rgba.g') {
      buf.setChannel('G', data);
      return;
    }
    if (lower === 'rgba.blue' || lower === 'blue' || lower === 'b' || lower === 'rgba.b') {
      buf.setChannel('B', data);
      return;
    }

    buf.setChannel(clean, data);
  }
}

