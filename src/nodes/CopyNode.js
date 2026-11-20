/**
 * OpenComp - Copy Node
 * Copies specified channels from input A to input B with scalable channel remapping,
 * arbitrary AOV support (e.g. depth.Z, motion.u, crypto), mix blending,
 * optional mask gating, dynamic bounding box handling (industry standard Copy),
 * and dynamic channel pair scaling supporting >= 8, 16, or higher mapping counts.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class CopyNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Copy', 'Channel', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('B', 'B', 'Background (B)');
    this.addInput('A', 'A', 'Foreground (A)');
    this.addInput('mask', 'mask', 'Mask (Optional)');

    // Pre-register standard legacy 4 channel pairs for 100% backward compatibility
    this.addKnob('from0', 'From A', 'string', 'rgba.alpha');
    this.addKnob('to0', 'To B', 'string', 'rgba.alpha');

    this.addKnob('from1', 'From A (2)', 'string', '-');
    this.addKnob('to1', 'To B (2)', 'string', '-');

    this.addKnob('from2', 'From A (3)', 'string', '-');
    this.addKnob('to2', 'To B (3)', 'string', '-');

    this.addKnob('from3', 'From A (4)', 'string', '-');
    this.addKnob('to3', 'To B (4)', 'string', '-');

    this.addKnob('mix', 'Mix', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('bbox', 'Set BBox To', 'select', 'B', {
      options: [
        { label: 'B (default)', value: 'B' },
        { label: 'union', value: 'union' },
        { label: 'intersection', value: 'intersection' },
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
   * Ensure knob pair from{idx} and to{idx} exists in this.knobs
   * @param {number} idx 
   */
  _ensurePairKnobs(idx) {
    if (idx < 0 || isNaN(idx)) return;
    const fromKey = `from${idx}`;
    const toKey = `to${idx}`;
    if (!this.knobs[fromKey]) {
      this.addKnob(fromKey, `From A (${idx + 1})`, 'string', '-');
    }
    if (!this.knobs[toKey]) {
      this.addKnob(toKey, `To B (${idx + 1})`, 'string', '-');
    }
  }

  /**
   * Set knob value with dynamic channel pair registration
   * @param {string} key 
   * @param {*} val 
   */
  setKnobValue(key, val) {
    const match = String(key).match(/^(from|to)(\d+)$/i);
    if (match) {
      const idx = parseInt(match[2], 10);
      this._ensurePairKnobs(idx);
    }
    super.setKnobValue(key, val);
  }

  /**
   * Get knob value with dynamic fallback for unallocated pairs
   * @param {string} key 
   * @param {Object} [context={}] 
   * @returns {*}
   */
  getKnobValue(key, context = {}) {
    const match = String(key).match(/^(from|to)(\d+)$/i);
    if (match) {
      const idx = parseInt(match[2], 10);
      if (!this.knobs[`from${idx}`] && !this.knobs[`to${idx}`]) {
        return '-';
      }
    }
    return super.getKnobValue(key, context);
  }

  /**
   * Return number of allocated channel pairs (at least 4)
   * @returns {number}
   */
  getChannelPairCount() {
    let count = 4;
    while (this.knobs[`from${count}`] !== undefined || this.knobs[`to${count}`] !== undefined) {
      count++;
    }
    return count;
  }

  /**
   * Return all registered channel pairs
   * @returns {Array<{ index: number, from: string, to: string }>}
   */
  getChannelPairs() {
    const pairs = [];
    const count = this.getChannelPairCount();
    for (let i = 0; i < count; i++) {
      pairs.push({
        index: i,
        from: String(this.getKnobValue(`from${i}`) || '-'),
        to: String(this.getKnobValue(`to${i}`) || '-')
      });
    }
    return pairs;
  }

  /**
   * Return active channel pairs where both from and to are non-empty and not '-'
   * @param {Object} [context={}] 
   * @returns {Array<{ index: number, from: string, to: string }>}
   */
  getActivePairs(context = {}) {
    const active = [];
    let i = 0;
    while (this.knobs[`from${i}`] !== undefined && this.knobs[`to${i}`] !== undefined) {
      const fromCh = String(this.getKnobValue(`from${i}`, context) || '').trim();
      const toCh = String(this.getKnobValue(`to${i}`, context) || '').trim();
      if (fromCh && fromCh !== '-' && toCh && toCh !== '-') {
        active.push({ index: i, from: fromCh, to: toCh });
      }
      i++;
    }
    return active;
  }

  /**
   * Add a new channel mapping pair
   * @param {string} [fromChannel='-'] 
   * @param {string} [toChannel='-'] 
   * @returns {number} The index of the added pair
   */
  addChannelPair(fromChannel = '-', toChannel = '-') {
    let targetIdx = -1;
    let i = 1;
    while (this.knobs[`from${i}`] !== undefined) {
      const f = String(this.knobs[`from${i}`].value || '').trim();
      const t = String(this.knobs[`to${i}`].value || '').trim();
      if ((!f || f === '-') && (!t || t === '-')) {
        targetIdx = i;
        break;
      }
      i++;
    }
    if (targetIdx === -1) {
      targetIdx = i;
      this._ensurePairKnobs(targetIdx);
    }
    this.setKnobValue(`from${targetIdx}`, fromChannel);
    this.setKnobValue(`to${targetIdx}`, toChannel);
    return targetIdx;
  }

  /**
   * Explicitly set mapping at a given index
   * @param {number} index 
   * @param {string} fromChannel 
   * @param {string} toChannel 
   */
  setChannelPair(index, fromChannel, toChannel) {
    this._ensurePairKnobs(index);
    this.setKnobValue(`from${index}`, fromChannel);
    this.setKnobValue(`to${index}`, toChannel);
  }

  /**
   * Remove a channel pair by index
   * @param {number} index 
   */
  removeChannelPair(index) {
    if (index < 0) return;
    if (index < 4) {
      this.setKnobValue(`from${index}`, '-');
      this.setKnobValue(`to${index}`, '-');
      return;
    }
    let maxIdx = index;
    while (this.knobs[`from${maxIdx + 1}`] !== undefined) {
      maxIdx++;
    }
    for (let i = index; i < maxIdx; i++) {
      this.setKnobValue(`from${i}`, this.getKnobValue(`from${i + 1}`));
      this.setKnobValue(`to${i}`, this.getKnobValue(`to${i + 1}`));
    }
    delete this.knobs[`from${maxIdx}`];
    delete this.knobs[`to${maxIdx}`];
    this.markDirty();
  }

  /**
   * Clear all channel mappings
   */
  clearChannelPairs() {
    let i = 0;
    while (this.knobs[`from${i}`] !== undefined) {
      if (i < 4) {
        this.setKnobValue(`from${i}`, '-');
        this.setKnobValue(`to${i}`, '-');
      } else {
        delete this.knobs[`from${i}`];
        delete this.knobs[`to${i}`];
      }
      i++;
    }
    this.markDirty();
  }

  /**
   * Set multiple channel pairs at once
   * @param {Array<{from: string, to: string}|[string, string]>} pairs 
   */
  setChannelPairs(pairs) {
    if (!Array.isArray(pairs)) return;
    this.clearChannelPairs();
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const fromCh = Array.isArray(p) ? p[0] : p.from;
      const toCh = Array.isArray(p) ? p[1] : p.to;
      this.setChannelPair(i, fromCh, toCh);
    }
  }

  /**
   * Deserialize with automatic dynamic pair reconstruction
   * @param {Object} data 
   */
  deserialize(data) {
    if (data && data.knobs) {
      for (const k of Object.keys(data.knobs)) {
        const match = k.match(/^(from|to)(\d+)$/i);
        if (match) {
          const idx = parseInt(match[2], 10);
          this._ensurePairKnobs(idx);
        }
      }
    }
    super.deserialize(data);
  }

  /**
   * Determine output dynamic BBox according to bbox knob (B, union, intersection, A)
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
    const mode = this.getKnobValue('bbox', context) || 'B';

    if (mode === 'union') {
      return boxB.union(boxA);
    } else if (mode === 'intersection') {
      return boxB.intersect(boxA);
    } else if (mode === 'A') {
      return boxA;
    }
    // Default: B
    return boxB;
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

    // Clone B as destination base (preserving all existing channels and metadata)
    const result = bufB.clone();
    result.bbox = outBBox;

    // Resample A to match B if dimensions differ
    const resampledA = (bufA.width === w && bufA.height === h) ? bufA : bufA.resample(w, h);

    // Resample mask if present and mismatched
    const resampledMask = (bufMask && (bufMask.width !== w || bufMask.height !== h))
      ? bufMask.resample(w, h)
      : bufMask;

    const mix = Math.max(0.0, Math.min(1.0, Number(this.getKnobValue('mix', context)) ?? 1.0));
    const maskChan = this.getKnobValue('maskChannel', context) || 'alpha';
    const invertMask = !!this.getKnobValue('invertMask', context);

    // Collect active channel mapping pairs dynamically (no limit on pair count)
    const pairs = this.getActivePairs(context);

    if (pairs.length === 0) {
      return result;
    }

    // Prepare mask factor array if mask connected or mix < 1.0
    let maskWeights = null;
    if (resampledMask || mix < 0.9999) {
      maskWeights = new Float32Array(len);
      const mData = resampledMask ? resampledMask.data : null;
      for (let i = 0; i < len; i++) {
        let m = 1.0;
        if (mData) {
          const idx = i * 4;
          if (maskChan === 'luma') {
            m = 0.2126 * mData[idx] + 0.7152 * mData[idx + 1] + 0.0722 * mData[idx + 2];
          } else {
            m = mData[idx + 3];
          }
          if (invertMask) m = 1.0 - m;
          m = Math.max(0.0, Math.min(1.0, m));
        }
        maskWeights[i] = m * mix;
      }
    }

    // Process each channel pair
    for (const pair of pairs) {
      const srcData = this._getChannelData(resampledA, pair.from, len);
      if (!srcData) continue;

      if (!maskWeights) {
        // Fast path: direct 100% channel copy
        this._setChannelData(result, pair.to, srcData, len);
      } else {
        // Blended channel copy
        const origData = this._getChannelData(result, pair.to, len) || new Float32Array(len);
        const blended = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const wgt = maskWeights[i];
          blended[i] = origData[i] * (1.0 - wgt) + srcData[i] * wgt;
        }
        this._setChannelData(result, pair.to, blended, len);
      }
    }

    return result;
  }

  /**
   * Helper to resolve and extract channel array
   * @private
   */
  _getChannelData(buf, chName, len) {
    if (!buf || !chName) return null;
    const clean = String(chName).trim();
    const lower = clean.toLowerCase();

    // Standard RGBA mappings
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

    // Constant 0 or 1
    if (lower === '0' || lower === 'zero') {
      return new Float32Array(len);
    }
    if (lower === '1' || lower === 'one' || lower === 'white') {
      const arr = new Float32Array(len);
      arr.fill(1.0);
      return arr;
    }

    // Direct channel query
    if (buf.hasChannel && buf.hasChannel(clean)) {
      return buf.getChannel(clean);
    }
    const direct = buf.getChannel(clean);
    if (direct) return direct;

    // Check layer-qualified channel fallback (e.g. depth.Z -> Z)
    if (clean.includes('.')) {
      const sub = clean.split('.')[1];
      if (buf.hasChannel && buf.hasChannel(sub)) {
        return buf.getChannel(sub);
      }
    }

    return null;
  }

  /**
   * Helper to write channel array into target buffer
   * @private
   */
  _setChannelData(buf, chName, data, len) {
    if (!buf || !chName || !data) return;
    const clean = String(chName).trim();
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

    // Arbitrary auxiliary channel (e.g. depth.Z, forward.u, crypto_01)
    buf.setChannel(clean, data);
  }
}
