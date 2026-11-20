/**
 * OpenComp - Interactive Curve Editor UI
 * Professional multi-curve interactive animation curve editor.
 * Supports multiple simultaneous animated channels, marquee box selection,
 * multi-key retiming/scaling/duplication, cubic Bezier tangent editing,
 * tangent modes (Smooth, Flat, Linear, Constant, Free), pre/post extrapolation,
 * Fit Selected [F] / Fit All [A], numeric keyframe inspector, and live DAG sync.
 */

import { KeyframeTrack, Keyframe } from '../core/Animation.js';

export class CurveEditorUI {
  /**
   * @param {HTMLCanvasElement} canvasElement
   * @param {Object} [options={}]
   * @param {Function} [options.onCurveChanged]
   */
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onCurveChanged = options.onCurveChanged || null;

    // Multi-track registry: id -> { id, name, track, node, knobKey, color, visible, selected }
    this.tracks = new Map();
    this.activeTrackId = null;

    // Legacy / primary compatibility references
    this.activeTrack = null;
    this.targetNode = null;
    this.targetKnobKey = null;

    // Viewport coordinate limits
    this.viewStartFrame = options.startFrame !== undefined ? options.startFrame : 1;
    this.viewEndFrame = options.endFrame !== undefined ? options.endFrame : 100;
    this.viewMinValue = options.minValue !== undefined ? options.minValue : 0.0;
    this.viewMaxValue = options.maxValue !== undefined ? options.maxValue : 1.0;

    // Margins for axes
    this.margin = { top: 25, right: 30, bottom: 30, left: 55 };

    // Selection & interaction state
    this.selectedKey = null; // Currently inspected primary keyframe
    /** @type {Set<Keyframe>} Multi-selection set */
    this.selectedKeys = new Set();
    this.activeHandle = null; // 'keyPoint' | 'leftTangent' | 'rightTangent'
    this.isPanning = false;
    this.isMarquee = false;
    this.marqueeStart = { x: 0, y: 0 };
    this.marqueeEnd = { x: 0, y: 0 };
    this.isDraggingKeys = false;
    this.dragStartFrame = 0;
    this.dragStartValue = 0;
    this.initialKeyPositions = new Map(); // key -> { frame, value }
    this.lastMouse = { x: 0, y: 0 };
    this.tangentMode = 'smooth'; // 'smooth' | 'flat' | 'linear' | 'constant' | 'free'

    // Extrapolation
    this.preExtrapolation = 'constant';
    this.postExtrapolation = 'constant';

    // Clipboard for copy/paste
    this.clipboard = [];

    // History for undo/redo
    this.undoStack = [];
    this.redoStack = [];

    this.palette = ['#ff922b', '#20c997', '#339af0', '#f06595', '#fcc419', '#845ef7', '#51cf66'];

