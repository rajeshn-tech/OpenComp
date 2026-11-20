/**
 * OpenComp - Base Node Class
 * Represents a single node in the Directed Acyclic Graph (DAG) with full keyframe animation support.
 */

export class Node {
  /**
   * @param {string} id 
   * @param {string} type 
   * @param {string} category 
   * @param {number} x 
   * @param {number} y 
   */
  constructor(id, type, category = 'General', x = 0, y = 0) {
    this.id = id;
    this.name = id;
    this.type = type;
    this.category = category;
    this.x = x;
    this.y = y;
    this.width = 110;
    this.height = 36;
    
    // Nuke category colors
    this.color = Node.getCategoryColor(category);

    /** @type {Array<{id: string, name: string, label: string, connection: {nodeId: string, outputPortId: string}|null}>} */
    this.inputs = [];

    /** @type {Array<{id: string, name: string}>} */
    this.outputs = [{ id: 'out', name: 'Output' }];

    /** @type {Object.<string, {label: string, type: string, value: any, keyframes?: Object.<number, any>, options?: any[], min?: number, max?: number, step?: number}>} */
    this.knobs = {};

    this.disabled = false;
    this.isDirty = true;
    this.cachedBuffer = null;
    this.cachedFrame = null;
    this.graph = null;
  }

  static getCategoryColor(category) {
    switch (category) {
      case 'Image': return '#6d5335';      // Read, Write, Constant, Ramp (Brown/Orange)
      case 'Color': return '#706b32';      // Grade, ColorCorrect, ColorLookup (Olive Yellow)
      case 'Filter': return '#305575';     // Blur, Sharpen, EdgeBlur, Erode (Blue)
      case 'Merge': return '#2f663c';      // Merge, Premult, Unpremult (Green)
      case 'Transform': return '#6e3570';  // Transform, CornerPin, Reformat (Magenta)
      case 'Keyer': return '#2b6363';      // ChromaKeyer, LumaKeyer (Teal)
      case 'Channel': return '#355b6e';    // Shuffle, Roto, Dot, Backdrop (Cyan)
      case 'Viewer': return '#595959';     // Viewer (Gray)
      default: return '#4a4a4a';
    }
  }

  addInput(id, name, label = '') {
    this.inputs.push({
      id,
      name,
      label: label || name,
      connection: null
    });
  }

  addKnob(key, label, type, defaultValue, options = {}) {
    this.knobs[key] = {
      label,
      type,
      value: defaultValue,
      keyframes: {},
      ...options
    };
  }

  findKnobKey(key) {
    if (this.knobs[key] !== undefined) return key;
    const clean = String(key).toLowerCase().replace(/_/g, '');
    for (const k of Object.keys(this.knobs)) {
      if (k.toLowerCase().replace(/_/g, '') === clean) return k;
    }
    return key;
  }

  getKnobValue(key, context = {}) {
    const k = this.findKnobKey(key);
    const knob = this.knobs[k];
    if (!knob) return undefined;
    if (context && context.frame !== undefined && knob.keyframes && Object.keys(knob.keyframes).length > 0) {
      return this.getKnobValueAtFrame(k, context.frame);
    }
    return knob.value;
  }

  setKnobValue(key, val) {
    const k = this.findKnobKey(key);
    if (this.knobs[k] !== undefined) {
      if (this.knobs[k].value !== val) {
        this.knobs[k].value = val;
        this.markDirty();
      }
    }
  }

  setKeyframe(key, frame, val) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k]) return;
    if (!this.knobs[k].keyframes) {
      this.knobs[k].keyframes = {};
    }
    this.knobs[k].keyframes[frame] = val;
    this.markDirty();
  }

  getKnobValueAtFrame(key, frame) {
    const knob = this.knobs[key];
    if (!knob) return undefined;
    if (!knob.keyframes || Object.keys(knob.keyframes).length === 0) {
      return knob.value;
    }

    const frames = Object.keys(knob.keyframes).map(Number).sort((a, b) => a - b);
    if (frames.length === 1 || frame <= frames[0]) {
      return knob.keyframes[frames[0]];
    }
    if (frame >= frames[frames.length - 1]) {
      return knob.keyframes[frames[frames.length - 1]];
    }

    // Linear interpolation between adjacent keyframes
    for (let i = 0; i < frames.length - 1; i++) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      if (frame >= f0 && frame <= f1) {
        const t = (frame - f0) / (f1 - f0);
        const v0 = Number(knob.keyframes[f0]);
        const v1 = Number(knob.keyframes[f1]);
        if (isNaN(v0) || isNaN(v1)) return knob.keyframes[f0];
        return v0 + t * (v1 - v0);
      }
    }
    return knob.value;
  }

  hasKeyframes(key) {
    const knob = this.knobs[key];
    return !!(knob && knob.keyframes && Object.keys(knob.keyframes).length > 0);
  }

  markDirty() {
    this.isDirty = true;
    this.cachedBuffer = null;
    this.cachedFrame = null;
    if (this.graph) {
      this.graph.markDependentsDirty(this.id);
    }
  }

  /**
   * Abstract execution method
   * @param {Object.<string, import('./PixelBuffer.js').PixelBuffer>} inputBuffers 
   * @param {Object} context 
   * @returns {import('./PixelBuffer.js').PixelBuffer|null}
   */
  compute(inputBuffers, context = {}) {
    // If disabled (Bypassed), pass through the primary input (usually index 0 or 'B')
    if (this.disabled) {
      const firstInput = this.inputs[0];
      if (firstInput && inputBuffers[firstInput.id]) {
        return inputBuffers[firstInput.id];
      }
      return null;
    }
    return null;
  }

  serialize() {
    const serializedKnobs = {};
    for (const [k, v] of Object.entries(this.knobs)) {
      serializedKnobs[k] = {
        value: v.value,
        keyframes: v.keyframes && Object.keys(v.keyframes).length > 0 ? { ...v.keyframes } : undefined
      };
    }
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      category: this.category,
      x: this.x,
      y: this.y,
      disabled: this.disabled,
      knobs: serializedKnobs,
      inputs: this.inputs.map(inp => ({
        id: inp.id,
        name: inp.name,
        connection: inp.connection ? { ...inp.connection } : null
      }))
    };
  }

  deserialize(data) {
    this.id = data.id || this.id;
    this.name = data.name || this.name;
    this.x = data.x ?? this.x;
    this.y = data.y ?? this.y;
    this.disabled = !!data.disabled;

    if (data.knobs) {
      for (const [k, v] of Object.entries(data.knobs)) {
        if (this.knobs[k]) {
          if (typeof v === 'object' && v !== null && 'value' in v) {
            this.knobs[k].value = v.value;
            if (v.keyframes) {
              this.knobs[k].keyframes = { ...v.keyframes };
            }
          } else {
            this.knobs[k].value = v;
          }
        }
      }
    }

    if (data.inputs && Array.isArray(data.inputs)) {
      for (const inp of data.inputs) {
        const target = this.inputs.find(i => i.id === inp.id);
        if (target) {
          target.connection = inp.connection;
        }
      }
    }
    this.markDirty();
  }
}
