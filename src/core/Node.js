/**
 * OpenComp - Base Node Class
 * Represents a single node in the Directed Acyclic Graph (DAG) with full keyframe animation support,
 * expression evaluation, live postage stamps, and clone linkages.
 */

import { BBox } from './BBox.js';
import { ExpressionEngine } from './ExpressionEngine.js';

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
    
    // Category styling colors
    this.color = Node.getCategoryColor(category);

    /** @type {Array<{id: string, name: string, label: string, connection: {nodeId: string, outputPortId: string}|null}>} */
    this.inputs = [];

    /** @type {Array<{id: string, name: string}>} */
    this.outputs = [{ id: 'out', name: 'Output' }];

    /** @type {Object.<string, {label: string, type: string, value: any, keyframes?: Object.<number, any>, expression?: string|null, options?: any[], min?: number, max?: number, step?: number}>} */
    this.knobs = {};

    this.disabled = false;
    this.isDirty = true;
    this.status = 'dirty'; // 'idle', 'cached', 'dirty', 'error'
    this.errorMessage = null;
    this.cachedBuffer = null;
    this.cachedFrame = null;
    this.graph = null;

    // Live Node Postage Stamp preview
    this.showPostageStamp = false;
    this.thumbnailCanvas = null;
    this.thumbnailDirty = true;

    // Clone node linkage
    this.cloneGroupId = null;
    this.masterNodeId = null;
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
      case 'Tool': return '#4a6b5d';       // Group, Gizmo (Sage Green)
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
      expression: null,
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

    // 1. Evaluate expression if assigned
    if (knob.expression) {
      try {
        const exprVal = ExpressionEngine.evaluate(knob.expression, context, this.graph);
        if (exprVal !== undefined && !isNaN(exprVal)) {
          return exprVal;
        }
      } catch (err) {
        // Fall back gracefully
      }
    }

    // 2. Check animated keyframes at requested frame
    if (context && context.frame !== undefined && knob.keyframes && Object.keys(knob.keyframes).length > 0) {
      return this.getKnobValueAtFrame(k, context.frame);
    }

    // 3. Static knob value
    return knob.value;
  }

  setKnobValue(key, val, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (this.knobs[k] !== undefined) {
      if (this.knobs[k].value !== val) {
        this.knobs[k].value = val;
        this.markDirty();

        // Bidirectional clone synchronization
        if (!fromCloneSync && this.cloneGroupId && this.graph) {
          for (const other of this.graph.getAllNodes()) {
            if (other !== this && other.cloneGroupId === this.cloneGroupId) {
              other.setKnobValue(k, val, true);
            }
          }
        }
      }
    }
  }

  setKeyframe(key, frame, val, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k]) return;
    if (!this.knobs[k].keyframes) {
      this.knobs[k].keyframes = {};
    }
    this.knobs[k].keyframes[frame] = val;
    this.markDirty();

    // Clone synchronization
    if (!fromCloneSync && this.cloneGroupId && this.graph) {
      for (const other of this.graph.getAllNodes()) {
        if (other !== this && other.cloneGroupId === this.cloneGroupId) {
          other.setKeyframe(k, frame, val, true);
        }
      }
    }
  }

  removeKeyframe(key, frame, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k] || !this.knobs[k].keyframes) return;
    delete this.knobs[k].keyframes[frame];
    this.markDirty();

    // Clone synchronization
    if (!fromCloneSync && this.cloneGroupId && this.graph) {
      for (const other of this.graph.getAllNodes()) {
        if (other !== this && other.cloneGroupId === this.cloneGroupId) {
          other.removeKeyframe(k, frame, true);
        }
      }
    }
  }

  clearKeyframes(key, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k]) return;
    this.knobs[k].keyframes = {};
    this.markDirty();

    // Clone synchronization
    if (!fromCloneSync && this.cloneGroupId && this.graph) {
      for (const other of this.graph.getAllNodes()) {
        if (other !== this && other.cloneGroupId === this.cloneGroupId) {
          other.clearKeyframes(k, true);
        }
      }
    }
  }

  setExpression(key, exprStr, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k]) return;
    this.knobs[k].expression = (typeof exprStr === 'string' && exprStr.trim()) ? exprStr.trim() : null;
    this.markDirty();

    // Clone synchronization
    if (!fromCloneSync && this.cloneGroupId && this.graph) {
      for (const other of this.graph.getAllNodes()) {
        if (other !== this && other.cloneGroupId === this.cloneGroupId) {
          other.setExpression(k, exprStr, true);
        }
      }
    }
  }

  removeExpression(key, fromCloneSync = false) {
    const k = this.findKnobKey(key);
    if (!this.knobs[k]) return;
    this.knobs[k].expression = null;
    this.markDirty();

    // Clone synchronization
    if (!fromCloneSync && this.cloneGroupId && this.graph) {
      for (const other of this.graph.getAllNodes()) {
        if (other !== this && other.cloneGroupId === this.cloneGroupId) {
          other.removeExpression(k, true);
        }
      }
    }
  }

  hasExpression(key) {
    const k = this.findKnobKey(key);
    return !!(this.knobs[k] && this.knobs[k].expression);
  }

  getExpression(key) {
    const k = this.findKnobKey(key);
    return this.knobs[k] ? (this.knobs[k].expression || null) : null;
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

  hasAnyKeyframes() {
    for (const knob of Object.values(this.knobs)) {
      if (knob.keyframes && Object.keys(knob.keyframes).length > 0) return true;
    }
    return false;
  }

  hasAnyExpressions() {
    for (const knob of Object.values(this.knobs)) {
      if (knob.expression) return true;
    }
    return false;
  }

  isClone() {
    return !!this.cloneGroupId;
  }

  declone() {
    this.cloneGroupId = null;
    this.masterNodeId = null;
    this.markDirty();
  }

  markDirty() {
    this.isDirty = true;
    this.status = 'dirty';
    this.cachedBuffer = null;
    this.cachedFrame = null;
    this.thumbnailDirty = true;
    if (this.graph) {
      this.graph.markDependentsDirty(this.id);
    }
  }

  /**
   * Generates or returns cached postage stamp thumbnail canvas
   * @param {number} [maxW=96] 
   * @param {number} [maxH=54] 
   * @returns {HTMLCanvasElement|null}
   */
  generateThumbnail(maxW = 96, maxH = 54) {
    if (!this.thumbnailDirty && this.thumbnailCanvas) {
      return this.thumbnailCanvas;
    }

    if (!this.cachedBuffer || !this.cachedBuffer.data) {
      return null;
    }

    const buf = this.cachedBuffer;
    const aspect = (buf.width > 0 && buf.height > 0) ? (buf.width / buf.height) : (16 / 9);
    let targetW = maxW;
    let targetH = Math.round(targetW / aspect);
    if (targetH > maxH) {
      targetH = maxH;
      targetW = Math.round(targetH * aspect);
    }
    targetW = Math.max(16, targetW);
    targetH = Math.max(16, targetH);

    if (typeof document !== 'undefined') {
      if (!this.thumbnailCanvas) {
        this.thumbnailCanvas = document.createElement('canvas');
      }
      this.thumbnailCanvas.width = targetW;
      this.thumbnailCanvas.height = targetH;
      const ctx = this.thumbnailCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(targetW, targetH);
        const data = imgData.data;
        const srcData = buf.data;
        const srcW = buf.width;
        const srcH = buf.height;

        for (let y = 0; y < targetH; y++) {
          const sy = Math.min(srcH - 1, Math.floor((y / targetH) * srcH));
          const rowOffset = sy * srcW;
          const targetOffset = y * targetW;
          for (let x = 0; x < targetW; x++) {
            const sx = Math.min(srcW - 1, Math.floor((x / targetW) * srcW));
            const sp4 = (rowOffset + sx) * 4;
            const dp4 = (targetOffset + x) * 4;
            data[dp4]     = Math.min(255, Math.max(0, Math.round(srcData[sp4] * 255)));
            data[dp4 + 1] = Math.min(255, Math.max(0, Math.round(srcData[sp4 + 1] * 255)));
            data[dp4 + 2] = Math.min(255, Math.max(0, Math.round(srcData[sp4 + 2] * 255)));
            data[dp4 + 3] = Math.min(255, Math.max(0, Math.round((srcData[sp4 + 3] !== undefined ? srcData[sp4 + 3] : 1.0) * 255)));
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }

    this.thumbnailDirty = false;
    return this.thumbnailCanvas;
  }

  /**
   * Determine output dynamic bounding box (BBox / data window)
   * Standard: propagates active region upstream to downstream.
   * @param {Object.<string, import('./PixelBuffer.js').PixelBuffer>} inputBuffers 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputBuffers = {}, context = {}) {
    // If disabled, pass through primary input's BBox
    if (this.disabled) {
      const firstInput = this.inputs[0];
      if (firstInput && inputBuffers[firstInput.id]) {
        const buf = inputBuffers[firstInput.id];
        return buf.bbox ? buf.bbox.clone() : BBox.fromFormat(buf.width, buf.height);
      }
      return new BBox(0, 0, 0, 0);
    }

    // Default passthrough: find primary input buffer ('B', 'in', or first defined input)
    let primaryBuf = inputBuffers['B'] || inputBuffers['in'] || inputBuffers['input'];
    if (!primaryBuf) {
      for (const inp of this.inputs) {
        if (inputBuffers[inp.id]) {
          primaryBuf = inputBuffers[inp.id];
          break;
        }
      }
    }

    if (primaryBuf) {
      return primaryBuf.bbox ? primaryBuf.bbox.clone() : BBox.fromFormat(primaryBuf.width, primaryBuf.height);
    }

    return new BBox(0, 0, 0, 0);
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
        keyframes: v.keyframes && Object.keys(v.keyframes).length > 0 ? { ...v.keyframes } : undefined,
        expression: v.expression || undefined
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
      showPostageStamp: this.showPostageStamp || undefined,
      cloneGroupId: this.cloneGroupId || undefined,
      masterNodeId: this.masterNodeId || undefined,
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
    this.showPostageStamp = !!data.showPostageStamp;
    this.cloneGroupId = data.cloneGroupId || null;
    this.masterNodeId = data.masterNodeId || null;

    if (data.knobs) {
      for (const [k, v] of Object.entries(data.knobs)) {
        if (this.knobs[k]) {
          if (typeof v === 'object' && v !== null && 'value' in v) {
            this.knobs[k].value = v.value;
            if (v.keyframes) {
              this.knobs[k].keyframes = { ...v.keyframes };
            }
            if (v.expression) {
              this.knobs[k].expression = v.expression;
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
