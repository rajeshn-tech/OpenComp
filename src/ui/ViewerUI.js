/**
 * OpenComp - Advanced Viewport & Color Management Engine (Phase 2)
 * High-performance multi-layout VFX viewport supporting:
 * - Single, Dual (A/B), and Quad (1-4) display layouts with independent/synchronized zoom & pan
 * - A/B Horizontal & Vertical Wipe, Side-by-Side, and Difference comparisons
 * - Full OCIO v2 color management pipeline (Display, View, Working Space, Bypass toggle)
 * - Exposure (EV stops) and Gamma controls with non-destructive display rasterization
 * - Region of Interest (ROI) interactive drawing, dragging, resizing, and coordinate mapping
 * - Safe areas (Action 90%, Title 80%), Center Cross, Center Marks, Rule of Thirds, and Grid
 * - Interactive pixel sampler (Linear Float, Display 8-bit, Hex, and Pinned Sample Target)
 * - Real-time Waveform, RGB Parade, Histogram, and Vectorscope scopes
 * - WebGL 2.0 GPU acceleration with seamless CPU fallback and context-loss recovery
 */

import { GLPipeline } from '../core/GLPipeline.js';
import { globalOCIO } from '../core/OCIOManager.js';
import { ViewerScopes } from './ViewerScopes.js';
import { ViewerOverlay } from './ViewerOverlay.js';
import { Viewer3DUI } from './Viewer3DUI.js';
import { StereoEngine } from '../core/StereoEngine.js';

export class ViewerUI {
  constructor(canvasElement, controlsContainer = null, infoBarElement = null, scopesCanvasElement = null) {
    this.canvas = canvasElement;
    this.ctx = canvasElement && typeof canvasElement.getContext === 'function' ? canvasElement.getContext('2d') : null;
    this.controls = controlsContainer;
    this.infoBar = infoBarElement;

    // Buffers
    this.currentBuffer = null;
    this.multiBuffers = {}; // { '1': buf1, '2': buf2, ... }
    this.sourceA = '1';
    this.sourceB = '2';

    // Layout Mode: 'single', 'dual', 'quad'
    this.layoutMode = 'single';
    this.syncZoomPan = true;
    this.activeViewportIdx = 0; // 0: Top-Left/Left/Main, 1: Top-Right/Right, 2: Bottom-Left, 3: Bottom-Right

    // Viewports state for Multi-Viewer
    this.viewports = [
      { zoom: 1.0, panX: 0, panY: 0, slot: '1', title: 'View 1' },
      { zoom: 1.0, panX: 0, panY: 0, slot: '2', title: 'View 2' },
      { zoom: 1.0, panX: 0, panY: 0, slot: '3', title: 'View 3' },
      { zoom: 1.0, panX: 0, panY: 0, slot: '4', title: 'View 4' }
    ];

    // Primary transform (mapped to viewports[0])
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Tool Modes: 'nav' (pan/zoom), 'roi' (draw/resize ROI), 'sample' (pin sample point)
    this.toolMode = 'nav';

    // Color Management Pipeline (OCIO v2)
    this.ocioProcessEnabled = true;
    this.workingSpace = 'ACEScg';
    const displays = globalOCIO.getDisplays();
    this.ocioDisplay = displays[0] || 'sRGB - Display';
    const views = globalOCIO.getViews(this.ocioDisplay);
    this.ocioView = views[0] || 'ACES 1.0 - SDR Video';

    this.exposure = 0.0;
    this.gamma = 1.0;
    this.channelMode = 'RGBA'; // 'RGBA', 'RGB', 'RED', 'GREEN', 'BLUE', 'ALPHA', 'LUMA'

    // GPU Acceleration Pipeline
    try {
      this.glPipeline = new GLPipeline();
    } catch (err) {
      this.glPipeline = null;
    }

    // Overlays, Guides & ROI Subsystem
    this.overlay = new ViewerOverlay();

    // Scopes Subsystem
    this.scopes = new ViewerScopes(scopesCanvasElement);

    // Interactive Wipe drag state
    this.isDraggingWipe = false;
    this.dragWipeOrientation = 'horizontal';
    this.activeViewerNode = null;

    // ROI dragging state
    this.isDrawingROI = false;
    this.isDraggingROI = false;
    this.roiDragHandle = null;
    this.roiStartPos = null;

    // Interactive Department Viewport Hooks (Roto, Paint, Depth, Stereo)
    this.activeDepartment = null;
    this.departmentHandler = null;
    this.onDrawOverlay = null;
    this.onViewerUpdate = null;

    // Hover inspection coordinates
    this.hoveredImgX = -1;
    this.hoveredImgY = -1;

    // Dedicated 3D Viewport Subsystem
    this.viewMode = '2D'; // '2D' or '3D'
    this.on3DNodeSelect = null;
    this.viewer3D = new Viewer3DUI(canvasElement, null, (node) => {
      if (this.onViewerUpdate) this.onViewerUpdate();
    }, (node) => {
      if (this.on3DNodeSelect) this.on3DNodeSelect(node);
    });

    // Deep Compositing & Sample Inspection Subsystem
    this.isDeep = false;
    this.activeDeepBuffer = null;
    this.deepDisplayMode = 'flatten'; // 'flatten' | 'depth' | 'heatmap'
    this.onDeepSampleInspect = null;

    // Stereo 3D Monitoring Subsystem
    this.stereoMode = 'none'; // 'none' | 'anaglyph' | 'side_by_side' | 'wipe' | 'difference' | 'left' | 'right'
    this.stereoConvergence = 0.5;
    this.stereoSeparation = 12.0;

    // Advanced Imaging & Multi-Channel / AOV Inspection
    this.activeAOV = null; // null for RGBA, or channel name string (e.g. 'depth.Z', 'normal.X')
    this.onAOVChannelsChanged = null;

    this.initEvents();
    this.loadPreferences();
  }

  setViewMode(mode) {
    if (mode !== '2D' && mode !== '3D') return;
    this.viewMode = mode;
    this.updateModeUI();
    this.render();
    this.savePreferences();
  }

  toggleViewMode() {
    this.setViewMode(this.viewMode === '2D' ? '3D' : '2D');
  }

  updateModeUI() {
    if (typeof document === 'undefined') return;
    const btn2D = document.getElementById('btn-viewer-mode-2d');
    const btn3D = document.getElementById('btn-viewer-mode-3d');
    const toolbar3D = document.getElementById('viewer-3d-toolbar');
    const toolbar2DGroups = document.querySelectorAll('.viewer-2d-group');

    if (btn2D) btn2D.classList.toggle('active', this.viewMode === '2D');
    if (btn3D) btn3D.classList.toggle('active', this.viewMode === '3D');

    if (toolbar3D) toolbar3D.style.display = this.viewMode === '3D' ? 'inline-flex' : 'none';
    toolbar2DGroups.forEach(el => {
      el.style.display = this.viewMode === '2D' ? 'inline-flex' : 'none';
    });

    if (this.infoBar) {
      if (this.viewMode === '3D') {
        const camName = this.viewer3D?.activeCameraNodeId || this.viewer3D?.viewType?.toUpperCase() || 'PERSPECTIVE';
        this.infoBar.innerHTML = `<span class="info-res">3D Viewport: <b>${camName}</b> | Display: <b>${this.viewer3D?.displayMode?.toUpperCase()}</b> | Manip: <b>${this.viewer3D?.gizmoMode?.toUpperCase()}</b> (${this.viewer3D?.coordSpace?.toUpperCase()})</span>`;
      }
    }
  }

  get zoom() {
    return this.viewports?.[0]?.zoom ?? 1.0;
  }
  set zoom(val) {
    if (this.viewports && this.viewports[0]) {
      this.viewports[0].zoom = val;
      if (this.syncZoomPan) {
        for (let i = 1; i < this.viewports.length; i++) {
          this.viewports[i].zoom = val;
        }
      }
    }
  }

  get panX() {
    return this.viewports?.[0]?.panX ?? 0;
  }
  set panX(val) {
    if (this.viewports && this.viewports[0]) {
      this.viewports[0].panX = val;
      if (this.syncZoomPan) {
        for (let i = 1; i < this.viewports.length; i++) {
          this.viewports[i].panX = val;
        }
      }
    }
  }

