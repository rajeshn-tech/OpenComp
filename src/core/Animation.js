/**
 * OpenComp - Animation & Keyframe Core Engine
 * Provides deterministic multi-curve keyframe interpolation (Linear, Cubic Bezier, Hold)
 * for animated node knobs, roto control points, and temporal VFX parameters.
 */

export class Keyframe {
  constructor(frame, value, interpolation = 'bezier') {
    this.frame = Math.round(frame);
    this.value = (typeof value === 'object' && value !== null) ? JSON.parse(JSON.stringify(value)) : value;
    this.interpolation = interpolation; // 'linear', 'bezier', 'smooth', 'constant', 'hold', 'free'

    // Tangents for Bezier / Hermite interpolation
    this.leftSlope = 0.0;
    this.rightSlope = 0.0;
    this.leftLength = 0.33;
    this.rightLength = 0.33;

    // Transient UI selection state
    this.selected = false;
  }

  clone() {
    const k = new Keyframe(this.frame, this.value, this.interpolation);
    k.leftSlope = this.leftSlope;
    k.rightSlope = this.rightSlope;
    k.leftLength = this.leftLength;
    k.rightLength = this.rightLength;
    k.selected = this.selected;
    return k;
  }

  serialize() {
    return {
      frame: this.frame,
      value: this.value,
      interpolation: this.interpolation,
      leftSlope: this.leftSlope,
      rightSlope: this.rightSlope,
      leftLength: this.leftLength,
      rightLength: this.rightLength
    };
  }

  static deserialize(data) {
    const k = new Keyframe(data.frame, data.value, data.interpolation || 'bezier');
    if (data.leftSlope !== undefined) k.leftSlope = data.leftSlope;
    if (data.rightSlope !== undefined) k.rightSlope = data.rightSlope;
    if (data.leftLength !== undefined) k.leftLength = data.leftLength;
    if (data.rightLength !== undefined) k.rightLength = data.rightLength;
    return k;
  }
}

export class KeyframeTrack {
  constructor(defaultValue = 0.0) {
    this.defaultValue = defaultValue;
    this.keys = []; // Sorted ascending by frame
    this.preExtrapolation = 'constant'; // 'constant' | 'linear' | 'cycle'
    this.postExtrapolation = 'constant'; // 'constant' | 'linear' | 'cycle'
  }

  get length() {
    return this.keys.length;
  }

  isAnimated() {
    return this.keys.length > 0;
  }

  addKey(frame, value, interpolation = 'bezier') {
    const f = Math.round(frame);
    const existingIdx = this.keys.findIndex(k => k.frame === f);

    const newKey = new Keyframe(f, value, interpolation);

    if (existingIdx >= 0) {
      this.keys[existingIdx] = newKey;
    } else {
      this.keys.push(newKey);
      this.keys.sort((a, b) => a.frame - b.frame);
    }

    this.recomputeAutoTangents();
    return newKey;
  }

  removeKey(frame) {
    const f = Math.round(frame);
    const idx = this.keys.findIndex(k => k.frame === f);
    if (idx >= 0) {
      this.keys.splice(idx, 1);
      this.recomputeAutoTangents();
      return true;
    }
    return false;
  }

  getKey(frame) {
    const f = Math.round(frame);
    return this.keys.find(k => k.frame === f) || null;
  }

  hasKey(frame) {
    const f = Math.round(frame);
    return this.keys.some(k => k.frame === f);
  }

  recomputeAutoTangents() {
    const n = this.keys.length;
    if (n < 2) return;

    for (let i = 0; i < n; i++) {
      const cur = this.keys[i];
      if (typeof cur.value !== 'number') continue;

      if (i === 0) {
        // Flat start
        cur.leftSlope = 0.0;
        const next = this.keys[i + 1];
        const dt = Math.max(1, next.frame - cur.frame);
        cur.rightSlope = (typeof next.value === 'number') ? (next.value - cur.value) / dt : 0.0;
      } else if (i === n - 1) {
        // Flat end
        const prev = this.keys[i - 1];
        const dt = Math.max(1, cur.frame - prev.frame);
        cur.leftSlope = (typeof prev.value === 'number') ? (cur.value - prev.value) / dt : 0.0;
        cur.rightSlope = 0.0;
      } else {
        // Smooth Catmull-Rom central tangent
        const prev = this.keys[i - 1];
        const next = this.keys[i + 1];
        if (typeof prev.value === 'number' && typeof next.value === 'number') {
          const dt = Math.max(1, next.frame - prev.frame);
          const slope = (next.value - prev.value) / dt;
          cur.leftSlope = slope;
          cur.rightSlope = slope;
        }
      }
    }
  }

