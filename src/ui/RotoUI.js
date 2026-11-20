/**
 * OpenComp - Department 1: Professional Roto UI & Interactive Workspace
 * Professional manual rotoscoping tools:
 * - Bezier and B-Spline shape creation, editing, closing, and point insertion/deletion
 * - Control point, collinear/cusp tangent handles, and edge feather manipulation
 * - Multi-layer shape hierarchy, layer reordering, solo, lock, and visibility controls
 * - Per-shape and per-point feathering with interactive dashed falloff overlays
 * - Animated shape properties synchronized with current timeline frame
 * - Interactive shape transformation (translation, scaling, pivot)
 * - Numeric point inspector for precision coordinate adjustment
 * - Non-destructive viewer overlays with overlay visibility toggles
 * - Integrated Undo/Redo stack
 */

import { RotoShape, RotoControlPoint } from '../core/RotoSpline.js';

export class RotoUI {
  constructor(containerElement, viewerUI = null, onRotoUpdate = null) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onRotoUpdate = onRotoUpdate;

    this.activeRotoNode = null;
    this.selectedShapeId = null;
    this.selectedPointIndex = null;
    this.activeTool = 'select'; // 'select', 'bezier', 'bspline', 'add-point', 'remove-point', 'feather', 'transform'
    this.currentFrame = 1;

    // Overlay display toggles
    this.showOverlay = true;
    this.showPoints = true;
    this.showTangents = true;
    this.showFeather = true;

    // Dragging state
    this.isDraggingPoint = false;
    this.isDraggingTangent = false;
    this.dragTangentType = null; // 'in' or 'out'
    this.isDraggingFeather = false;
    this.isTransforming = false;
    this.transformDragMode = 'translate'; // 'translate', 'scale'
    this.transformHandle = null;
    this.dragStartPos = { x: 0, y: 0 };
    this.initialShapeBBox = null;

    // Undo / Redo stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndoSteps = 30;

