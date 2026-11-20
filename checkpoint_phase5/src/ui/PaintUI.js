/**
 * OpenComp - Department 2: Paint UI & Interactive Workspace
 * Non-destructive manual cleanup tools: Paint Brush, Clone Stamp,
 * Clean-Plate Reveal, Eraser, Local Blur, and Stroke Stack Management.
 */

import { PaintStroke } from '../core/PaintStroke.js';

export class PaintUI {
  constructor(containerElement, viewerUI, onPaintUpdate) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onPaintUpdate = onPaintUpdate;

    this.activePaintNode = null;
    this.activeTool = 'brush'; // 'brush', 'clone', 'reveal', 'eraser', 'blur'
    this.brushSize = 35;
    this.brushHardness = 0.5;
    this.brushOpacity = 1.0;
    this.brushFlow = 1.0;
    this.brushColor = [1.0, 0.2, 0.2, 1.0]; // Default reddish

    // Clone source
    this.cloneOffset = { dx: 50, dy: 50 };
    this.sourceFrame = 1;
    this.isPickingCloneSource = false;

    // Active drawing stroke
    this.currentStroke = null;
    this.isPainting = false;

    this.render();
  }

  setPaintNode(paintNode) {
    this.activePaintNode = paintNode;
    this.updateStrokeList();
  }

  render() {
    this.container.innerHTML = `
      <div class="paint-workspace-panel">
        <div class="paint-header">
          <span class="paint-title">🎨 Manual Paint & Cleanup</span>
          <div class="paint-tool-buttons">
            <button class="btn-tool active" data-tool="brush" title="Paint Brush (B)">🖌 Brush [B]</button>
            <button class="btn-tool" data-tool="clone" title="Clone / Wire Removal (C)">⧉ Clone [C]</button>
            <button class="btn-tool" data-tool="reveal" title="Reveal Clean Plate (R)">✦ Reveal [R]</button>
            <button class="btn-tool" data-tool="eraser" title="Eraser (E)">⌫ Erase [E]</button>
            <button class="btn-tool" data-tool="blur" title="Blur / Soften (L)">💧 Blur [L]</button>
          </div>
        </div>

        <div class="paint-brush-props">
          <div class="paint-prop-row">
            <span>Size:</span>
            <input type="range" id="paint-size-slider" min="1" max="250" value="${this.brushSize}" />
            <span id="paint-size-val">${this.brushSize}px</span>
          </div>
          <div class="paint-prop-row">
            <span>Hardness:</span>
            <input type="range" id="paint-hard-slider" min="0" max="1" step="0.05" value="${this.brushHardness}" />
            <span id="paint-hard-val">${Math.round(this.brushHardness * 100)}%</span>
          </div>
          <div class="paint-prop-row">
            <span>Opacity:</span>
            <input type="range" id="paint-opac-slider" min="0" max="1" step="0.05" value="${this.brushOpacity}" />
            <span id="paint-opac-val">${Math.round(this.brushOpacity * 100)}%</span>
          </div>
          <div class="paint-prop-row">
            <span>Color:</span>
            <input type="color" id="paint-color-picker" value="#ff3333" />
          </div>
        </div>

        <!-- Clone Source Controls -->
        <div class="paint-clone-box" id="paint-clone-box" style="display:none;">
          <label class="paint-section-label">Clone Source Offset:</label>
          <div class="paint-prop-row">
            <button id="btn-pick-clone-src" class="btn-action">Pick Source (Alt+Click)</button>
            <span id="paint-clone-offset-val" style="font-family:monospace; color:#aaa;">dx: +50, dy: +50</span>
          </div>
          <div class="paint-prop-row">
            <span>Source Frame:</span>
            <input type="number" id="paint-source-frame" value="${this.sourceFrame}" class="timeline-num" />
          </div>
        </div>

        <!-- Non-Destructive Stroke History -->
        <div class="paint-stroke-list-container">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="paint-section-label">Non-Destructive Stroke Stack:</label>
            <button id="btn-clear-strokes" class="btn-tool btn-danger" style="font-size:10px;">Clear All</button>
          </div>
          <div id="paint-stroke-tree" class="paint-stroke-tree"></div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Tool selection
    const toolBtns = this.container.querySelectorAll('.paint-tool-buttons .btn-tool');
    const cloneBox = this.container.querySelector('#paint-clone-box');

    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        if (cloneBox) {
          cloneBox.style.display = (this.activeTool === 'clone') ? 'block' : 'none';
        }
      });
    });

    // Brush properties
    const sizeSlider = this.container.querySelector('#paint-size-slider');
    const sizeVal = this.container.querySelector('#paint-size-val');
    sizeSlider?.addEventListener('input', (e) => {
      this.brushSize = Number(e.target.value);
      if (sizeVal) sizeVal.textContent = `${this.brushSize}px`;
    });

    const hardSlider = this.container.querySelector('#paint-hard-slider');
    const hardVal = this.container.querySelector('#paint-hard-val');
    hardSlider?.addEventListener('input', (e) => {
      this.brushHardness = Number(e.target.value);
      if (hardVal) hardVal.textContent = `${Math.round(this.brushHardness * 100)}%`;
    });

    const opacSlider = this.container.querySelector('#paint-opac-slider');
    const opacVal = this.container.querySelector('#paint-opac-val');
    opacSlider?.addEventListener('input', (e) => {
      this.brushOpacity = Number(e.target.value);
      if (opacVal) opacVal.textContent = `${Math.round(this.brushOpacity * 100)}%`;
    });

    const colorPicker = this.container.querySelector('#paint-color-picker');
    colorPicker?.addEventListener('input', (e) => {
      const hex = e.target.value;
      const r = parseInt(hex.substr(1, 2), 16) / 255.0;
      const g = parseInt(hex.substr(3, 2), 16) / 255.0;
      const b = parseInt(hex.substr(5, 2), 16) / 255.0;
      this.brushColor = [r, g, b, 1.0];
    });

    // Clear strokes
    this.container.querySelector('#btn-clear-strokes')?.addEventListener('click', () => {
      if (!this.activePaintNode) return;
      if (confirm('Clear all paint strokes on this node?')) {
        this.activePaintNode.clearStrokes();
        this.updateStrokeList();
        if (this.onPaintUpdate) this.onPaintUpdate();
      }
    });

    // Source frame
    const srcFrameInput = this.container.querySelector('#paint-source-frame');
    srcFrameInput?.addEventListener('change', (e) => {
      this.sourceFrame = Number(e.target.value);
    });

    // Pick Clone Source button
    this.container.querySelector('#btn-pick-clone-src')?.addEventListener('click', () => {
      this.isPickingCloneSource = true;
      alert('Click anywhere on the image in the Viewer to set the clone source origin point.');
    });
  }

  updateStrokeList() {
    const tree = this.container.querySelector('#paint-stroke-tree');
    if (!tree) return;
    tree.innerHTML = '';

    if (!this.activePaintNode || this.activePaintNode.strokes.length === 0) {
      tree.innerHTML = '<div class="paint-empty-msg">No strokes painted. Select a brush and draw in Viewer.</div>';
      return;
    }

    const strokes = this.activePaintNode.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      const item = document.createElement('div');
      item.className = 'paint-tree-item';
      item.innerHTML = `
        <span class="stroke-vis-icon" title="Toggle Visibility">${s.visible ? '👁' : '🚫'}</span>
        <span class="stroke-type-badge">${s.type.toUpperCase()}</span>
        <span class="stroke-info">Frame ${s.frame} (${s.points.length} pts, size ${Math.round(s.size)}px)</span>
        <button class="btn-del-stroke" title="Delete Stroke">✕</button>
      `;

      item.querySelector('.stroke-vis-icon')?.addEventListener('click', () => {
        s.visible = !s.visible;
        this.activePaintNode.markDirty();
        this.updateStrokeList();
        if (this.onPaintUpdate) this.onPaintUpdate();
      });

      item.querySelector('.btn-del-stroke')?.addEventListener('click', () => {
        this.activePaintNode.removeStroke(s.id);
        this.updateStrokeList();
        if (this.onPaintUpdate) this.onPaintUpdate();
      });

      tree.appendChild(item);
    }
  }

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.activePaintNode) return;

    // Draw brush outline at current cursor pos
    if (this.lastCursor) {
      const cx = this.lastCursor.imgX * zoom + panX;
      const cy = this.lastCursor.imgY * zoom + panY;
      const radius = Math.max(2, (this.brushSize * 0.5) * zoom);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // If clone tool, draw clone source crosshair & connecting ray
      if (this.activeTool === 'clone') {
        const srcX = (this.lastCursor.imgX - this.cloneOffset.dx) * zoom + panX;
        const srcY = (this.lastCursor.imgY - this.cloneOffset.dy) * zoom + panY;

        ctx.strokeStyle = 'rgba(255, 146, 43, 0.6)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(srcX, srcY);
        ctx.stroke();

        // Crosshair
        ctx.strokeStyle = '#ff922b';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(srcX - 8, srcY);
        ctx.lineTo(srcX + 8, srcY);
        ctx.moveTo(srcX, srcY - 8);
        ctx.lineTo(srcX, srcY + 8);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  onMouseDown(e, imgX, imgY) {
    if (!this.activePaintNode) return false;

    if (this.isPickingCloneSource) {
      this.cloneOffset.dx = Math.round(this.lastCursor?.imgX ? this.lastCursor.imgX - imgX : 50);
      this.cloneOffset.dy = Math.round(this.lastCursor?.imgY ? this.lastCursor.imgY - imgY : 50);
      this.isPickingCloneSource = false;
      const offsetLabel = this.container.querySelector('#paint-clone-offset-val');
      if (offsetLabel) {
        offsetLabel.textContent = `dx: ${this.cloneOffset.dx > 0 ? '+' : ''}${this.cloneOffset.dx}, dy: ${this.cloneOffset.dy > 0 ? '+' : ''}${this.cloneOffset.dy}`;
      }
      return true;
    }

    // Start a new paint stroke
    const stroke = new PaintStroke(
      this.activeTool,
      this.brushSize,
      this.brushHardness,
      this.brushOpacity,
      this.brushFlow,
      [...this.brushColor]
    );
    stroke.cloneOffset = { ...this.cloneOffset };
    stroke.sourceFrame = this.sourceFrame;
    stroke.addPoint(imgX, imgY, 1.0);

    this.activePaintNode.addStroke(stroke);
    this.currentStroke = stroke;
    this.isPainting = true;
    this.lastCursor = { imgX, imgY };
    return true;
  }

  onMouseMove(e, imgX, imgY) {
    this.lastCursor = { imgX, imgY };
    if (this.isPainting && this.currentStroke) {
      this.currentStroke.addPoint(imgX, imgY, 1.0);
      this.activePaintNode.markDirty();
      if (this.onPaintUpdate) this.onPaintUpdate();
    }
  }

  onMouseUp(e, imgX, imgY) {
    if (this.isPainting) {
      this.isPainting = false;
      this.currentStroke = null;
      this.activePaintNode?.markDirty();
      this.updateStrokeList();
      if (this.onPaintUpdate) this.onPaintUpdate();
    }
  }
}

