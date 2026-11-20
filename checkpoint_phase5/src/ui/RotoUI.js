/**
 * OpenComp - Department 1: Roto UI & Interactive Workspace
 * Provides professional manual rotoscoping tools, Bezier spline editing,
 * tangent handles, feather visualization, and layer hierarchy management.
 */

import { RotoShape, RotoControlPoint } from '../core/RotoSpline.js';

export class RotoUI {
  constructor(containerElement, viewerUI, onRotoUpdate) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onRotoUpdate = onRotoUpdate;

    this.activeRotoNode = null;
    this.selectedShapeId = null;
    this.selectedPointIndex = null;
    this.activeTool = 'select'; // 'select', 'bezier', 'b-spline', 'add-point', 'feather'

    this.isDraggingPoint = false;
    this.isDraggingTangent = false;
    this.dragTangentType = null; // 'in' or 'out'
    this.dragStartPos = { x: 0, y: 0 };

    this.render();
  }

  setRotoNode(rotoNode) {
    this.activeRotoNode = rotoNode;
    if (rotoNode && rotoNode.shapes.length > 0 && !this.selectedShapeId) {
      this.selectedShapeId = rotoNode.shapes[0].id;
    }
    this.updateShapeList();
  }

  getActiveShape() {
    if (!this.activeRotoNode) return null;
    return this.activeRotoNode.shapes.find(s => s.id === this.selectedShapeId) || null;
  }

  render() {
    this.container.innerHTML = `
      <div class="roto-workspace-panel">
        <div class="roto-header">
          <span class="roto-title">🖋️ Manual Roto Tools</span>
          <div class="roto-tool-buttons">
            <button class="btn-tool active" data-tool="select" title="Select / Edit Points (V)">↖ Move [V]</button>
            <button class="btn-tool" data-tool="bezier" title="Draw Bezier Spline (P)">✒ Pen [P]</button>
            <button class="btn-tool" data-tool="add-point" title="Add Point (+)">+ Pt</button>
            <button class="btn-tool" data-tool="feather" title="Feather Tool (E)">☁ Feather</button>
          </div>
        </div>

        <div class="roto-shape-actions">
          <button id="btn-add-bezier" class="btn-action">+ New Bezier</button>
          <button id="btn-add-rect" class="btn-action">+ Rectangle</button>
          <button id="btn-del-shape" class="btn-action btn-danger">Delete</button>
        </div>

        <div class="roto-shape-list-container">
          <label class="roto-section-label">Roto Layers & Shapes:</label>
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
            <span>Feather:</span>
            <input type="range" id="roto-prop-feather" min="0" max="100" step="1" value="0" />
            <span id="roto-prop-feather-val">0px</span>
          </div>
          <div class="roto-prop-row">
            <span>Opacity:</span>
            <input type="range" id="roto-prop-opacity" min="0" max="1" step="0.05" value="1" />
            <span id="roto-prop-opacity-val">1.0</span>
          </div>
          <div class="roto-prop-row">
            <span>Invert:</span>
            <input type="checkbox" id="roto-prop-invert" />
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Tool buttons
    const toolBtns = this.container.querySelectorAll('.roto-tool-buttons .btn-tool');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
      });
    });

    // Add Bezier
    this.container.querySelector('#btn-add-bezier')?.addEventListener('click', () => {
      if (!this.activeRotoNode) return;
      const count = this.activeRotoNode.shapes.length + 1;
      const shape = new RotoShape(`Bezier_${count}`, 'bezier');
      // Create a default triangular spline around center
      shape.addPoint(860, 440, -40, 0, 40, 0);
      shape.addPoint(1060, 440, 0, -40, 0, 40);
      shape.addPoint(960, 640, 40, 0, -40, 0);
      this.activeRotoNode.addShape(shape);
      this.selectedShapeId = shape.id;
      this.updateShapeList();
      if (this.onRotoUpdate) this.onRotoUpdate();
    });

    // Add Rectangle
    this.container.querySelector('#btn-add-rect')?.addEventListener('click', () => {
      if (!this.activeRotoNode) return;
      const count = this.activeRotoNode.shapes.length + 1;
      const shape = new RotoShape(`Box_${count}`, 'polygon');
      shape.addPoint(800, 400);
      shape.addPoint(1120, 400);
      shape.addPoint(1120, 680);
      shape.addPoint(800, 680);
      this.activeRotoNode.addShape(shape);
      this.selectedShapeId = shape.id;
      this.updateShapeList();
      if (this.onRotoUpdate) this.onRotoUpdate();
    });

    // Delete Shape
    this.container.querySelector('#btn-del-shape')?.addEventListener('click', () => {
      if (!this.activeRotoNode || !this.selectedShapeId) return;
      this.activeRotoNode.removeShape(this.selectedShapeId);
      this.selectedShapeId = this.activeRotoNode.shapes[0]?.id || null;
      this.updateShapeList();
      if (this.onRotoUpdate) this.onRotoUpdate();
    });

    // Property inputs
    const featherSlider = this.container.querySelector('#roto-prop-feather');
    const featherVal = this.container.querySelector('#roto-prop-feather-val');
    featherSlider?.addEventListener('input', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.feather = Number(e.target.value);
        if (featherVal) featherVal.textContent = `${s.feather}px`;
        this.activeRotoNode.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
      }
    });

    const opacitySlider = this.container.querySelector('#roto-prop-opacity');
    const opacityVal = this.container.querySelector('#roto-prop-opacity-val');
    opacitySlider?.addEventListener('input', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.opacity = Number(e.target.value);
        if (opacityVal) opacityVal.textContent = s.opacity.toFixed(2);
        this.activeRotoNode.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
      }
    });

    const blendSelect = this.container.querySelector('#roto-prop-blend');
    blendSelect?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.blendMode = e.target.value;
        this.activeRotoNode.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
      }
    });

    const invertCheck = this.container.querySelector('#roto-prop-invert');
    invertCheck?.addEventListener('change', (e) => {
      const s = this.getActiveShape();
      if (s) {
        s.inverted = e.target.checked;
        this.activeRotoNode.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
      }
    });
  }

  updateShapeList() {
    const tree = this.container.querySelector('#roto-shape-tree');
    if (!tree) return;
    tree.innerHTML = '';

    if (!this.activeRotoNode || this.activeRotoNode.shapes.length === 0) {
      tree.innerHTML = '<div class="roto-empty-msg">No active roto shapes. Click "+ New Bezier" above.</div>';
      return;
    }

    for (const shape of this.activeRotoNode.shapes) {
      const item = document.createElement('div');
      item.className = `roto-tree-item ${shape.id === this.selectedShapeId ? 'selected' : ''}`;
      item.innerHTML = `
        <span class="shape-vis-icon" title="Toggle Visibility">${shape.visible ? '👁' : '🚫'}</span>
        <span class="shape-color-dot" style="background:${shape.color};"></span>
        <span class="shape-name">${shape.name}</span>
        <span class="shape-points-count">${shape.points.length} pts</span>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('shape-vis-icon')) {
          shape.visible = !shape.visible;
          item.querySelector('.shape-vis-icon').textContent = shape.visible ? '👁' : '🚫';
          this.activeRotoNode.markDirty();
          if (this.onRotoUpdate) this.onRotoUpdate();
          return;
        }
        this.selectedShapeId = shape.id;
        this.updateShapeList();
        this.syncShapeProperties();
      });

      tree.appendChild(item);
    }

    this.syncShapeProperties();
  }

  syncShapeProperties() {
    const s = this.getActiveShape();
    if (!s) return;

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
  }

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.activeRotoNode || !this.activeRotoNode.shapes) return;

    for (const shape of this.activeRotoNode.shapes) {
      if (!shape.visible || shape.points.length === 0) continue;

      const isSelected = (shape.id === this.selectedShapeId);
      ctx.save();

      // Draw Spline Boundary Line
      ctx.beginPath();
      const firstPt = shape.points[0];
      const startX = firstPt.x * zoom + panX;
      const startY = firstPt.y * zoom + panY;
      ctx.moveTo(startX, startY);

      if (shape.type === 'bezier') {
        for (let i = 0; i < shape.points.length; i++) {
          const curr = shape.points[i];
          const next = shape.points[(i + 1) % shape.points.length];
          const cp1x = (curr.x + curr.tangentOutX) * zoom + panX;
          const cp1y = (curr.y + curr.tangentOutY) * zoom + panY;
          const cp2x = (next.x + next.tangentInX) * zoom + panX;
          const cp2y = (next.y + next.tangentInY) * zoom + panY;
          const endX = next.x * zoom + panX;
          const endY = next.y * zoom + panY;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
        }
      } else {
        for (let i = 1; i < shape.points.length; i++) {
          const pt = shape.points[i];
          ctx.lineTo(pt.x * zoom + panX, pt.y * zoom + panY);
        }
        ctx.closePath();
      }

      ctx.strokeStyle = isSelected ? '#ff922b' : (shape.color || '#51cf66');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Feather boundary outline (dashed)
      if (shape.feather > 0 && isSelected) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        for (let i = 0; i < shape.points.length; i++) {
          const pt = shape.points[i];
          const px = pt.x * zoom + panX;
          const py = pt.y * zoom + panY;
          if (i === 0) ctx.moveTo(px, py - shape.feather * zoom);
          else ctx.lineTo(px, py - shape.feather * zoom);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // Draw Control Points
      if (isSelected) {
        for (let i = 0; i < shape.points.length; i++) {
          const pt = shape.points[i];
          const px = pt.x * zoom + panX;
          const py = pt.y * zoom + panY;
          const isPtSelected = (i === this.selectedPointIndex);

          // Control Point Box
          ctx.fillStyle = isPtSelected ? '#ffdd00' : '#ffffff';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.fillRect(px - 4, py - 4, 8, 8);
          ctx.strokeRect(px - 4, py - 4, 8, 8);

          // Tangent Handles
          if (isPtSelected && shape.type === 'bezier') {
            const hInX = (pt.x + pt.tangentInX) * zoom + panX;
            const hInY = (pt.y + pt.tangentInY) * zoom + panY;
            const hOutX = (pt.x + pt.tangentOutX) * zoom + panX;
            const hOutY = (pt.y + pt.tangentOutY) * zoom + panY;

            ctx.strokeStyle = '#339af0';
            ctx.beginPath();
            ctx.moveTo(hInX, hInY);
            ctx.lineTo(px, py);
            ctx.lineTo(hOutX, hOutY);
            ctx.stroke();

            // Tangent handles end circles
            ctx.fillStyle = '#339af0';
            ctx.beginPath();
            ctx.arc(hInX, hInY, 3, 0, Math.PI * 2);
            ctx.arc(hOutX, hOutY, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.restore();
    }
  }

  onMouseDown(e, imgX, imgY) {
    const shape = this.getActiveShape();
    if (!shape) return false;

    // Check hit on existing control points
    const hitRadius = 12 / (this.viewerUI?.zoom || 1.0);
    for (let i = 0; i < shape.points.length; i++) {
      const pt = shape.points[i];
      const dist = Math.hypot(pt.x - imgX, pt.y - imgY);
      if (dist <= hitRadius) {
        this.selectedPointIndex = i;
        this.isDraggingPoint = true;
        this.dragStartPos = { x: imgX, y: imgY };
        return true;
      }
    }

    // If pen / bezier / add-point tool active, add new point
    if (this.activeTool === 'bezier' || this.activeTool === 'add-point') {
      shape.addPoint(imgX, imgY, -30, 0, 30, 0);
      this.selectedPointIndex = shape.points.length - 1;
      this.isDraggingPoint = true;
      this.dragStartPos = { x: imgX, y: imgY };
      this.activeRotoNode.markDirty();
      this.updateShapeList();
      if (this.onRotoUpdate) this.onRotoUpdate();
      return true;
    }

    this.selectedPointIndex = null;
    return false;
  }

  onMouseMove(e, imgX, imgY) {
    if (this.isDraggingPoint && this.selectedPointIndex !== null) {
      const shape = this.getActiveShape();
      if (shape && shape.points[this.selectedPointIndex]) {
        const pt = shape.points[this.selectedPointIndex];
        pt.x = imgX;
        pt.y = imgY;
        this.activeRotoNode.markDirty();
        if (this.onRotoUpdate) this.onRotoUpdate();
      }
    }
  }

  onMouseUp(e, imgX, imgY) {
    if (this.isDraggingPoint) {
      this.isDraggingPoint = false;
      this.activeRotoNode?.markDirty();
      if (this.onRotoUpdate) this.onRotoUpdate();
    }
  }
}