    if (this.container) {
      this.render();
    }
  }

  setFrame(frame) {
    this.currentFrame = Math.round(frame) || 1;
    this.syncShapeProperties();
    if (this.viewerUI) {
      this.viewerUI.render();
    }
  }

  setRotoNode(rotoNode) {
    this.activeRotoNode = rotoNode;
    this.undoStack = [];
    this.redoStack = [];
    if (rotoNode && rotoNode.shapes.length > 0 && !this.selectedShapeId) {
      this.selectedShapeId = rotoNode.shapes[0].id;
    }
    this.updateShapeList();
    this.syncShapeProperties();
  }

  getActiveShape() {
    if (!this.activeRotoNode || !this.activeRotoNode.shapes) return null;
    return this.activeRotoNode.shapes.find(s => s.id === this.selectedShapeId) || null;
  }

  pushUndoState() {
    if (!this.activeRotoNode) return;
    const snapshot = (this.activeRotoNode.shapes || []).map(s => s.serialize());
    this.undoStack.push(JSON.stringify(snapshot));
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    if (!this.activeRotoNode || this.undoStack.length === 0) return false;
    const current = (this.activeRotoNode.shapes || []).map(s => s.serialize());
    this.redoStack.push(JSON.stringify(current));

    const state = JSON.parse(this.undoStack.pop());
    this.activeRotoNode.shapes = state.map(sd => RotoShape.deserialize(sd));
    this.activeRotoNode.markDirty();
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
    return true;
  }

  redo() {
    if (!this.activeRotoNode || this.redoStack.length === 0) return false;
    const current = (this.activeRotoNode.shapes || []).map(s => s.serialize());
    this.undoStack.push(JSON.stringify(current));

    const state = JSON.parse(this.redoStack.pop());
    this.activeRotoNode.shapes = state.map(sd => RotoShape.deserialize(sd));
    this.activeRotoNode.markDirty();
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
    return true;
  }

  setTool(tool) {
    this.activeTool = tool;
    if (!this.container) return;
    const toolBtns = this.container.querySelectorAll('.roto-tool-buttons .btn-tool');
    toolBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="roto-workspace-panel">
        <div class="roto-header">
          <span class="roto-title">🖋️ Professional Roto Engine</span>
          <div class="roto-tool-buttons">
            <button class="btn-tool ${this.activeTool === 'select' ? 'active' : ''}" data-tool="select" title="Select / Edit Points (V)">↖ Select [V]</button>
            <button class="btn-tool ${this.activeTool === 'bezier' ? 'active' : ''}" data-tool="bezier" title="Bezier Pen (P)">✒ Bezier [P]</button>
            <button class="btn-tool ${this.activeTool === 'bspline' ? 'active' : ''}" data-tool="bspline" title="B-Spline (B)">➰ B-Spline [B]</button>
            <button class="btn-tool ${this.activeTool === 'add-point' ? 'active' : ''}" data-tool="add-point" title="Add Point on Curve (+)">+ Pt</button>
            <button class="btn-tool ${this.activeTool === 'feather' ? 'active' : ''}" data-tool="feather" title="Feather Tool (E)">☁ Feather [E]</button>
            <button class="btn-tool ${this.activeTool === 'transform' ? 'active' : ''}" data-tool="transform" title="Shape Transform (T)">⤢ Box [T]</button>
          </div>
        </div>

        <div class="roto-overlay-toggles" style="display:flex; gap:8px; padding:4px 0; font-size:10px; color:#aaa; align-items:center;">
          <label><input type="checkbox" id="roto-toggle-overlay" ${this.showOverlay ? 'checked' : ''} /> Overlay</label>
          <label><input type="checkbox" id="roto-toggle-points" ${this.showPoints ? 'checked' : ''} /> Points</label>
          <label><input type="checkbox" id="roto-toggle-tangents" ${this.showTangents ? 'checked' : ''} /> Tangents</label>
          <label><input type="checkbox" id="roto-toggle-feather" ${this.showFeather ? 'checked' : ''} /> Feather</label>
          <div style="margin-left:auto; display:flex; gap:4px;">
            <button id="btn-roto-undo" class="btn-tool" title="Undo (Ctrl+Z)" style="font-size:10px; padding:2px 6px;">↶</button>
            <button id="btn-roto-redo" class="btn-tool" title="Redo (Ctrl+Y)" style="font-size:10px; padding:2px 6px;">↷</button>
          </div>
        </div>

        <div class="roto-shape-actions">
          <button id="btn-add-bezier" class="btn-action">+ Bezier</button>
          <button id="btn-add-bspline" class="btn-action">+ B-Spline</button>
          <button id="btn-add-rect" class="btn-action">+ Rect</button>
          <button id="btn-add-ellipse" class="btn-action">+ Ellipse</button>
          <button id="btn-dup-shape" class="btn-action" title="Duplicate Shape (Ctrl+D)">Duplicate</button>
          <button id="btn-del-shape" class="btn-action btn-danger">Delete</button>
        </div>

        <div class="roto-shape-list-container">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="roto-section-label">Shape Hierarchy & Layers:</label>
            <div style="display:flex; gap:4px;">
              <button id="btn-shape-move-up" class="btn-tool" title="Move Up" style="font-size:10px; padding:2px 6px;">▲</button>
              <button id="btn-shape-move-down" class="btn-tool" title="Move Down" style="font-size:10px; padding:2px 6px;">▼</button>
            </div>
          </div>
          <div id="roto-shape-tree" class="roto-shape-tree"></div>
        </div>

        <div class="roto-shape-props" id="roto-shape-props">
          <label class="roto-section-label">Shape Parameters:</label>
          <div class="roto-prop-row">
            <span>Blend Mode:</span>
            <select id="roto-prop-blend" class="roto-select">
              <option value="add">Add (Union)</option>
              <option value="subtract">Subtract (Hole)</option>
              <option value="intersect">Intersect</option>
              <option value="replace">Replace</option>
            </select>
          </div>
          <div class="roto-prop-row">
            <span>Global Feather:</span>
            <input type="range" id="roto-prop-feather" min="0" max="100" step="1" value="0" />
            <span id="roto-prop-feather-val">0px</span>
          </div>
          <div class="roto-prop-row">
            <span>Opacity:</span>
            <input type="range" id="roto-prop-opacity" min="0" max="1" step="0.05" value="1" />
            <span id="roto-prop-opacity-val">1.0</span>
          </div>
          <div class="roto-prop-row" style="display:flex; gap:16px;">
            <label><input type="checkbox" id="roto-prop-invert" /> Invert</label>
            <label><input type="checkbox" id="roto-prop-closed" checked /> Closed</label>
            <label><input type="checkbox" id="roto-prop-locked" /> Lock</label>
            <label><input type="checkbox" id="roto-prop-solo" /> Solo</label>
          </div>
        </div>

        <!-- Point Inspector -->
        <div class="roto-point-inspector" id="roto-point-inspector" style="margin-top:8px; padding-top:8px; border-top:1px solid #333; display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="roto-section-label" id="roto-point-label">Point Inspector:</label>
            <button id="btn-delete-point" class="btn-action btn-danger" style="font-size:10px; padding:2px 6px;">Delete Point</button>
          </div>
          <div class="roto-prop-row">
            <span>Position:</span>
            <label>X: <input type="number" id="roto-pt-x" style="width:60px;" class="timeline-num" /></label>
            <label>Y: <input type="number" id="roto-pt-y" style="width:60px;" class="timeline-num" /></label>
          </div>
          <div class="roto-prop-row" id="roto-pt-tangents-row">
            <span>Tangents:</span>
            <label>In: <input type="number" id="roto-pt-inx" style="width:45px;" class="timeline-num" />,<input type="number" id="roto-pt-iny" style="width:45px;" class="timeline-num" /></label>
            <label>Out: <input type="number" id="roto-pt-outx" style="width:45px;" class="timeline-num" />,<input type="number" id="roto-pt-outy" style="width:45px;" class="timeline-num" /></label>
          </div>
          <div class="roto-prop-row">
            <span>Point Feather:</span>
            <input type="range" id="roto-pt-feather" min="0" max="50" step="0.5" value="0" />
            <span id="roto-pt-feather-val">0px</span>
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
    this.updateShapeList();
    this.syncShapeProperties();
  }

  initEventListeners() {
    if (!this.container) return;

    // Tool buttons
    const toolBtns = this.container.querySelectorAll('.roto-tool-buttons .btn-tool');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        if (this.viewerUI) this.viewerUI.render();
      });
    });

    // Overlay display toggles
    this.container.querySelector('#roto-toggle-overlay')?.addEventListener('change', (e) => {
      this.showOverlay = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });
    this.container.querySelector('#roto-toggle-points')?.addEventListener('change', (e) => {
      this.showPoints = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });
    this.container.querySelector('#roto-toggle-tangents')?.addEventListener('change', (e) => {
      this.showTangents = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });
    this.container.querySelector('#roto-toggle-feather')?.addEventListener('change', (e) => {
      this.showFeather = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });

    // Undo / Redo buttons
    this.container.querySelector('#btn-roto-undo')?.addEventListener('click', () => this.undo());
    this.container.querySelector('#btn-roto-redo')?.addEventListener('click', () => this.redo());

    // Add Bezier
    this.container.querySelector('#btn-add-bezier')?.addEventListener('click', () => {
      this.addDefaultShape('bezier');
    });

    // Add B-Spline
    this.container.querySelector('#btn-add-bspline')?.addEventListener('click', () => {
      this.addDefaultShape('bspline');
    });

    // Add Rectangle
    this.container.querySelector('#btn-add-rect')?.addEventListener('click', () => {
      this.addDefaultShape('rectangle');
    });

    // Add Ellipse
    this.container.querySelector('#btn-add-ellipse')?.addEventListener('click', () => {
      this.addDefaultShape('ellipse');
    });

    // Duplicate Shape
    this.container.querySelector('#btn-dup-shape')?.addEventListener('click', () => {
      this.duplicateSelectedShape();
    });

    // Delete Shape
    this.container.querySelector('#btn-del-shape')?.addEventListener('click', () => {
      this.deleteSelectedShape();
    });

    // Reorder Shapes
    this.container.querySelector('#btn-shape-move-up')?.addEventListener('click', () => {
      this.moveSelectedShape(-1);
    });
    this.container.querySelector('#btn-shape-move-down')?.addEventListener('click', () => {
      this.moveSelectedShape(1);
    });

    // Shape properties
    const featherSlider = this.container.querySelector('#roto-prop-feather');
    const featherVal = this.container.querySelector('#roto-prop-feather-val');
    featherSlider?.addEventListener('input', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.feather = Number(e.target.value);
        if (featherVal) featherVal.textContent = `${s.feather}px`;
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const opacitySlider = this.container.querySelector('#roto-prop-opacity');
    const opacityVal = this.container.querySelector('#roto-prop-opacity-val');
    opacitySlider?.addEventListener('input', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.opacity = Number(e.target.value);
        if (opacityVal) opacityVal.textContent = s.opacity.toFixed(2);
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const blendSelect = this.container.querySelector('#roto-prop-blend');
    blendSelect?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.blendMode = e.target.value;
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const invertCheck = this.container.querySelector('#roto-prop-invert');
    invertCheck?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.inverted = e.target.checked;
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const closedCheck = this.container.querySelector('#roto-prop-closed');
    closedCheck?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.closed = e.target.checked;
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const lockCheck = this.container.querySelector('#roto-prop-locked');
    lockCheck?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.locked = e.target.checked;
        this.updateShapeList();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    const soloCheck = this.container.querySelector('#roto-prop-solo');
    soloCheck?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.solo = e.target.checked;
        this.activeRotoNode?.markDirty();
        this.updateShapeList();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    // Point Inspector events
    const ptX = this.container.querySelector('#roto-pt-x');
    const ptY = this.container.querySelector('#roto-pt-y');
    ptX?.addEventListener('change', () => this.updateSelectedPointFromInspector());
    ptY?.addEventListener('change', () => this.updateSelectedPointFromInspector());

    const ptInX = this.container.querySelector('#roto-pt-inx');
    const ptInY = this.container.querySelector('#roto-pt-iny');
    const ptOutX = this.container.querySelector('#roto-pt-outx');
    const ptOutY = this.container.querySelector('#roto-pt-outy');
    ptInX?.addEventListener('change', () => this.updateSelectedPointFromInspector());
    ptInY?.addEventListener('change', () => this.updateSelectedPointFromInspector());
    ptOutX?.addEventListener('change', () => this.updateSelectedPointFromInspector());
    ptOutY?.addEventListener('change', () => this.updateSelectedPointFromInspector());

    const ptFeather = this.container.querySelector('#roto-pt-feather');
    const ptFeatherVal = this.container.querySelector('#roto-pt-feather-val');
    ptFeather?.addEventListener('input', (e) => {
      const shape = this.getActiveShape();
      if (shape && this.selectedPointIndex !== null && shape.points[this.selectedPointIndex]) {
        const pt = shape.points[this.selectedPointIndex];
        const val = Number(e.target.value);
        if (ptFeatherVal) ptFeatherVal.textContent = `${val}px`;
        const cur = pt.getAtFrame(this.currentFrame);
        pt.setKey(this.currentFrame, cur.x, cur.y, cur.inTx, cur.inTy, cur.outTx, cur.outTy, val);
        this.activeRotoNode?.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      }
    });

    this.container.querySelector('#btn-delete-point')?.addEventListener('click', () => {
      this.deleteSelectedPoint();
    });
  }

  addDefaultShape(type) {
    if (!this.activeRotoNode) return;
    this.pushUndoState();
    const count = this.activeRotoNode.shapes.length + 1;

    let shape;
    if (type === 'bezier') {
      shape = new RotoShape(`Bezier_${count}`, 'bezier');
      shape.addPoint(860, 440, -40, 0, 40, 0, this.currentFrame);
      shape.addPoint(1060, 440, 0, -40, 0, 40, this.currentFrame);
      shape.addPoint(960, 640, 40, 0, -40, 0, this.currentFrame);
    } else if (type === 'bspline') {
      shape = new RotoShape(`BSpline_${count}`, 'bspline');
      shape.addPoint(850, 420, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(1070, 420, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(1070, 640, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(850, 640, 0, 0, 0, 0, this.currentFrame);
    } else if (type === 'rectangle') {
      shape = new RotoShape(`Rect_${count}`, 'polygon');
      shape.addPoint(800, 400, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(1120, 400, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(1120, 680, 0, 0, 0, 0, this.currentFrame);
      shape.addPoint(800, 680, 0, 0, 0, 0, this.currentFrame);
    } else if (type === 'ellipse') {
      shape = new RotoShape(`Ellipse_${count}`, 'bezier');
      const cx = 960, cy = 540, rx = 160, ry = 110;
      const k = 0.5522847498;
      shape.addPoint(cx, cy - ry, -rx * k, 0, rx * k, 0, this.currentFrame);
      shape.addPoint(cx + rx, cy, 0, -ry * k, 0, ry * k, this.currentFrame);
      shape.addPoint(cx, cy + ry, rx * k, 0, -rx * k, 0, this.currentFrame);
      shape.addPoint(cx - rx, cy, 0, ry * k, 0, -ry * k, this.currentFrame);
    }

    this.activeRotoNode.addShape(shape);
    this.selectedShapeId = shape.id;
    this.selectedPointIndex = null;
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
  }

  duplicateSelectedShape() {
    const s = this.getActiveShape();
    if (!s || !this.activeRotoNode) return;
    this.pushUndoState();
    const copy = s.duplicate();
    // Offset slightly for visibility
    copy.transform({ tx: 30, ty: 30 }, this.currentFrame);
    this.activeRotoNode.addShape(copy);
    this.selectedShapeId = copy.id;
    this.selectedPointIndex = null;
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
  }

  deleteSelectedShape() {
    if (!this.activeRotoNode || !this.selectedShapeId) return;
    this.pushUndoState();
    this.activeRotoNode.removeShape(this.selectedShapeId);
    this.selectedShapeId = this.activeRotoNode.shapes[0]?.id || null;
    this.selectedPointIndex = null;
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
  }

  deleteSelectedPoint() {
    const shape = this.getActiveShape();
    if (!shape || this.selectedPointIndex === null || shape.locked) return;
    if (shape.points.length <= 2) {
      this.deleteSelectedShape();
      return;
    }
    this.pushUndoState();
    shape.removePoint(this.selectedPointIndex);
    this.selectedPointIndex = Math.min(this.selectedPointIndex, shape.points.length - 1);
    this.activeRotoNode?.markDirty();
    this.updateShapeList();
    this.syncShapeProperties();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
  }

  moveSelectedShape(direction) {
    if (!this.activeRotoNode || !this.selectedShapeId) return;
    const shapes = this.activeRotoNode.shapes;
    const idx = shapes.findIndex(s => s.id === this.selectedShapeId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < shapes.length) {
      this.pushUndoState();
      const [item] = shapes.splice(idx, 1);
      shapes.splice(newIdx, 0, item);
      this.activeRotoNode.markDirty();
      this.updateShapeList();
      if (this.onRotoUpdate) this.onRotoUpdate();
      if (this.viewerUI) this.viewerUI.render();
    }
  }

  updateShapeList() {
    if (!this.container) return;
    const tree = this.container.querySelector('#roto-shape-tree');
    if (!tree) return;
    tree.innerHTML = '';

    if (!this.activeRotoNode || this.activeRotoNode.shapes.length === 0) {
      tree.innerHTML = '<div class="roto-empty-msg" style="padding:10px; color:#666; font-size:11px;">No active roto shapes. Click "+ Bezier" or "+ B-Spline" above.</div>';
      return;
    }

    const hasAnySolo = this.activeRotoNode.shapes.some(s => s.solo);

    for (let i = 0; i < this.activeRotoNode.shapes.length; i++) {
      const shape = this.activeRotoNode.shapes[i];
      const isSelected = (shape.id === this.selectedShapeId);
      const isEffectiveVisible = shape.visible && (!hasAnySolo || shape.solo);

      const item = document.createElement('div');
      item.className = `roto-tree-item ${isSelected ? 'selected' : ''}`;
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '6px';
      item.style.padding = '4px 6px';
      item.style.cursor = 'pointer';
      item.style.borderBottom = '1px solid #222';
      item.style.background = isSelected ? '#2a313d' : 'transparent';

      item.innerHTML = `
        <span class="shape-vis-icon" title="Toggle Visibility" style="cursor:pointer; opacity:${isEffectiveVisible ? '1.0' : '0.4'};">${shape.visible ? '👁' : '🚫'}</span>
        <span class="shape-lock-icon" title="Toggle Lock" style="cursor:pointer; font-size:11px;">${shape.locked ? '🔒' : '🔓'}</span>
        <span class="shape-solo-icon" title="Toggle Solo" style="cursor:pointer; font-size:11px; opacity:${shape.solo ? '1.0' : '0.4'};">⭐</span>
        <span class="shape-color-dot" style="width:8px; height:8px; border-radius:50%; background:${shape.color};"></span>
        <span class="shape-name" style="flex:1; font-size:11px; font-weight:500; color:${isSelected ? '#fff' : '#aaa'};">${shape.name}</span>
        <span class="shape-type-badge" style="font-size:9px; background:#1e2430; padding:1px 4px; border-radius:3px; color:#888;">${shape.type.toUpperCase()}</span>
        <span class="shape-points-count" style="font-size:10px; color:#666;">${shape.points.length}p</span>
      `;

      // Event handlers on icons
      item.querySelector('.shape-vis-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        shape.visible = !shape.visible;
        this.activeRotoNode?.markDirty();
        this.updateShapeList();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      });

      item.querySelector('.shape-lock-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        shape.locked = !shape.locked;
        this.updateShapeList();
        this.syncShapeProperties();
        if (this.viewerUI) this.viewerUI.render();
      });

      item.querySelector('.shape-solo-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        shape.solo = !shape.solo;
        this.activeRotoNode?.markDirty();
        this.updateShapeList();
        this.syncShapeProperties();
        if (this.onRotoUpdate) this.onRotoUpdate();
        if (this.viewerUI) this.viewerUI.render();
      });

      // Item selection
      item.addEventListener('click', () => {
        this.selectedShapeId = shape.id;
        this.selectedPointIndex = null;
        this.updateShapeList();
        this.syncShapeProperties();
        if (this.viewerUI) this.viewerUI.render();
      });

      // Double-click to rename
      item.querySelector('.shape-name')?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const curName = shape.name;
        const newName = prompt('Enter new shape name:', curName);
        if (newName && newName.trim()) {
          shape.name = newName.trim();
          this.updateShapeList();
        }
      });

      tree.appendChild(item);
    }
  }

  syncShapeProperties() {
    if (!this.container) return;
    const s = this.getActiveShape();
    const propsPanel = this.container.querySelector('#roto-shape-props');
    const ptInspector = this.container.querySelector('#roto-point-inspector');

    if (!s) {
      if (propsPanel) propsPanel.style.opacity = '0.5';
      if (ptInspector) ptInspector.style.display = 'none';
      return;
    }
    if (propsPanel) propsPanel.style.opacity = '1.0';

    const blendSelect = this.container.querySelector('#roto-prop-blend');
    if (blendSelect) blendSelect.value = s.blendMode;

    const featherSlider = this.container.querySelector('#roto-prop-feather');
    const featherVal = this.container.querySelector('#roto-prop-feather-val');
    if (featherSlider) featherSlider.value = s.feather;
    if (featherVal) featherVal.textContent = `${s.feather}px`;

    const opacitySlider = this.container.querySelector('#roto-prop-opacity');
    const opacityVal = this.container.querySelector('#roto-prop-opacity-val');
    if (opacitySlider) opacitySlider.value = s.opacity;
    if (opacityVal) opacityVal.textContent = s.opacity.toFixed(2);

    const invertCheck = this.container.querySelector('#roto-prop-invert');
    if (invertCheck) invertCheck.checked = s.inverted;

    const closedCheck = this.container.querySelector('#roto-prop-closed');
    if (closedCheck) closedCheck.checked = s.closed;

    const lockCheck = this.container.querySelector('#roto-prop-locked');
    if (lockCheck) lockCheck.checked = s.locked;

    const soloCheck = this.container.querySelector('#roto-prop-solo');
    if (soloCheck) soloCheck.checked = s.solo;

    // Sync Point Inspector
    if (this.selectedPointIndex !== null && s.points[this.selectedPointIndex]) {
      const pt = s.points[this.selectedPointIndex];
      const cur = pt.getAtFrame(this.currentFrame);
      if (ptInspector) ptInspector.style.display = 'block';

      const label = this.container.querySelector('#roto-point-label');
      if (label) label.textContent = `Point #${this.selectedPointIndex + 1} (${s.type}):`;

      const ptX = this.container.querySelector('#roto-pt-x');
      const ptY = this.container.querySelector('#roto-pt-y');
      if (ptX) ptX.value = Math.round(cur.x);
      if (ptY) ptY.value = Math.round(cur.y);

      const tanRow = this.container.querySelector('#roto-pt-tangents-row');
      if (tanRow) {
        tanRow.style.display = (s.type === 'bezier') ? 'flex' : 'none';
      }

      const ptInX = this.container.querySelector('#roto-pt-inx');
      const ptInY = this.container.querySelector('#roto-pt-iny');
      const ptOutX = this.container.querySelector('#roto-pt-outx');
      const ptOutY = this.container.querySelector('#roto-pt-outy');
      if (ptInX) ptInX.value = Math.round(cur.inTx);
      if (ptInY) ptInY.value = Math.round(cur.inTy);
      if (ptOutX) ptOutX.value = Math.round(cur.outTx);
      if (ptOutY) ptOutY.value = Math.round(cur.outTy);

      const ptFeather = this.container.querySelector('#roto-pt-feather');
      const ptFeatherVal = this.container.querySelector('#roto-pt-feather-val');
      if (ptFeather) ptFeather.value = cur.feather;
      if (ptFeatherVal) ptFeatherVal.textContent = `${cur.feather}px`;
    } else {
      if (ptInspector) ptInspector.style.display = 'none';
    }
  }

  updateSelectedPointFromInspector() {
    const shape = this.getActiveShape();
    if (!shape || this.selectedPointIndex === null || shape.locked) return;
    const pt = shape.points[this.selectedPointIndex];
    if (!pt) return;

    this.pushUndoState();
    const ptX = Number(this.container.querySelector('#roto-pt-x')?.value) || 0;
    const ptY = Number(this.container.querySelector('#roto-pt-y')?.value) || 0;
    const inX = Number(this.container.querySelector('#roto-pt-inx')?.value) || 0;
    const inY = Number(this.container.querySelector('#roto-pt-iny')?.value) || 0;
    const outX = Number(this.container.querySelector('#roto-pt-outx')?.value) || 0;
    const outY = Number(this.container.querySelector('#roto-pt-outy')?.value) || 0;
    const cur = pt.getAtFrame(this.currentFrame);

    pt.setKey(this.currentFrame, ptX, ptY, inX, inY, outX, outY, cur.feather);
    this.activeRotoNode?.markDirty();
    if (this.onRotoUpdate) this.onRotoUpdate();
    if (this.viewerUI) this.viewerUI.render();
  }

  // --- Viewer Overlay Drawing ---

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.showOverlay || !this.activeRotoNode || !this.activeRotoNode.shapes) return;

    const shapes = this.activeRotoNode.shapes;
    const hasAnySolo = shapes.some(s => s.solo);

    for (const shape of shapes) {
      if (!shape.visible) continue;
      if (hasAnySolo && !shape.solo) continue;
      if (shape.points.length === 0) continue;

      const isSelected = (shape.id === this.selectedShapeId);
      const strokeColor = isSelected ? '#ff922b' : (shape.color || '#51cf66');

      ctx.save();

      // 1. Draw evaluated spline boundary curve
      const poly = shape.sampleCurve(this.currentFrame, 16);
      if (poly.length >= 2) {
        ctx.beginPath();
        const startX = poly[0].x * zoom + panX;
        const startY = poly[0].y * zoom + panY;
        ctx.moveTo(startX, startY);

        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x * zoom + panX, poly[i].y * zoom + panY);
        }
        if (shape.closed) {
          ctx.closePath();
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isSelected ? 2.0 : 1.2;
        ctx.stroke();

        // Optional semi-transparent fill on selected shape
        if (isSelected && shape.closed) {
          ctx.fillStyle = 'rgba(255, 146, 43, 0.08)';
          ctx.fill();
        }
      }

      // 2. Feather boundary outline (dashed)
      if (this.showFeather && (shape.feather > 0 || isSelected)) {
        const totalFeather = shape.feather;
        if (totalFeather > 0 && poly.length >= 2) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isSelected ? 'rgba(255, 200, 100, 0.55)' : 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 1;

          // Outward normal approximation
          ctx.beginPath();
          const n = poly.length;
          for (let i = 0; i < n; i++) {
            const pPrev = poly[(i - 1 + n) % n];
            const pNext = poly[(i + 1) % n];
            const dx = pNext.x - pPrev.x;
            const dy = pNext.y - pPrev.y;
            const len = Math.hypot(dx, dy) || 1.0;
            // Outward normal (assuming clockwise)
            const nx = -dy / len;
            const ny = dx / len;
            const fDist = totalFeather + (poly[i].feather || 0);
            const fx = (poly[i].x + nx * fDist) * zoom + panX;
            const fy = (poly[i].y + ny * fDist) * zoom + panY;

            if (i === 0) ctx.moveTo(fx, fy);
            else ctx.lineTo(fx, fy);
          }
          if (shape.closed) ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      }

      // 3. Draw Control Points & Tangents
      if (this.showPoints && isSelected) {
        const evaluatedPoints = shape.points.map(p => p.getAtFrame(this.currentFrame));

        // Connect B-spline guiding polygon with thin dotted line
        if (shape.type === 'bspline') {
          ctx.save();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.beginPath();
          for (let i = 0; i < evaluatedPoints.length; i++) {
            const px = evaluatedPoints[i].x * zoom + panX;
            const py = evaluatedPoints[i].y * zoom + panY;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          if (shape.closed) ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }

        for (let i = 0; i < evaluatedPoints.length; i++) {
          const pt = evaluatedPoints[i];
          const px = pt.x * zoom + panX;
          const py = pt.y * zoom + panY;
          const isPtSelected = (i === this.selectedPointIndex);

          // Control Point Box
          ctx.fillStyle = isPtSelected ? '#ffdd00' : '#ffffff';
          ctx.strokeStyle = '#111111';
          ctx.lineWidth = 1.2;
          ctx.fillRect(px - 4, py - 4, 8, 8);
          ctx.strokeRect(px - 4, py - 4, 8, 8);

          // Bezier Tangent Handles
          if (this.showTangents && shape.type === 'bezier' && (isPtSelected || this.activeTool === 'feather')) {
            const hInX = (pt.x + pt.inTx) * zoom + panX;
            const hInY = (pt.y + pt.inTy) * zoom + panY;
            const hOutX = (pt.x + pt.outTx) * zoom + panX;
            const hOutY = (pt.y + pt.outTy) * zoom + panY;

            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(hInX, hInY);
            ctx.lineTo(px, py);
            ctx.lineTo(hOutX, hOutY);
            ctx.stroke();

            // Tangent Handle End Points
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(hInX, hInY, 3.5, 0, Math.PI * 2);
            ctx.arc(hOutX, hOutY, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.stroke();
          }

          // Per-point feather indicator
          if (pt.feather > 0) {
            ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
            ctx.font = '8px monospace';
            ctx.fillText(`+${pt.feather}`, px + 6, py - 6);
          }
        }
      }

      // 4. Transform Bounding Box & Handles (Transform tool)
      if (isSelected && this.activeTool === 'transform') {
        const bbox = shape.getBoundingBox(this.currentFrame);
        if (bbox && bbox.width > 0) {
          const bx = bbox.minX * zoom + panX;
          const by = bbox.minY * zoom + panY;
          const bw = bbox.width * zoom;
          const bh = bbox.height * zoom;

          ctx.save();
          ctx.strokeStyle = '#ff922b';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 2]);
          ctx.strokeRect(bx, by, bw, bh);

          // 8 Corner / Edge Handles
          ctx.setLineDash([]);
          ctx.fillStyle = '#ff922b';
          const handles = [
            { x: bx, y: by }, { x: bx + bw * 0.5, y: by }, { x: bx + bw, y: by },
            { x: bx + bw, y: by + bh * 0.5 }, { x: bx + bw, y: by + bh },
            { x: bx + bw * 0.5, y: by + bh }, { x: bx, y: by + bh }, { x: bx, y: by + bh * 0.5 }
          ];
          for (const h of handles) {
            ctx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
          }

          // Center Pivot Cross
          const pcx = bbox.centerX * zoom + panX;
          const pcy = bbox.centerY * zoom + panY;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(pcx - 8, pcy); ctx.lineTo(pcx + 8, pcy);
          ctx.moveTo(pcx, pcy - 8); ctx.lineTo(pcx, pcy + 8);
          ctx.stroke();
          ctx.restore();
        }
      }

      ctx.restore();
    }
  }

  // --- Mouse Interaction ---

  onMouseDown(e, imgX, imgY) {
    if (!this.activeRotoNode) return false;

    const shape = this.getActiveShape();
    const zoom = this.viewerUI?.zoom || 1.0;
    const hitRadius = 12 / zoom;

    // 1. Transform tool interaction
    if (this.activeTool === 'transform' && shape && !shape.locked) {
      const bbox = shape.getBoundingBox(this.currentFrame);
      if (bbox && bbox.width > 0) {
        this.pushUndoState();
        this.isTransforming = true;
        this.dragStartPos = { x: imgX, y: imgY };
        this.initialShapeBBox = { ...bbox };
        return true;
      }
    }

    // 2. Tangent handles hit test (Bezier shape and selected point)
    if (shape && !shape.locked && shape.type === 'bezier' && this.selectedPointIndex !== null) {
      const pt = shape.points[this.selectedPointIndex];
      if (pt) {
        const cur = pt.getAtFrame(this.currentFrame);
        const inDist = Math.hypot((cur.x + cur.inTx) - imgX, (cur.y + cur.inTy) - imgY);
        const outDist = Math.hypot((cur.x + cur.outTx) - imgX, (cur.y + cur.outTy) - imgY);

        if (inDist <= hitRadius) {
          this.pushUndoState();
          this.isDraggingTangent = true;
          this.dragTangentType = 'in';
          this.dragStartPos = { x: imgX, y: imgY };
          return true;
        }
        if (outDist <= hitRadius) {
          this.pushUndoState();
          this.isDraggingTangent = true;
          this.dragTangentType = 'out';
          this.dragStartPos = { x: imgX, y: imgY };
          return true;
        }
      }
    }

    // 3. Existing control points hit test
    if (shape && !shape.locked) {
      for (let i = 0; i < shape.points.length; i++) {
        const pt = shape.points[i];
        const cur = pt.getAtFrame(this.currentFrame);
        const dist = Math.hypot(cur.x - imgX, cur.y - imgY);

        if (dist <= hitRadius) {
          // If in remove-point mode, delete point
          if (this.activeTool === 'remove-point') {
            this.selectedPointIndex = i;
            this.deleteSelectedPoint();
            return true;
          }

          // If in feather tool mode, start feather dragging
          if (this.activeTool === 'feather') {
            this.pushUndoState();
            this.selectedPointIndex = i;
            this.isDraggingFeather = true;
            this.dragStartPos = { x: imgX, y: imgY };
            this.syncShapeProperties();
            return true;
          }

          // In select or bezier mode: select and drag point
          this.pushUndoState();
          this.selectedPointIndex = i;
          this.isDraggingPoint = true;
          this.dragStartPos = { x: imgX, y: imgY };
          this.syncShapeProperties();
          return true;
        }
      }
    }

    // 4. Close curve check (in bezier or bspline mode, clicking near point 0 closes the spline)
    if (shape && !shape.locked && (this.activeTool === 'bezier' || this.activeTool === 'bspline') && shape.points.length >= 3 && !shape.closed) {
      const p0 = shape.points[0].getAtFrame(this.currentFrame);
      if (Math.hypot(p0.x - imgX, p0.y - imgY) <= hitRadius) {
        this.pushUndoState();
        shape.closed = true;
        this.activeRotoNode.markDirty();
        this.syncShapeProperties();
        if (this.onRotoUpdate) this.onRotoUpdate();
        return true;
      }
    }

    // 5. Add Point Tool: insert along nearest segment
    if (shape && !shape.locked && this.activeTool === 'add-point') {
      const poly = shape.sampleCurve(this.currentFrame, 16);
      let closestDist = Infinity;
      let insertIndex = shape.points.length;

      for (let i = 0; i < shape.points.length; i++) {
        const nextIdx = (i + 1) % shape.points.length;
        const p1 = shape.points[i].getAtFrame(this.currentFrame);
        const p2 = shape.points[nextIdx].getAtFrame(this.currentFrame);
        const d = distToSegment(imgX, imgY, p1.x, p1.y, p2.x, p2.y);
        if (d < closestDist && d < hitRadius * 2) {
          closestDist = d;
          insertIndex = i + 1;
        }
      }

      this.pushUndoState();
      const newPt = shape.insertPoint(insertIndex, imgX, imgY, this.currentFrame);
      this.selectedPointIndex = insertIndex;
      this.isDraggingPoint = true;
      this.dragStartPos = { x: imgX, y: imgY };
      this.activeRotoNode.markDirty();
      this.updateShapeList();
      this.syncShapeProperties();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return true;
    }

    // 6. Pen / Bezier / B-Spline Tool: append new point
    if (shape && !shape.locked && (this.activeTool === 'bezier' || this.activeTool === 'bspline')) {
      this.pushUndoState();
      const defaultTan = (this.activeTool === 'bezier') ? 30 : 0;
      shape.addPoint(imgX, imgY, -defaultTan, 0, defaultTan, 0, this.currentFrame);
      this.selectedPointIndex = shape.points.length - 1;
      this.isDraggingPoint = true;
      this.dragStartPos = { x: imgX, y: imgY };
      this.activeRotoNode.markDirty();
      this.updateShapeList();
      this.syncShapeProperties();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return true;
    }

    // 7. Check click inside any visible shape to select it
    for (const sh of this.activeRotoNode.shapes) {
      if (!sh.visible || sh.locked) continue;
      const poly = sh.sampleCurve(this.currentFrame, 8);
      if (isPointInsidePolygon(imgX, imgY, poly)) {
        this.selectedShapeId = sh.id;
        this.selectedPointIndex = null;
        this.updateShapeList();
        this.syncShapeProperties();
        return true;
      }
    }

    // Click in blank space: deselect point
    this.selectedPointIndex = null;
    this.syncShapeProperties();
    return false;
  }

  onMouseMove(e, imgX, imgY) {
    const shape = this.getActiveShape();
    if (!shape || shape.locked) return;

    // 1. Dragging Control Point
    if (this.isDraggingPoint && this.selectedPointIndex !== null && shape.points[this.selectedPointIndex]) {
      const pt = shape.points[this.selectedPointIndex];
      const cur = pt.getAtFrame(this.currentFrame);
      pt.setKey(this.currentFrame, imgX, imgY, cur.inTx, cur.inTy, cur.outTx, cur.outTy, cur.feather);
      this.activeRotoNode?.markDirty();
      this.syncShapeProperties();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return;
    }

    // 2. Dragging Tangent Handle
    if (this.isDraggingTangent && this.selectedPointIndex !== null && shape.points[this.selectedPointIndex]) {
      const pt = shape.points[this.selectedPointIndex];
      const cur = pt.getAtFrame(this.currentFrame);
      const isAlt = !!e.altKey;

      if (this.dragTangentType === 'out') {
        const outX = imgX - cur.x;
        const outY = imgY - cur.y;
        let inX = cur.inTx;
        let inY = cur.inTy;
        // Collinear / smooth symmetry unless Alt is pressed
        if (!isAlt && pt.isSmooth) {
          inX = -outX;
          inY = -outY;
        }
        pt.setKey(this.currentFrame, cur.x, cur.y, inX, inY, outX, outY, cur.feather);
      } else {
        const inX = imgX - cur.x;
        const inY = imgY - cur.y;
        let outX = cur.outTx;
        let outY = cur.outTy;
        if (!isAlt && pt.isSmooth) {
          outX = -inX;
          outY = -inY;
        }
        pt.setKey(this.currentFrame, cur.x, cur.y, inX, inY, outX, outY, cur.feather);
      }

      this.activeRotoNode?.markDirty();
      this.syncShapeProperties();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return;
    }

    // 3. Dragging Feather Distance
    if (this.isDraggingFeather && this.selectedPointIndex !== null && shape.points[this.selectedPointIndex]) {
      const pt = shape.points[this.selectedPointIndex];
      const cur = pt.getAtFrame(this.currentFrame);
      const dist = Math.hypot(imgX - cur.x, imgY - cur.y);
      pt.setKey(this.currentFrame, cur.x, cur.y, cur.inTx, cur.inTy, cur.outTx, cur.outTy, Math.round(dist));
      this.activeRotoNode?.markDirty();
      this.syncShapeProperties();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return;
    }

    // 4. Transforming Entire Shape
    if (this.isTransforming && this.dragStartPos) {
      const dx = imgX - this.dragStartPos.x;
      const dy = imgY - this.dragStartPos.y;
      shape.transform({ tx: dx, ty: dy }, this.currentFrame);
      this.dragStartPos = { x: imgX, y: imgY };
      this.activeRotoNode?.markDirty();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return;
    }
  }

  onMouseUp(e, imgX, imgY) {
    if (this.isDraggingPoint || this.isDraggingTangent || this.isDraggingFeather || this.isTransforming) {
      this.isDraggingPoint = false;
      this.isDraggingTangent = false;
      this.dragTangentType = null;
      this.isDraggingFeather = false;
      this.isTransforming = false;
      this.activeRotoNode?.markDirty();
      if (this.onRotoUpdate) this.onRotoUpdate();
      if (this.viewerUI) this.viewerUI.render();
    }
  }

  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return false;

    if (e.key === 'v' || e.key === 'V') {
      this.setTool('select');
      return true;
    }
    if (e.key === 'p' || e.key === 'P') {
      this.setTool('bezier');
      return true;
    }
    if (e.key === 'b' || e.key === 'B') {
      this.setTool('bspline');
      return true;
    }
    if (e.key === 'e' || e.key === 'E') {
      this.setTool('feather');
      return true;
    }
    if (e.key === 't' || e.key === 'T') {
      this.setTool('transform');
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedPointIndex !== null) {
        this.deleteSelectedPoint();
        return true;
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      this.duplicateSelectedShape();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.redo();
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Geometry Helper Functions
// ---------------------------------------------------------------------------
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function isPointInsidePolygon(px, py, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