  get panY() {
    return this.viewports?.[0]?.panY ?? 0;
  }
  set panY(val) {
    if (this.viewports && this.viewports[0]) {
      this.viewports[0].panY = val;
      if (this.syncZoomPan) {
        for (let i = 1; i < this.viewports.length; i++) {
          this.viewports[i].panY = val;
        }
      }
    }
  }

  setViewerNode(node) {
    this.activeViewerNode = node;
    if (this.viewer3D && node && node.graph) {
      this.viewer3D.setGraph(node.graph);
    }
    if (node) {
      if (node.getKnobValue('sourceA')) this.sourceA = String(node.getKnobValue('sourceA'));
      if (node.getKnobValue('sourceB')) this.sourceB = String(node.getKnobValue('sourceB'));
      if (node.getKnobValue('layoutMode')) this.layoutMode = node.getKnobValue('layoutMode');
      if (node.getKnobValue('activeInput')) {
        this.setViewportSlot(this.activeViewportIdx, String(node.getKnobValue('activeInput')));
      }
    }
  }

  get buffer() {
    return this.currentBuffer;
  }

  setBuffer(buffer, multiInputs = null) {
    this.currentBuffer = buffer;
    if (multiInputs && typeof multiInputs === 'object') {
      this.multiBuffers = { ...multiInputs };
    } else if (this.activeViewerNode && typeof this.activeViewerNode.getAllInputBuffers === 'function') {
      this.multiBuffers = this.activeViewerNode.getAllInputBuffers();
    }

    // Detect Deep buffer
    this.isDeep = !!(buffer && (buffer.isDeep || buffer.sampleOffsets));
    if (this.isDeep) {
      this.activeDeepBuffer = buffer;
    } else {
      this.activeDeepBuffer = null;
    }
    this.updateDeepStatusUI();
    this.updateAOVChannelsUI();

    this.render();
    if (this.scopes.enabled) {
      this.renderScopes();
    }
  }

  setDeepDisplayMode(mode) {
    if (!['flatten', 'depth', 'heatmap'].includes(mode)) return;
    this.deepDisplayMode = mode;
    this.render();
    this.savePreferences();
  }

