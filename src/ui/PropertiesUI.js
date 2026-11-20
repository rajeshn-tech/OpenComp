/**
 * OpenComp - Properties & Knobs Control Panel UI (Phase 3 Professional Parity)
 * Professional Multi-Card Properties Bin & Floating Windows:
 * - Floating properties panels within the workspace (tear-off, draggable, resizable, re-dock)
 * - Tabbed properties mode for multiple selected nodes with instant tab switching
 * - Proper RGBA four-channel controls (R, G, B, A numeric inputs, gang toggle, color swatch)
 * - Context menus for knobs and parameters (keyframes, expressions, reset, copy/paste)
 * - Keyframe animation controls integrated with properties (diamond status, prev/next keyframe jump)
 * - Expression editing and validation with live preview and syntax checking
 * - Embedded Roto, Paint, Depth, and Stereo department workspace handlers
 */

import { PixelBuffer } from '../core/PixelBuffer.js';
import { ExpressionEngine } from '../core/ExpressionEngine.js';
import { RotoUI } from './RotoUI.js';
import { PaintUI } from './PaintUI.js';
import { KeyerUI } from './KeyerUI.js';
import { DepthUI } from './DepthUI.js';
import { StereoUI } from './StereoUI.js';
import { TrackingUI } from './TrackingUI.js';

