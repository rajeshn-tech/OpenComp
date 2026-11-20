/**
 * OpenComp - Animation & Keyframe Core Engine
 * Provides deterministic multi-curve keyframe interpolation (Linear, Cubic Bezier, Hold)
 * for animated node knobs, roto control points, and temporal VFX parameters.
 */

export class Keyframe {
  constructor(frame, value, interpolation = 'bezier') {
    this.frame = Math.round(frame);
    this.value = (typeof value === 'object' && value !== null) ? JSON.parse(JSON.stringify(value)) : value;
    this.interpolation = interpolation; // 'linear', 'bezier', 'smooth', 'hold'

    // Tangents for Bezier / Hermite interpolation
    this.leftSlope = 0.0;
    this.rightSlope = 0.0;
    this.leftLength = 0.33;
    this.rightLength = 0.33;
  }

  clone() {
    const k = new Keyframe(this.frame, this.value, this.interpolation);
    k.leftSlope = this.leftSlope;
    k.rightSlope = this.rightSlope;
    k.leftLength = this.leftLength;
    k.rightLength = this.rightLength;
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

  evaluate(frame) {
    if (this.keys.length === 0) {
      return this.defaultValue;
    }

    if (this.keys.length === 1) {
      return this.keys[0].value;
    }

    const t = Number(frame);

    // Clamping outside bounds
    if (t <= this.keys[0].frame) {
      return this.keys[0].value;
    }
    if (t >= this.keys[this.keys.length - 1].frame) {
      return this.keys[this.keys.length - 1].value;
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

    // 1. Hold Interpolation
    if (k0.interpolation === 'hold') {
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
      keys: this.keys.map(k => k.serialize())
    };
  }

  static deserialize(data) {
    const track = new KeyframeTrack(data.defaultValue);
    if (data.keys && Array.isArray(data.keys)) {
      track.keys = data.keys.map(kd => Keyframe.deserialize(kd));
      track.keys.sort((a, b) => a.frame - b.frame);
    }
    return track;
  }
}