  updateDeepStatusUI() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('viewer-deep-badge');
    if (badge) {
      badge.style.display = this.isDeep ? 'inline-flex' : 'none';
      if (this.isDeep && this.activeDeepBuffer) {
        badge.textContent = `🌊 DEEP (${(this.activeDeepBuffer.totalSamples || 0).toLocaleString()} spl)`;
      }
    }
  }

  setStereoMode(mode) {
    if (!['none', 'anaglyph', 'side_by_side', 'wipe', 'difference', 'left', 'right'].includes(mode)) return;
    this.stereoMode = mode;
    this.updateStereoStatusUI();
    this.render();
    this.savePreferences();
  }

  updateStereoStatusUI() {
    if (typeof document === 'undefined') return;
    const btnLeft = document.getElementById('btn-stereo-left');
    const btnRight = document.getElementById('btn-stereo-right');
    const btn3D = document.getElementById('btn-stereo-3d');

    if (btnLeft) btnLeft.classList.toggle('active', this.stereoMode === 'left');
    if (btnRight) btnRight.classList.toggle('active', this.stereoMode === 'right');
    if (btn3D) btn3D.classList.toggle('active', this.stereoMode === 'anaglyph' || this.stereoMode === 'side_by_side');
  }

  setAOVChannel(channelName) {
    if (!channelName || channelName === 'RGBA' || channelName === 'RGB') {
      this.activeAOV = null;
      if (channelName) this.setChannelMode(channelName);
    } else {
      this.activeAOV = channelName;
      this.render();
      if (this.scopes.enabled) this.renderScopes();
    }

    const select = document.getElementById('viewer-layer-select');
    if (select && select.value !== (channelName || 'RGBA')) {
      select.value = channelName || 'RGBA';
    }
    this.savePreferences();
  }

  updateAOVChannelsUI() {
    if (typeof document === 'undefined') return;
    const select = document.getElementById('viewer-layer-select');
    if (!select) return;

    const buf = this.currentBuffer;
    let channels = ['RGBA', 'RGB'];
    if (buf && typeof buf.getChannelNames === 'function') {
      const extra = buf.getChannelNames().filter(c => !['R', 'G', 'B', 'A', 'r', 'g', 'b', 'a'].includes(c));
      channels = [...channels, ...extra];
    } else if (buf && (buf.isDeep || buf.channels)) {
      const extra = (buf.channels || ['Z', 'ZBack']).filter(c => !['R', 'G', 'B', 'A'].includes(c));
      channels = [...channels, ...extra];
    }

    select.innerHTML = '';
    for (const ch of channels) {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      if (ch === (this.activeAOV || this.channelMode)) opt.selected = true;
      select.appendChild(opt);
    }

    if (this.onAOVChannelsChanged) {
      this.onAOVChannelsChanged(channels);
    }
  }

  renderAOVChannelCanvas(buffer, aovName) {
    if (!this.offlineCanvas) {
      this.offlineCanvas = document.createElement('canvas');
      this.offlineCtx = this.offlineCanvas.getContext('2d');
    }
    if (this.offlineCanvas.width !== buffer.width || this.offlineCanvas.height !== buffer.height) {
      this.offlineCanvas.width = buffer.width;
      this.offlineCanvas.height = buffer.height;
    }
    const W = buffer.width;
    const H = buffer.height;
    const totalPx = W * H;
    const chData = typeof buffer.getChannel === 'function' ? buffer.getChannel(aovName) : null;
    const ImageDataType = (typeof ImageData !== 'undefined') ? ImageData : class MockImageData {
      constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
    };
    const imgData = new ImageDataType(W, H);
    const dst = imgData.data;

    // Normal vectors visualization if full XYZ available
    if (aovName.startsWith('normal') && buffer.hasChannel && buffer.hasChannel('normal.X') && buffer.hasChannel('normal.Y') && buffer.hasChannel('normal.Z')) {
      const nX = buffer.getChannel('normal.X');
      const nY = buffer.getChannel('normal.Y');
      const nZ = buffer.getChannel('normal.Z');
      for (let p = 0; p < totalPx; p++) {
        const outIdx = p * 4;
        dst[outIdx] = Math.min(255, Math.max(0, Math.round((nX[p] * 0.5 + 0.5) * 255)));
        dst[outIdx + 1] = Math.min(255, Math.max(0, Math.round((nY[p] * 0.5 + 0.5) * 255)));
        dst[outIdx + 2] = Math.min(255, Math.max(0, Math.round((nZ[p] * 0.5 + 0.5) * 255)));
        dst[outIdx + 3] = 255;
      }
    } else if (chData) {
      // Find min and max for auto-normalization
      let minVal = 1e9, maxVal = -1e9;
      for (let p = 0; p < totalPx; p++) {
        const v = chData[p];
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
      if (minVal >= maxVal) { minVal = 0; maxVal = 1; }
      const range = maxVal - minVal || 1.0;

      for (let p = 0; p < totalPx; p++) {
        const v = chData[p];
        const norm = Math.max(0, Math.min(1, (v - minVal) / range));
        const byteVal = Math.round(norm * 255);
        const outIdx = p * 4;
        dst[outIdx] = byteVal;
        dst[outIdx + 1] = byteVal;
        dst[outIdx + 2] = byteVal;
        dst[outIdx + 3] = 255;
      }
    }
    this.offlineCtx.putImageData(imgData, 0, 0);
    return this.offlineCanvas;
  }

  setLayoutMode(mode) {
    if (['single', 'dual', 'dual_h', 'dual_v', 'quad'].includes(mode)) {
      this.layoutMode = mode;
      if (this.activeViewerNode) {
        this.activeViewerNode.setKnobValue('layoutMode', mode);
      }
      this.render();
      if (this.scopes.enabled) this.renderScopes();
      this.savePreferences();
    }
  }

  setViewportSlot(vpIdx, slot) {
    if (this.viewports && this.viewports[vpIdx]) {
      this.viewports[vpIdx].slot = String(slot);
      if (vpIdx === 0) {
        this.sourceA = String(slot);
        if (this.activeViewerNode) this.activeViewerNode.setKnobValue('sourceA', String(slot));
      } else if (vpIdx === 1) {
        this.sourceB = String(slot);
        if (this.activeViewerNode) this.activeViewerNode.setKnobValue('sourceB', String(slot));
      }
      this.render();
      if (this.scopes.enabled) this.renderScopes();
      this.updateSlotUI();
    }
  }

  setActiveInput(slot) {
    this.setViewportSlot(this.activeViewportIdx, slot);
    if (this.activeViewerNode) {
      this.activeViewerNode.setKnobValue('activeInput', String(slot));
      if (this.onViewerUpdate) this.onViewerUpdate();
    }
  }

  updateSlotUI() {
    const activeSlot = this.viewports[this.activeViewportIdx]?.slot || '1';
    const inputSelect = document.getElementById('viewer-input-select');
    if (inputSelect && inputSelect.value !== activeSlot) {
      inputSelect.value = activeSlot;
    }
  }

  setSyncZoomPan(enabled) {
    this.syncZoomPan = !!enabled;
    if (this.syncZoomPan) {
      // Sync all viewports to active viewport
      const activeVp = this.viewports[this.activeViewportIdx];
      for (const vp of this.viewports) {
        vp.zoom = activeVp.zoom;
        vp.panX = activeVp.panX;
        vp.panY = activeVp.panY;
      }
      this.zoom = activeVp.zoom;
      this.panX = activeVp.panX;
      this.panY = activeVp.panY;
      this.render();
    }
    this.savePreferences();
  }

  toggleSyncZoomPan() {
    this.setSyncZoomPan(!this.syncZoomPan);
    return this.syncZoomPan;
  }

  setToolMode(mode) {
    if (['nav', 'roi', 'sample'].includes(mode)) {
      this.toolMode = mode;
      if (this.canvas) {
        if (mode === 'roi') this.canvas.style.cursor = 'crosshair';
        else if (mode === 'sample') this.canvas.style.cursor = 'crosshair';
        else this.canvas.style.cursor = 'default';
      }
    }
  }

  // --- OCIO Color Management Controls ---

  setOCIODisplay(display) {
    this.ocioDisplay = display;
    const views = globalOCIO.getViews(display);
    if (!views.includes(this.ocioView)) {
      this.ocioView = views[0] || 'ACES 1.0 - SDR Video';
    }
    this.updateLUTStatus();
    this.render();
  }

  setOCIOView(view) {
    this.ocioView = view;
    this.updateLUTStatus();
    this.render();
  }

  toggleOCIOProcess(forceState) {
    this.ocioProcessEnabled = (forceState !== undefined) ? !!forceState : !this.ocioProcessEnabled;
    this.updateLUTStatus();
    this.render();
  }

  resetColorControls() {
    this.exposure = 0.0;
    this.gamma = 1.0;
    this.channelMode = 'RGBA';
    this.ocioProcessEnabled = true;

    const displays = globalOCIO.getDisplays();
    this.ocioDisplay = displays[0] || 'sRGB - Display';
    const views = globalOCIO.getViews(this.ocioDisplay);
    this.ocioView = views[0] || 'ACES 1.0 - SDR Video';

    // Update UI Elements if present
    const expSlider = document.getElementById('viewer-exposure-slider');
    const expVal = document.getElementById('viewer-exposure-val');
    const gammaSlider = document.getElementById('viewer-gamma-slider');
    const gammaVal = document.getElementById('viewer-gamma-val');
    const displaySel = document.getElementById('viewer-ocio-display');
    const viewSel = document.getElementById('viewer-ocio-view');
    const ocioToggle = document.getElementById('btn-viewer-ocio-toggle');

    if (expSlider) expSlider.value = 0.0;
    if (expVal) expVal.textContent = '0.0';
    if (gammaSlider) gammaSlider.value = 1.0;
    if (gammaVal) gammaVal.textContent = '1.0';
    if (displaySel) displaySel.value = this.ocioDisplay;
    if (viewSel) viewSel.value = this.ocioView;
    if (ocioToggle) ocioToggle.classList.add('active');

    const chanButtons = document.querySelectorAll('.btn-channel');
    chanButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.channel === 'RGBA');
    });

    this.updateLUTStatus();
    this.render();
  }

  setChannelMode(mode) {
    const validModes = ['RGBA', 'RGB', 'RED', 'GREEN', 'BLUE', 'ALPHA', 'LUMA'];
    const m = (mode || 'RGBA').toUpperCase();
    if (validModes.includes(m)) {
      this.channelMode = m;
      this.render();
      if (this.scopes.enabled) this.renderScopes();
      this.savePreferences();
      const chanButtons = document.querySelectorAll('.btn-channel');
      chanButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.channel === m);
      });
    }
  }

  setExposure(val) {
    this.exposure = Number(val) || 0.0;
    this.render();
    if (this.scopes.enabled) this.renderScopes();
    const expSlider = document.getElementById('viewer-exposure-slider');
    const expVal = document.getElementById('viewer-exposure-val');
    if (expSlider) expSlider.value = this.exposure;
    if (expVal) expVal.textContent = this.exposure.toFixed(1);
    this.savePreferences();
  }

  setGamma(val) {
    this.gamma = Math.max(0.01, Number(val) || 1.0);
    this.render();
    if (this.scopes.enabled) this.renderScopes();
    const gammaSlider = document.getElementById('viewer-gamma-slider');
    const gammaVal = document.getElementById('viewer-gamma-val');
    if (gammaSlider) gammaSlider.value = this.gamma;
    if (gammaVal) gammaVal.textContent = this.gamma.toFixed(2);
    this.savePreferences();
  }

  resetColorPipeline() {
    this.resetColorControls();
  }

  clearROI() {
    this.overlay.clearROI();
    const clearBtn = document.getElementById('btn-viewer-roi-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    this.render();
  }

  updateLUTStatus() {
    const badge = document.getElementById('viewer-lut-status');
    if (badge) {
      if (this.ocioProcessEnabled) {
        badge.textContent = `OCIO: ${this.ocioDisplay.split(' ')[0]} / ${this.ocioView.split(' ')[0]}`;
        badge.classList.remove('bypass');
      } else {
        badge.textContent = 'OCIO: Bypass (Raw Linear)';
        badge.classList.add('bypass');
      }
    }
  }

  // --- Scopes ---

  toggleScopes(forceState) {
    this.scopes.enabled = (forceState !== undefined) ? !!forceState : !this.scopes.enabled;
    const overlay = document.getElementById('viewer-scopes-overlay');
    if (overlay) {
      overlay.style.display = this.scopes.enabled ? 'block' : 'none';
    }
    if (this.scopes.enabled) {
      this.renderScopes();
    }
    this.savePreferences();
  }

  setScopeType(type) {
    this.scopes.setScopeType(type);
    const title = (typeof document !== 'undefined' && typeof document.querySelector === 'function') ? document.querySelector('.scopes-title') : null;
    if (title) {
      const names = { waveform: 'Waveform', parade: 'RGB Parade', histogram: 'Histogram', vectorscope: 'Vectorscope', pixel_analyzer: 'Pixel Analyzer' };
      title.textContent = `📊 Image Scope: ${names[type] || type.toUpperCase()}`;
    }
    if (this.scopes.enabled) {
      this.renderScopes();
    }
    this.savePreferences();
  }

  resizeScopes(width, height) {
    if (this.scopes && typeof this.scopes.resize === 'function') {
      this.scopes.resize(width, height);
    }
  }

  renderScopes() {
    if (!this.scopes.enabled) return;
    const buf = this.getBufferForViewport(this.activeViewportIdx) || this.currentBuffer;
    if (!buf) return;
    const roi = this.overlay.roi.enabled ? this.overlay.roi : null;
    this.scopes.render(buf, roi);
  }

  // --- Viewport Bounds Mapping ---

  getViewportBounds(idx, totalW, totalH) {
    if (this.layoutMode === 'dual' || this.layoutMode === 'dual_h') {
      const halfW = Math.floor(totalW * 0.5);
      const slotA = this.viewports[0]?.slot || this.sourceA || '1';
      const slotB = this.viewports[1]?.slot || this.sourceB || '2';
      if (idx === 0) return { x: 0, y: 0, w: halfW, h: totalH, title: `A: Slot ${slotA}` };
      return { x: halfW, y: 0, w: totalW - halfW, h: totalH, title: `B: Slot ${slotB}` };
    }

    if (this.layoutMode === 'dual_v') {
      const halfH = Math.floor(totalH * 0.5);
      const slotA = this.viewports[0]?.slot || this.sourceA || '1';
      const slotB = this.viewports[1]?.slot || this.sourceB || '2';
      if (idx === 0) return { x: 0, y: 0, w: totalW, h: halfH, title: `A: Slot ${slotA}` };
      return { x: 0, y: halfH, w: totalW, h: totalH - halfH, title: `B: Slot ${slotB}` };
    }

    if (this.layoutMode === 'quad') {
      const halfW = Math.floor(totalW * 0.5);
      const halfH = Math.floor(totalH * 0.5);
      const s1 = this.viewports[0]?.slot || '1';
      const s2 = this.viewports[1]?.slot || '2';
      const s3 = this.viewports[2]?.slot || '3';
      const s4 = this.viewports[3]?.slot || '4';
      switch (idx) {
        case 0: return { x: 0, y: 0, w: halfW, h: halfH, title: `Slot ${s1}` };
        case 1: return { x: halfW, y: 0, w: totalW - halfW, h: halfH, title: `Slot ${s2}` };
        case 2: return { x: 0, y: halfH, w: halfW, h: totalH - halfH, title: `Slot ${s3}` };
        case 3:
        default: return { x: halfW, y: halfH, w: totalW - halfW, h: totalH - halfH, title: `Slot ${s4}` };
      }
    }

    const activeSlot = this.viewports[0]?.slot || '1';
    return { x: 0, y: 0, w: totalW, h: totalH, title: `Slot ${activeSlot}` };
  }

  getViewportRect(idx, totalW, totalH) {
    const b = this.getViewportBounds(idx, totalW, totalH);
    return { x: b.x, y: b.y, width: b.w, height: b.h };
  }

  samplePixel(imgX, imgY, buffer = null) {
    const buf = buffer || this.currentBuffer;
    if (!buf || imgX < 0 || imgX >= buf.width || imgY < 0 || imgY >= buf.height) return null;
    const [rLin, gLin, bLin, aLin] = buf.getPixel(imgX, imgY);
    const expMult = Math.pow(2.0, this.exposure);
    const invGamma = 1.0 / Math.max(0.001, this.gamma);
    const dR = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, rLin * expMult), invGamma) * 255)));
    const dG = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, gLin * expMult), invGamma) * 255)));
    const dB = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, bLin * expMult), invGamma) * 255)));
    const hex = `#${((1 << 24) + (dR << 16) + (dG << 8) + dB).toString(16).slice(1)}`;
    return {
      linear: { r: rLin, g: gLin, b: bLin, a: aLin },
      display: { r: dR, g: dG, b: dB },
      hex
    };
  }

  getViewportAtPoint(clientX, clientY) {
    if (!this.canvas) return 0;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (this.layoutMode === 'dual' || this.layoutMode === 'dual_h') {
      return (x < this.canvas.width * 0.5) ? 0 : 1;
    }
    if (this.layoutMode === 'dual_v') {
      return (y < this.canvas.height * 0.5) ? 0 : 1;
    }
    if (this.layoutMode === 'quad') {
      const isLeft = x < this.canvas.width * 0.5;
      const isTop = y < this.canvas.height * 0.5;
      if (isTop) return isLeft ? 0 : 1;
      return isLeft ? 2 : 3;
    }
    return 0;
  }

  // --- Navigation & Viewport Controls ---

  fitToView() {
    if (!this.canvas) return;
    const count = (this.layoutMode === 'quad') ? 4 : (this.layoutMode === 'dual' || this.layoutMode === 'dual_h' || this.layoutMode === 'dual_v') ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const bounds = this.getViewportBounds(i, this.canvas.width, this.canvas.height);
      const buf = this.getBufferForViewport(i);
      if (!buf) continue;

      const padding = 20;
      const availW = bounds.w - padding * 2;
      const availH = bounds.h - padding * 2;
      const scaleW = availW / buf.width;
      const scaleH = availH / buf.height;
      const fitZoom = Math.min(scaleW, scaleH);

      this.viewports[i].zoom = fitZoom;
      this.viewports[i].panX = (bounds.w - buf.width * fitZoom) * 0.5;
      this.viewports[i].panY = (bounds.h - buf.height * fitZoom) * 0.5;
    }

    this.zoom = this.viewports[0].zoom;
    this.panX = this.viewports[0].panX;
    this.panY = this.viewports[0].panY;

    this.render();
    this.updateZoomDisplay();
  }

  actualSize() {
    if (!this.canvas) return;
    const count = (this.layoutMode === 'quad') ? 4 : (this.layoutMode === 'dual' || this.layoutMode === 'dual_h' || this.layoutMode === 'dual_v') ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const bounds = this.getViewportBounds(i, this.canvas.width, this.canvas.height);
      const buf = this.getBufferForViewport(i);
      this.viewports[i].zoom = 1.0;
      if (buf) {
        this.viewports[i].panX = (bounds.w - buf.width) * 0.5;
        this.viewports[i].panY = (bounds.h - buf.height) * 0.5;
      } else {
        this.viewports[i].panX = 0;
        this.viewports[i].panY = 0;
      }
    }

    this.zoom = 1.0;
    this.panX = this.viewports[0].panX;
    this.panY = this.viewports[0].panY;

    this.render();
    this.updateZoomDisplay();
  }

  resetView() {
    this.actualSize();
  }

  setZoomPreset(ratio) {
    if (!this.canvas || typeof ratio !== 'number' || ratio <= 0) return;
    const targetZoom = Math.max(0.05, Math.min(32.0, ratio));
    const count = (this.layoutMode === 'quad') ? 4 : (this.layoutMode === 'dual' || this.layoutMode === 'dual_h' || this.layoutMode === 'dual_v') ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const bounds = this.getViewportBounds(i, this.canvas.width, this.canvas.height);
      const buf = this.getBufferForViewport(i);
      this.viewports[i].zoom = targetZoom;
      if (buf) {
        this.viewports[i].panX = (bounds.w - buf.width * targetZoom) * 0.5;
        this.viewports[i].panY = (bounds.h - buf.height * targetZoom) * 0.5;
      }
    }

    this.zoom = targetZoom;
    this.panX = this.viewports[0].panX;
    this.panY = this.viewports[0].panY;

    this.render();
    this.updateZoomDisplay();
  }

  resetViewerLayout() {
    this.layoutMode = 'single';
    this.syncZoomPan = true;
    this.activeViewportIdx = 0;
    this.overlay.clearROI();
    this.overlay.clearPinnedSample();
    this.setToolMode('nav');
    this.actualSize();

    const layoutSel = document.getElementById('viewer-layout-select');
    if (layoutSel) layoutSel.value = 'single';

    if (this.activeViewerNode) {
      this.activeViewerNode.setKnobValue('layoutMode', 'single');
    }
    this.savePreferences();
  }

  updateZoomDisplay() {
    const zoomLabel = document.getElementById('viewer-zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  getBufferForViewport(idx) {
    if (this.layoutMode === 'dual' || this.layoutMode === 'dual_h' || this.layoutMode === 'dual_v') {
      if (idx === 0) return this.multiBuffers[this.sourceA] || this.currentBuffer;
      return this.multiBuffers[this.sourceB] || null;
    }
    if (this.layoutMode === 'quad') {
      const slot = this.viewports[idx]?.slot || String(idx + 1);
      return this.multiBuffers[slot] || (idx === 0 ? this.currentBuffer : null);
    }
    return this.multiBuffers[this.viewports[0]?.slot] || this.currentBuffer;
  }

  savePreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const prefs = {
        viewMode: this.viewMode,
        layoutMode: this.layoutMode,
        syncZoomPan: this.syncZoomPan,
        channelMode: this.channelMode,
        exposure: this.exposure,
        gamma: this.gamma,
        ocioProcessEnabled: this.ocioProcessEnabled,
        ocioDisplay: this.ocioDisplay,
        ocioView: this.ocioView,
        scopeType: this.scopes?.scopeType || 'waveform',
        scopesEnabled: this.scopes?.enabled || false,
        guideMode: this.overlay?.guideMode || 'none',
        deepDisplayMode: this.deepDisplayMode,
        stereoMode: this.stereoMode,
        activeAOV: this.activeAOV
      };
      localStorage.setItem('opencomp_viewer_preferences_v1', JSON.stringify(prefs));
    } catch (e) { }
  }

  loadPreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem('opencomp_viewer_preferences_v1');
      if (!saved) return;
      const prefs = JSON.parse(saved);
      if (prefs.viewMode) this.viewMode = prefs.viewMode;
      if (prefs.layoutMode) this.layoutMode = prefs.layoutMode;
      if (prefs.syncZoomPan !== undefined) this.syncZoomPan = prefs.syncZoomPan;
      if (prefs.channelMode) this.channelMode = prefs.channelMode;
      if (typeof prefs.exposure === 'number') this.exposure = prefs.exposure;
      if (typeof prefs.gamma === 'number') this.gamma = prefs.gamma;
      if (prefs.ocioProcessEnabled !== undefined) this.ocioProcessEnabled = prefs.ocioProcessEnabled;
      if (prefs.ocioDisplay) this.ocioDisplay = prefs.ocioDisplay;
      if (prefs.ocioView) this.ocioView = prefs.ocioView;
      if (prefs.scopeType && this.scopes) this.scopes.scopeType = prefs.scopeType;
      if (prefs.scopesEnabled && this.scopes) this.scopes.enabled = prefs.scopesEnabled;
      if (prefs.guideMode && this.overlay) this.overlay.setGuideMode(prefs.guideMode);
      if (prefs.deepDisplayMode) this.deepDisplayMode = prefs.deepDisplayMode;
      if (prefs.stereoMode) this.stereoMode = prefs.stereoMode;
      if (prefs.activeAOV) this.activeAOV = prefs.activeAOV;
    } catch (e) { }
  }

  // --- Event Handling ---

  initEvents() {
    const c = this.canvas;
    if (!c) return;

    // Mouse Wheel Zoom
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.viewMode === '3D' && this.viewer3D) {
        if (this.viewer3D.onWheel(e)) {
          this.viewer3D.render();
          return;
        }
      }
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const targetVpIdx = this.getViewportAtPoint(e.clientX, e.clientY);
      const bounds = this.getViewportBounds(targetVpIdx, c.width, c.height);
      const vpMouseX = mouseX - bounds.x;
      const vpMouseY = mouseY - bounds.y;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const currentZoom = this.viewports[targetVpIdx].zoom;
      const newZoom = Math.max(0.05, Math.min(20.0, currentZoom * zoomFactor));

      const newPanX = vpMouseX - (vpMouseX - this.viewports[targetVpIdx].panX) * (newZoom / currentZoom);
      const newPanY = vpMouseY - (vpMouseY - this.viewports[targetVpIdx].panY) * (newZoom / currentZoom);

      if (this.syncZoomPan) {
        for (const vp of this.viewports) {
          vp.zoom = newZoom;
          vp.panX = newPanX;
          vp.panY = newPanY;
        }
        this.zoom = newZoom;
        this.panX = newPanX;
        this.panY = newPanY;
      } else {
        this.viewports[targetVpIdx].zoom = newZoom;
        this.viewports[targetVpIdx].panX = newPanX;
        this.viewports[targetVpIdx].panY = newPanY;
        if (targetVpIdx === 0) {
          this.zoom = newZoom;
          this.panX = newPanX;
          this.panY = newPanY;
        }
      }

      this.render();
      this.updateZoomDisplay();
    }, { passive: false });

    // Mouse Down (Pan, ROI, Pinned Sample, Wipe Drag, Department Tools)
    c.addEventListener('mousedown', (e) => {
      if (this.viewMode === '3D' && this.viewer3D) {
        if (this.viewer3D.onMouseDown(e)) {
          this.viewer3D.render();
          return;
        }
      }
      const targetVpIdx = this.getViewportAtPoint(e.clientX, e.clientY);
      const prevVpIdx = this.activeViewportIdx;
      this.activeViewportIdx = targetVpIdx;
      this.updateSlotUI();
      if (prevVpIdx !== targetVpIdx && this.layoutMode !== 'single') {
        this.render();
        if (this.scopes.enabled) this.renderScopes();
      }
      const bounds = this.getViewportBounds(targetVpIdx, c.width, c.height);
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - bounds.x;
      const mouseY = e.clientY - rect.top - bounds.y;
      const vp = this.viewports[targetVpIdx];

      const imgCoords = this.overlay.screenToImage(mouseX, mouseY, vp.zoom, vp.panX, vp.panY);

      // 1. Pan (Middle click or Space/Alt + Left Click, unless picking clone source)
      const isClonePick = this.departmentHandler && (this.departmentHandler.isPickingCloneSource || (this.departmentHandler.activeTool === 'clone' && e.altKey));
      if (e.button === 1 || (e.button === 0 && (e.spaceKey || (e.altKey && !isClonePick)))) {
        this.isPanning = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        c.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // 2. Pixel Sampler Tool (Click to pin sample point)
      if (e.button === 0 && this.toolMode === 'sample') {
        const buf = this.getBufferForViewport(targetVpIdx);
        if (buf && imgCoords.x >= 0 && imgCoords.x < buf.width && imgCoords.y >= 0 && imgCoords.y < buf.height) {
          this.overlay.setPinnedSample(imgCoords.x, imgCoords.y);
          this.render();
          this.updatePixelInspector(e);
        }
        return;
      }

      // 3. ROI Tool (Drag to define or resize ROI)
      if (e.button === 0 && this.toolMode === 'roi') {
        this.isDrawingROI = true;
        this.roiStartPos = { ...imgCoords };
        this.overlay.setROI(imgCoords.x, imgCoords.y, 1, 1);
        this.render();
        return;
      }

      // 4. Department Handlers (Roto / Paint)
      if (e.button === 0 && this.departmentHandler && this.departmentHandler.onMouseDown) {
        if (this.departmentHandler.onMouseDown(e, imgCoords.x, imgCoords.y)) {
          e.preventDefault();
          this.render();
          return;
        }
      }

      // 5. Interactive Wipe Handles (Horizontal / Vertical)
      if (e.button === 0 && this.activeViewerNode && this.layoutMode === 'single') {
        const compareMode = this.activeViewerNode.getKnobValue('compareMode');
        const buf = this.currentBuffer;
        if (buf) {
          const wipePos = Number(this.activeViewerNode.getKnobValue('wipePosition')) ?? 0.5;
          if (compareMode === 'wipe_h') {
            const wipeX = buf.width * wipePos;
            if (Math.abs(imgCoords.x - wipeX) < 16 / vp.zoom) {
              this.isDraggingWipe = true;
              this.dragWipeOrientation = 'horizontal';
              e.preventDefault();
            }
          } else if (compareMode === 'wipe_v') {
            const wipeY = buf.height * wipePos;
            if (Math.abs(imgCoords.y - wipeY) < 16 / vp.zoom) {
              this.isDraggingWipe = true;
              this.dragWipeOrientation = 'vertical';
              e.preventDefault();
            }
          }
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.viewMode === '3D' && this.viewer3D) {
        if (this.viewer3D.onMouseMove(e)) {
          this.viewer3D.render();
          return;
        }
      }
      // 1. Panning
      if (this.isPanning) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;

        if (this.syncZoomPan) {
          for (const vp of this.viewports) {
            vp.panX += dx;
            vp.panY += dy;
          }
          this.panX += dx;
          this.panY += dy;
        } else {
          this.viewports[this.activeViewportIdx].panX += dx;
          this.viewports[this.activeViewportIdx].panY += dy;
          if (this.activeViewportIdx === 0) {
            this.panX += dx;
            this.panY += dy;
          }
        }

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.render();
        return;
      }

      // 2. Dragging ROI
      if (this.isDrawingROI && this.roiStartPos) {
        const targetVp = this.viewports[this.activeViewportIdx];
        const bounds = this.getViewportBounds(this.activeViewportIdx, c.width, c.height);
        const rect = c.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - bounds.x;
        const mouseY = e.clientY - rect.top - bounds.y;
        const currentImgPos = this.overlay.screenToImage(mouseX, mouseY, targetVp.zoom, targetVp.panX, targetVp.panY);

        const x1 = Math.min(this.roiStartPos.x, currentImgPos.x);
        const y1 = Math.min(this.roiStartPos.y, currentImgPos.y);
        const x2 = Math.max(this.roiStartPos.x, currentImgPos.x);
        const y2 = Math.max(this.roiStartPos.y, currentImgPos.y);

        const buf = this.getBufferForViewport(this.activeViewportIdx);
        const maxW = buf ? buf.width : 4096;
        const maxH = buf ? buf.height : 4096;

        this.overlay.setROI(
          Math.max(0, x1),
          Math.max(0, y1),
          Math.min(maxW - Math.max(0, x1), x2 - x1),
          Math.min(maxH - Math.max(0, y1), y2 - y1)
        );

        this.render();
        if (this.scopes.enabled) this.renderScopes();
        return;
      }

      // 3. Dragging Wipe Handle
      if (this.isDraggingWipe && this.activeViewerNode && this.currentBuffer) {
        const vp = this.viewports[0];
        const rect = c.getBoundingClientRect();
        const imgCoords = this.overlay.screenToImage(e.clientX - rect.left, e.clientY - rect.top, vp.zoom, vp.panX, vp.panY);

        if (this.dragWipeOrientation === 'vertical') {
          const newPos = Math.max(0.0, Math.min(1.0, imgCoords.y / this.currentBuffer.height));
          this.activeViewerNode.setKnobValue('wipePosition', newPos);
        } else {
          const newPos = Math.max(0.0, Math.min(1.0, imgCoords.x / this.currentBuffer.width));
          this.activeViewerNode.setKnobValue('wipePosition', newPos);
        }

        if (this.onViewerUpdate) this.onViewerUpdate();
        return;
      }

      // 4. Department mouse move
      if (this.departmentHandler && this.departmentHandler.onMouseMove) {
        const vp = this.viewports[this.activeViewportIdx];
        const bounds = this.getViewportBounds(this.activeViewportIdx, c.width, c.height);
        const rect = c.getBoundingClientRect();
        const imgCoords = this.overlay.screenToImage(e.clientX - rect.left - bounds.x, e.clientY - rect.top - bounds.y, vp.zoom, vp.panX, vp.panY);
        this.departmentHandler.onMouseMove(e, imgCoords.x, imgCoords.y);
      }

      // 4.1 Cursor feedback for interactive wipe
      if (!this.isPanning && !this.isDrawingROI && !this.isDraggingWipe && this.activeViewerNode && this.layoutMode === 'single') {
        const compareMode = this.activeViewerNode.getKnobValue('compareMode');
        const buf = this.currentBuffer;
        if (buf && (compareMode === 'wipe_h' || compareMode === 'wipe_v')) {
          const vp = this.viewports[0];
          const bounds = this.getViewportBounds(0, c.width, c.height);
          const rect = c.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - bounds.x;
          const mouseY = e.clientY - rect.top - bounds.y;
          const imgCoords = this.overlay.screenToImage(mouseX, mouseY, vp.zoom, vp.panX, vp.panY);
          const wipePos = Number(this.activeViewerNode.getKnobValue('wipePosition')) ?? 0.5;

          if (compareMode === 'wipe_h') {
            const wipeX = buf.width * wipePos;
            if (Math.abs(imgCoords.x - wipeX) < 16 / vp.zoom) {
              c.style.cursor = 'col-resize';
            } else if (this.toolMode === 'nav') {
              c.style.cursor = 'default';
            }
          } else if (compareMode === 'wipe_v') {
            const wipeY = buf.height * wipePos;
            if (Math.abs(imgCoords.y - wipeY) < 16 / vp.zoom) {
              c.style.cursor = 'row-resize';
            } else if (this.toolMode === 'nav') {
              c.style.cursor = 'default';
            }
          }
        }
      }

      // 5. Update Pixel Inspector
      this.updatePixelInspector(e);
      if (this.viewports[this.activeViewportIdx]?.zoom >= 8.0) {
        this.render();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.viewMode === '3D' && this.viewer3D) {
        if (this.viewer3D.onMouseUp(e)) {
          this.viewer3D.render();
        }
      }
      this.isPanning = false;
      this.isDraggingWipe = false;
      this.isDrawingROI = false;
      this.roiStartPos = null;

      if (this.departmentHandler && this.departmentHandler.onMouseUp) {
        const vp = this.viewports[this.activeViewportIdx];
        const bounds = this.getViewportBounds(this.activeViewportIdx, c.width, c.height);
        const rect = c.getBoundingClientRect();
        const imgCoords = this.overlay.screenToImage(e.clientX - rect.left - bounds.x, e.clientY - rect.top - bounds.y, vp.zoom, vp.panX, vp.panY);
        this.departmentHandler.onMouseUp(e, imgCoords.x, imgCoords.y);
      }

      c.style.cursor = (this.toolMode === 'roi' || this.toolMode === 'sample') ? 'crosshair' : 'default';
    });

    // Keyboard Shortcuts (Nuke-style viewport navigation & controls)
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

      // Tab toggles 2D / 3D Viewer mode (Nuke standard)
      if (e.key === 'Tab') {
        e.preventDefault();
        this.toggleViewMode();
        return;
      }

      if (this.viewMode === '3D' && this.viewer3D) {
        if (this.viewer3D.onKeyDown(e)) {
          e.preventDefault();
          this.viewer3D.render();
          return;
        }
      }

      // Allow active department handler (Roto, Paint, Keyer) to handle shortcuts first
      if (this.departmentHandler && typeof this.departmentHandler.onKeyDown === 'function') {
        if (this.departmentHandler.onKeyDown(e)) {
          e.preventDefault();
          this.render();
          return;
        }
      }

      if (e.key === 'f' || e.key === 'F') {
        this.fitToView();
      } else if (e.key === 'h' || e.key === 'H') {
        this.actualSize();
      } else if (e.key === 'Home') {
        this.resetView();
      } else if (e.key === 'l' || e.key === 'L') {
        if (e.shiftKey || e.altKey || this.stereoMode !== 'none') {
          this.setStereoMode(this.stereoMode === 'left' ? 'none' : 'left');
        }
      } else if (e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        this.setStereoMode(this.stereoMode === 'right' ? 'none' : 'right');
      } else if (e.key === 'r' || e.key === 'R') {
        this.setChannelMode('RED');
      } else if (e.key === 'g' || e.key === 'G') {
        this.setChannelMode('GREEN');
      } else if (e.key === 'b' || e.key === 'B') {
        this.setChannelMode('BLUE');
      } else if (e.key === 'a' || e.key === 'A') {
        this.setChannelMode('ALPHA');
      } else if (e.key === 'y' || e.key === 'Y') {
        this.setChannelMode('LUMA');
      } else if (e.key === 'c' || e.key === 'C') {
        this.setChannelMode(this.channelMode === 'RGB' ? 'RGBA' : 'RGB');
      } else if (e.key === '~' || e.key === '`') {
        this.setChannelMode('RGBA');
      } else if (e.key === 'w' || e.key === 'W') {
        if (this.activeViewerNode) {
          const cur = this.activeViewerNode.getKnobValue('compareMode');
          const next = cur === 'wipe_h' ? 'single' : 'wipe_h';
          this.activeViewerNode.setKnobValue('compareMode', next);
          if (this.onViewerUpdate) this.onViewerUpdate();
          this.render();
        }
      } else if (e.key === 's' || e.key === 'S') {
        this.toggleScopes();
      } else if (e.key >= '1' && e.key <= '9') {
        this.setActiveInput(e.key);
      } else if (e.key === '0') {
        this.setActiveInput('10');
      }
    });

    // WebGL Context Loss / Restoration
    this.isContextLost = false;
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('OpenComp Viewer: WebGL context lost. Gracefully falling back to CPU Float32 pipeline.');
      this.handleContextLost();
    });

    c.addEventListener('webglcontextrestored', () => {
      console.log('OpenComp Viewer: WebGL context restored.');
      this.handleContextRestored();
      this.render();
    });

    // Window Resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
    this.resizeCanvas();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    this.canvas.width = parent ? (parent.clientWidth || 800) : (this.canvas.clientWidth || 800);
    this.canvas.height = parent ? (parent.clientHeight || 500) : (this.canvas.clientHeight || 500);
    this.render();
  }

  handleContextLost() {
    this.isContextLost = true;
    this.glPipeline = null;
  }

  handleContextRestored() {
    this.isContextLost = false;
    try {
      this.glPipeline = new GLPipeline();
    } catch (err) {
      this.glPipeline = null;
    }
  }

  // --- Pixel Inspector & Sampler ---

  updatePixelInspector(e) {
    if (!this.infoBar || !this.canvas) return;
    const vpIdx = this.getViewportAtPoint(e.clientX, e.clientY);
    const bounds = this.getViewportBounds(vpIdx, this.canvas.width, this.canvas.height);
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - bounds.x;
    const mouseY = e.clientY - rect.top - bounds.y;
    const vp = this.viewports[vpIdx];
    const buf = this.getBufferForViewport(vpIdx);

    const imgX = Math.floor((mouseX - vp.panX) / vp.zoom);
    const imgY = Math.floor((mouseY - vp.panY) / vp.zoom);
    this.hoveredImgX = imgX;
    this.hoveredImgY = imgY;

    if (buf && imgX >= 0 && imgX < buf.width && imgY >= 0 && imgY < buf.height) {
      const [rLin, gLin, bLin, aLin] = buf.getPixel(imgX, imgY);

      // Deep buffer inspection
      let deepInfoTag = '';
      if (this.isDeep && this.activeDeepBuffer) {
        const count = this.activeDeepBuffer.getSampleCount(imgX, imgY);
        const samples = this.activeDeepBuffer.getSamples(imgX, imgY);
        deepInfoTag = ` | <span style="color:#f59e0b; font-weight:bold;">Samples: ${count}</span>`;
        if (samples.length > 0) {
          const zF = samples[0].zFront;
          const zB = samples[samples.length - 1].zBack;
          deepInfoTag += ` | <span style="color:#a78bfa;">Z: [${zF.toFixed(2)} - ${zB.toFixed(2)}]</span>`;
        }
        if (typeof this.onDeepSampleInspect === 'function') {
          this.onDeepSampleInspect(imgX, imgY, samples, this.activeDeepBuffer);
        }
      }

      // Auxiliary Depth.Z inspection
      let auxDepthTag = '';
      if (buf.hasChannel && buf.hasChannel('depth.Z')) {
        const zArr = buf.getChannel('depth.Z');
        if (zArr) {
          const zVal = zArr[imgY * buf.width + imgX];
          auxDepthTag = ` | <span style="color:#38bdf8;">depth.Z: <b>${zVal.toFixed(3)}</b></span>`;
        }
      }

      // Display 8-bit calculation
      const expMult = Math.pow(2.0, this.exposure);
      const invGamma = 1.0 / Math.max(0.001, this.gamma);
      const dR = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, rLin * expMult), invGamma) * 255)));
      const dG = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, gLin * expMult), invGamma) * 255)));
      const dB = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, bLin * expMult), invGamma) * 255)));
      const hex = `#${((1 << 24) + (dR << 16) + (dG << 8) + dB).toString(16).slice(1)}`;

      let pinnedHtml = '';
      if (this.overlay.pinnedSample.pinned) {
        const px = this.overlay.pinnedSample.x;
        const py = this.overlay.pinnedSample.y;
        if (px >= 0 && px < buf.width && py >= 0 && py < buf.height) {
          const [pr, pg, pb] = buf.getPixel(px, py);
          pinnedHtml = `<span class="info-pinned" style="color:#f97316; margin-left:8px;">📌 [${px},${py}]: R:${pr.toFixed(3)} G:${pg.toFixed(3)} B:${pb.toFixed(3)}</span>`;
        }
      }

      const activeSlot = vp.slot || String(vpIdx + 1);
      const slotTag = this.layoutMode !== 'single' ? `<span style="color:#ff922b; margin-right:8px;">[View ${vpIdx + 1}: Slot ${activeSlot}]</span>` : '';
      const colorTag = `<span style="color:#888; font-size:10px; margin-left:6px;">(${this.ocioProcessEnabled ? this.ocioDisplay.split(' ')[0] : 'RAW'})</span>`;

      this.infoBar.innerHTML = `
        ${slotTag}
        <span class="info-coord">X: <b>${imgX}</b> Y: <b>${imgY}</b></span>
        <span class="info-color">
          <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${hex}; margin-right:4px; vertical-align:middle; border:1px solid #555;"></span>
          <span style="color:#ff6b6b">R: <b>${rLin.toFixed(4)}</b></span>
          <span style="color:#51cf66">G: <b>${gLin.toFixed(4)}</b></span>
          <span style="color:#339af0">B: <b>${bLin.toFixed(4)}</b></span>
          <span style="color:#ced4da">A: <b>${aLin.toFixed(4)}</b></span>
          <span style="color:#888; font-size:10px; margin-left:4px;">(Disp: ${dR},${dG},${dB})</span>
          ${colorTag}
        </span>
        ${deepInfoTag}
        ${auxDepthTag}
        ${pinnedHtml}
        <span class="info-res">${buf.width} x ${buf.height} (${this.isDeep ? 'Deep Multi-Sample' : '32-bit Float Linear'})</span>
      `;
    } else if (buf) {
      this.hoveredImgX = -1;
      this.hoveredImgY = -1;
      this.infoBar.innerHTML = `
        <span class="info-res">${buf.width} x ${buf.height} (32-bit Float Linear)</span>
      `;
    } else {
      this.hoveredImgX = -1;
      this.hoveredImgY = -1;
      this.infoBar.innerHTML = `<span class="info-res">No Active Image Buffer</span>`;
    }
  }

  // --- Rendering Pipeline ---

  render() {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;

    if (this.viewMode === '3D') {
      if (this.viewer3D) {
        this.viewer3D.render();
      }
      return;
    }

    ctx.fillStyle = '#18191c';
    ctx.fillRect(0, 0, c.width, c.height);

    const vpCount = (this.layoutMode === 'quad') ? 4 : (this.layoutMode === 'dual' || this.layoutMode === 'dual_h' || this.layoutMode === 'dual_v') ? 2 : 1;

    for (let i = 0; i < vpCount; i++) {
      const bounds = this.getViewportBounds(i, c.width, c.height);
      const vp = this.viewports[i];
      let buf = this.getBufferForViewport(i);

      // Stereoscopic 3D compositing in Single View mode
      if (this.stereoMode !== 'none' && this.layoutMode === 'single') {
        const leftBuf = this.multiBuffers['1'] || this.multiBuffers[this.sourceA] || this.currentBuffer;
        const rightBuf = this.multiBuffers['2'] || this.multiBuffers[this.sourceB] || leftBuf;
        if (leftBuf && rightBuf) {
          const stereoWipePos = (this.activeViewerNode && this.layoutMode === 'single')
            ? (Number(this.activeViewerNode.getKnobValue('wipePosition')) ?? 0.5)
            : 0.5;
          if (this.stereoMode === 'anaglyph') buf = StereoEngine.compositeAnaglyph(leftBuf, rightBuf);
          else if (this.stereoMode === 'side_by_side') buf = StereoEngine.compositeSideBySide(leftBuf, rightBuf);
          else if (this.stereoMode === 'wipe') buf = StereoEngine.compositeWipe(leftBuf, rightBuf, stereoWipePos);
          else if (this.stereoMode === 'difference') buf = StereoEngine.compositeDifference(leftBuf, rightBuf);
          else if (this.stereoMode === 'left') buf = leftBuf;
          else if (this.stereoMode === 'right') buf = rightBuf;
        }
      }

      ctx.save();
      // Clip to viewport sub-region
      ctx.beginPath();
      ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
      ctx.clip();

      if (buf) {
        this.renderViewportImage(ctx, buf, bounds, vp);
        // Overlays only on active viewport or single view
        if (i === this.activeViewportIdx || this.layoutMode === 'single') {
          const wipeMode = (this.activeViewerNode && this.layoutMode === 'single') ? this.activeViewerNode.getKnobValue('compareMode') : null;
          const wipePosition = this.activeViewerNode ? Number(this.activeViewerNode.getKnobValue('wipePosition')) : 0.5;
          this.overlay.renderOverlays(ctx, buf.width, buf.height, vp.zoom, bounds.x + vp.panX, bounds.y + vp.panY, {
            wipeMode,
            wipePosition,
            hoveredPixel: (this.hoveredImgX >= 0 && this.hoveredImgY >= 0) ? { x: this.hoveredImgX, y: this.hoveredImgY } : null,
            buffer: buf
          });
        }
      } else {
        // Disconnected slot placeholder
        ctx.fillStyle = '#555';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${bounds.title} (Disconnected)`, bounds.x + bounds.w * 0.5, bounds.y + bounds.h * 0.5);
      }

      // Viewport Sub-header Badge in Multi-Viewer modes
      if (this.layoutMode !== 'single') {
        ctx.fillStyle = (i === this.activeViewportIdx) ? '#ff922b' : '#333';
        ctx.fillRect(bounds.x + 8, bounds.y + 8, 80, 20);
        ctx.fillStyle = (i === this.activeViewportIdx) ? '#111' : '#ccc';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(bounds.title, bounds.x + 48, bounds.y + 22);

        // Active border outline
        if (i === this.activeViewportIdx) {
          ctx.strokeStyle = '#ff922b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.w - 1, bounds.h - 1);
        }
      }

      ctx.restore();
    }

    // Comparison Mode HUD tag in Single View
    if (this.activeViewerNode && this.layoutMode === 'single') {
      const cmp = this.activeViewerNode.getKnobValue('compareMode');
      if (cmp && cmp !== 'single') {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(10, 10, 220, 24);
        ctx.strokeStyle = '#ff922b';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, 10, 220, 24);
        ctx.fillStyle = '#ff922b';
        ctx.font = 'bold 10px monospace';
        const cmpLabels = {
          wipe_h: 'A/B HORIZONTAL WIPE',
          wipe_v: 'A/B VERTICAL WIPE',
          side_by_side: 'A/B SIDE-BY-SIDE',
          diff: `A/B DIFFERENCE (${this.activeViewerNode.getKnobValue('diffGain') || 1}x)`
        };
        ctx.fillText(cmpLabels[cmp] || cmp.toUpperCase(), 16, 26);
        ctx.restore();
      }
    }

    // Stereo Mode HUD badge in Single View
    if (this.stereoMode !== 'none' && this.layoutMode === 'single') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(10, 40, 220, 24);
      ctx.strokeStyle = '#63b3ed';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 40, 220, 24);
      ctx.fillStyle = '#63b3ed';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`🕶️ STEREO: ${this.stereoMode.toUpperCase()}`, 16, 56);
      ctx.restore();
    }

    // Deep Buffer HUD badge
    if (this.isDeep && this.layoutMode === 'single') {
      const topY = (this.stereoMode !== 'none') ? 70 : 40;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(10, topY, 220, 24);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, topY, 220, 24);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px monospace';
      const deepLabels = { flatten: 'DEEP: 2D FLATTENED', depth: 'DEEP: PRIMARY DEPTH', heatmap: 'DEEP: SAMPLE HEATMAP' };
      ctx.fillText(`🌊 ${deepLabels[this.deepDisplayMode] || 'DEEP BUFFER'}`, 16, topY + 16);
      ctx.restore();
    }

    // Active AOV HUD badge
    if (this.activeAOV && this.layoutMode === 'single') {
      const topY = (this.stereoMode !== 'none' && this.isDeep) ? 100 : (this.stereoMode !== 'none' || this.isDeep ? 70 : 40);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(10, topY, 220, 24);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, topY, 220, 24);
      ctx.fillStyle = '#a78bfa';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`AOV: ${this.activeAOV.toUpperCase()}`, 16, topY + 16);
      ctx.restore();
    }

    // Dividers between viewports
    if (this.layoutMode === 'dual' || this.layoutMode === 'dual_h') {
      ctx.strokeStyle = '#383b42';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.width * 0.5, 0);
      ctx.lineTo(c.width * 0.5, c.height);
      ctx.stroke();
    } else if (this.layoutMode === 'dual_v') {
      ctx.strokeStyle = '#383b42';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, c.height * 0.5);
      ctx.lineTo(c.width, c.height * 0.5);
      ctx.stroke();
    } else if (this.layoutMode === 'quad') {
      ctx.strokeStyle = '#383b42';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.width * 0.5, 0);
      ctx.lineTo(c.width * 0.5, c.height);
      ctx.moveTo(0, c.height * 0.5);
      ctx.lineTo(c.width, c.height * 0.5);
      ctx.stroke();
    }

    // External department overlay hook
    const activeVp = this.viewports[this.activeViewportIdx];
    const bounds = this.getViewportBounds(this.activeViewportIdx, c.width, c.height);
    if (this.onDrawOverlay) {
      this.onDrawOverlay(ctx, activeVp.zoom, bounds.x + activeVp.panX, bounds.y + activeVp.panY);
    }
    if (this.departmentHandler && typeof this.departmentHandler.drawOverlay === 'function') {
      this.departmentHandler.drawOverlay(ctx, activeVp.zoom, bounds.x + activeVp.panX, bounds.y + activeVp.panY);
    }
  }

  renderViewportImage(ctx, buffer, bounds, vp) {
    let sourceCanvas = null;

    // 1. Deep Buffer Viewport Display
    if (buffer && (buffer.isDeep || buffer.sampleOffsets)) {
      if (!this.offlineCanvas) {
        this.offlineCanvas = document.createElement('canvas');
        this.offlineCtx = this.offlineCanvas.getContext('2d');
      }
      if (this.offlineCanvas.width !== buffer.width || this.offlineCanvas.height !== buffer.height) {
        this.offlineCanvas.width = buffer.width;
        this.offlineCanvas.height = buffer.height;
      }
      const imgData = buffer.toImageData(this.exposure, this.gamma, this.channelMode, null, this.deepDisplayMode);
      this.offlineCtx.putImageData(imgData, 0, 0);
      sourceCanvas = this.offlineCanvas;
    } else if (this.activeAOV && buffer && typeof buffer.hasChannel === 'function' && buffer.hasChannel(this.activeAOV)) {
      // 2. Auxiliary AOV Channel Isolation
      sourceCanvas = this.renderAOVChannelCanvas(buffer, this.activeAOV);
    } else {
      // 3. WebGL GPU acceleration if available
      if (this.glPipeline && this.glPipeline.isSupported) {
        try {
          sourceCanvas = this.glPipeline.renderViewer(buffer, this.exposure, this.gamma, this.channelMode);
        } catch (err) {
          sourceCanvas = null;
        }
      }

      if (!sourceCanvas) {
        // CPU Fallback
        if (!this.offlineCanvas) {
          this.offlineCanvas = document.createElement('canvas');
          this.offlineCtx = this.offlineCanvas.getContext('2d');
        }
        if (this.offlineCanvas.width !== buffer.width || this.offlineCanvas.height !== buffer.height) {
          this.offlineCanvas.width = buffer.width;
          this.offlineCanvas.height = buffer.height;
        }

        // Convert via non-destructive toImageData
        const imgData = buffer.toImageData(this.exposure, this.gamma, this.channelMode);
        this.offlineCtx.putImageData(imgData, 0, 0);
        sourceCanvas = this.offlineCanvas;
      }
    }

    // Draw transformed image onto viewport
    ctx.save();
    ctx.translate(bounds.x + vp.panX, bounds.y + vp.panY);
    ctx.scale(vp.zoom, vp.zoom);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();
  }
}