    this.initEvents();
  }

  // -------------------------------------------------------------
  // Track Management API
  // -------------------------------------------------------------

  /**
   * Bind a single track (backward-compatible)
   */
  bindTrack(track, node = null, knobKey = null) {
    this.clearTracks();
    if (!track) {
      this.activeTrack = null;
      this.targetNode = null;
      this.targetKnobKey = null;
      this.render();
      return;
    }

    const id = knobKey || 'track_0';
    const name = knobKey ? `${node ? node.name + '.' : ''}${knobKey}` : 'Curve';
    this.addTrack(id, name, track, node, knobKey, '#ff922b');
    this.activeTrackId = id;
    this.activeTrack = track;
    this.targetNode = node;
    this.targetKnobKey = knobKey;
    this.selectedKey = track.keys.length > 0 ? track.keys[0] : null;
    this.selectedKeys.clear();
    if (this.selectedKey) {
      this.selectedKey.selected = true;
      this.selectedKeys.add(this.selectedKey);
    }
    this.fitToCurves();
    this.render();
  }

  /**
   * Add an animated track to the multi-curve editor
   */
  addTrack(id, name, track, node = null, knobKey = null, color = null) {
    if (!track) return;
    const trackColor = color || this.palette[this.tracks.size % this.palette.length];
    this.tracks.set(id, {
      id,
      name: name || id,
      track,
      node,
      knobKey,
      color: trackColor,
      visible: true,
      selected: false
    });
    if (!this.activeTrack) {
      this.activeTrack = track;
      this.activeTrackId = id;
      this.targetNode = node;
      this.targetKnobKey = knobKey;
    }
  }

  removeTrack(id) {
    this.tracks.delete(id);
    if (this.activeTrackId === id) {
      const first = this.tracks.values().next().value;
      if (first) {
        this.activeTrackId = first.id;
        this.activeTrack = first.track;
        this.targetNode = first.node;
        this.targetKnobKey = first.knobKey;
      } else {
        this.activeTrackId = null;
        this.activeTrack = null;
        this.targetNode = null;
        this.targetKnobKey = null;
      }
    }
    this.render();
  }

  clearTracks() {
    this.tracks.clear();
    this.activeTrackId = null;
    this.activeTrack = null;
    this.targetNode = null;
    this.targetKnobKey = null;
    this.selectedKey = null;
    this.selectedKeys.clear();
  }

  setTrackVisible(id, visible) {
    const entry = this.tracks.get(id);
    if (entry) {
      entry.visible = !!visible;
      this.render();
    }
  }

  // -------------------------------------------------------------
  // Coordinate Mapping
  // -------------------------------------------------------------

  get plotWidth() {
    return Math.max(10, this.canvas.width - this.margin.left - this.margin.right);
  }

  get plotHeight() {
    return Math.max(10, this.canvas.height - this.margin.top - this.margin.bottom);
  }

  frameToScreen(frame) {
    const range = Math.max(1, this.viewEndFrame - this.viewStartFrame);
    const u = (frame - this.viewStartFrame) / range;
    return this.margin.left + u * this.plotWidth;
  }

  valueToScreen(value) {
    const range = Math.max(0.0001, this.viewMaxValue - this.viewMinValue);
    const u = (value - this.viewMinValue) / range;
    return (this.canvas.height - this.margin.bottom) - u * this.plotHeight;
  }

  screenToFrame(screenX) {
    const u = (screenX - this.margin.left) / this.plotWidth;
    return this.viewStartFrame + u * (this.viewEndFrame - this.viewStartFrame);
  }

  screenToValue(screenY) {
    const u = ((this.canvas.height - this.margin.bottom) - screenY) / this.plotHeight;
    return this.viewMinValue + u * (this.viewMaxValue - this.viewMinValue);
  }

  // -------------------------------------------------------------
  // Tangent Calculations
  // -------------------------------------------------------------

  getTangentHandles(key, track = null) {
    const t = track || this.activeTrack;
    if (!key || !t) return null;

    const span = 10;
    const kx = this.frameToScreen(key.frame);
    const ky = this.valueToScreen(key.value);

    const leftF = key.frame - span * (key.leftLength || 0.33);
    const leftV = key.value - key.leftSlope * (span * (key.leftLength || 0.33));
    const leftX = this.frameToScreen(leftF);
    const leftY = this.valueToScreen(leftV);

    const rightF = key.frame + span * (key.rightLength || 0.33);
    const rightV = key.value + key.rightSlope * (span * (key.rightLength || 0.33));
    const rightX = this.frameToScreen(rightF);
    const rightY = this.valueToScreen(rightV);

    return {
      keyPos: { x: kx, y: ky },
      leftHandle: { x: leftX, y: leftY, frame: leftF, value: leftV },
      rightHandle: { x: rightX, y: rightY, frame: rightF, value: rightV }
    };
  }

  // -------------------------------------------------------------
  // Tangent & Interpolation Modes
  // -------------------------------------------------------------

  setTangentMode(mode) {
    this.tangentMode = mode;
    const keysToModify = (this.selectedKeys.size > 0 && (!this.selectedKey || this.selectedKeys.has(this.selectedKey)))
      ? Array.from(this.selectedKeys)
      : (this.selectedKey ? [this.selectedKey] : []);
    if (keysToModify.length === 0) return;

    this.saveUndoState();

    for (const key of keysToModify) {
      if (mode === 'flat') {
        key.leftSlope = 0.0;
        key.rightSlope = 0.0;
        key.interpolation = 'bezier';
      } else if (mode === 'smooth') {
        key.interpolation = 'bezier';
        for (const entry of this.tracks.values()) {
          if (entry.track.keys.includes(key)) entry.track.recomputeAutoTangents();
        }
      } else if (mode === 'linear') {
        key.interpolation = 'linear';
      } else if (mode === 'constant' || mode === 'hold') {
        key.interpolation = 'constant';
      } else if (mode === 'free') {
        key.interpolation = 'bezier';
      }
    }

    this.syncAllNodes();
    this.render();
  }

  setExtrapolation(preMode, postMode) {
    this.saveUndoState();
    if (preMode) {
      this.preExtrapolation = preMode;
      for (const entry of this.tracks.values()) {
        entry.track.preExtrapolation = preMode;
      }
    }
    if (postMode) {
      this.postExtrapolation = postMode;
      for (const entry of this.tracks.values()) {
        entry.track.postExtrapolation = postMode;
      }
    }
    this.syncAllNodes();
    this.render();
  }

  // -------------------------------------------------------------
  // Keyframe Retiming, Scaling, Duplication & Clipboard
  // -------------------------------------------------------------

  deleteSelectedKeyframes() {
    const keys = Array.from(this.selectedKeys);
    if (keys.length === 0 && this.selectedKey) keys.push(this.selectedKey);
    if (keys.length === 0) return;

    this.saveUndoState();
    for (const entry of this.tracks.values()) {
      for (const k of keys) {
        entry.track.removeKey(k.frame);
      }
    }
    this.selectedKeys.clear();
    this.selectedKey = this.activeTrack && this.activeTrack.keys.length > 0 ? this.activeTrack.keys[0] : null;
    this.syncAllNodes();
    this.render();
  }

  duplicateSelectedKeyframes(deltaFrame = 1) {
    const keys = Array.from(this.selectedKeys);
    if (keys.length === 0 && this.selectedKey) keys.push(this.selectedKey);
    if (keys.length === 0) return;

    this.saveUndoState();
    const newSelected = new Set();

    for (const entry of this.tracks.values()) {
      const trackKeys = keys.filter(k => entry.track.keys.includes(k));
      if (trackKeys.length > 0) {
        const dups = entry.track.duplicateKeys(trackKeys.map(k => k.frame), deltaFrame);
        for (const d of dups) {
          d.selected = true;
          newSelected.add(d);
        }
      }
    }

    for (const k of this.selectedKeys) k.selected = false;
    this.selectedKeys = newSelected;
    this.selectedKey = newSelected.values().next().value || null;

    this.syncAllNodes();
    this.render();
  }

  scaleSelectedKeyframes(scaleFactor, pivotFrame = null) {
    if (this.selectedKeys.size === 0) return;
    this.saveUndoState();

    const pivot = pivotFrame !== null ? pivotFrame : Array.from(this.selectedKeys)[0].frame;
    for (const entry of this.tracks.values()) {
      entry.track.scaleKeys(scaleFactor, pivot, true);
    }
    this.syncAllNodes();
    this.render();
  }

  copyKeyframes() {
    const keys = Array.from(this.selectedKeys);
    if (keys.length === 0 && this.selectedKey) keys.push(this.selectedKey);
    if (keys.length === 0) return [];

    this.clipboard = [];
    for (const entry of this.tracks.values()) {
      const trackKeys = keys.filter(k => entry.track.keys.includes(k));
      if (trackKeys.length > 0) {
        this.clipboard.push({
          trackId: entry.id,
          keys: entry.track.copyKeys(trackKeys.map(k => k.frame))
        });
      }
    }
    return this.clipboard;
  }

  pasteKeyframes(targetFrame = null) {
    if (this.clipboard.length === 0) return [];
    this.saveUndoState();

    const pastedKeys = [];
    for (const item of this.clipboard) {
      const entry = this.tracks.get(item.trackId) || (this.activeTrack ? { track: this.activeTrack } : null);
      if (entry) {
        const added = entry.track.pasteKeys(item.keys, targetFrame);
        pastedKeys.push(...added);
      }
    }

    this.selectedKeys.clear();
    for (const k of pastedKeys) {
      k.selected = true;
      this.selectedKeys.add(k);
    }
    this.selectedKey = pastedKeys[0] || null;

    this.syncAllNodes();
    this.render();
    return pastedKeys;
  }

  // -------------------------------------------------------------
  // Viewport Fit Methods
  // -------------------------------------------------------------

  fitToCurves() {
    this.fitAll();
  }

  fitAll() {
    const allKeys = [];
    for (const entry of this.tracks.values()) {
      if (entry.visible) allKeys.push(...entry.track.keys);
    }

    if (allKeys.length === 0) {
      this.viewStartFrame = 1;
      this.viewEndFrame = 100;
      this.viewMinValue = 0.0;
      this.viewMaxValue = 1.0;
      this.render();
      return;
    }

    let minF = allKeys[0].frame;
    let maxF = allKeys[0].frame;
    let minV = allKeys[0].value;
    let maxV = allKeys[0].value;

    for (const k of allKeys) {
      if (k.frame < minF) minF = k.frame;
      if (k.frame > maxF) maxF = k.frame;
      if (typeof k.value === 'number') {
        if (k.value < minV) minV = k.value;
        if (k.value > maxV) maxV = k.value;
      }
    }

    const fSpan = Math.max(10, maxF - minF);
    const vSpan = Math.max(0.1, maxV - minV);

    this.viewStartFrame = Math.floor(minF - fSpan * 0.15);
    this.viewEndFrame = Math.ceil(maxF + fSpan * 0.15);
    this.viewMinValue = minV - vSpan * 0.2;
    this.viewMaxValue = maxV + vSpan * 0.2;
    this.render();
  }

  fitSelected() {
    const keys = Array.from(this.selectedKeys);
    if (keys.length === 0 && this.selectedKey) keys.push(this.selectedKey);
    if (keys.length === 0) {
      this.fitAll();
      return;
    }

    let minF = keys[0].frame;
    let maxF = keys[0].frame;
    let minV = keys[0].value;
    let maxV = keys[0].value;

    for (const k of keys) {
      if (k.frame < minF) minF = k.frame;
      if (k.frame > maxF) maxF = k.frame;
      if (typeof k.value === 'number') {
        if (k.value < minV) minV = k.value;
        if (k.value > maxV) maxV = k.value;
      }
    }

    const fSpan = Math.max(5, maxF - minF);
    const vSpan = Math.max(0.05, maxV - minV);

    this.viewStartFrame = Math.floor(minF - fSpan * 0.2);
    this.viewEndFrame = Math.ceil(maxF + fSpan * 0.2);
    this.viewMinValue = minV - vSpan * 0.25;
    this.viewMaxValue = maxV + vSpan * 0.25;
    this.render();
  }

  // -------------------------------------------------------------
  // Undo / Redo & Node Sync
  // -------------------------------------------------------------

  saveUndoState() {
    const snapshot = [];
    for (const entry of this.tracks.values()) {
      snapshot.push({
        id: entry.id,
        serialized: entry.track.serialize()
      });
    }
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    // Push current to redo
    const curSnapshot = [];
    for (const entry of this.tracks.values()) {
      curSnapshot.push({ id: entry.id, serialized: entry.track.serialize() });
    }
    this.redoStack.push(curSnapshot);

    const prevState = this.undoStack.pop();
    for (const item of prevState) {
      const entry = this.tracks.get(item.id);
      if (entry) {
        const restored = KeyframeTrack.deserialize(item.serialized);
        entry.track.keys = restored.keys;
        entry.track.preExtrapolation = restored.preExtrapolation;
        entry.track.postExtrapolation = restored.postExtrapolation;
      }
    }
    this.syncAllNodes();
    this.render();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const curSnapshot = [];
    for (const entry of this.tracks.values()) {
      curSnapshot.push({ id: entry.id, serialized: entry.track.serialize() });
    }
    this.undoStack.push(curSnapshot);

    const nextState = this.redoStack.pop();
    for (const item of nextState) {
      const entry = this.tracks.get(item.id);
      if (entry) {
        const restored = KeyframeTrack.deserialize(item.serialized);
        entry.track.keys = restored.keys;
        entry.track.preExtrapolation = restored.preExtrapolation;
        entry.track.postExtrapolation = restored.postExtrapolation;
      }
    }
    this.syncAllNodes();
    this.render();
    return true;
  }

  syncNode() {
    this.syncAllNodes();
  }

  syncAllNodes() {
    for (const entry of this.tracks.values()) {
      if (entry.node && entry.knobKey && entry.track) {
        const kfs = {};
        for (const k of entry.track.keys) {
          kfs[k.frame] = k.value;
        }
        if (!entry.node.knobs[entry.knobKey]) {
          entry.node.knobs[entry.knobKey] = {};
        }
        entry.node.knobs[entry.knobKey].keyframes = kfs;
        entry.node.markDirty();
      }
    }

    if (this.onCurveChanged && this.activeTrack) {
      this.onCurveChanged(this.activeTrack);
    }
  }

  // -------------------------------------------------------------
  // Event Listeners
  // -------------------------------------------------------------

  initEvents() {
    const c = this.canvas;

    // Mouse wheel zoom
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const fCenter = this.screenToFrame(mouseX);
      const vCenter = this.screenToValue(mouseY);

      const zoom = e.deltaY < 0 ? 1.15 : 0.87;

      const fRange = (this.viewEndFrame - this.viewStartFrame) / zoom;
      const vRange = (this.viewMaxValue - this.viewMinValue) / zoom;

      const uF = (mouseX - this.margin.left) / this.plotWidth;
      const uV = ((c.height - this.margin.bottom) - mouseY) / this.plotHeight;

      this.viewStartFrame = fCenter - uF * fRange;
      this.viewEndFrame = this.viewStartFrame + fRange;

      this.viewMinValue = vCenter - uV * vRange;
      this.viewMaxValue = this.viewMinValue + vRange;

      this.render();
    }, { passive: false });

    // Mouse down
    c.addEventListener('mousedown', (e) => {
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Middle click or Alt+click for pan
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        c.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        // 1. Check if clicking selected key tangent handles
        if (this.selectedKey) {
          const handles = this.getTangentHandles(this.selectedKey);
          if (handles) {
            const dLeft = Math.hypot(mouseX - handles.leftHandle.x, mouseY - handles.leftHandle.y);
            if (dLeft <= 9) {
              this.activeHandle = 'leftTangent';
              this.saveUndoState();
              e.preventDefault();
              return;
            }

            const dRight = Math.hypot(mouseX - handles.rightHandle.x, mouseY - handles.rightHandle.y);
            if (dRight <= 9) {
              this.activeHandle = 'rightTangent';
              this.saveUndoState();
              e.preventDefault();
              return;
            }
          }
        }

        // 2. Check if clicking any keyframe point across all visible tracks
        let clickedKey = null;
        let clickedTrack = null;

        for (const entry of this.tracks.values()) {
          if (!entry.visible) continue;
          for (const k of entry.track.keys) {
            const kx = this.frameToScreen(k.frame);
            const ky = this.valueToScreen(k.value);
            const d = Math.hypot(mouseX - kx, mouseY - ky);
            if (d <= 9) {
              clickedKey = k;
              clickedTrack = entry.track;
              this.activeTrack = entry.track;
              this.activeTrackId = entry.id;
              this.targetNode = entry.node;
              this.targetKnobKey = entry.knobKey;
              break;
            }
          }
          if (clickedKey) break;
        }

        if (clickedKey) {
          if (e.shiftKey) {
            // Toggle selection
            if (this.selectedKeys.has(clickedKey)) {
              this.selectedKeys.delete(clickedKey);
              clickedKey.selected = false;
            } else {
              this.selectedKeys.add(clickedKey);
              clickedKey.selected = true;
            }
          } else {
            // If clicking already selected key, keep selection for multi-drag
            if (!this.selectedKeys.has(clickedKey)) {
              for (const k of this.selectedKeys) k.selected = false;
              this.selectedKeys.clear();
              this.selectedKeys.add(clickedKey);
              clickedKey.selected = true;
            }
          }

          this.selectedKey = clickedKey;
          this.activeHandle = 'keyPoint';
          this.isDraggingKeys = true;
          this.dragStartFrame = this.screenToFrame(mouseX);
          this.dragStartValue = this.screenToValue(mouseY);

          // Store initial positions of all selected keys for delta dragging
          this.initialKeyPositions.clear();
          for (const k of this.selectedKeys) {
            this.initialKeyPositions.set(k, { frame: k.frame, value: k.value });
          }

          this.saveUndoState();
          this.render();
          e.preventDefault();
          return;
        }

        // 3. Clicked empty background: Start Marquee Box Selection
        if (!e.shiftKey) {
          for (const k of this.selectedKeys) k.selected = false;
          this.selectedKeys.clear();
          this.selectedKey = null;
        }

        this.isMarquee = true;
        this.marqueeStart = { x: mouseX, y: mouseY };
        this.marqueeEnd = { x: mouseX, y: mouseY };
        this.render();
      }
    });

    // Window Mouse Move
    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isPanning) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };

        const df = (dx / this.plotWidth) * (this.viewEndFrame - this.viewStartFrame);
        const dv = (dy / this.plotHeight) * (this.viewMaxValue - this.viewMinValue);

        this.viewStartFrame -= df;
        this.viewEndFrame -= df;
        this.viewMinValue += dv;
        this.viewMaxValue += dv;

        this.render();
        return;
      }

      if (this.isMarquee) {
        this.marqueeEnd = { x: mouseX, y: mouseY };
        this.updateMarqueeSelection();
        this.render();
        return;
      }

      if (this.isDraggingKeys && this.activeHandle === 'keyPoint') {
        const curF = this.screenToFrame(mouseX);
        const curV = this.screenToValue(mouseY);
        const deltaF = Math.round(curF - this.dragStartFrame);
        const deltaV = curV - this.dragStartValue;

        for (const [key, init] of this.initialKeyPositions.entries()) {
          key.frame = Math.round(init.frame + deltaF);
          if (typeof init.value === 'number') {
            key.value = init.value + deltaV;
          }
        }

        for (const entry of this.tracks.values()) {
          entry.track.keys.sort((a, b) => a.frame - b.frame);
          entry.track.recomputeAutoTangents();
        }

        this.syncAllNodes();
        this.render();
        return;
      }

      if (this.selectedKey && (this.activeHandle === 'rightTangent' || this.activeHandle === 'leftTangent')) {
        const curF = this.screenToFrame(mouseX);
        const curV = this.screenToValue(mouseY);

        if (this.activeHandle === 'rightTangent') {
          const df = Math.max(0.01, curF - this.selectedKey.frame);
          const dv = curV - this.selectedKey.value;
          const slope = dv / df;
          this.selectedKey.rightSlope = slope;
          if (this.tangentMode === 'smooth') {
            this.selectedKey.leftSlope = slope; // Collinear
          }
        } else if (this.activeHandle === 'leftTangent') {
          const df = Math.max(0.01, this.selectedKey.frame - curF);
          const dv = this.selectedKey.value - curV;
          const slope = dv / df;
          this.selectedKey.leftSlope = slope;
          if (this.tangentMode === 'smooth') {
            this.selectedKey.rightSlope = slope; // Collinear
          }
        }
        this.syncAllNodes();
        this.render();
        return;
      }

      // Cursor hover feedback
      if (this.selectedKey) {
        const handles = this.getTangentHandles(this.selectedKey);
        if (handles) {
          const dLeft = Math.hypot(mouseX - handles.leftHandle.x, mouseY - handles.leftHandle.y);
          const dRight = Math.hypot(mouseX - handles.rightHandle.x, mouseY - handles.rightHandle.y);
          if (dLeft <= 9 || dRight <= 9) {
            c.style.cursor = 'grab';
            return;
          }
        }
      }
      c.style.cursor = 'crosshair';
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.isMarquee = false;
      this.isDraggingKeys = false;
      this.activeHandle = null;
      this.render();
    });

    // Keyboard shortcuts in Curve Editor
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'f' || e.key === 'F') {
        this.fitSelected();
      } else if (e.key === 'a' || e.key === 'A') {
        this.fitAll();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelectedKeyframes();
      } else if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.duplicateSelectedKeyframes(1);
      } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        this.copyKeyframes();
      } else if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        this.pasteKeyframes();
      } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) this.redo();
        else this.undo();
      }
    });
  }

  updateMarqueeSelection() {
    const left = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const right = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
    const top = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const bottom = Math.max(this.marqueeStart.y, this.marqueeEnd.y);

    const fMin = this.screenToFrame(left);
    const fMax = this.screenToFrame(right);
    const vMax = this.screenToValue(top);
    const vMin = this.screenToValue(bottom);

    for (const entry of this.tracks.values()) {
      if (!entry.visible) continue;
      for (const k of entry.track.keys) {
        if (k.frame >= fMin && k.frame <= fMax && k.value >= vMin && k.value <= vMax) {
          k.selected = true;
          this.selectedKeys.add(k);
          if (!this.selectedKey) this.selectedKey = k;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!ctx || w <= 0 || h <= 0) return;

    // 1. Dark Studio Canvas Background
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw Grid Lines and Coordinate Labels
    this.renderGrid(ctx, w, h);

    if (this.tracks.size === 0 && !this.activeTrack) {
      ctx.fillStyle = '#666';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No animated curve selected', w * 0.5, h * 0.5);
      return;
    }

    // 3. Draw Evaluated Animation Curves
    for (const entry of this.tracks.values()) {
      if (entry.visible) {
        this.renderSingleCurve(ctx, entry.track, entry.color, entry.track === this.activeTrack);
      }
    }

    // 4. Draw Keyframe Points & Tangents
    for (const entry of this.tracks.values()) {
      if (entry.visible) {
        this.renderTrackKeyframes(ctx, entry.track, entry.color);
      }
    }

    // 5. Draw Marquee Selection Box
    if (this.isMarquee) {
      const left = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
      const top = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
      const boxW = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
      const boxH = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);

      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(left, top, boxW, boxH);

      ctx.fillStyle = 'rgba(74, 144, 226, 0.15)';
      ctx.fillRect(left, top, boxW, boxH);
      ctx.setLineDash([]);
    }

    // 6. Draw Channel Legend
    this.renderLegend(ctx);
  }

  renderGrid(ctx, w, h) {
    const startF = this.viewStartFrame;
    const endF = this.viewEndFrame;
    const minV = this.viewMinValue;
    const maxV = this.viewMaxValue;

    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#777';
    ctx.font = '10px monospace';

    // Horizontal grid lines (Values)
    const vSpan = maxV - minV;
    const vStep = Math.pow(10, Math.floor(Math.log10(vSpan))) * 0.5;

    const startVal = Math.floor(minV / vStep) * vStep;
    for (let v = startVal; v <= maxV; v += vStep) {
      const y = this.valueToScreen(v);
      if (y >= this.margin.top && y <= h - this.margin.bottom) {
        ctx.beginPath();
        ctx.moveTo(this.margin.left, y);
        ctx.lineTo(w - this.margin.right, y);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(2), this.margin.left - 8, y + 3);
      }
    }

    // Zero-value axis line
    const zeroY = this.valueToScreen(0.0);
    if (zeroY >= this.margin.top && zeroY <= h - this.margin.bottom) {
      ctx.strokeStyle = '#444';
      ctx.beginPath();
      ctx.moveTo(this.margin.left, zeroY);
      ctx.lineTo(w - this.margin.right, zeroY);
      ctx.stroke();
      ctx.strokeStyle = '#262626';
    }

    // Vertical grid lines (Frames)
    const fSpan = endF - startF;
    let fStep = 10;
    if (fSpan < 20) fStep = 1;
    else if (fSpan < 50) fStep = 5;
    else if (fSpan > 200) fStep = 25;
    else if (fSpan > 500) fStep = 50;

    const firstFrameTick = Math.ceil(startF / fStep) * fStep;
    for (let f = firstFrameTick; f <= endF; f += fStep) {
      const x = this.frameToScreen(f);
      if (x >= this.margin.left && x <= w - this.margin.right) {
        ctx.beginPath();
        ctx.moveTo(x, this.margin.top);
        ctx.lineTo(x, h - this.margin.bottom);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillText(String(f), x, h - this.margin.bottom + 16);
      }
    }

    // Outer Plot Border
    ctx.strokeStyle = '#333';
    ctx.strokeRect(this.margin.left, this.margin.top, this.plotWidth, this.plotHeight);
  }

  renderSingleCurve(ctx, track, color = '#ff922b', isActive = false) {
    if (track.keys.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top, this.plotWidth, this.plotHeight);
    ctx.clip();

    // 1. Draw extrapolation lines (dashed)
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 2 : 1.2;
    ctx.setLineDash([4, 3]);

    const firstK = track.keys[0];
    const lastK = track.keys[track.keys.length - 1];
    const firstX = this.frameToScreen(firstK.frame);
    const lastX = this.frameToScreen(lastK.frame);

    // Pre-extrapolation
    ctx.beginPath();
    let first = true;
    for (let x = this.margin.left; x < firstX; x += 4) {
      const f = this.screenToFrame(x);
      const v = track.evaluate(f);
      const y = this.valueToScreen(v);
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Post-extrapolation
    ctx.beginPath();
    first = true;
    for (let x = lastX; x <= this.margin.left + this.plotWidth; x += 4) {
      const f = this.screenToFrame(x);
      const v = track.evaluate(f);
      const y = this.valueToScreen(v);
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw active evaluated keyframe curve
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.beginPath();
    first = true;
    for (let x = Math.max(this.margin.left, firstX); x <= Math.min(this.margin.left + this.plotWidth, lastX); x += 2) {
      const f = this.screenToFrame(x);
      const v = track.evaluate(f);
      const y = this.valueToScreen(v);
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.restore();
  }

  renderTrackKeyframes(ctx, track, color = '#ff922b') {
    for (const key of track.keys) {
      const isSelected = this.selectedKeys.has(key) || this.selectedKey === key;
      const kx = this.frameToScreen(key.frame);
      const ky = this.valueToScreen(key.value);

      // Tangent Handles for selected keys
      if (isSelected && key.interpolation !== 'linear' && key.interpolation !== 'constant' && key.interpolation !== 'hold') {
        const handles = this.getTangentHandles(key, track);
        if (handles) {
          ctx.strokeStyle = '#51cf66';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);

          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(handles.leftHandle.x, handles.leftHandle.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(handles.rightHandle.x, handles.rightHandle.y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#51cf66';
          ctx.beginPath();
          ctx.arc(handles.leftHandle.x, handles.leftHandle.y, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(handles.rightHandle.x, handles.rightHandle.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Keyframe Point Diamond / Dot
      ctx.fillStyle = isSelected ? '#ff922b' : color;
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.arc(kx, ky, isSelected ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(kx, ky, 8.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  renderLegend(ctx) {
    if (this.tracks.size === 0) return;
    let lx = this.margin.left + 10;
    const ly = this.margin.top - 8;

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';

    for (const entry of this.tracks.values()) {
      ctx.fillStyle = entry.color;
      ctx.fillRect(lx, ly - 8, 8, 8);
      ctx.fillStyle = entry.visible ? '#ccc' : '#555';
      ctx.fillText(entry.name, lx + 12, ly);
      lx += ctx.measureText(entry.name).width + 28;
    }
  }
}