  // --- Retiming, Scaling & Clipboard Operations ---

  offsetKeys(deltaFrame, deltaValue = 0, selectedOnly = false) {
    if (deltaFrame === 0 && deltaValue === 0) return;
    const targetKeys = selectedOnly ? this.keys.filter(k => k.selected) : this.keys;
    for (const k of targetKeys) {
      k.frame = Math.round(k.frame + deltaFrame);
      if (typeof k.value === 'number' && deltaValue !== 0) {
        k.value += deltaValue;
      }
    }
    this.keys.sort((a, b) => a.frame - b.frame);
    this.recomputeAutoTangents();
  }

  scaleKeys(scaleFactor, pivotFrame = null, selectedOnly = false) {
    if (scaleFactor <= 0 || scaleFactor === 1.0) return;
    const targetKeys = selectedOnly ? this.keys.filter(k => k.selected) : this.keys;
    if (targetKeys.length === 0) return;

    const pivot = pivotFrame !== null ? pivotFrame : targetKeys[0].frame;
    for (const k of targetKeys) {
      k.frame = Math.round(pivot + (k.frame - pivot) * scaleFactor);
    }
    this.keys.sort((a, b) => a.frame - b.frame);
    this.recomputeAutoTangents();
  }

  duplicateKeys(frames = null, deltaFrame = 1) {
    const list = frames ? this.keys.filter(k => frames.includes(k.frame)) : this.keys.filter(k => k.selected);
    const toDuplicate = list.length > 0 ? list : this.keys;
    const duplicated = [];

    for (const src of toDuplicate) {
      const copy = src.clone();
      copy.frame = Math.round(src.frame + deltaFrame);
      this.addKey(copy.frame, copy.value, copy.interpolation);
      const added = this.getKey(copy.frame);
      if (added) {
        added.leftSlope = copy.leftSlope;
        added.rightSlope = copy.rightSlope;
        added.leftLength = copy.leftLength;
        added.rightLength = copy.rightLength;
        duplicated.push(added);
      }
    }
    return duplicated;
  }

  copyKeys(frames = null) {
    const list = frames ? this.keys.filter(k => frames.includes(k.frame)) : this.keys.filter(k => k.selected);
    const toCopy = list.length > 0 ? list : this.keys;
    return toCopy.map(k => k.serialize());
  }

  pasteKeys(serializedKeys, targetFrame = null) {
    if (!Array.isArray(serializedKeys) || serializedKeys.length === 0) return [];
    const minFrame = Math.min(...serializedKeys.map(k => k.frame));
    const offset = targetFrame !== null ? targetFrame - minFrame : 0;
    const pasted = [];

    for (const data of serializedKeys) {
      const k = Keyframe.deserialize(data);
      k.frame = Math.round(k.frame + offset);
      this.addKey(k.frame, k.value, k.interpolation);
      const added = this.getKey(k.frame);
      if (added) {
        added.leftSlope = k.leftSlope;
        added.rightSlope = k.rightSlope;
        added.leftLength = k.leftLength;
        added.rightLength = k.rightLength;
        pasted.push(added);
      }
    }
    return pasted;
  }