export class PropertiesUI {
  constructor(containerElement, onParamChange, onRenderRequest, viewerUI = null) {
    this.container = containerElement;
    this.onParamChange = onParamChange;
    this.onRenderRequest = onRenderRequest;
    this.viewerUI = viewerUI;

    /** @type {Map<string, { node: any, card: HTMLElement, handler: any, isFloating: boolean, floatingWindow: HTMLElement|null }>} */
    this.openNodes = new Map();
    this.activeNodeId = null;
    this.maxPanels = 10;
    this.viewMode = 'bin'; // 'bin' (stacked cards) or 'tabbed' (single active tab)
    this.currentFrame = 1;

    // Clipboard for copy/paste knob parameters
    this.knobClipboard = null;

    // Active context menu DOM element
    this.activeContextMenuEl = null;

    // Initialize tabs bar container above the cards
    this.initTabBar();

    // Clear all button in bin header
    const clearBtn = document.getElementById('btn-clear-properties');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearAll());
    }

    // Close knob context menu on outside click
    window.addEventListener('click', (e) => {
      if (this.activeContextMenuEl && !this.activeContextMenuEl.contains(e.target)) {
        this.closeContextMenu();
      }
    });

    this.renderEmptyState();
  }

  initTabBar() {
    let tabBar = document.getElementById('properties-tab-bar');
    if (!tabBar && this.container && this.container.parentElement) {
      tabBar = document.createElement('div');
      tabBar.id = 'properties-tab-bar';
      tabBar.className = 'properties-tab-bar';
      this.container.parentElement.insertBefore(tabBar, this.container);
    }
    this.tabBar = tabBar;
    this.renderTabBar();
  }

  renderTabBar() {
    if (!this.tabBar) return;
    this.tabBar.innerHTML = '';

    if (this.openNodes.size === 0) {
      this.tabBar.style.display = 'none';
      return;
    }
    this.tabBar.style.display = 'flex';

    // Tabs container
    const tabsList = document.createElement('div');
    tabsList.className = 'prop-tabs-list';

    for (const [nodeId, entry] of this.openNodes.entries()) {
      const tab = document.createElement('div');
      tab.className = `prop-tab-item ${nodeId === this.activeNodeId ? 'active' : ''}`;
      tab.style.borderTop = `2px solid ${entry.node.color || '#888'}`;

      tab.innerHTML = `
        <span class="prop-tab-title" title="${entry.node.name} (${entry.node.type})">${entry.node.name}</span>
        <button class="prop-tab-close" title="Close">✕</button>
      `;

      tab.querySelector('.prop-tab-title').addEventListener('click', () => {
        this.focusNode(nodeId);
      });

      tab.querySelector('.prop-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeNode(nodeId);
      });

      tabsList.appendChild(tab);
    }

    // View mode toggle button (Bin vs Tabbed)
    const modeBtn = document.createElement('button');
    modeBtn.className = 'prop-btn-icon prop-mode-toggle';
    modeBtn.title = this.viewMode === 'bin' ? 'Switch to Tabbed View' : 'Switch to Bin View (Stacked)';
    modeBtn.textContent = this.viewMode === 'bin' ? 'Stacked' : 'Tabbed';
    modeBtn.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'bin' ? 'tabbed' : 'bin';
      this.updateCardVisibilities();
      this.renderTabBar();
    });

    this.tabBar.appendChild(tabsList);
    this.tabBar.appendChild(modeBtn);
  }

  updateCardVisibilities() {
    for (const [nodeId, entry] of this.openNodes.entries()) {
      if (entry.isFloating) continue;
      if (this.viewMode === 'tabbed') {
        entry.card.style.display = (nodeId === this.activeNodeId) ? 'block' : 'none';
      } else {
        entry.card.style.display = 'block';
      }
    }
  }

  renderEmptyState() {
    this.container.innerHTML = `
      <div class="empty-properties">
        <p>No node selected</p>
        <small>Select or double-click any node in the graph to edit parameters.</small>
      </div>
    `;
    if (this.tabBar) this.tabBar.style.display = 'none';
  }

  showNodes(nodes) {
    if (!nodes || nodes.length === 0) return;
    for (const node of nodes) {
      this.showNode(node);
    }
  }

  showNode(node) {
    if (!node) return;

    // Remove empty placeholder if present
    const emptyMsg = this.container.querySelector('.empty-properties');
    if (emptyMsg) emptyMsg.remove();

    // If node is already open, focus it
    if (this.openNodes.has(node.id)) {
      this.focusNode(node.id);
      return;
    }

    // Limit maximum open property panels (close oldest unpinned)
    if (this.openNodes.size >= this.maxPanels) {
      const oldestId = this.openNodes.keys().next().value;
      if (oldestId) this.closeNode(oldestId);
    }

    // Build new card
    const entry = this.createNodeCard(node);
    this.openNodes.set(node.id, entry);

    // Prepend to top of bin
    this.container.prepend(entry.card);
    this.focusNode(node.id);
    this.renderTabBar();
  }

  focusNode(nodeId) {
    this.activeNodeId = nodeId;

    // Update focused styling
    for (const [id, entry] of this.openNodes.entries()) {
      if (id === nodeId) {
        entry.card.classList.add('focused');
        entry.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        entry.card.classList.remove('focused');
      }
    }

    this.updateCardVisibilities();
    this.renderTabBar();

    // Update Viewer tool handler for active node
    const activeEntry = this.openNodes.get(nodeId);
    if (activeEntry && this.viewerUI) {
      this.viewerUI.departmentHandler = activeEntry.handler || null;
      if (activeEntry.node && typeof activeEntry.node.drawOverlay === 'function') {
        this.viewerUI.onDrawOverlay = (ctx, zoom, panX, panY) => {
          activeEntry.node.drawOverlay(ctx, { zoom, panX, panY });
        };
      } else if (!activeEntry.handler) {
        this.viewerUI.onDrawOverlay = null;
      }
      this.viewerUI.render();
    }
    this.updateContextToolbar(activeEntry);
  }

  closeNode(nodeId) {
    const entry = this.openNodes.get(nodeId);
    if (!entry) return;

    if (entry.isFloating && entry.floatingWindow) {
      entry.floatingWindow.remove();
    }
    entry.card.remove();
    this.openNodes.delete(nodeId);

    if (this.activeNodeId === nodeId) {
      const remainingIds = Array.from(this.openNodes.keys());
      if (remainingIds.length > 0) {
        this.focusNode(remainingIds[0]);
      } else {
        this.activeNodeId = null;
        if (this.viewerUI) {
          this.viewerUI.departmentHandler = null;
          this.viewerUI.onDrawOverlay = null;
          this.viewerUI.render();
        }
        this.updateContextToolbar(null);
        this.renderEmptyState();
      }
    }
    this.renderTabBar();
  }

  clearAll() {
    for (const entry of this.openNodes.values()) {
      if (entry.isFloating && entry.floatingWindow) {
        entry.floatingWindow.remove();
      }
      entry.card.remove();
    }
    this.openNodes.clear();
    this.activeNodeId = null;
    this.container.innerHTML = '';
    this.renderEmptyState();
    if (this.viewerUI) {
      this.viewerUI.departmentHandler = null;
      this.viewerUI.onDrawOverlay = null;
      this.viewerUI.render();
    }
    this.updateContextToolbar(null);
  }

  updateContextToolbar(activeEntry) {
    if (!this.contextToolbar) {
      this.contextToolbar = document.getElementById('viewer-context-toolbar');
    }
    if (!this.contextToolbar) return;

    if (!activeEntry || !activeEntry.node || !activeEntry.handler) {
      this.contextToolbar.style.display = 'none';
      this.contextToolbar.innerHTML = '';
      return;
    }

    const node = activeEntry.node;
    const handler = activeEntry.handler;
    this.contextToolbar.style.display = 'flex';
    this.contextToolbar.innerHTML = '';

    if (node.type === 'Roto') {
      this.renderRotoContextToolbar(this.contextToolbar, handler, node);
    } else if (node.type === 'Paint') {
      this.renderPaintContextToolbar(this.contextToolbar, handler, node);
    } else if (node.type === 'Keyer' || node.type === 'ChromaKeyer' || node.type === 'Despill' || node.type === 'MatteControl') {
      this.renderKeyerContextToolbar(this.contextToolbar, handler, node);
    } else if (node.type === 'Tracker' || node.type === 'PlanarTracker') {
      this.renderTrackingContextToolbar(this.contextToolbar, handler, node);
    } else if (['Axis3D', 'Camera3D', 'Card3D', 'Cube3D', 'Scene3D', 'Project3D', 'ScanlineRender'].includes(node.type)) {
      this.render3DContextToolbar(this.contextToolbar, node);
    } else if (['DeepRead', 'DeepWrite', 'DeepMerge', 'DeepHoldout', 'DeepCrop', 'DeepToImage', 'DeepFromImage'].includes(node.type)) {
      this.renderDeepContextToolbar(this.contextToolbar, node);
    } else if (['StereoWarp', 'StereoMerge'].includes(node.type)) {
      this.renderStereoContextToolbar(this.contextToolbar, node);
    } else {
      this.contextToolbar.style.display = 'none';
    }
  }

  render3DContextToolbar(toolbar, node) {
    const isCam = (node.type === 'Camera3D');
    const v3d = this.viewerUI?.viewer3D;
    const curGizmo = v3d?.gizmoMode || 'translate';
    const curSpace = v3d?.coordSpace || 'world';

    let html = `<span class="context-dept-badge badge-3d">🧊 3D WORKFLOW</span><div class="toolbar-group">`;
    html += `
      <button class="btn-tool ${curGizmo === 'translate' ? 'active' : ''}" id="ctx-3d-gizmo-trans" title="Translate Gizmo [W]">W Trans</button>
      <button class="btn-tool ${curGizmo === 'rotate' ? 'active' : ''}" id="ctx-3d-gizmo-rot" title="Rotate Gizmo [E]">E Rot</button>
      <button class="btn-tool ${curGizmo === 'scale' ? 'active' : ''}" id="ctx-3d-gizmo-scale" title="Scale Gizmo [R]">R Scale</button>
      <select id="ctx-3d-space-select" class="tool-select" title="Coordinate Frame (World/Local)">
        <option value="world" ${curSpace === 'world' ? 'selected' : ''}>World</option>
        <option value="local" ${curSpace === 'local' ? 'selected' : ''}>Local</option>
      </select>
    </div>
    <div class="toolbar-group">
      <button class="btn-tool" id="ctx-3d-reset-trans" title="Reset Translation to Origin">Reset T</button>
      <button class="btn-tool" id="ctx-3d-reset-rot" title="Reset Rotation to Zero">Reset R</button>
      <button class="btn-tool" id="ctx-3d-reset-scale" title="Reset Scale to 1.0">Reset S</button>
      <button class="btn-tool" id="ctx-3d-reset-all" title="Reset All Transforms">Reset All</button>
    </div>
    <div class="toolbar-group" style="margin-left:auto;">
      <button class="btn-tool" id="ctx-3d-frame" title="Frame Selected Object in 3D Viewer [F]">🎯 Frame</button>
      ${isCam ? `<button class="btn-tool" id="ctx-3d-look-through" title="Look Through This Camera in 3D Viewer">👁 Look Through</button>` : ''}
    </div>`;

    toolbar.innerHTML = html;
    toolbar.style.display = 'flex';

    toolbar.querySelector('#ctx-3d-gizmo-trans')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.setGizmoMode('translate');
        this.viewerUI.render();
      }
      this.render3DContextToolbar(toolbar, node);
    });

    toolbar.querySelector('#ctx-3d-gizmo-rot')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.setGizmoMode('rotate');
        this.viewerUI.render();
      }
      this.render3DContextToolbar(toolbar, node);
    });

    toolbar.querySelector('#ctx-3d-gizmo-scale')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.setGizmoMode('scale');
        this.viewerUI.render();
      }
      this.render3DContextToolbar(toolbar, node);
    });

    toolbar.querySelector('#ctx-3d-space-select')?.addEventListener('change', (e) => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.setCoordSpace(e.target.value);
        this.viewerUI.render();
      }
    });

    toolbar.querySelector('#ctx-3d-reset-trans')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.resetTranslate();
        this.viewerUI.render();
      }
      this.updateValuesAtFrame(this.currentFrame);
    });

    toolbar.querySelector('#ctx-3d-reset-rot')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.resetRotate();
        this.viewerUI.render();
      }
      this.updateValuesAtFrame(this.currentFrame);
    });

    toolbar.querySelector('#ctx-3d-reset-scale')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.resetScale();
        this.viewerUI.render();
      }
      this.updateValuesAtFrame(this.currentFrame);
    });

    toolbar.querySelector('#ctx-3d-reset-all')?.addEventListener('click', () => {
      if (this.viewerUI?.viewer3D) {
        this.viewerUI.viewer3D.resetAllTransforms();
        this.viewerUI.render();
      }
      this.updateValuesAtFrame(this.currentFrame);
    });

    toolbar.querySelector('#ctx-3d-frame')?.addEventListener('click', () => {
      if (this.viewerUI) {
        this.viewerUI.setViewMode('3D');
        this.viewerUI.viewer3D?.setSelectedNode(node);
        this.viewerUI.viewer3D?.frameSelected();
        this.viewerUI.render();
      }
    });

    toolbar.querySelector('#ctx-3d-look-through')?.addEventListener('click', () => {
      if (this.viewerUI) {
        this.viewerUI.setViewMode('3D');
        this.viewerUI.viewer3D?.setViewType(`camera:${node.id}`);
        this.viewerUI.render();
      }
    });
  }

  renderDeepContextToolbar(toolbar, node) {
    let html = `<span class="context-dept-badge badge-deep">🌊 DEEP COMP</span><div class="toolbar-group">`;
    html += `
      <button class="btn-tool" id="ctx-deep-open-inspector" title="Open Deep Sample Inspector Tab">🌊 Deep Inspector</button>
      <button class="btn-tool" id="ctx-deep-heatmap" title="Toggle Sample Density Heatmap">🔥 Heatmap</button>
      <button class="btn-tool" id="ctx-deep-meta" title="Inspect Deep EXR Header Metadata">📋 Metadata</button>
    </div>`;

    if (node.type === 'DeepToImage') {
      html += `<div class="toolbar-group">
        <span style="font-size:10px; color:#aaa; margin-right:4px;">Primary Depth:</span>
        <select id="ctx-deep-depth-mode" class="tool-select">
          <option value="first">First Hit</option>
          <option value="midpoint">Midpoint</option>
          <option value="maxAlpha">Max Alpha</option>
        </select>
      </div>`;
    }

    toolbar.innerHTML = html;

    toolbar.querySelector('#ctx-deep-open-inspector')?.addEventListener('click', () => {
      const tabBtn = document.getElementById('tab-btn-deepinspector');
      if (tabBtn) tabBtn.click();
    });

    toolbar.querySelector('#ctx-deep-heatmap')?.addEventListener('click', () => {
      if (this.viewerUI) {
        const cur = this.viewerUI.deepDisplayMode;
        this.viewerUI.setDeepDisplayMode(cur === 'heatmap' ? 'flatten' : 'heatmap');
      }
    });

    toolbar.querySelector('#ctx-deep-meta')?.addEventListener('click', () => {
      const tabBtn = document.getElementById('tab-btn-metadata');
      if (tabBtn) tabBtn.click();
    });

    const depthModeSel = toolbar.querySelector('#ctx-deep-depth-mode');
    if (depthModeSel && node.type === 'DeepToImage') {
      depthModeSel.value = node.getKnobValue('primaryDepth') || 'first';
      depthModeSel.addEventListener('change', (e) => {
        node.setKnobValue('primaryDepth', e.target.value);
        if (this.onParamChange) this.onParamChange(node);
      });
    }
  }

  renderStereoContextToolbar(toolbar, node) {
    const curMode = this.viewerUI?.stereoMode || 'anaglyph';
    let html = `<span class="context-dept-badge badge-stereo">🕶️ STEREO 3D</span><div class="toolbar-group">`;
    html += `
      <button class="btn-tool ${curMode === 'anaglyph' ? 'active' : ''}" id="ctx-stereo-anaglyph" title="3D Anaglyph Red/Cyan">🔴🔵 Anaglyph</button>
      <button class="btn-tool ${curMode === 'side_by_side' ? 'active' : ''}" id="ctx-stereo-sbs" title="Side-by-Side 3D">⧉ Side-by-Side</button>
      <button class="btn-tool ${curMode === 'wipe' ? 'active' : ''}" id="ctx-stereo-wipe" title="Interactive Split Wipe">◨ Wipe</button>
      <button class="btn-tool ${curMode === 'difference' ? 'active' : ''}" id="ctx-stereo-diff" title="Disparity Difference">Δ Diff</button>
      <button class="btn-tool ${curMode === 'left' ? 'active' : ''}" id="ctx-stereo-left" title="Left Eye Only [L]">Left [L]</button>
      <button class="btn-tool ${curMode === 'right' ? 'active' : ''}" id="ctx-stereo-right" title="Right Eye Only [R]">Right [R]</button>
      <button class="btn-tool" id="ctx-stereo-tab" title="Open Stereo 3D Panel">🕶️ Panel</button>
    </div>`;

    toolbar.innerHTML = html;

    const modes = [
      { id: '#ctx-stereo-anaglyph', mode: 'anaglyph' },
      { id: '#ctx-stereo-sbs', mode: 'side_by_side' },
      { id: '#ctx-stereo-wipe', mode: 'wipe' },
      { id: '#ctx-stereo-diff', mode: 'difference' },
      { id: '#ctx-stereo-left', mode: 'left' },
      { id: '#ctx-stereo-right', mode: 'right' }
    ];

    for (const m of modes) {
      toolbar.querySelector(m.id)?.addEventListener('click', () => {
        if (this.viewerUI) this.viewerUI.setStereoMode(m.mode);
        if (node.type === 'StereoWarp') node.setKnobValue('outputEye', m.mode);
        if (node.type === 'StereoMerge') node.setKnobValue('mode', m.mode);
        this.renderStereoContextToolbar(toolbar, node);
        if (this.onParamChange) this.onParamChange(node);
      });
    }

    toolbar.querySelector('#ctx-stereo-tab')?.addEventListener('click', () => {
      const tabBtn = document.getElementById('tab-btn-stereo');
      if (tabBtn) tabBtn.click();
    });
  }

  renderTrackingContextToolbar(toolbar, trackingUI, node) {
    const isPlanar = (node.type === 'PlanarTracker');
    let html = `<span class="context-dept-badge badge-tracking">🎯 TRACKING</span><div class="toolbar-group">`;
    html += `
      <button class="btn-tool" id="ctx-track-rev" title="Track Reverse Sequence">◀ Rev</button>
      <button class="btn-tool" id="ctx-track-step-rev" title="Step Track 1 Frame Back">|◀ Step</button>
      <button class="btn-tool btn-stop" id="ctx-track-stop" title="Stop Tracking">⏹ Stop</button>
      <button class="btn-tool" id="ctx-track-step-fwd" title="Step Track 1 Frame Forward">Step ▶|</button>
      <button class="btn-tool" id="ctx-track-fwd" title="Track Forward Sequence">Fwd ▶</button>
    </div>
    <div class="toolbar-group">
      ${!isPlanar ? `<button class="btn-tool" id="ctx-track-add-track" title="Add Track Point">+ Track</button>` : ''}
      <button class="btn-tool" id="ctx-track-export-matchmove" title="Export Matchmove Transform">Export MatchMove</button>
      <button class="btn-tool" id="ctx-track-export-cornerpin" title="Export CornerPin2D">Export CornerPin</button>
    </div>
    <div class="toolbar-group" style="margin-left:auto;">
      <button class="btn-tool ${trackingUI.showOverlay ? 'active' : ''}" id="ctx-track-overlay" title="Toggle Tracking Overlay (T)">👁 Overlay</button>
    </div>`;

    toolbar.innerHTML = html;

    toolbar.querySelector('#ctx-track-rev')?.addEventListener('click', () => trackingUI.trackBackward());
    toolbar.querySelector('#ctx-track-step-rev')?.addEventListener('click', () => trackingUI.stepTrackBackward());
    toolbar.querySelector('#ctx-track-stop')?.addEventListener('click', () => trackingUI.stopTracking());
    toolbar.querySelector('#ctx-track-step-fwd')?.addEventListener('click', () => trackingUI.stepTrackForward());
    toolbar.querySelector('#ctx-track-fwd')?.addEventListener('click', () => trackingUI.trackForward());
    toolbar.querySelector('#ctx-track-add-track')?.addEventListener('click', () => trackingUI.addTrack());
    toolbar.querySelector('#ctx-track-export-matchmove')?.addEventListener('click', () => trackingUI.exportTransform('matchmove'));
    toolbar.querySelector('#ctx-track-export-cornerpin')?.addEventListener('click', () => trackingUI.exportCornerPin('matchmove'));
    toolbar.querySelector('#ctx-track-overlay')?.addEventListener('click', (e) => {
      trackingUI.showOverlay = !trackingUI.showOverlay;
      e.target.classList.toggle('active', trackingUI.showOverlay);
      trackingUI.viewerUI?.render();
    });
  }

  renderRotoContextToolbar(toolbar, rotoUI, node) {
    const tools = [
      { id: 'select', label: 'Select [V]', icon: '↖' },
      { id: 'bezier', label: 'Bezier [P]', icon: '🖋' },
      { id: 'bspline', label: 'B-Spline [B]', icon: '〰' },
      { id: 'add-point', label: 'Add Pt [+]', icon: '➕' },
      { id: 'feather', label: 'Feather [E]', icon: '🪶' },
      { id: 'transform', label: 'Transform [T]', icon: '⤢' }
    ];

    let html = `<span class="context-dept-badge badge-roto">✒️ ROTO</span><div class="toolbar-group">`;
    for (const t of tools) {
      const active = (rotoUI.activeTool === t.id) ? 'active' : '';
      html += `<button class="btn-tool ${active}" data-roto-tool="${t.id}" title="${t.label}">${t.icon} ${t.label}</button>`;
    }
    html += `</div><div class="toolbar-group">
      <button class="btn-tool" id="ctx-roto-add-bezier" title="Add Bezier Shape">+ Bezier</button>
      <button class="btn-tool" id="ctx-roto-add-bspline" title="Add B-Spline Shape">+ B-Spline</button>
      <button class="btn-tool" id="ctx-roto-add-rect" title="Add Rectangle Shape">+ Rect</button>
      <button class="btn-tool" id="ctx-roto-add-ellipse" title="Add Ellipse Shape">+ Ellipse</button>
    </div>
    <div class="toolbar-group" style="margin-left:auto;">
      <button class="btn-tool" id="ctx-roto-undo" title="Undo (Ctrl+Z)">↶</button>
      <button class="btn-tool" id="ctx-roto-redo" title="Redo (Ctrl+Y)">↷</button>
      <button class="btn-tool ${rotoUI.showOverlay ? 'active' : ''}" id="ctx-roto-overlay" title="Toggle Overlay (O)">👁 Overlay</button>
    </div>`;

    toolbar.innerHTML = html;

    toolbar.querySelectorAll('[data-roto-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        rotoUI.setTool(btn.dataset.rotoTool);
        toolbar.querySelectorAll('[data-roto-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    toolbar.querySelector('#ctx-roto-add-bezier')?.addEventListener('click', () => rotoUI.addShape('bezier'));
    toolbar.querySelector('#ctx-roto-add-bspline')?.addEventListener('click', () => rotoUI.addShape('bspline'));
    toolbar.querySelector('#ctx-roto-add-rect')?.addEventListener('click', () => rotoUI.addShape('rectangle'));
    toolbar.querySelector('#ctx-roto-add-ellipse')?.addEventListener('click', () => rotoUI.addShape('ellipse'));
    toolbar.querySelector('#ctx-roto-undo')?.addEventListener('click', () => rotoUI.undo());
    toolbar.querySelector('#ctx-roto-redo')?.addEventListener('click', () => rotoUI.redo());
    toolbar.querySelector('#ctx-roto-overlay')?.addEventListener('click', (e) => {
      rotoUI.showOverlay = !rotoUI.showOverlay;
      e.target.classList.toggle('active', rotoUI.showOverlay);
      rotoUI.viewerUI?.render();
    });
  }

  renderPaintContextToolbar(toolbar, paintUI, node) {
    const tools = [
      { id: 'brush', label: 'Brush [B]', icon: '🖌' },
      { id: 'clone', label: 'Clone [C]', icon: '⧉' },
      { id: 'reveal', label: 'Reveal [R]', icon: '✦' },
      { id: 'eraser', label: 'Erase [E]', icon: '⌫' },
      { id: 'blur', label: 'Blur [L]', icon: '💧' }
    ];

    let html = `<span class="context-dept-badge badge-paint">🎨 PAINT</span><div class="toolbar-group">`;
    for (const t of tools) {
      const active = (paintUI.activeTool === t.id) ? 'active' : '';
      html += `<button class="btn-tool ${active}" data-paint-tool="${t.id}" title="${t.label}">${t.icon} ${t.label}</button>`;
    }
    html += `</div><div class="toolbar-group" style="display:flex; align-items:center; gap:4px;">
      <label style="font-size:10px; color:#aaa;">Size:</label>
      <input type="number" id="ctx-paint-size" class="paint-num-input" min="1" max="500" value="${paintUI.brushSize}" style="width:45px;" />
      <span style="font-size:10px; color:#888;">px</span>
      <label style="font-size:10px; color:#aaa; margin-left:6px;">Hard:</label>
      <span style="font-size:10px; color:#ccc;">${Math.round(paintUI.brushHardness * 100)}%</span>
    </div>
    <div class="toolbar-group" style="margin-left:auto;">
      <button class="btn-tool" id="ctx-paint-undo" title="Undo (Ctrl+Z)">↶</button>
      <button class="btn-tool" id="ctx-paint-redo" title="Redo (Ctrl+Y)">↷</button>
      <button class="btn-tool ${paintUI.showOverlay ? 'active' : ''}" id="ctx-paint-overlay" title="Toggle Overlay (O)">👁 Overlay</button>
    </div>`;

    toolbar.innerHTML = html;

    toolbar.querySelectorAll('[data-paint-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        paintUI.setTool(btn.dataset.paintTool);
        toolbar.querySelectorAll('[data-paint-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    toolbar.querySelector('#ctx-paint-size')?.addEventListener('change', (e) => {
      paintUI.brushSize = Math.max(1, Math.min(500, Number(e.target.value) || 1));
      paintUI.viewerUI?.render();
    });
    toolbar.querySelector('#ctx-paint-undo')?.addEventListener('click', () => paintUI.undo());
    toolbar.querySelector('#ctx-paint-redo')?.addEventListener('click', () => paintUI.redo());
    toolbar.querySelector('#ctx-paint-overlay')?.addEventListener('click', (e) => {
      paintUI.showOverlay = !paintUI.showOverlay;
      e.target.classList.toggle('active', paintUI.showOverlay);
      paintUI.viewerUI?.render();
    });
  }

  renderKeyerContextToolbar(toolbar, keyerUI, node) {
    const curOutputMode = node.getKnobValue('output') || node.getKnobValue('outputMode') || 'composite';

    let html = `<span class="context-dept-badge badge-keyer">🔀 KEYING</span>
    <div class="toolbar-group">
      <label style="font-size:10px; color:#aaa; margin-right:3px;">View:</label>
      <button class="btn-tool ${curOutputMode === 'composite' ? 'active' : ''}" data-keyer-mode="composite">Composite</button>
      <button class="btn-tool ${curOutputMode === 'matte' ? 'active' : ''}" data-keyer-mode="matte">Matte</button>
      <button class="btn-tool ${curOutputMode === 'status' ? 'active' : ''}" data-keyer-mode="status">Status</button>
      <button class="btn-tool ${curOutputMode === 'unpremult' || curOutputMode === 'despill' ? 'active' : ''}" data-keyer-mode="despill">Despilled</button>
    </div>
    <div class="toolbar-group">
      <button class="btn-tool ${keyerUI.sampleMode === 'eyedropper' ? 'active' : ''}" id="ctx-keyer-eye" title="Sample single pixel screen color">🎯 Eyedropper</button>
      <button class="btn-tool ${keyerUI.sampleMode === 'box' ? 'active' : ''}" id="ctx-keyer-box" title="Box sample average screen color">⧉ Box Sample</button>
      <div id="ctx-keyer-swatch" style="width:16px; height:16px; border-radius:2px; border:1px solid #555; background:${keyerUI.sampledHex}; margin-left:4px;" title="Sampled Color"></div>
    </div>
    <div class="toolbar-group" style="margin-left:auto;">
      <button class="btn-tool ${keyerUI.isComparing ? 'active' : ''}" id="ctx-keyer-compare" title="Toggle A/B Wipe against Input Plate">
        ${keyerUI.isComparing ? '◀▶ Wipe Active' : '⚖ Compare A/B'}
      </button>
    </div>`;

    toolbar.innerHTML = html;

    toolbar.querySelectorAll('[data-keyer-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        keyerUI.setOutputMode(btn.dataset.keyerMode);
        toolbar.querySelectorAll('[data-keyer-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    toolbar.querySelector('#ctx-keyer-eye')?.addEventListener('click', (e) => {
      keyerUI.sampleMode = (keyerUI.sampleMode === 'eyedropper') ? 'none' : 'eyedropper';
      e.target.classList.toggle('active', keyerUI.sampleMode === 'eyedropper');
      toolbar.querySelector('#ctx-keyer-box')?.classList.remove('active');
      if (keyerUI.viewerUI) keyerUI.viewerUI.canvas.style.cursor = (keyerUI.sampleMode === 'eyedropper') ? 'crosshair' : 'default';
      keyerUI.viewerUI?.render();
    });

    toolbar.querySelector('#ctx-keyer-box')?.addEventListener('click', (e) => {
      keyerUI.sampleMode = (keyerUI.sampleMode === 'box') ? 'none' : 'box';
      e.target.classList.toggle('active', keyerUI.sampleMode === 'box');
      toolbar.querySelector('#ctx-keyer-eye')?.classList.remove('active');
      if (keyerUI.viewerUI) keyerUI.viewerUI.canvas.style.cursor = (keyerUI.sampleMode === 'box') ? 'crosshair' : 'default';
      keyerUI.viewerUI?.render();
    });

    toolbar.querySelector('#ctx-keyer-compare')?.addEventListener('click', () => {
      keyerUI.toggleCompareAB();
      const compBtn = toolbar.querySelector('#ctx-keyer-compare');
      if (compBtn) {
        compBtn.classList.toggle('active', keyerUI.isComparing);
        compBtn.textContent = keyerUI.isComparing ? '◀▶ Wipe Active' : '⚖ Compare A/B';
      }
    });
  }

  floatNode(nodeId) {
    const entry = this.openNodes.get(nodeId);
    if (!entry || entry.isFloating) return;

    const node = entry.node;
    entry.isFloating = true;

    // Create floating window container
    const win = document.createElement('div');
    win.className = 'opencomp-floating-prop-window';
    win.style.left = `${Math.max(100, window.innerWidth - 450)}px`;
    win.style.top = '120px';
    win.style.width = '340px';
    win.style.borderTop = `3px solid ${node.color || '#888'}`;

    // Move card inside floating window
    entry.card.remove();
    win.appendChild(entry.card);

    // Make floating window draggable
    const header = entry.card.querySelector('.prop-header');
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    header.style.cursor = 'move';
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      isDragging = true;
      dragOffset = {
        x: e.clientX - win.offsetLeft,
        y: e.clientY - win.offsetTop
      };
      win.style.zIndex = '1000';
      e.preventDefault();
    });

    const onMove = (e) => {
      if (!isDragging) return;
      win.style.left = `${Math.max(10, Math.min(window.innerWidth - 100, e.clientX - dragOffset.x))}px`;
      win.style.top = `${Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y))}px`;
    };

    const onUp = () => {
      isDragging = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // Update float button to redock button
    const floatBtn = entry.card.querySelector('.btn-float');
    if (floatBtn) {
      floatBtn.textContent = '⤓';
      floatBtn.title = 'Re-dock to Properties Bin';
      floatBtn.onclick = (e) => {
        e.stopPropagation();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        this.redockNode(nodeId);
      };
    }

    const targetContainer = document.getElementById('workspace-container') || document.body;
    targetContainer.appendChild(win);
    entry.floatingWindow = win;

    this.focusNode(nodeId);
    this.renderTabBar();
  }

  redockNode(nodeId) {
    const entry = this.openNodes.get(nodeId);
    if (!entry || !entry.isFloating) return;

    entry.isFloating = false;
    if (entry.floatingWindow) {
      entry.card.remove();
      entry.floatingWindow.remove();
      entry.floatingWindow = null;
    }

    // Restore Float button
    const floatBtn = entry.card.querySelector('.btn-float');
    if (floatBtn) {
      floatBtn.textContent = '⧉';
      floatBtn.title = 'Float Panel';
      floatBtn.onclick = (e) => {
        e.stopPropagation();
        this.floatNode(nodeId);
      };
    }

    const header = entry.card.querySelector('.prop-header');
    header.style.cursor = 'default';

    // Put back in bin container
    this.container.prepend(entry.card);
    this.focusNode(nodeId);
    this.renderTabBar();
  }

  createNodeCard(node) {
    const card = document.createElement('div');
    card.className = 'node-properties-card';
    card.dataset.nodeId = node.id;

    // Header with collapse toggle, color bar, name input, type, disable checkbox, float button, and close button
    const header = document.createElement('div');
    header.className = 'prop-header';
    header.style.borderLeft = `5px solid ${node.color || '#888'}`;

    header.innerHTML = `
      <div class="prop-title-row">
        <button class="prop-btn-icon btn-collapse" title="Collapse / Expand Panel">▼</button>
        <input type="text" class="prop-node-name" value="${node.name}" />
        <span class="prop-node-type">${node.type}${node.isClone && node.isClone() ? ' [Clone]' : ''}</span>
      </div>
      <div class="prop-card-actions">
        <label class="prop-disable-label" title="Disable / Bypass Node (Hotkey: D)">
          <input type="checkbox" class="prop-disable-chk" ${node.disabled ? 'checked' : ''} />
          <span>[D]</span>
        </label>
        <button class="prop-btn-icon btn-float" title="Float Panel">⧉</button>
        <button class="prop-btn-icon btn-close" title="Close Panel (✕)">✕</button>
      </div>
    `;

    // Collapse toggle
    const collapseBtn = header.querySelector('.btn-collapse');
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('collapsed');
      collapseBtn.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
    });

    // Float button
    const floatBtn = header.querySelector('.btn-float');
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.floatNode(node.id);
    });

    // Close button
    const closeBtn = header.querySelector('.btn-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNode(node.id);
    });

    // Focus card on header click
    header.addEventListener('click', () => {
      this.focusNode(node.id);
    });

    // Name change
    const nameInput = header.querySelector('.prop-node-name');
    nameInput.addEventListener('change', (e) => {
      node.name = e.target.value.trim() || node.id;
      this.renderTabBar();
      if (this.onParamChange) this.onParamChange(node);
    });

    // Disable checkbox
    const disableChk = header.querySelector('.prop-disable-chk');
    disableChk.addEventListener('change', (e) => {
      node.disabled = e.target.checked;
      node.markDirty();
      if (this.onParamChange) this.onParamChange(node);
    });

    card.appendChild(header);

    // Knobs body container
    const knobsBody = document.createElement('div');
    knobsBody.className = 'prop-knobs-body';

    // Special controls for Read node: File Upload
    if (node.type === 'Read') {
      const uploadRow = document.createElement('div');
      uploadRow.className = 'prop-knob-row file-upload-row';
      uploadRow.innerHTML = `
        <label>Upload Image</label>
        <input type="file" id="prop-file-input-${node.id}" accept="image/*" />
      `;
      const fileInput = uploadRow.querySelector(`#prop-file-input-${node.id}`);
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const imgData = ctx.getImageData(0, 0, img.width, img.height);
              const buf = PixelBuffer.fromImageData(imgData);
              node.setUploadedImage(buf);
              if (this.onParamChange) this.onParamChange(node);
            };
            img.src = event.target.result;
          };
          reader.readAsDataURL(file);
        }
      });
      knobsBody.appendChild(uploadRow);
    }

    // Special controls for Write node: Export Button
    if (node.type === 'Write') {
      const exportRow = document.createElement('div');
      exportRow.className = 'prop-knob-row export-action-row';
      exportRow.innerHTML = `
        <button class="btn-primary prop-export-btn">Export Rendered Frame</button>
      `;
      const exportBtn = exportRow.querySelector('.prop-export-btn');
      exportBtn.addEventListener('click', () => {
        if (this.onRenderRequest) this.onRenderRequest(node);
      });
      knobsBody.appendChild(exportRow);
    }

    // Render each knob
    const isRoto = (node.type === 'Roto');
    const isPaint = (node.type === 'Paint');

    for (const [key, knob] of Object.entries(node.knobs)) {
      if (isRoto && key !== 'outputMode') continue;
      if (isPaint && key === 'opacity') continue;

      const row = document.createElement('div');
      row.className = 'prop-knob-row';
      row.dataset.knobKey = key;

      // Knob Context Menu on right-click
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openKnobContextMenu(e.clientX, e.clientY, node, key, knob);
      });

      // Label with Keyframe indicator
      const labelWrap = document.createElement('div');
      labelWrap.className = 'knob-label-wrap';

      // Animation Diamond Button
      const animBtn = document.createElement('button');
      animBtn.className = 'knob-anim-btn';
      this.updateAnimBtnState(animBtn, node, key);
      animBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleKnobKeyframe(node, key);
        this.updateAnimBtnState(animBtn, node, key);
        if (this.onParamChange) this.onParamChange(node);
      });
      labelWrap.appendChild(animBtn);

      const label = document.createElement('label');
      label.textContent = knob.label;
      labelWrap.appendChild(label);
      row.appendChild(labelWrap);

      const controlWrap = document.createElement('div');
      controlWrap.className = 'knob-control-wrap';

      // Determine if knob is RGBA 4-channel control
      const isRGBA = knob.type === 'rgba' || knob.type === 'color4' ||
        (Array.isArray(knob.value) && knob.value.length === 4) ||
        (typeof knob.value === 'object' && knob.value !== null && 'r' in knob.value);

      if (isRGBA) {
        this.renderRGBAControl(controlWrap, node, key, knob);
      } else if (knob.type === 'select') {
        const select = document.createElement('select');
        select.className = 'prop-select';
        for (const opt of knob.options || []) {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (opt.value === knob.value) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(select);
      } else if (knob.type === 'number' || knob.type === 'float') {
        this.renderNumericControl(controlWrap, node, key, knob);
      } else if (knob.type === 'color') {
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = knob.value || '#ffffff';
        colorInput.className = 'prop-color-input';
        colorInput.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(colorInput);
      } else if (knob.type === 'boolean') {
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!knob.value;
        chk.className = 'prop-checkbox';
        chk.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.checked);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(chk);
      } else if (knob.type === 'text') {
        const txt = document.createElement('input');
        txt.type = 'text';
        txt.value = knob.value || '';
        txt.className = 'prop-text-input';
        txt.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(txt);
      }

      row.appendChild(controlWrap);
      knobsBody.appendChild(row);
    }

    card.appendChild(knobsBody);

    // Embedded Specialized Node Tool Sections
    let specializedHandler = null;

    if (isRoto) {
      const rotoContainer = document.createElement('div');
      const rotoUI = new RotoUI(rotoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      rotoUI.setRotoNode(node);
      card.appendChild(rotoContainer);
      specializedHandler = rotoUI;
    } else if (isPaint) {
      const paintContainer = document.createElement('div');
      const paintUI = new PaintUI(paintContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      paintUI.setPaintNode(node);
      card.appendChild(paintContainer);
      specializedHandler = paintUI;
    } else if (node.type === 'Keyer' || node.type === 'ChromaKeyer' || node.type === 'Despill' || node.type === 'MatteControl') {
      const keyerContainer = document.createElement('div');
      const keyerUI = new KeyerUI(keyerContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      keyerUI.setKeyerNode(node);
      card.appendChild(keyerContainer);
      specializedHandler = keyerUI;
    } else if (node.type === 'Depth') {
      const depthContainer = document.createElement('div');
      const depthUI = new DepthUI(depthContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      depthUI.setDepthNode(node);
      card.appendChild(depthContainer);
    } else if (node.type === 'StereoWarp') {
      const stereoContainer = document.createElement('div');
      const stereoUI = new StereoUI(stereoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      stereoUI.setWarpNode(node);
      card.appendChild(stereoContainer);
    } else if (node.type === 'StereoMerge') {
      const stereoContainer = document.createElement('div');
      const stereoUI = new StereoUI(stereoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      stereoUI.setMergeNode(node);
      card.appendChild(stereoContainer);
    } else if (node.type === 'Tracker' || node.type === 'PlanarTracker') {
      const trackingContainer = document.createElement('div');
      const trackingUI = new TrackingUI(trackingContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      trackingUI.setTrackerNode(node);
      card.appendChild(trackingContainer);
      specializedHandler = trackingUI;
    }

    return { node, card, handler: specializedHandler, isFloating: false, floatingWindow: null };
  }

  renderNumericControl(wrap, node, key, knob) {
    wrap.innerHTML = '';

    // If knob has an active expression, show expression badge and formula
    if (knob.expression) {
      const exprWrap = document.createElement('div');
      exprWrap.className = 'prop-expr-wrap';
      const curVal = node.getKnobValue(key, { frame: this.currentFrame });
      exprWrap.innerHTML = `
        <span class="prop-expr-badge" title="Click to edit expression">fx</span>
        <input type="text" class="prop-expr-input" value="= ${knob.expression}" title="Evaluates to: ${curVal}" />
      `;
      const input = exprWrap.querySelector('.prop-expr-input');
      input.addEventListener('change', (e) => {
        const val = e.target.value.replace(/^=\s*/, '');
        node.setExpression(key, val);
        if (this.onParamChange) this.onParamChange(node);
      });
      exprWrap.querySelector('.prop-expr-badge').addEventListener('click', () => {
        this.openExpressionEditor(node, key);
      });
      wrap.appendChild(exprWrap);
      return;
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = knob.min ?? 0;
    slider.max = knob.max ?? (Number(knob.value) > 1.0 ? Number(knob.value) * 2 : 1.0);
    slider.step = knob.step ?? 0.01;
    slider.value = knob.value;
    slider.className = 'prop-slider';

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.step = knob.step ?? 0.01;
    numInput.value = Number(knob.value).toFixed(2);
    numInput.className = 'prop-num-input';

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      numInput.value = val.toFixed(2);
      node.setKnobValue(key, val);
      if (this.onParamChange) this.onParamChange(node);
    });

    numInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      slider.value = val;
      node.setKnobValue(key, val);
      if (this.onParamChange) this.onParamChange(node);
    });

    wrap.appendChild(slider);
    wrap.appendChild(numInput);
  }

  renderRGBAControl(wrap, node, key, knob) {
    wrap.innerHTML = '';
    const rgbaContainer = document.createElement('div');
    rgbaContainer.className = 'prop-rgba-container';

    // Parse RGBA channels
    let r = 1.0, g = 1.0, b = 1.0, a = 1.0;
    if (Array.isArray(knob.value)) {
      r = knob.value[0] ?? 1.0;
      g = knob.value[1] ?? 1.0;
      b = knob.value[2] ?? 1.0;
      a = knob.value[3] ?? 1.0;
    } else if (typeof knob.value === 'object' && knob.value !== null) {
      r = knob.value.r ?? 1.0;
      g = knob.value.g ?? 1.0;
      b = knob.value.b ?? 1.0;
      a = knob.value.a ?? 1.0;
    } else if (typeof knob.value === 'number') {
      r = g = b = a = knob.value;
    }

    let isGanged = (knob.ganged !== undefined) ? !!knob.ganged : true;

    // Channels numeric fields
    const channelsRow = document.createElement('div');
    channelsRow.className = 'prop-rgba-inputs-row';

    const createChInput = (label, val, chClass, onChange) => {
      const col = document.createElement('div');
      col.className = `rgba-ch-col ${chClass}`;
      col.innerHTML = `
        <span class="rgba-ch-tag">${label}</span>
        <input type="number" step="0.01" class="prop-num-input rgba-num-input" value="${Number(val).toFixed(2)}" />
      `;
      const input = col.querySelector('input');
      input.addEventListener('change', (e) => onChange(parseFloat(e.target.value) || 0));
      return { col, input };
    };

    const updateNodeRGBA = (newR, newG, newB, newA) => {
      r = newR; g = newG; b = newB; a = newA;
      if (Array.isArray(knob.value)) {
        node.setKnobValue(key, [r, g, b, a]);
      } else if (typeof knob.value === 'object' && knob.value !== null) {
        node.setKnobValue(key, { r, g, b, a });
      } else {
        node.setKnobValue(key, [r, g, b, a]);
      }
      swatch.style.backgroundColor = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      if (this.onParamChange) this.onParamChange(node);
    };

    const inR = createChInput('R', r, 'ch-r', (v) => {
      if (isGanged) {
        const delta = v - r;
        inG.input.value = (g + delta).toFixed(2);
        inB.input.value = (b + delta).toFixed(2);
        inA.input.value = (a + delta).toFixed(2);
        updateNodeRGBA(v, g + delta, b + delta, a + delta);
      } else {
        updateNodeRGBA(v, g, b, a);
      }
    });

    const inG = createChInput('G', g, 'ch-g', (v) => {
      if (isGanged) {
        const delta = v - g;
        inR.input.value = (r + delta).toFixed(2);
        inB.input.value = (b + delta).toFixed(2);
        inA.input.value = (a + delta).toFixed(2);
        updateNodeRGBA(r + delta, v, b + delta, a + delta);
      } else {
        updateNodeRGBA(r, v, b, a);
      }
    });

    const inB = createChInput('B', b, 'ch-b', (v) => {
      if (isGanged) {
        const delta = v - b;
        inR.input.value = (r + delta).toFixed(2);
        inG.input.value = (g + delta).toFixed(2);
        inA.input.value = (a + delta).toFixed(2);
        updateNodeRGBA(r + delta, g + delta, v, a + delta);
      } else {
        updateNodeRGBA(r, g, v, a);
      }
    });

    const inA = createChInput('A', a, 'ch-a', (v) => {
      if (isGanged) {
        const delta = v - a;
        inR.input.value = (r + delta).toFixed(2);
        inG.input.value = (g + delta).toFixed(2);
        inB.input.value = (b + delta).toFixed(2);
        updateNodeRGBA(r + delta, g + delta, b + delta, v);
      } else {
        updateNodeRGBA(r, g, b, v);
      }
    });

    // Gang Link button
    const gangBtn = document.createElement('button');
    gangBtn.className = `prop-btn-icon btn-gang ${isGanged ? 'active' : ''}`;
    gangBtn.textContent = isGanged ? '🔗' : '🔓';
    gangBtn.title = isGanged ? 'Channels Ganged (Linked)' : 'Channels Independent (Unlinked)';
    gangBtn.addEventListener('click', () => {
      isGanged = !isGanged;
      knob.ganged = isGanged;
      gangBtn.className = `prop-btn-icon btn-gang ${isGanged ? 'active' : ''}`;
      gangBtn.textContent = isGanged ? '🔗' : '🔓';
      gangBtn.title = isGanged ? 'Channels Ganged (Linked)' : 'Channels Independent (Unlinked)';
    });

    // Color Swatch preview
    const swatch = document.createElement('div');
    swatch.className = 'prop-rgba-swatch';
    swatch.style.backgroundColor = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    swatch.title = 'Live Color Swatch';

    channelsRow.appendChild(inR.col);
    channelsRow.appendChild(inG.col);
    channelsRow.appendChild(inB.col);
    channelsRow.appendChild(inA.col);
    channelsRow.appendChild(gangBtn);
    channelsRow.appendChild(swatch);

    rgbaContainer.appendChild(channelsRow);
    wrap.appendChild(rgbaContainer);
  }

  updateAnimBtnState(btn, node, key) {
    const knob = node.knobs[key];
    if (!knob) return;
    const hasKeys = knob.keyframes && Object.keys(knob.keyframes).length > 0;
    const isOnKey = hasKeys && (knob.keyframes[this.currentFrame] !== undefined);

    if (isOnKey) {
      btn.className = 'knob-anim-btn on-key';
      btn.textContent = '◆';
      btn.title = `Keyframe active at frame ${this.currentFrame} (Click to remove)`;
    } else if (hasKeys) {
      btn.className = 'knob-anim-btn animated';
      btn.textContent = '◇';
      btn.title = `Animated parameter (Click to set keyframe at frame ${this.currentFrame})`;
    } else {
      btn.className = 'knob-anim-btn static';
      btn.textContent = '•';
      btn.title = `Static parameter (Click to add keyframe at frame ${this.currentFrame})`;
    }
  }

  toggleKnobKeyframe(node, key) {
    const knob = node.knobs[key];
    if (!knob) return;
    const hasKeys = knob.keyframes && Object.keys(knob.keyframes).length > 0;
    const isOnKey = hasKeys && (knob.keyframes[this.currentFrame] !== undefined);

    if (isOnKey) {
      node.removeKeyframe(key, this.currentFrame);
    } else {
      const curVal = knob.value;
      node.setKeyframe(key, this.currentFrame, curVal);
    }
  }

  updateValuesAtFrame(frame) {
    this.currentFrame = Number(frame);

    // Refresh anim buttons and values for all open cards
    for (const [nodeId, entry] of this.openNodes.entries()) {
      const node = entry.node;
      for (const [key, knob] of Object.entries(node.knobs)) {
        const row = entry.card.querySelector(`.prop-knob-row[data-knob-key="${key}"]`);
        if (!row) continue;

        // Update anim button
        const btn = row.querySelector('.knob-anim-btn');
        if (btn) this.updateAnimBtnState(btn, node, key);

        // Update numeric slider / inputs
        const val = (knob.keyframes && Object.keys(knob.keyframes).length > 0)
          ? node.getKnobValueAtFrame(key, this.currentFrame)
          : node.getKnobValue(key);
        const slider = row.querySelector('.prop-slider');
        const numInput = row.querySelector('.prop-num-input');
        if (slider && numInput && typeof val === 'number') {
          slider.value = val;
          numInput.value = Number(val).toFixed(2);
        }
      }

      // Sync active department handler (e.g. Tracking, Roto, Paint)
      if (entry.handler && typeof entry.handler.setFrame === 'function') {
        entry.handler.setFrame(this.currentFrame);
      }
    }
  }

  openKnobContextMenu(clientX, clientY, node, key, knob) {
    this.closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'opencomp-context-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const addItem = (label, kbd, onClick) => {
      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.innerHTML = `<span>${label}</span>${kbd ? `<span class="kbd">${kbd}</span>` : ''}`;
      item.addEventListener('click', () => {
        this.closeContextMenu();
        onClick();
      });
      menu.appendChild(item);
    };

    const addHr = () => {
      const hr = document.createElement('div');
      hr.className = 'ctx-hr';
      menu.appendChild(hr);
    };

    const header = document.createElement('div');
    header.className = 'ctx-header';
    header.textContent = `${knob.label} (${key})`;
    menu.appendChild(header);

    addItem(`Set Keyframe at Frame ${this.currentFrame}`, '', () => {
      node.setKeyframe(key, this.currentFrame, knob.value);
      this.updateValuesAtFrame(this.currentFrame);
      if (this.onParamChange) this.onParamChange(node);
    });

    if (knob.keyframes && knob.keyframes[this.currentFrame] !== undefined) {
      addItem(`Remove Keyframe at Frame ${this.currentFrame}`, '', () => {
        node.removeKeyframe(key, this.currentFrame);
        this.updateValuesAtFrame(this.currentFrame);
        if (this.onParamChange) this.onParamChange(node);
      });
    }

    if (knob.keyframes && Object.keys(knob.keyframes).length > 0) {
      addItem('Clear All Keyframes', '', () => {
        node.clearKeyframes(key);
        this.updateValuesAtFrame(this.currentFrame);
        if (this.onParamChange) this.onParamChange(node);
      });
    }

    addHr();
    addItem('Add Expression...', 'fx', () => {
      this.openExpressionEditor(node, key);
    });

    if (knob.expression) {
      addItem('Remove Expression', '', () => {
        node.removeExpression(key);
        // Re-render knob control
        this.rebuildNodeKnobControl(node, key);
        if (this.onParamChange) this.onParamChange(node);
      });
    }

    addHr();
    addItem('Copy Parameter', 'Ctrl+C', () => {
      this.knobClipboard = {
        value: knob.value,
        keyframes: knob.keyframes ? { ...knob.keyframes } : null,
        expression: knob.expression || null
      };
    });

    if (this.knobClipboard) {
      addItem('Paste Parameter', 'Ctrl+V', () => {
        if (this.knobClipboard.value !== undefined) node.setKnobValue(key, this.knobClipboard.value);
        if (this.knobClipboard.keyframes) {
          for (const [f, v] of Object.entries(this.knobClipboard.keyframes)) {
            node.setKeyframe(key, Number(f), v);
          }
        }
        if (this.knobClipboard.expression) {
          node.setExpression(key, this.knobClipboard.expression);
        }
        this.rebuildNodeKnobControl(node, key);
        if (this.onParamChange) this.onParamChange(node);
      });
    }

    addItem('Reset to Default', '', () => {
      const defVal = (knob.type === 'color' || knob.type === 'rgba') ? [1, 1, 1, 1] : 0;
      node.setKnobValue(key, defVal);
      node.clearKeyframes(key);
      node.removeExpression(key);
      this.rebuildNodeKnobControl(node, key);
      if (this.onParamChange) this.onParamChange(node);
    });

    document.body.appendChild(menu);
    this.activeContextMenuEl = menu;

    const mRect = menu.getBoundingClientRect();
    if (mRect.right > window.innerWidth) menu.style.left = `${window.innerWidth - mRect.width - 8}px`;
    if (mRect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - mRect.height - 8}px`;
  }

  rebuildNodeKnobControl(node, key) {
    const entry = this.openNodes.get(node.id);
    if (!entry) return;
    const row = entry.card.querySelector(`.prop-knob-row[data-knob-key="${key}"]`);
    if (!row) return;
    const wrap = row.querySelector('.knob-control-wrap');
    if (!wrap) return;

    const knob = node.knobs[key];
    if (knob.type === 'number' || knob.type === 'float') {
      this.renderNumericControl(wrap, node, key, knob);
    }
  }

  openExpressionEditor(node, key) {
    const knob = node.knobs[key];
    if (!knob) return;

    // Create modal popup for expression editing
    const overlay = document.createElement('div');
    overlay.className = 'opencomp-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'opencomp-modal-dialog';
    dialog.innerHTML = `
      <div class="modal-header">
        <h3>Edit Expression: ${node.name}.${key}</h3>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <label>Expression Formula (supports frame, sin, cos, clamp, noise, Node.knob):</label>
        <textarea class="expr-textarea" rows="3">${knob.expression || ''}</textarea>
        <div class="expr-preview-bar">
          <span class="expr-status">Checking syntax...</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-tool btn-remove-expr" ${!knob.expression ? 'disabled' : ''}>Clear</button>
        <div style="flex: 1;"></div>
        <button class="btn-tool btn-cancel">Cancel</button>
        <button class="btn-primary btn-save-expr">Apply</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const textarea = dialog.querySelector('.expr-textarea');
    const status = dialog.querySelector('.expr-status');

    const checkSyntax = () => {
      const val = textarea.value.trim();
      if (!val) {
        status.textContent = 'Empty expression (will clear)';
        status.style.color = '#888';
        return true;
      }
      const res = ExpressionEngine.validate(val);
      if (res.valid) {
        const testVal = ExpressionEngine.evaluate(val, { frame: this.currentFrame }, node.graph);
        status.textContent = `✓ Valid syntax (evaluates to: ${Number(testVal).toFixed(3)} at frame ${this.currentFrame})`;
        status.style.color = '#51cf66';
        return true;
      } else {
        status.textContent = `✕ Error: ${res.error}`;
        status.style.color = '#fa5252';
        return false;
      }
    };

    textarea.addEventListener('input', checkSyntax);
    checkSyntax();

    dialog.querySelector('.modal-close').onclick = () => overlay.remove();
    dialog.querySelector('.btn-cancel').onclick = () => overlay.remove();

    dialog.querySelector('.btn-remove-expr').onclick = () => {
      node.removeExpression(key);
      this.rebuildNodeKnobControl(node, key);
      if (this.onParamChange) this.onParamChange(node);
      overlay.remove();
    };

    dialog.querySelector('.btn-save-expr').onclick = () => {
      const val = textarea.value.trim();
      if (val) {
        node.setExpression(key, val);
      } else {
        node.removeExpression(key);
      }
      this.rebuildNodeKnobControl(node, key);
      if (this.onParamChange) this.onParamChange(node);
      overlay.remove();
    };

    textarea.focus();
  }

  closeContextMenu() {
    if (this.activeContextMenuEl) {
      this.activeContextMenuEl.remove();
      this.activeContextMenuEl = null;
    }
  }
}
