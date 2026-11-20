/**
 * OpenComp - Department 2: Paint UI & Interactive Workspace
 * Non-destructive manual cleanup tools: Paint Brush, Clone Stamp,
 * Clean-Plate Reveal, Eraser, Local Blur, and Stroke Stack Management.
 */

import { PaintStroke, PaintPoint } from '../core/PaintStroke.js';

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
    this.brushSpacing = 0.15;
    this.brushColor = [1.0, 0.2, 0.2, 1.0]; // Default reddish

    // Clone source
    this.cloneOffset = { dx: 50, dy: 50 };
    this.sourceFrame = 1;
    this.isPickingCloneSource = false;

    // Stroke Lifetime
    this.lifetime = 'single'; // 'single', 'all', 'range'
    this.startFrame = 1;
    this.endFrame = 100;
    this.currentFrame = 1;

    // Selection & State
    this.selectedStrokeId = null;
    this.currentStroke = null;
    this.isPainting = false;
    this.isResizingBrush = false;
    this.resizeStart = null;
    this.showOverlay = true;
    this.lastCursor = null;

    // Undo / Redo history
    this.undoStack = [];
    this.redoStack = [];

    this.render();
  }

  setPaintNode(paintNode) {
    this.activePaintNode = paintNode;
    this.selectedStrokeId = null;
    this.updateStrokeList();
  }

  setFrame(frame) {
    this.currentFrame = Number(frame) || 1;
    const frameInput = this.container.querySelector('#paint-stroke-frame');
    if (frameInput) frameInput.value = this.currentFrame;
  }

  render() {
    this.container.innerHTML = `
      <div class="paint-workspace-panel">
        <div class="paint-header">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <span class="paint-title">🎨 Manual Paint &amp; Cleanup</span>
            <div style="display:flex; gap:4px;">
              <button id="paint-btn-undo" class="btn-tool" title="Undo (Ctrl+Z)">↶</button>
              <button id="paint-btn-redo" class="btn-tool" title="Redo (Ctrl+Y)">↷</button>
              <button id="paint-btn-toggle-overlay" class="btn-tool active" title="Toggle Overlay (O)">👁 Overlay</button>
            </div>
          </div>
          <div class="paint-tool-buttons" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:3px;">
            <button class="btn-tool active" data-tool="brush" title="Paint Brush [B]">🖌 Brush [B]</button>
            <button class="btn-tool" data-tool="clone" title="Clone / Wire Removal [C]">⧉ Clone [C]</button>
            <button class="btn-tool" data-tool="reveal" title="Reveal Clean Plate [R]">✦ Reveal [R]</button>
            <button class="btn-tool" data-tool="eraser" title="Eraser [E]">⌫ Erase [E]</button>
            <button class="btn-tool" data-tool="blur" title="Blur / Soften [L]">💧 Blur [L]</button>
          </div>
        </div>

        <div class="paint-brush-props">
          <div class="paint-prop-row">
            <span>Size:</span>
            <input type="range" id="paint-size-slider" min="1" max="250" value="${this.brushSize}" />
            <input type="number" id="paint-size-num" class="paint-num-input" min="1" max="500" value="${this.brushSize}" />
          </div>
          <div class="paint-prop-row">
            <span>Hardness:</span>
            <input type="range" id="paint-hard-slider" min="0" max="1" step="0.05" value="${this.brushHardness}" />
            <span id="paint-hard-val" class="prop-val-label">${Math.round(this.brushHardness * 100)}%</span>
          </div>
          <div class="paint-prop-row">
            <span>Opacity:</span>
            <input type="range" id="paint-opac-slider" min="0" max="1" step="0.05" value="${this.brushOpacity}" />
            <span id="paint-opac-val" class="prop-val-label">${Math.round(this.brushOpacity * 100)}%</span>
          </div>
          <div class="paint-prop-row">
            <span>Flow:</span>
            <input type="range" id="paint-flow-slider" min="0.05" max="1.0" step="0.05" value="${this.brushFlow}" />
            <span id="paint-flow-val" class="prop-val-label">${Math.round(this.brushFlow * 100)}%</span>
          </div>
          <div class="paint-prop-row">
            <span>Spacing:</span>
            <input type="range" id="paint-spacing-slider" min="0.02" max="0.5" step="0.01" value="${this.brushSpacing}" />
            <span id="paint-spacing-val" class="prop-val-label">${Math.round(this.brushSpacing * 100)}%</span>
          </div>
          <div class="paint-prop-row" id="paint-color-row">
            <span>Color:</span>
            <input type="color" id="paint-color-picker" value="#ff3333" />
            <span id="paint-color-rgb" style="font-family:monospace; font-size:10px; color:#aaa; margin-left:6px;">RGB(1.0, 0.2, 0.2)</span>
          </div>
        </div>

        <!-- Lifetime & Timing -->
        <div class="paint-timing-box">
          <label class="paint-section-label">Stroke Lifetime &amp; Range:</label>
          <div class="paint-prop-row">
            <span>Lifetime:</span>
            <select id="paint-lifetime-select" class="tool-select">
              <option value="single" ${this.lifetime === 'single' ? 'selected' : ''}>Single Frame</option>
              <option value="range" ${this.lifetime === 'range' ? 'selected' : ''}>Frame Range</option>
              <option value="all" ${this.lifetime === 'all' ? 'selected' : ''}>All Frames</option>
            </select>
          </div>
          <div class="paint-prop-row" id="paint-lifetime-range-row" style="display:${this.lifetime === 'range' ? 'flex' : 'none'};">
            <span>From:</span>
            <input type="number" id="paint-start-frame" value="${this.startFrame}" class="timeline-num" style="width:50px;" />
            <span style="margin-left:6px;">To:</span>
            <input type="number" id="paint-end-frame" value="${this.endFrame}" class="timeline-num" style="width:50px;" />
          </div>
        </div>

        <!-- Clone Source Controls -->
        <div class="paint-clone-box" id="paint-clone-box" style="display:${this.activeTool === 'clone' ? 'block' : 'none'};">
          <label class="paint-section-label">Clone Source Offset:</label>
          <div class="paint-prop-row">
            <button id="btn-pick-clone-src" class="btn-action">🎯 Pick Source (Alt+Click)</button>
            <span id="paint-clone-offset-val" style="font-family:monospace; color:#aaa; font-size:11px;">dx: ${this.cloneOffset.dx > 0 ? '+' : ''}${this.cloneOffset.dx}, dy: ${this.cloneOffset.dy > 0 ? '+' : ''}${this.cloneOffset.dy}</span>
          </div>
          <div class="paint-prop-row">
            <span>Source Frame:</span>
            <input type="number" id="paint-source-frame" value="${this.sourceFrame}" class="timeline-num" style="width:50px;" />
          </div>
        </div>

        <!-- Selected Stroke Inspector -->
        <div id="paint-selected-stroke-inspector" style="display:none; background:#1b1b1b; border:1px solid #333; border-radius:4px; padding:6px; margin-top:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="font-size:11px; color:#ff922b;" id="paint-inspect-title">Stroke Properties</strong>
            <button id="paint-btn-deselect-stroke" class="btn-reset" style="font-size:10px;">✕</button>
          </div>
          <div class="paint-prop-row">
            <span>Size:</span>
            <input type="range" id="inspect-stroke-size" min="1" max="250" />
            <span id="inspect-stroke-size-val"></span>
          </div>
          <div class="paint-prop-row">
            <span>Opacity:</span>
            <input type="range" id="inspect-stroke-opacity" min="0" max="1" step="0.05" />
            <span id="inspect-stroke-opac-val"></span>
          </div>
          <div class="paint-prop-row">
            <span>Lifetime:</span>
            <select id="inspect-stroke-lifetime" class="tool-select">
              <option value="single">Single Frame</option>
              <option value="range">Frame Range</option>
              <option value="all">All Frames</option>
            </select>
          </div>
        </div>

        <!-- Non-Destructive Stroke History -->
        <div class="paint-stroke-list-container" style="margin-top:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="paint-section-label">Stroke Stack (${this.activePaintNode ? this.activePaintNode.strokes.length : 0}):</label>
            <button id="btn-clear-strokes" class="btn-tool btn-danger" style="font-size:10px;">Clear All</button>
          </div>
          <div id="paint-stroke-tree" class="paint-stroke-tree"></div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Tool buttons
    const toolBtns = this.container.querySelectorAll('.paint-tool-buttons .btn-tool');
    const cloneBox = this.container.querySelector('#paint-clone-box');
    const colorRow = this.container.querySelector('#paint-color-row');

    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        if (cloneBox) {
          cloneBox.style.display = (this.activeTool === 'clone') ? 'block' : 'none';
        }
        if (colorRow) {
          colorRow.style.display = (this.activeTool === 'brush') ? 'flex' : 'none';
        }
        this.viewerUI?.render();
      });
    });

    // Undo / Redo buttons
    this.container.querySelector('#paint-btn-undo')?.addEventListener('click', () => this.undo());
    this.container.querySelector('#paint-btn-redo')?.addEventListener('click', () => this.redo());

    // Overlay toggle
    const overlayBtn = this.container.querySelector('#paint-btn-toggle-overlay');
    overlayBtn?.addEventListener('click', () => {
      this.showOverlay = !this.showOverlay;
      overlayBtn.classList.toggle('active', this.showOverlay);
      this.viewerUI?.render();
    });

    // Brush properties
    const sizeSlider = this.container.querySelector('#paint-size-slider');
    const sizeNum = this.container.querySelector('#paint-size-num');
    const updateSize = (val) => {
      this.brushSize = Math.max(1, Math.min(500, Number(val) || 1));
      if (sizeSlider) sizeSlider.value = this.brushSize;
      if (sizeNum) sizeNum.value = this.brushSize;
      this.viewerUI?.render();
    };
    sizeSlider?.addEventListener('input', (e) => updateSize(e.target.value));
    sizeNum?.addEventListener('change', (e) => updateSize(e.target.value));

    const hardSlider = this.container.querySelector('#paint-hard-slider');
    const hardVal = this.container.querySelector('#paint-hard-val');
    hardSlider?.addEventListener('input', (e) => {
      this.brushHardness = Number(e.target.value);
      if (hardVal) hardVal.textContent = `${Math.round(this.brushHardness * 100)}%`;
      this.viewerUI?.render();
    });

    const opacSlider = this.container.querySelector('#paint-opac-slider');
    const opacVal = this.container.querySelector('#paint-opac-val');
    opacSlider?.addEventListener('input', (e) => {
      this.brushOpacity = Number(e.target.value);
      if (opacVal) opacVal.textContent = `${Math.round(this.brushOpacity * 100)}%`;
    });

    const flowSlider = this.container.querySelector('#paint-flow-slider');
    const flowVal = this.container.querySelector('#paint-flow-val');
    flowSlider?.addEventListener('input', (e) => {
      this.brushFlow = Number(e.target.value);
      if (flowVal) flowVal.textContent = `${Math.round(this.brushFlow * 100)}%`;
    });

    const spacingSlider = this.container.querySelector('#paint-spacing-slider');
    const spacingVal = this.container.querySelector('#paint-spacing-val');
    spacingSlider?.addEventListener('input', (e) => {
      this.brushSpacing = Number(e.target.value);
      if (spacingVal) spacingVal.textContent = `${Math.round(this.brushSpacing * 100)}%`;
    });

    const colorPicker = this.container.querySelector('#paint-color-picker');
    const colorLabel = this.container.querySelector('#paint-color-rgb');
    colorPicker?.addEventListener('input', (e) => {
      const hex = e.target.value;
      const r = parseInt(hex.substr(1, 2), 16) / 255.0;
      const g = parseInt(hex.substr(3, 2), 16) / 255.0;
      const b = parseInt(hex.substr(5, 2), 16) / 255.0;
      this.brushColor = [r, g, b, 1.0];
      if (colorLabel) colorLabel.textContent = `RGB(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`;
    });

    // Lifetime controls
    const lifetimeSelect = this.container.querySelector('#paint-lifetime-select');
    const rangeRow = this.container.querySelector('#paint-lifetime-range-row');
    lifetimeSelect?.addEventListener('change', (e) => {
      this.lifetime = e.target.value;
      if (rangeRow) rangeRow.style.display = (this.lifetime === 'range') ? 'flex' : 'none';
    });

    this.container.querySelector('#paint-start-frame')?.addEventListener('change', (e) => {
      this.startFrame = Number(e.target.value) || 1;
    });
    this.container.querySelector('#paint-end-frame')?.addEventListener('change', (e) => {
      this.endFrame = Number(e.target.value) || 100;
    });

    // Clear strokes
    this.container.querySelector('#btn-clear-strokes')?.addEventListener('click', () => {
      if (!this.activePaintNode || this.activePaintNode.strokes.length === 0) return;
      if (confirm('Clear all paint strokes on this node?')) {
        const oldStrokes = [...this.activePaintNode.strokes];
        this.undoStack.push({ type: 'clear', strokes: oldStrokes });
        this.redoStack = [];
        this.activePaintNode.clearStrokes();
        this.selectedStrokeId = null;
        this.updateStrokeList();
        if (this.onPaintUpdate) this.onPaintUpdate();
      }
    });

    // Source frame
    const srcFrameInput = this.container.querySelector('#paint-source-frame');
    srcFrameInput?.addEventListener('change', (e) => {
      this.sourceFrame = Number(e.target.value) || 1;
    });

    // Pick Clone Source button
    this.container.querySelector('#btn-pick-clone-src')?.addEventListener('click', () => {
      this.isPickingCloneSource = true;
      if (this.viewerUI) this.viewerUI.canvas.style.cursor = 'crosshair';
    });

    // Deselect stroke in inspector
    this.container.querySelector('#paint-btn-deselect-stroke')?.addEventListener('click', () => {
      this.selectedStrokeId = null;
      this.updateStrokeList();
    });
  }

  selectStroke(id) {
    this.selectedStrokeId = id;
    this.updateStrokeList();
  }

  moveStrokeUp(id) {
    if (!this.activePaintNode) return;
    const strokes = this.activePaintNode.strokes;
    const idx = strokes.findIndex(s => s.id === id);
    if (idx < strokes.length - 1 && idx >= 0) {
      // In execution order, later = on top = higher index
      const item = strokes[idx];
      strokes.splice(idx, 1);
      strokes.splice(idx + 1, 0, item);
      this.undoStack.push({ type: 'reorder', id, fromIndex: idx, toIndex: idx + 1 });
      this.redoStack = [];
      this.activePaintNode.markDirty();
      this.updateStrokeList();
      if (this.onPaintUpdate) this.onPaintUpdate();
    }
  }

  moveStrokeDown(id) {
    if (!this.activePaintNode) return;
    const strokes = this.activePaintNode.strokes;
    const idx = strokes.findIndex(s => s.id === id);
    if (idx > 0) {
      const item = strokes[idx];
      strokes.splice(idx, 1);
      strokes.splice(idx - 1, 0, item);
      this.undoStack.push({ type: 'reorder', id, fromIndex: idx, toIndex: idx - 1 });
      this.redoStack = [];
      this.activePaintNode.markDirty();
      this.updateStrokeList();
      if (this.onPaintUpdate) this.onPaintUpdate();
    }
  }

  deleteStroke(id) {
    if (!this.activePaintNode) return;
    const strokes = this.activePaintNode.strokes;
    const idx = strokes.findIndex(s => s.id === id);
    if (idx >= 0) {
      const deletedStroke = strokes[idx];
      this.activePaintNode.removeStroke(id);
      this.undoStack.push({ type: 'delete', stroke: deletedStroke, index: idx });
      this.redoStack = [];
      if (this.selectedStrokeId === id) this.selectedStrokeId = null;
      this.updateStrokeList();
      if (this.onPaintUpdate) this.onPaintUpdate();
    }
  }

  undo() {
    if (this.undoStack.length === 0 || !this.activePaintNode) return false;
    const action = this.undoStack.pop();

    if (action.type === 'add') {
      const idx = this.activePaintNode.strokes.findIndex(s => s.id === action.stroke.id);
      if (idx >= 0) {
        this.activePaintNode.strokes.splice(idx, 1);
        this.redoStack.push(action);
      }
    } else if (action.type === 'delete') {
      this.activePaintNode.insertStroke(action.stroke, action.index);
      this.redoStack.push(action);
    } else if (action.type === 'reorder') {
      const strokes = this.activePaintNode.strokes;
      const curIdx = strokes.findIndex(s => s.id === action.id);
      if (curIdx >= 0) {
        const [item] = strokes.splice(curIdx, 1);
        strokes.splice(action.fromIndex, 0, item);
        this.redoStack.push(action);
      }
    } else if (action.type === 'clear') {
      this.activePaintNode.strokes = [...action.strokes];
      this.redoStack.push(action);
    }

    this.activePaintNode.markDirty();
    this.updateStrokeList();
    if (this.onPaintUpdate) this.onPaintUpdate();
    this.viewerUI?.render();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0 || !this.activePaintNode) return false;
    const action = this.redoStack.pop();

    if (action.type === 'add') {
      this.activePaintNode.addStroke(action.stroke);
      this.undoStack.push(action);
    } else if (action.type === 'delete') {
      const idx = this.activePaintNode.strokes.findIndex(s => s.id === action.stroke.id);
      if (idx >= 0) {
        this.activePaintNode.strokes.splice(idx, 1);
        this.undoStack.push(action);
      }
    } else if (action.type === 'reorder') {
      const strokes = this.activePaintNode.strokes;
      const curIdx = strokes.findIndex(s => s.id === action.id);
      if (curIdx >= 0) {
        const [item] = strokes.splice(curIdx, 1);
        strokes.splice(action.toIndex, 0, item);
        this.undoStack.push(action);
      }
    } else if (action.type === 'clear') {
      this.activePaintNode.clearStrokes();
      this.undoStack.push(action);
    }

    this.activePaintNode.markDirty();
    this.updateStrokeList();
    if (this.onPaintUpdate) this.onPaintUpdate();
    this.viewerUI?.render();
    return true;
  }

  updateStrokeList() {
    const tree = this.container.querySelector('#paint-stroke-tree');
    const inspector = this.container.querySelector('#paint-selected-stroke-inspector');
    if (!tree) return;
    tree.innerHTML = '';

    if (!this.activePaintNode || this.activePaintNode.strokes.length === 0) {
      tree.innerHTML = '<div class="paint-empty-msg" style="padding:10px; font-size:11px; color:#777; text-align:center;">No strokes. Select a tool and paint in Viewer.</div>';
      if (inspector) inspector.style.display = 'none';
      return;
    }

    const strokes = this.activePaintNode.strokes;
    let selectedStroke = null;

    // Display in top-down visual layer order (latest stroke at top)
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      const isSelected = (s.id === this.selectedStrokeId);
      if (isSelected) selectedStroke = s;

      const item = document.createElement('div');
      item.className = `paint-tree-item ${isSelected ? 'selected' : ''}`;
      item.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        padding:4px 6px; margin-bottom:2px; background:${isSelected ? '#2b394e' : '#222'};
        border:1px solid ${isSelected ? '#3b82f6' : '#333'}; border-radius:3px; font-size:11px; cursor:pointer;
      `;

      let lifetimeLabel = '1F';
      if (s.lifetime === 'all') lifetimeLabel = 'ALL';
      else if (s.lifetime === 'range') lifetimeLabel = `F${s.startFrame}-${s.endFrame}`;

      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:5px; overflow:hidden;">
          <span class="stroke-vis-icon" title="Toggle Visibility" style="cursor:pointer;">${s.visible ? '👁' : '🚫'}</span>
          <span class="stroke-type-badge" style="background:#444; border-radius:2px; padding:1px 4px; font-size:9px; font-weight:bold; color:#ff922b;">${s.type.toUpperCase()}</span>
          <span style="font-family:monospace; font-size:9px; background:#181818; padding:1px 3px; border-radius:2px; color:#8ce99a;">${lifetimeLabel}</span>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#ddd;">F${s.frame} (${s.points.length} pts, ${Math.round(s.size)}px)</span>
        </div>
        <div style="display:flex; align-items:center; gap:2px;">
          <button class="btn-tool btn-move-up" title="Move Up (Earlier)" style="padding:1px 3px; font-size:9px;">▲</button>
          <button class="btn-tool btn-move-down" title="Move Down (Later)" style="padding:1px 3px; font-size:9px;">▼</button>
          <button class="btn-tool btn-del-stroke" title="Delete Stroke" style="padding:1px 4px; font-size:10px; color:#ff6b6b;">✕</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.stroke-vis-icon')) return;
        this.selectStroke(s.id);
      });

      item.querySelector('.stroke-vis-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        s.visible = !s.visible;
        this.activePaintNode.markDirty();
        this.updateStrokeList();
        if (this.onPaintUpdate) this.onPaintUpdate();
        this.viewerUI?.render();
      });

      item.querySelector('.btn-move-up')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveStrokeUp(s.id);
      });

      item.querySelector('.btn-move-down')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveStrokeDown(s.id);
      });

      item.querySelector('.btn-del-stroke')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteStroke(s.id);
      });

      tree.appendChild(item);
    }

    // Update Selected Stroke Inspector
    if (selectedStroke && inspector) {
      inspector.style.display = 'block';
      const title = inspector.querySelector('#paint-inspect-title');
      if (title) title.textContent = `Selected: ${selectedStroke.type.toUpperCase()} (${selectedStroke.points.length} pts)`;

      const sizeInput = inspector.querySelector('#inspect-stroke-size');
      const sizeVal = inspector.querySelector('#inspect-stroke-size-val');
      if (sizeInput) {
        sizeInput.value = selectedStroke.size;
        if (sizeVal) sizeVal.textContent = `${Math.round(selectedStroke.size)}px`;
        sizeInput.oninput = (e) => {
          selectedStroke.size = Number(e.target.value);
          if (sizeVal) sizeVal.textContent = `${Math.round(selectedStroke.size)}px`;
          this.activePaintNode.markDirty();
          if (this.onPaintUpdate) this.onPaintUpdate();
          this.viewerUI?.render();
        };
      }

      const opacInput = inspector.querySelector('#inspect-stroke-opacity');
      const opacVal = inspector.querySelector('#inspect-stroke-opac-val');
      if (opacInput) {
        opacInput.value = selectedStroke.opacity;
        if (opacVal) opacVal.textContent = `${Math.round(selectedStroke.opacity * 100)}%`;
        opacInput.oninput = (e) => {
          selectedStroke.opacity = Number(e.target.value);
          if (opacVal) opacVal.textContent = `${Math.round(selectedStroke.opacity * 100)}%`;
          this.activePaintNode.markDirty();
          if (this.onPaintUpdate) this.onPaintUpdate();
          this.viewerUI?.render();
        };
      }

      const lifeSelect = inspector.querySelector('#inspect-stroke-lifetime');
      if (lifeSelect) {
        lifeSelect.value = selectedStroke.lifetime || 'single';
        lifeSelect.onchange = (e) => {
          selectedStroke.lifetime = e.target.value;
          this.activePaintNode.markDirty();
          this.updateStrokeList();
          if (this.onPaintUpdate) this.onPaintUpdate();
          this.viewerUI?.render();
        };
      }
    } else if (inspector) {
      inspector.style.display = 'none';
    }
  }

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.activePaintNode || !this.showOverlay) return;

    if (this.lastCursor) {
      const cx = this.lastCursor.imgX * zoom + panX;
      const cy = this.lastCursor.imgY * zoom + panY;
      const outerRadius = Math.max(2, (this.brushSize * 0.5) * zoom);
      const innerRadius = Math.max(1, outerRadius * Math.max(0.01, this.brushHardness));

      ctx.save();

      // Outer Brush Ring (Size boundary)
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Inner Brush Ring (Hardness core boundary)
      if (this.brushHardness > 0.05 && this.brushHardness < 0.98) {
        ctx.beginPath();
        ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.0;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Center crosshair / dot
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Clone Tool: Clone source crosshair, dashed connecting ray, and source preview circle
      if (this.activeTool === 'clone') {
        const srcX = (this.lastCursor.imgX - this.cloneOffset.dx) * zoom + panX;
        const srcY = (this.lastCursor.imgY - this.cloneOffset.dy) * zoom + panY;

        // Connecting Ray
        ctx.strokeStyle = 'rgba(255, 146, 43, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(srcX, srcY);
        ctx.stroke();

        // Source Ring
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(srcX, srcY, outerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 146, 43, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Source Crosshair
        ctx.strokeStyle = '#ff922b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(srcX - 10, srcY);
        ctx.lineTo(srcX + 10, srcY);
        ctx.moveTo(srcX, srcY - 10);
        ctx.lineTo(srcX, srcY + 10);
        ctx.stroke();

        // Source Frame Label
        ctx.font = '10px monospace';
        ctx.fillStyle = '#ff922b';
        ctx.fillText(`Source: F${this.sourceFrame} (dx:${this.cloneOffset.dx}, dy:${this.cloneOffset.dy})`, srcX + 12, srcY - 4);
      }

      // Dynamic Brush Resize Numeric Readout
      if (this.isResizingBrush) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(cx + outerRadius + 8, cy - 12, 80, 20);
        ctx.strokeStyle = '#3b82f6';
        ctx.strokeRect(cx + outerRadius + 8, cy - 12, 80, 20);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#60a5fa';
        ctx.fillText(`Size: ${this.brushSize}px`, cx + outerRadius + 14, cy + 2);
      }

      ctx.restore();
    }
  }

  onMouseDown(e, imgX, imgY) {
    if (!this.activePaintNode) return false;

    // Clone source picking via Alt+Click or Pick button
    if (this.isPickingCloneSource || (e.altKey && this.activeTool === 'clone')) {
      if (this.lastCursor) {
        this.cloneOffset.dx = Math.round(this.lastCursor.imgX - imgX);
        this.cloneOffset.dy = Math.round(this.lastCursor.imgY - imgY);
      } else {
        this.cloneOffset.dx = 50;
        this.cloneOffset.dy = 50;
      }
      this.isPickingCloneSource = false;
      if (this.viewerUI) this.viewerUI.canvas.style.cursor = 'default';

      const offsetLabel = this.container.querySelector('#paint-clone-offset-val');
      if (offsetLabel) {
        offsetLabel.textContent = `dx: ${this.cloneOffset.dx > 0 ? '+' : ''}${this.cloneOffset.dx}, dy: ${this.cloneOffset.dy > 0 ? '+' : ''}${this.cloneOffset.dy}`;
      }
      this.viewerUI?.render();
      return true;
    }

    // Shift + Left Mouse Drag: Interactive Brush Resize
    if (e.shiftKey) {
      this.isResizingBrush = true;
      this.resizeStart = { x: imgX, y: imgY, startSize: this.brushSize };
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
    stroke.spacing = this.brushSpacing;
    stroke.cloneOffset = { ...this.cloneOffset };
    stroke.sourceFrame = this.sourceFrame;
    stroke.lifetime = this.lifetime;
    stroke.frame = this.currentFrame || 1;
    stroke.startFrame = this.startFrame;
    stroke.endFrame = this.endFrame;
    stroke.addPoint(imgX, imgY, 1.0);

    this.activePaintNode.addStroke(stroke);
    this.currentStroke = stroke;
    this.isPainting = true;
    this.lastCursor = { imgX, imgY };

    // Record action for Undo
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];

    if (this.onPaintUpdate) this.onPaintUpdate();
    return true;
  }

  onMouseMove(e, imgX, imgY) {
    this.lastCursor = { imgX, imgY };

    if (this.isResizingBrush && this.resizeStart) {
      const delta = imgX - this.resizeStart.x;
      const newSize = Math.max(1, Math.min(500, Math.round(this.resizeStart.startSize + delta * 0.5)));
      this.brushSize = newSize;

      const sizeSlider = this.container.querySelector('#paint-size-slider');
      const sizeNum = this.container.querySelector('#paint-size-num');
      if (sizeSlider) sizeSlider.value = newSize;
      if (sizeNum) sizeNum.value = newSize;

      this.viewerUI?.render();
      return;
    }

    if (this.isPainting && this.currentStroke) {
      this.currentStroke.addPoint(imgX, imgY, 1.0);
      this.activePaintNode.markDirty();
      if (this.onPaintUpdate) this.onPaintUpdate();
    } else {
      // Just redraw overlay to keep brush circle following mouse
      this.viewerUI?.render();
    }
  }

  onMouseUp(e, imgX, imgY) {
    if (this.isResizingBrush) {
      this.isResizingBrush = false;
      this.resizeStart = null;
      this.viewerUI?.render();
      return;
    }

    if (this.isPainting) {
      this.isPainting = false;
      this.currentStroke = null;
      this.activePaintNode?.markDirty();
      this.updateStrokeList();
      if (this.onPaintUpdate) this.onPaintUpdate();
      this.viewerUI?.render();
    }
  }

  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      return false;
    }

    // Brush resize with [ and ]
    if (e.key === '[' || e.key === '{') {
      this.brushSize = Math.max(1, this.brushSize - 4);
      const sizeSlider = this.container.querySelector('#paint-size-slider');
      const sizeNum = this.container.querySelector('#paint-size-num');
      if (sizeSlider) sizeSlider.value = this.brushSize;
      if (sizeNum) sizeNum.value = this.brushSize;
      this.viewerUI?.render();
      return true;
    }
    if (e.key === ']' || e.key === '}') {
      this.brushSize = Math.min(500, this.brushSize + 4);
      const sizeSlider = this.container.querySelector('#paint-size-slider');
      const sizeNum = this.container.querySelector('#paint-size-num');
      if (sizeSlider) sizeSlider.value = this.brushSize;
      if (sizeNum) sizeNum.value = this.brushSize;
      this.viewerUI?.render();
      return true;
    }

    // Tool shortcuts
    if (e.key === 'b' || e.key === 'B') {
      this.setTool('brush');
      return true;
    }
    if (e.key === 'c' || e.key === 'C') {
      this.setTool('clone');
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.setTool('reveal');
      return true;
    }
    if (e.key === 'e' || e.key === 'E') {
      this.setTool('eraser');
      return true;
    }
    if (e.key === 'l' || e.key === 'L') {
      this.setTool('blur');
      return true;
    }

    // Toggle Overlay
    if (e.key === 'o' || e.key === 'O') {
      this.showOverlay = !this.showOverlay;
      const overlayBtn = this.container.querySelector('#paint-btn-toggle-overlay');
      if (overlayBtn) overlayBtn.classList.toggle('active', this.showOverlay);
      this.viewerUI?.render();
      return true;
    }

    // Delete selected stroke
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedStrokeId) {
      this.deleteStroke(this.selectedStrokeId);
      return true;
    }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      this.redo();
      return true;
    }

    return false;
  }

  setTool(tool) {
    this.activeTool = tool;
    const toolBtns = this.container.querySelectorAll('.paint-tool-buttons .btn-tool');
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

    const cloneBox = this.container.querySelector('#paint-clone-box');
    if (cloneBox) cloneBox.style.display = (this.activeTool === 'clone') ? 'block' : 'none';

    const colorRow = this.container.querySelector('#paint-color-row');
    if (colorRow) colorRow.style.display = (this.activeTool === 'brush') ? 'flex' : 'none';

    this.viewerUI?.render();
  }
}