  evaluate(frame) {
    if (this.keys.length === 0) {
      return this.defaultValue;
    }

    if (this.keys.length === 1) {
      return this.keys[0].value;
    }

    let t = Number(frame);
    const firstKey = this.keys[0];
    const lastKey = this.keys[this.keys.length - 1];

    // Pre-extrapolation (Past)
    if (t < firstKey.frame) {
      if (this.preExtrapolation === 'linear') {
        const slope = firstKey.leftSlope !== 0 ? firstKey.leftSlope :
          ((typeof this.keys[1].value === 'number' && typeof firstKey.value === 'number') ?
            (this.keys[1].value - firstKey.value) / Math.max(1, this.keys[1].frame - firstKey.frame) : 0);
        return typeof firstKey.value === 'number' ? firstKey.value + (t - firstKey.frame) * slope : firstKey.value;
      } else if (this.preExtrapolation === 'cycle') {
        const span = Math.max(1, lastKey.frame - firstKey.frame);
        const offset = ((t - firstKey.frame) % span + span) % span;
        t = firstKey.frame + offset;
      } else {
        // 'constant' default clamp
        return firstKey.value;
      }
    }

    // Post-extrapolation (Future)
    if (t > lastKey.frame) {
      if (this.postExtrapolation === 'linear') {
        const slope = lastKey.rightSlope !== 0 ? lastKey.rightSlope :
          ((typeof lastKey.value === 'number' && typeof this.keys[this.keys.length - 2].value === 'number') ?
            (lastKey.value - this.keys[this.keys.length - 2].value) / Math.max(1, lastKey.frame - this.keys[this.keys.length - 2].frame) : 0);
        return typeof lastKey.value === 'number' ? lastKey.value + (t - lastKey.frame) * slope : lastKey.value;
      } else if (this.postExtrapolation === 'cycle') {
        const span = Math.max(1, lastKey.frame - firstKey.frame);
        const offset = ((t - firstKey.frame) % span + span) % span;
        t = firstKey.frame + offset;
      } else {
        // 'constant' default clamp
        return lastKey.value;
      }
    }

    // Locate segment [k0, k1]
    let k0 = this.keys[0];
    let k1 = this.keys[1];

    for (let i = 0; i < this.keys.length - 1; i++) {
      if (t >= this.keys[i].frame && t <= this.keys[i + 1].frame) {
        k0 = this.keys[i];
        k1 = this.keys[i + 1];
        break;
      }
    }

    // Exact keyframe match
    if (t === k0.frame) return k0.value;
    if (t === k1.frame) return k1.value;

    const span = k1.frame - k0.frame;
    if (span <= 0) return k0.value;

    const u = (t - k0.frame) / span;

    // 1. Hold / Constant Interpolation
    if (k0.interpolation === 'hold' || k0.interpolation === 'constant') {
      return k0.value;
    }

    // 2. Numeric Interpolation (Scalar)
    if (typeof k0.value === 'number' && typeof k1.value === 'number') {
      if (k0.interpolation === 'linear') {
        return (1.0 - u) * k0.value + u * k1.value;
      }

      // Cubic Hermite / Smooth Bezier
      const u2 = u * u;
      const u3 = u2 * u;

      const h00 = 2.0 * u3 - 3.0 * u2 + 1.0;
      const h10 = u3 - 2.0 * u2 + u;
      const h01 = -2.0 * u3 + 3.0 * u2;
      const h11 = u3 - u2;

      const m0 = k0.rightSlope * span;
      const m1 = k1.leftSlope * span;

      return h00 * k0.value + h10 * m0 + h01 * k1.value + h11 * m1;
    }

    // 3. Vector / Point Interpolation [x, y] or Object {x, y}
    if (Array.isArray(k0.value) && Array.isArray(k1.value) && k0.value.length === k1.value.length) {
      const res = [];
      for (let i = 0; i < k0.value.length; i++) {
        const v0 = Number(k0.value[i]) || 0;
        const v1 = Number(k1.value[i]) || 0;
        res.push((1.0 - u) * v0 + u * v1);
      }
      return res;
    }

    if (typeof k0.value === 'object' && typeof k1.value === 'object' && k0.value !== null && k1.value !== null) {
      const res = {};
      for (const key of Object.keys(k0.value)) {
        if (typeof k0.value[key] === 'number' && typeof k1.value[key] === 'number') {
          res[key] = (1.0 - u) * k0.value[key] + u * k1.value[key];
        } else {
          res[key] = u < 0.5 ? k0.value[key] : k1.value[key];
        }
      }
      return res;
    }

    // Fallback: Hold previous
    return k0.value;
  }

  serialize() {
    return {
      defaultValue: this.defaultValue,
      preExtrapolation: this.preExtrapolation,
      postExtrapolation: this.postExtrapolation,
      keys: this.keys.map(k => k.serialize())
    };
  }

  static deserialize(data) {
    const track = new KeyframeTrack(data.defaultValue);
    if (data.preExtrapolation) track.preExtrapolation = data.preExtrapolation;
    if (data.postExtrapolation) track.postExtrapolation = data.postExtrapolation;
    if (data.keys && Array.isArray(data.keys)) {
      track.keys = data.keys.map(kd => Keyframe.deserialize(kd));
      track.keys.sort((a, b) => a.frame - b.frame);
    }
    return track;
  }
}


