/**
 * OpenComp - Main Application Orchestrator
 * Coordinates DAG graph execution, Viewer rendering, Node Graph, Properties, and Menu Actions.
 */

import { Graph } from './core/Graph.js';
import { NodeCreationService, createNode, NODE_REGISTRY, NODE_MENU } from './core/NodeRegistry.js';
import { ViewerUI } from './ui/ViewerUI.js';
import { NodeGraphUI } from './ui/NodeGraphUI.js';
import { PropertiesUI } from './ui/PropertiesUI.js';
import { TimelineUI } from './ui/TimelineUI.js';
import { CurveEditorUI } from './ui/CurveEditorUI.js';
import { DopeSheetUI } from './ui/DopeSheetUI.js';
import { SceneGraphUI } from './ui/SceneGraphUI.js';
import { ParticlesUI } from './ui/ParticlesUI.js';
import { DeepInspectorUI } from './ui/DeepInspectorUI.js';
import { MetadataUI } from './ui/MetadataUI.js';
import { StereoUI } from './ui/StereoUI.js';
import { ProductionPipelineUI } from './ui/ProductionPipelineUI.js';
import { KeyframeTrack } from './core/Animation.js';
import { NukeScriptIO } from './core/NukeScriptIO.js';
import { HistoryManager } from './core/HistoryManager.js';
import { AutosaveManager } from './core/AutosaveManager.js';
import { DockManager } from './ui/DockManager.js';
import { ShortcutManager } from './ui/ShortcutManager.js';
import { globalOCIO } from './core/OCIOManager.js';
import { ImageIO } from './core/ImageIO.js';

class OpenCompApp {
  constructor() {
    this.graph = new Graph();
    this.graph.nodeFactory = createNode;
    this.history = new HistoryManager();
    this.nodeCreationService = new NodeCreationService(this);
    this.autosaveManager = new AutosaveManager({
      getProjectData: () => this.graph.serialize()
    });

    // DOM Elements
    this.viewerCanvas = document.getElementById('viewer-canvas');
    this.viewerControls = document.getElementById('viewer-toolbar');
    this.viewerInfo = document.getElementById('viewer-info-bar');
    this.viewerScopesCanvas = document.getElementById('viewer-scopes-canvas');
    this.nodeCanvas = document.getElementById('node-graph-canvas');
    this.propertiesContainer = document.getElementById('properties-container');
    this.propertiesPanelTitle = document.getElementById('properties-panel-title');
    this.timelineContainer = document.getElementById('timeline-bar');
    this.curveCanvas = document.getElementById('curve-editor-canvas');

    // UI Modules
    this.viewerUI = new ViewerUI(this.viewerCanvas, this.viewerControls, this.viewerInfo, this.viewerScopesCanvas);
    if (this.curveCanvas) {
      this.curveEditorUI = new CurveEditorUI(this.curveCanvas, {
        onCurveChanged: () => {
          this.evaluateGraph();
        }
      });
    } else {
      this.curveEditorUI = null;
    }

    this.dopesheetWrapper = document.getElementById('dopesheet-wrapper');
    if (this.dopesheetWrapper) {
      this.dopeSheetUI = new DopeSheetUI(this.dopesheetWrapper, {
        onFrameChange: (f) => {
          if (this.timelineUI && this.timelineUI.currentFrame !== f) {
            this.timelineUI.setFrame(f);
          }
        },
        onKeyframesChanged: () => {
          this.evaluateGraph();
        }
      });
    } else {
      this.dopeSheetUI = null;
    }

    // Phase 4: Scene Graph & Particles Workspace
    this.scenegraphWrapper = document.getElementById('scenegraph-wrapper');
    if (this.scenegraphWrapper) {
      this.sceneGraphUI = new SceneGraphUI(this.scenegraphWrapper, this.graph, this.viewerUI?.viewer3D, (node) => {
        this.propertiesUI.showNode(node);
        this.nodeGraphUI.selectedNode = node;
        this.nodeGraphUI.render();
      });
    } else {
      this.sceneGraphUI = null;
    }

    this.particlesWrapper = document.getElementById('particles-wrapper');
    if (this.particlesWrapper) {
      this.particlesUI = new ParticlesUI(this.particlesWrapper, this.timelineUI);
    } else {
      this.particlesUI = null;
    }

    this.deepInspectorWrapper = document.getElementById('deepinspector-wrapper');
    if (this.deepInspectorWrapper) {
      this.deepInspectorUI = new DeepInspectorUI(this.deepInspectorWrapper, this.viewerUI);
    } else {
      this.deepInspectorUI = null;
    }

    this.metadataWrapper = document.getElementById('metadata-wrapper');
    if (this.metadataWrapper) {
      this.metadataUI = new MetadataUI(this.metadataWrapper, this.viewerUI);
    } else {
      this.metadataUI = null;
    }

    this.stereoWrapper = document.getElementById('stereo-wrapper');
    if (this.stereoWrapper) {
      this.stereoUI = new StereoUI(this.stereoWrapper, this.viewerUI, () => {
        this.evaluateGraph();
      });
    } else {
      this.stereoUI = null;
    }

    this.productionWrapper = document.getElementById('production-wrapper');
    if (this.productionWrapper) {
      this.productionUI = new ProductionPipelineUI(this.productionWrapper, {
        app: this,
        graph: this.graph,
        viewerUI: this.viewerUI,
        onUpdate: () => this.evaluateGraph()
      });
    } else {
      this.productionUI = null;
    }

    // Wire 3D viewer graph and selection
    if (this.viewerUI?.viewer3D) {
      this.viewerUI.viewer3D.setGraph(this.graph);
      this.viewerUI.on3DNodeSelect = (node) => {
        this.propertiesUI.showNode(node);
        this.nodeGraphUI.selectedNode = node;
        this.sceneGraphUI?.setSelectedNode(node);
        this.nodeGraphUI.render();
      };
      if (this.sceneGraphUI) {
        this.sceneGraphUI.setViewer3D(this.viewerUI.viewer3D);
      }
    }

    this.propertiesUI = new PropertiesUI(
      this.propertiesContainer,
      (node) => this.onNodeParamChange(node),
      (node) => this.onExportRender(node),
      this.viewerUI
    );

    this.nodeGraphUI = new NodeGraphUI(
      this.nodeCanvas,
      this.graph,
      (node) => {
        this.propertiesUI.showNode(node);
        this.updateTimelineKeyframes(node);
      },
      (node) => {
        this.propertiesUI.showNode(node);
        this.updateTimelineKeyframes(node);
      }
    );
    this.nodeGraphUI.onUndo = () => {
      if (this.history.undo(this.graph, createNode)) {
        this.nodeGraphUI.render();
        this.evaluateGraph();
      }
    };
    this.nodeGraphUI.onRedo = () => {
      if (this.history.redo(this.graph, createNode)) {
        this.nodeGraphUI.render();
        this.evaluateGraph();
      }
    };
    this.nodeGraphUI.onOpenSearchPopup = (clientPos, graphPos) => {
      this.openNodeSearchPopup(clientPos, graphPos);
    };

    this.timelineUI = new TimelineUI(
      this.timelineContainer,
      (frame) => this.onFrameChange(frame)
    );

    this.viewerUI.onViewerUpdate = () => this.evaluateGraph();

    // Wire Graph change events
    this.graph.addListener((type) => {
      if (type !== 'graphLoaded' && type !== 'graphCleared') {
        this.history.pushState(this.graph);
      }
      this.nodeGraphUI.render();
      this.evaluateGraph();
      this.sceneGraphUI?.render();
      this.update3DCameraDropdown();
    });

    // Phase 1: Initialize Professional Docking Manager & Shortcut Manager
    this.dockManager = new DockManager({
      onResize: () => {
        this.viewerUI?.resizeCanvas();
        this.nodeGraphUI?.resizeCanvas();
      }
    });

    this.dockManager.registerPanel('viewer', 'Viewer', '.viewer-panel', { closable: false });
    this.dockManager.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel', { closable: false });
    this.dockManager.registerPanel('scenegraph', 'Scene Graph', '#scenegraph-wrapper', { closable: true });
    this.dockManager.registerPanel('particles', 'Particles', '#particles-wrapper', { closable: true });
    this.dockManager.registerPanel('deepinspector', 'Deep Inspector', '#deepinspector-wrapper', { closable: true });
    this.dockManager.registerPanel('metadata', 'Metadata & AOVs', '#metadata-wrapper', { closable: true });
    this.dockManager.registerPanel('stereo', 'Stereo 3D', '#stereo-wrapper', { closable: true });
    this.dockManager.registerPanel('production', 'Production & Pipeline', '#production-wrapper', { closable: true });
    this.dockManager.registerPanel('properties', 'Properties Bin', '#properties-panel', { closable: true });
    this.dockManager.registerPanel('timeline', 'Timeline', '#timeline-bar', { closable: true });

    this.shortcutManager = new ShortcutManager(this);

    this.initToolbarEvents();
    this.initLeftToolbar();
    this.initNodesTopMenu();
    this.initNodeSearchPopup();
    this.initMenuEvents();
    this.initSplitters();
    this.initContextMenus();
    this.initPhase1MenusAndModals();
    this.initShortcutKeyHandlers();
    this.dockManager.restoreSessionLayout();

    // Load project from URL query parameter or default production VFX preset
    const urlParams = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
    const initialProject = urlParams ? urlParams.get('project') : null;
    const autoPlay = urlParams ? (urlParams.get('play') === '1' || urlParams.get('autoplay') === '1') : false;

    if (initialProject) {
      fetch(initialProject)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${initialProject}`);
          return res.json();
        })
        .then(data => {
          this.loadProjectData(data);
          this.history.pushState(this.graph);
          if (autoPlay && this.timelineUI) {
            setTimeout(() => {
              this.timelineUI.play();
            }, 300);
          }
        })
        .catch(err => {
          console.error('Failed to load initial project from URL:', err);
          this.loadPresetGreenscreen();
          this.history.pushState(this.graph);
        });
    } else {
      this.loadPresetGreenscreen();
      this.history.pushState(this.graph);
    }

    // Initialize robust Autosave and Crash Recovery Engine
    this.autosaveManager.start(this.graph);
    this.checkAutosaveRecovery();
  }

  checkAutosaveRecovery() {
    try {
      const recovery = this.autosaveManager.checkForRecovery();
      if (!recovery) return;

      let banner = document.getElementById('autosave-recovery-banner');
      if (!banner && typeof document !== 'undefined') {
        banner = document.createElement('div');
        banner.id = 'autosave-recovery-banner';
        banner.style.cssText = `
          position: fixed;
          top: 32px;
          left: 50%;
          transform: translateX(-50%);
          background: #24292e;
          border: 1px solid #ff9800;
          border-radius: 4px;
          padding: 6px 14px;
          color: #f0f6fc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 99999;
          box-shadow: 0 4px 14px rgba(0,0,0,0.6);
        `;
        document.body.appendChild(banner);

        const timeStr = new Date(recovery.timestamp).toLocaleTimeString();
        banner.innerHTML = `
          <span>⚠️ <b>Crash Recovery:</b> Autosaved project found from ${timeStr} (${recovery.nodeCount} nodes).</span>
          <button id="btn-restore-autosave" style="background:#238636;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600;">Restore</button>
          <button id="btn-dismiss-autosave" style="background:#30363d;color:#c9d1d9;border:1px solid #484f58;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:11px;">Dismiss</button>
        `;

        document.getElementById('btn-restore-autosave')?.addEventListener('click', () => {
          this.autosaveManager.restore(this.graph, recovery.data);
          this.nodeGraphUI.render();
          this.evaluateGraph();
          banner.remove();
        });

        document.getElementById('btn-dismiss-autosave')?.addEventListener('click', () => {
          this.autosaveManager.discard();
          banner.remove();
        });
      }
    } catch (e) {
      console.warn('[AUTOSAVE] Recovery check bypassed:', e);
    }
  }

  evaluateGraph() {
    // Find active Viewer node
    const viewers = this.graph.getAllNodes().filter(n => n.type === 'Viewer');
    if (viewers.length === 0) {
      this.viewerUI.setBuffer(null);
      return;
    }

    const viewer = viewers[0];
    this.viewerUI.setViewerNode(viewer);

    // Pull-based evaluation starting from the Viewer node
    const outputBuffer = this.graph.evaluate(viewer.id, {
      frame: this.timelineUI.currentFrame
    });

    const multiInputs = typeof viewer.getAllInputBuffers === 'function' ? viewer.getAllInputBuffers() : null;
    this.viewerUI.setBuffer(outputBuffer, multiInputs);

    if (this.deepInspectorUI) {
      this.deepInspectorUI.setDeepBuffer(outputBuffer && (outputBuffer.isDeep || outputBuffer.sampleOffsets) ? outputBuffer : null);
    }
    if (this.metadataUI) {
      this.metadataUI.setBuffer(outputBuffer);
    }
  }

  onNodeParamChange(node) {
    this.nodeGraphUI.render();
    this.evaluateGraph();
  }

  async prefetchReadNodeFrame(readNode, frame) {
    if (!readNode) return null;
    if (readNode.sequenceFrames && readNode.sequenceFrames.has(frame)) {
      return readNode.sequenceFrames.get(frame);
    }
    const filePattern = readNode.getKnobValue('file');
    if (!filePattern) return null;
    const resolvedPath = ImageIO.resolveSequenceFrame(filePattern, frame);
    const url = resolvedPath.startsWith('/') ? resolvedPath : '/' + resolvedPath.replace(/\\/g, '/');
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn('[PREFETCH] HTTP error', res.status, url);
        return null;
      }
      const ab = await res.arrayBuffer();
      const pbuf = ImageIO.readEXR(ab);
      if (pbuf) {
        readNode.setSequenceFrame(frame, pbuf);
        return pbuf;
      }
    } catch (e) {
      console.warn('[PREFETCH] fetch failed:', e.message, url);
    }
    return null;
  }

  async loadFrameForReadNodes(frame) {
    const readNodes = this.graph.getAllNodes().filter(n => n.type === 'Read' && n.getKnobValue('sourceType') === 'file');
    if (readNodes.length === 0) return;
    const missing = readNodes.filter(rn => !rn.sequenceFrames || !rn.sequenceFrames.has(frame));
    if (missing.length > 0) {
      await Promise.all(missing.map(rn => this.prefetchReadNodeFrame(rn, frame)));
      this.evaluateGraph();
    }
  }

  prefetchShotSequences(startFrame, endFrame) {
    const readNodes = this.graph.getAllNodes().filter(n => n.type === 'Read' && n.getKnobValue('sourceType') === 'file');
    if (readNodes.length === 0) return;
    (async () => {
      for (let f = startFrame; f <= endFrame; f++) {
        for (const rn of readNodes) {
          if (!rn.sequenceFrames || !rn.sequenceFrames.has(f)) {
            await this.prefetchReadNodeFrame(rn, f);
          }
        }
      }
    })().catch(() => { });
  }

  onFrameChange(frame) {
    if (this.propertiesUI && typeof this.propertiesUI.updateValuesAtFrame === 'function') {
      this.propertiesUI.updateValuesAtFrame(frame);
    }
    if (this.dopeSheetUI && typeof this.dopeSheetUI.setFrame === 'function') {
      this.dopeSheetUI.setFrame(frame);
    }
    if (this.viewerUI && this.viewerUI.departmentHandler && typeof this.viewerUI.departmentHandler.setFrame === 'function') {
      this.viewerUI.departmentHandler.setFrame(frame);
    }
    if (this.viewerUI?.viewer3D && typeof this.viewerUI.viewer3D.setFrame === 'function') {
      this.viewerUI.viewer3D.setFrame(frame);
      if (this.viewerUI.viewMode === '3D') {
        this.viewerUI.render();
      }
    }
    if (this.particlesUI && typeof this.particlesUI.setFrame === 'function') {
      this.particlesUI.setFrame(frame);
    }
    this.evaluateGraph();
    this.loadFrameForReadNodes(frame);
  }

  onExportRender(writeNode) {
    const outputBuffer = this.graph.evaluate(writeNode.id);
    if (outputBuffer) {
      writeNode.exportFrame(outputBuffer);
    } else {
      alert('OpenComp: Nothing to export. Please connect an input to the Write node.');
    }
  }

  updateTimelineKeyframes(node) {
    if (!this.timelineUI) return;
    if (!node || !node.knobs) {
      if (typeof this.timelineUI.setKeyframes === 'function') {
        this.timelineUI.setKeyframes([]);
      }
      if (this.dopeSheetUI && typeof this.dopeSheetUI.setNodes === 'function') {
        this.dopeSheetUI.setNodes(this.graph.getAllNodes());
      }
      return;
    }
    const frames = new Set();
    let primaryTrack = null;
    let primaryKnobKey = null;

    if (this.curveEditorUI && typeof this.curveEditorUI.clearTracks === 'function') {
      this.curveEditorUI.clearTracks();
    }

    for (const [key, knob] of Object.entries(node.knobs)) {
      if (knob && knob.keyframes && Object.keys(knob.keyframes).length > 0) {
        for (const f of Object.keys(knob.keyframes)) {
          frames.add(Number(f));
        }
        const track = new KeyframeTrack(typeof knob.value === 'number' ? knob.value : 0.0);
        for (const [f, v] of Object.entries(knob.keyframes)) {
          const val = typeof v === 'object' && v !== null ? Number(v.value) : Number(v);
          track.addKey(Number(f), val);
        }
        if (!primaryTrack) {
          primaryKnobKey = key;
          primaryTrack = track;
        }
        if (this.curveEditorUI && typeof this.curveEditorUI.addTrack === 'function') {
          this.curveEditorUI.addTrack(key, `${node.name}.${key}`, track, node, key);
        }
      }
    }

    if (typeof this.timelineUI.setKeyframes === 'function') {
      this.timelineUI.setKeyframes(Array.from(frames));
    }

    if (this.curveEditorUI && primaryTrack) {
      this.curveEditorUI.activeTrack = primaryTrack;
      this.curveEditorUI.activeTrackId = primaryKnobKey;
      this.curveEditorUI.targetNode = node;
      this.curveEditorUI.targetKnobKey = primaryKnobKey;
      this.curveEditorUI.fitToCurves();
      this.curveEditorUI.render();
    }

    if (this.dopeSheetUI && typeof this.dopeSheetUI.setNodes === 'function') {
      this.dopeSheetUI.setNodes(this.graph.getAllNodes());
    }
  }

  update3DCameraDropdown() {
    const sel = document.getElementById('viewer-3d-camera-select');
    if (!sel || !this.graph) return;

    const currentVal = sel.value;
    const staticOptions = [
      { value: 'perspective', label: 'Perspective (Free)' },
      { value: 'top', label: 'Top' },
      { value: 'front', label: 'Front' },
      { value: 'right', label: 'Right' },
      { value: 'bottom', label: 'Bottom' },
      { value: 'back', label: 'Back' },
      { value: 'left', label: 'Left' }
    ];

    const camNodes = this.graph.getAllNodes().filter(n => n.type === 'Camera3D');

    let html = '';
    for (const opt of staticOptions) {
      html += `<option value="${opt.value}" ${opt.value === currentVal ? 'selected' : ''}>${opt.label}</option>`;
    }
    if (camNodes.length > 0) {
      html += `<optgroup label="Scene Cameras">`;
      for (const cam of camNodes) {
        const val = `camera:${cam.id}`;
        html += `<option value="${val}" ${val === currentVal ? 'selected' : ''}>🎥 ${cam.name}</option>`;
      }
      html += `</optgroup>`;
    }

    sel.innerHTML = html;
  }

  initToolbarEvents() {
    // Viewer Toolbar (Exposure, Gamma, Channels, Input 1/2)
    const expSlider = document.getElementById('viewer-exposure-slider');
    const expVal = document.getElementById('viewer-exposure-val');
    if (expSlider) {
      expSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.viewerUI.exposure = val;
        if (expVal) expVal.textContent = val.toFixed(1);
        this.viewerUI.render();
      });
    }

    const gammaSlider = document.getElementById('viewer-gamma-slider');
    const gammaVal = document.getElementById('viewer-gamma-val');
    if (gammaSlider) {
      gammaSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.viewerUI.gamma = val;
        if (gammaVal) gammaVal.textContent = val.toFixed(2);
        this.viewerUI.render();
      });
    }

    // Reset exposure / gamma buttons
    const resetExp = document.getElementById('btn-reset-exp');
    if (resetExp) {
      resetExp.addEventListener('click', () => {
        this.viewerUI.exposure = 0.0;
        if (expSlider) expSlider.value = 0;
        if (expVal) expVal.textContent = '0.0';
        this.viewerUI.render();
      });
    }

    const resetGamma = document.getElementById('btn-reset-gamma');
    if (resetGamma) {
      resetGamma.addEventListener('click', () => {
        this.viewerUI.gamma = 1.0;
        if (gammaSlider) gammaSlider.value = 1.0;
        if (gammaVal) gammaVal.textContent = '1.0';
        this.viewerUI.render();
      });
    }

    // Channel isolation buttons (RGB, R, G, B, A, Luma)
    const chanButtons = document.querySelectorAll('.btn-channel');
    chanButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        chanButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewerUI.channelMode = btn.dataset.channel;
        this.viewerUI.render();
      });
    });

    // Layer / AOV Selection Dropdown
    const layerSelect = document.getElementById('viewer-layer-select');
    if (layerSelect) {
      layerSelect.addEventListener('change', (e) => {
        this.viewerUI.setAOVChannel(e.target.value);
      });
    }

    // Stereo Viewer Controls
    const btnStereoLeft = document.getElementById('btn-stereo-left');
    if (btnStereoLeft) {
      btnStereoLeft.addEventListener('click', () => {
        const next = (this.viewerUI.stereoMode === 'left') ? 'none' : 'left';
        this.viewerUI.setStereoMode(next);
      });
    }

    const btnStereoRight = document.getElementById('btn-stereo-right');
    if (btnStereoRight) {
      btnStereoRight.addEventListener('click', () => {
        const next = (this.viewerUI.stereoMode === 'right') ? 'none' : 'right';
        this.viewerUI.setStereoMode(next);
      });
    }

    const btnStereo3D = document.getElementById('btn-stereo-3d');
    if (btnStereo3D) {
      btnStereo3D.addEventListener('click', () => {
        const next = (this.viewerUI.stereoMode === 'anaglyph') ? 'none' : 'anaglyph';
        this.viewerUI.setStereoMode(next);
      });
    }

    // 2D / 3D Viewer Mode Toggling
    const btnMode2D = document.getElementById('btn-viewer-mode-2d');
    const btnMode3D = document.getElementById('btn-viewer-mode-3d');
    if (btnMode2D && btnMode3D) {
      btnMode2D.addEventListener('click', () => {
        this.viewerUI.setViewMode('2D');
      });
      btnMode3D.addEventListener('click', () => {
        this.viewerUI.setViewMode('3D');
        this.update3DCameraDropdown();
      });
    }

    // 3D Viewport Toolbar Controls
    const cam3DSelect = document.getElementById('viewer-3d-camera-select');
    if (cam3DSelect) {
      cam3DSelect.addEventListener('change', (e) => {
        this.viewerUI.viewer3D?.setViewType(e.target.value);
        this.viewerUI.render();
      });
    }

    const disp3DSelect = document.getElementById('viewer-3d-display-mode');
    if (disp3DSelect) {
      disp3DSelect.addEventListener('change', (e) => {
        this.viewerUI.viewer3D?.setDisplayMode(e.target.value);
        this.viewerUI.render();
      });
    }

    const btnGizmoW = document.getElementById('btn-gizmo-translate');
    const btnGizmoE = document.getElementById('btn-gizmo-rotate');
    const btnGizmoR = document.getElementById('btn-gizmo-scale');

    const updateGizmoBtns = (mode) => {
      btnGizmoW?.classList.toggle('active', mode === 'translate');
      btnGizmoE?.classList.toggle('active', mode === 'rotate');
      btnGizmoR?.classList.toggle('active', mode === 'scale');
    };

    if (btnGizmoW) {
      btnGizmoW.addEventListener('click', () => {
        this.viewerUI.viewer3D?.setGizmoMode('translate');
        updateGizmoBtns('translate');
        this.viewerUI.render();
      });
    }
    if (btnGizmoE) {
      btnGizmoE.addEventListener('click', () => {
        this.viewerUI.viewer3D?.setGizmoMode('rotate');
        updateGizmoBtns('rotate');
        this.viewerUI.render();
      });
    }
    if (btnGizmoR) {
      btnGizmoR.addEventListener('click', () => {
        this.viewerUI.viewer3D?.setGizmoMode('scale');
        updateGizmoBtns('scale');
        this.viewerUI.render();
      });
    }

    const coordSpaceSelect = document.getElementById('viewer-3d-coord-space');
    if (coordSpaceSelect) {
      coordSpaceSelect.addEventListener('change', (e) => {
        this.viewerUI.viewer3D?.setCoordSpace(e.target.value);
        this.viewerUI.render();
      });
    }

    const btn3DGrid = document.getElementById('btn-viewer-3d-grid');
    if (btn3DGrid) {
      btn3DGrid.addEventListener('click', () => {
        const state = this.viewerUI.viewer3D?.toggleGrid();
        btn3DGrid.classList.toggle('active', state);
        this.viewerUI.render();
      });
    }

    const btn3DLockCam = document.getElementById('btn-viewer-3d-lock-cam');
    if (btn3DLockCam) {
      btn3DLockCam.addEventListener('click', () => {
        const locked = !this.viewerUI.viewer3D?.lockCameraToView;
        this.viewerUI.viewer3D?.setLockCameraToView(locked);
        btn3DLockCam.classList.toggle('active', locked);
      });
    }

    const btn3DFrameSel = document.getElementById('btn-viewer-3d-frame-sel');
    if (btn3DFrameSel) {
      btn3DFrameSel.addEventListener('click', () => {
        this.viewerUI.viewer3D?.frameSelected();
        this.viewerUI.render();
      });
    }

    const btn3DFrameAll = document.getElementById('btn-viewer-3d-frame-all');
    if (btn3DFrameAll) {
      btn3DFrameAll.addEventListener('click', () => {
        this.viewerUI.viewer3D?.frameAll();
        this.viewerUI.render();
      });
    }

    // 10-Slot Viewer Input Selection (Dropdown & Direct Hotkeys)
    const inputSelect = document.getElementById('viewer-input-select');
    if (inputSelect) {
      inputSelect.addEventListener('change', (e) => {
        const slot = e.target.value;
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('activeInput', slot);
          this.evaluateGraph();
        }
      });
    }

    // Comparison Mode Selection (Single, Wipe H, Wipe V, Diff, Side-by-Side)
    const compareSelect = document.getElementById('viewer-compare-select');
    const abSourcesGroup = document.getElementById('viewer-ab-sources');
    const sourceASelect = document.getElementById('viewer-source-a');
    const sourceBSelect = document.getElementById('viewer-source-b');

    if (compareSelect) {
      compareSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('compareMode', mode);
          if (abSourcesGroup) {
            abSourcesGroup.style.display = mode === 'single' ? 'none' : 'flex';
          }
          this.evaluateGraph();
        }
      });
    }

    if (sourceASelect) {
      sourceASelect.addEventListener('change', (e) => {
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('sourceA', e.target.value);
          this.evaluateGraph();
        }
      });
    }

    if (sourceBSelect) {
      sourceBSelect.addEventListener('change', (e) => {
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('sourceB', e.target.value);
          this.evaluateGraph();
        }
      });
    }

    // Phase 2: Multi-Layout Selection & Sync Pan/Zoom
    const layoutSelect = document.getElementById('viewer-layout-select');
    if (layoutSelect) {
      layoutSelect.addEventListener('change', (e) => {
        this.viewerUI.setLayoutMode(e.target.value);
      });
    }

    const btnSyncZoom = document.getElementById('btn-sync-zoom-pan');
    if (btnSyncZoom) {
      btnSyncZoom.addEventListener('click', () => {
        const nextState = !this.viewerUI.syncZoomPan;
        this.viewerUI.setSyncZoomPan(nextState);
        btnSyncZoom.classList.toggle('active', nextState);
      });
    }

    // Phase 2: Viewer Tool Modes (Nav, ROI, Sampler)
    const btnToolNav = document.getElementById('btn-viewer-tool-nav');
    const btnToolROI = document.getElementById('btn-viewer-tool-roi');
    const btnToolSample = document.getElementById('btn-viewer-tool-sample');
    const btnRoiClear = document.getElementById('btn-viewer-roi-clear');

    const setTool = (mode) => {
      this.viewerUI.setToolMode(mode);
      if (btnToolNav) btnToolNav.classList.toggle('active', mode === 'nav');
      if (btnToolROI) btnToolROI.classList.toggle('active', mode === 'roi');
      if (btnToolSample) btnToolSample.classList.toggle('active', mode === 'sample');
      if (btnRoiClear) btnRoiClear.style.display = this.viewerUI.overlay.hasROI() ? 'inline-block' : 'none';
    };

    if (btnToolNav) btnToolNav.addEventListener('click', () => setTool('nav'));
    if (btnToolROI) btnToolROI.addEventListener('click', () => setTool('roi'));
    if (btnToolSample) btnToolSample.addEventListener('click', () => setTool('sample'));
    if (btnRoiClear) {
      btnRoiClear.addEventListener('click', () => {
        this.viewerUI.clearROI();
        setTool('nav');
      });
    }

    // Phase 2: Safe Areas & Viewport Guides
    const guidesSelect = document.getElementById('viewer-guides-select');
    if (guidesSelect) {
      guidesSelect.addEventListener('change', (e) => {
        this.viewerUI.overlay.setGuideMode(e.target.value);
        this.viewerUI.render();
      });
    }

    // Phase 2: OCIO v2 Color Pipeline Management
    const ocioToggle = document.getElementById('btn-viewer-ocio-toggle');
    const displaySelect = document.getElementById('viewer-ocio-display');
    const viewSelect = document.getElementById('viewer-ocio-view');
    const resetColorBtn = document.getElementById('btn-reset-color-pipeline');

    if (displaySelect && viewSelect) {
      const displays = globalOCIO.getDisplays();
      displaySelect.innerHTML = displays.map(d => `<option value="${d}">${d.split(' ')[0]}</option>`).join('');
      displaySelect.value = this.viewerUI.ocioDisplay;

      const populateViews = (disp) => {
        const views = globalOCIO.getViews(disp);
        viewSelect.innerHTML = views.map(v => `<option value="${v}">${v.split(' ')[0]}</option>`).join('');
        viewSelect.value = this.viewerUI.ocioView;
      };
      populateViews(this.viewerUI.ocioDisplay);

      displaySelect.addEventListener('change', (e) => {
        populateViews(e.target.value);
        this.viewerUI.setOCIODisplay(e.target.value);
      });

      viewSelect.addEventListener('change', (e) => {
        this.viewerUI.setOCIOView(e.target.value);
      });
    }

    if (ocioToggle) {
      ocioToggle.addEventListener('click', () => {
        this.viewerUI.toggleOCIOProcess();
        ocioToggle.classList.toggle('active', this.viewerUI.ocioProcessEnabled);
      });
    }

    if (resetColorBtn) {
      resetColorBtn.addEventListener('click', () => {
        this.viewerUI.resetColorPipeline();
      });
    }

    // Phase 2: Interactive Real-Time Scopes
    const btnToggleScopes = document.getElementById('btn-toggle-scopes');
    const scopeTypeSelect = document.getElementById('viewer-scope-type');
    const btnCloseScopes = document.getElementById('btn-close-scopes');
    const scopesOverlayTitle = document.getElementById('scopes-overlay-title');

    if (btnToggleScopes) {
      btnToggleScopes.addEventListener('click', () => {
        this.viewerUI.toggleScopes();
        btnToggleScopes.classList.toggle('active', this.viewerUI.scopes.enabled);
        if (scopeTypeSelect) scopeTypeSelect.style.display = this.viewerUI.scopes.enabled ? 'inline-block' : 'none';
      });
    }

    if (btnCloseScopes) {
      btnCloseScopes.addEventListener('click', () => {
        this.viewerUI.toggleScopes(false);
        if (btnToggleScopes) btnToggleScopes.classList.remove('active');
        if (scopeTypeSelect) scopeTypeSelect.style.display = 'none';
      });
    }

    if (scopeTypeSelect) {
      scopeTypeSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.viewerUI.setScopeType(val);
        if (scopesOverlayTitle) {
          const names = { waveform: 'Waveform', parade: 'RGB Parade', histogram: 'Histogram', vectorscope: 'Vectorscope' };
          scopesOverlayTitle.textContent = `📊 Image Scope: ${names[val] || val}`;
        }
      });
    }

    // Tab buttons switching between DAG, Curve Editor, Dope Sheet, Scene Graph, Particles, Deep Inspector, Metadata, and Stereo
    const tabBtnDag = document.getElementById('tab-btn-nodegraph');
    const tabBtnCurve = document.getElementById('tab-btn-curveeditor');
    const tabBtnDope = document.getElementById('tab-btn-dopesheet');
    const tabBtnScene = document.getElementById('tab-btn-scenegraph');
    const tabBtnParts = document.getElementById('tab-btn-particles');
    const tabBtnDeep = document.getElementById('tab-btn-deepinspector');
    const tabBtnMeta = document.getElementById('tab-btn-metadata');
    const tabBtnStereo = document.getElementById('tab-btn-stereo');
    const tabBtnProd = document.getElementById('tab-btn-production');

    const dagWrapper = document.getElementById('nodegraph-canvas-wrapper');
    const curveWrapper = document.getElementById('curveeditor-canvas-wrapper');
    const dopeWrapper = document.getElementById('dopesheet-wrapper');
    const sceneWrapper = document.getElementById('scenegraph-wrapper');
    const partsWrapper = document.getElementById('particles-wrapper');
    const deepWrapper = document.getElementById('deepinspector-wrapper');
    const metaWrapper = document.getElementById('metadata-wrapper');
    const stereoWrapper = document.getElementById('stereo-wrapper');
    const prodWrapper = document.getElementById('production-wrapper');
    const tabHint = document.getElementById('tab-hint-text');

    const switchDagTab = (activeId) => {
      tabBtnDag?.classList.toggle('active', activeId === 'dag');
      tabBtnCurve?.classList.toggle('active', activeId === 'curve');
      tabBtnDope?.classList.toggle('active', activeId === 'dope');
      tabBtnScene?.classList.toggle('active', activeId === 'scene');
      tabBtnParts?.classList.toggle('active', activeId === 'particles');
      tabBtnDeep?.classList.toggle('active', activeId === 'deep');
      tabBtnMeta?.classList.toggle('active', activeId === 'meta');
      tabBtnStereo?.classList.toggle('active', activeId === 'stereo');
      tabBtnProd?.classList.toggle('active', activeId === 'production');

      if (dagWrapper) dagWrapper.style.display = activeId === 'dag' ? 'block' : 'none';
      if (curveWrapper) curveWrapper.style.display = activeId === 'curve' ? 'block' : 'none';
      if (dopeWrapper) dopeWrapper.style.display = activeId === 'dope' ? 'block' : 'none';
      if (sceneWrapper) sceneWrapper.style.display = activeId === 'scene' ? 'block' : 'none';
      if (partsWrapper) partsWrapper.style.display = activeId === 'particles' ? 'block' : 'none';
      if (deepWrapper) deepWrapper.style.display = activeId === 'deep' ? 'block' : 'none';
      if (metaWrapper) metaWrapper.style.display = activeId === 'meta' ? 'block' : 'none';
      if (stereoWrapper) stereoWrapper.style.display = activeId === 'stereo' ? 'block' : 'none';
      if (prodWrapper) prodWrapper.style.display = activeId === 'production' ? 'block' : 'none';
    };

    if (tabBtnDag) {
      tabBtnDag.addEventListener('click', () => {
        switchDagTab('dag');
        if (tabHint) tabHint.innerHTML = 'Press <kbd>Tab</kbd> to add node | <kbd>1-0</kbd> to view | <kbd>D</kbd> to disable';
        if (this.nodeGraphUI) this.nodeGraphUI.render();
      });
    }

    if (tabBtnCurve) {
      tabBtnCurve.addEventListener('click', () => {
        switchDagTab('curve');
        if (tabHint) tabHint.innerHTML = 'Draggable tangents | <kbd>F</kbd> to fit | Drag point to move | <kbd>Del</kbd> to delete';
        if (this.curveCanvas && curveWrapper) {
          this.curveCanvas.width = curveWrapper.clientWidth || 800;
          this.curveCanvas.height = curveWrapper.clientHeight || 400;
        }
        if (this.curveEditorUI) {
          this.curveEditorUI.fitToCurves();
          this.curveEditorUI.render();
        }
      });
    }

    if (tabBtnDope) {
      tabBtnDope.addEventListener('click', () => {
        switchDagTab('dope');
        if (tabHint) tabHint.innerHTML = 'Dope Sheet: Drag keyframes to retime | Marquee select | Expand tracks';
        if (this.dopeSheetUI) {
          this.dopeSheetUI.setNodes(this.graph.getAllNodes());
          this.dopeSheetUI.drawCanvas();
        }
      });
    }

    if (tabBtnScene) {
      tabBtnScene.addEventListener('click', () => {
        switchDagTab('scene');
        if (tabHint) tabHint.innerHTML = 'Scene Graph: Inspect 3D hierarchy | Toggle visibility 👁 | Frame objects 🎯';
        if (this.sceneGraphUI) {
          this.sceneGraphUI.render();
        }
      });
    }

    if (tabBtnParts) {
      tabBtnParts.addEventListener('click', () => {
        switchDagTab('particles');
        if (tabHint) tabHint.innerHTML = '⚠️ Particle UI Preview: Simulation engine mockup (Non-functional preview)';
        if (this.particlesUI) {
          this.particlesUI.initCanvasPreview();
          this.particlesUI.updateTimelineDisplay();
        }
      });
    }

    if (tabBtnDeep) {
      tabBtnDeep.addEventListener('click', () => {
        switchDagTab('deep');
        if (tabHint) tabHint.innerHTML = '🌊 Deep Sample Inspector: Click/hover on Viewer to inspect per-pixel volumetric samples &amp; ray profile';
        if (this.deepInspectorUI) {
          const buf = this.viewerUI?.activeDeepBuffer || (this.viewerUI?.currentBuffer?.isDeep ? this.viewerUI.currentBuffer : null);
          this.deepInspectorUI.setDeepBuffer(buf);
        }
      });
    }

    if (tabBtnMeta) {
      tabBtnMeta.addEventListener('click', () => {
        switchDagTab('meta');
        if (tabHint) tabHint.innerHTML = '📋 Metadata &amp; AOV Inspector: Explore EXR header attributes, bit-depth, and channel hierarchy';
        if (this.metadataUI) {
          this.metadataUI.setBuffer(this.viewerUI?.currentBuffer);
        }
      });
    }

    if (tabBtnStereo) {
      tabBtnStereo.addEventListener('click', () => {
        switchDagTab('stereo');
        if (tabHint) tabHint.innerHTML = '🕶️ Stereoscopic 3D Comp: Convergence, disparity separation &amp; viewing modes';
        if (this.stereoUI) {
          this.stereoUI.syncControls();
        }
      });
    }

    if (tabBtnProd) {
      tabBtnProd.addEventListener('click', () => {
        switchDagTab('production');
        if (tabHint) tabHint.innerHTML = '🚀 Production Pipeline: Render Queue, Farm Workers, Tokens, Delivery &amp; Automation';
        if (this.productionUI) {
          this.productionUI.render();
        }
      });
    }

    // Curve Editor Toolbar buttons
    const btnCurveFit = document.getElementById('btn-curve-fit');
    if (btnCurveFit) {
      btnCurveFit.addEventListener('click', () => {
        if (this.curveEditorUI) {
          this.curveEditorUI.fitToCurves();
          this.curveEditorUI.render();
        }
      });
    }
    const btnCurveSmooth = document.getElementById('btn-curve-smooth');
    if (btnCurveSmooth) {
      btnCurveSmooth.addEventListener('click', () => {
        if (this.curveEditorUI) this.curveEditorUI.setTangentMode('smooth');
      });
    }
    const btnCurveFlat = document.getElementById('btn-curve-flat');
    if (btnCurveFlat) {
      btnCurveFlat.addEventListener('click', () => {
        if (this.curveEditorUI) this.curveEditorUI.setTangentMode('flat');
      });
    }
    const btnCurveLinear = document.getElementById('btn-curve-linear');
    if (btnCurveLinear) {
      btnCurveLinear.addEventListener('click', () => {
        if (this.curveEditorUI) this.curveEditorUI.setTangentMode('linear');
      });
    }
    const btnCurveFree = document.getElementById('btn-curve-free');
    if (btnCurveFree) {
      btnCurveFree.addEventListener('click', () => {
        if (this.curveEditorUI) this.curveEditorUI.setTangentMode('free');
      });
    }

    // Fit View & 1:1 Actual Size buttons & Reset View
    const btnFit = document.getElementById('btn-fit-view');
    if (btnFit) {
      btnFit.addEventListener('click', () => this.viewerUI.fitToView());
    }

    const btnActual = document.getElementById('btn-actual-view');
    if (btnActual) {
      btnActual.addEventListener('click', () => this.viewerUI.actualSize());
    }

    const btnResetView = document.getElementById('btn-reset-view');
    if (btnResetView) {
      btnResetView.addEventListener('click', () => this.viewerUI.resetView());
    }

    const zoomPreset = document.getElementById('viewer-zoom-preset');
    if (zoomPreset) {
      zoomPreset.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'fit') {
          this.viewerUI.fitToView();
        } else {
          this.viewerUI.setZoomPreset(parseFloat(val));
        }
      });
    }
  }

  buildNodeCatalog() {
    if (this.nodeCreationService) {
      return this.nodeCreationService.getCatalog();
    }
    const catalogMap = new Map();
    if (Array.isArray(NODE_MENU)) {
      for (const group of NODE_MENU) {
        const cat = group.category || 'General';
        for (const item of (group.items || [])) {
          catalogMap.set(item.type, {
            type: item.type,
            category: cat,
            label: item.label || item.type,
            shortcut: item.shortcut || ''
          });
        }
      }
    }
    for (const type of Object.keys(NODE_REGISTRY)) {
      if (!catalogMap.has(type)) {
        catalogMap.set(type, {
          type,
          category: 'General',
          label: type,
          shortcut: ''
        });
      }
    }
    return Array.from(catalogMap.values());
  }

  openNodeSearchPopup(clientPos = null, graphPos = null) {
    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    const list = document.getElementById('node-search-results');
    if (!popup || !input || !list) return;

    // Save target graph spawn coordinates
    if (graphPos) {
      this.savedSpawnGraphPos = graphPos;
    } else if (this.nodeGraphUI && this.nodeGraphUI.lastMouseGraphPos) {
      this.savedSpawnGraphPos = this.nodeGraphUI.lastMouseGraphPos;
    } else if (this.nodeCanvas && this.nodeGraphUI) {
      this.savedSpawnGraphPos = this.nodeGraphUI.screenToGraph(this.nodeCanvas.width * 0.5, this.nodeCanvas.height * 0.5);
    } else {
      this.savedSpawnGraphPos = { x: 0, y: 0 };
    }

    // Position floating popup near mouse cursor within node graph panel
    const panel = document.getElementById('node-graph-panel') || (this.nodeCanvas ? this.nodeCanvas.parentElement : null);
    const panelRect = panel ? panel.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };

    let x = clientPos ? (clientPos.x - panelRect.left) : (panelRect.width * 0.5 - 160);
    let y = clientPos ? (clientPos.y - panelRect.top) : (panelRect.height * 0.25);

    const popupWidth = 320;
    const popupHeight = 280;
    const pad = 10;
    x = Math.max(pad, Math.min(x, (panelRect.width || 800) - popupWidth - pad));
    y = Math.max(35, Math.min(y, (panelRect.height || 600) - popupHeight - pad));

    popup.style.left = `${Math.round(x)}px`;
    popup.style.top = `${Math.round(y)}px`;
    popup.style.transform = 'none';
    popup.style.display = 'block';

    input.value = '';
    this.renderNodeSearchList('');
    input.focus();
    if (typeof input.select === 'function') {
      input.select();
    }
    setTimeout(() => {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }, 15);
  }

  renderNodeSearchList(filter = '') {
    const list = document.getElementById('node-search-results');
    const popup = document.getElementById('node-search-popup');
    if (!list) return;

    list.innerHTML = '';
    const catalog = this.buildNodeCatalog();
    const rawQuery = filter.toLowerCase().trim();

    let matches = [];
    if (!rawQuery) {
      matches = [...catalog].sort((a, b) => a.type.localeCompare(b.type));
    } else {
      // Support category prefix filtering e.g. "color:grade" or "filter:"
      let catFilter = null;
      let searchQuery = rawQuery;
      if (rawQuery.includes(':')) {
        const colonIdx = rawQuery.indexOf(':');
        catFilter = rawQuery.slice(0, colonIdx).trim().toLowerCase();
        searchQuery = rawQuery.slice(colonIdx + 1).trim().toLowerCase();
      }

      const scored = [];
      for (const item of catalog) {
        const typeLower = item.type.toLowerCase();
        const labelLower = item.label.toLowerCase();
        const catLower = item.category.toLowerCase();
        const shortcutLower = (item.shortcut || '').toLowerCase();

        // If category filter prefix was typed, enforce category match
        if (catFilter && !catLower.includes(catFilter)) {
          continue;
        }

        // Acronym match (e.g. "cc" for "ColorCorrect", "sr" for "ScanlineRender", "cp" for "CornerPin")
        const acronym = item.type.split(/(?=[A-Z])/).map(w => w[0]?.toLowerCase()).join('');

        let score = -1;
        if (!searchQuery) {
          // If only category was typed (e.g. "color:"), list all in category
          score = 10;
        } else if (typeLower === searchQuery) {
          score = 0; // Exact node type match
        } else if (typeLower.startsWith(searchQuery)) {
          score = 1; // Type starts with query
        } else if (acronym === searchQuery) {
          score = 2; // Acronym exact match
        } else if (labelLower.startsWith(searchQuery)) {
          score = 3; // Label starts with query
        } else if (shortcutLower === searchQuery) {
          score = 4; // Shortcut exact match
        } else if (typeLower.includes(searchQuery)) {
          score = 5; // Type contains query
        } else if (labelLower.includes(searchQuery)) {
          score = 6; // Label contains query
        } else if (catLower.includes(searchQuery)) {
          score = 7; // Category contains query
        }

        if (score !== -1) {
          scored.push({ item, score });
        }
      }

      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.item.type.localeCompare(b.item.type);
      });

      matches = scored.map(s => s.item);
    }

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-item-empty';
      empty.textContent = 'No matching nodes found';
      list.appendChild(empty);
      return;
    }

    matches.forEach((nodeInfo, index) => {
      const item = document.createElement('div');
      item.className = `search-item ${index === 0 ? 'selected' : ''}`;
      item.dataset.type = nodeInfo.type;

      const leftWrap = document.createElement('div');
      leftWrap.className = 'search-item-left';

      const nameEl = document.createElement('span');
      nameEl.className = 'search-item-name';
      nameEl.textContent = nodeInfo.type;
      leftWrap.appendChild(nameEl);

      const catBadge = document.createElement('span');
      const catClass = `cat-${nodeInfo.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      catBadge.className = `search-item-category ${catClass}`;
      catBadge.textContent = nodeInfo.category;
      leftWrap.appendChild(catBadge);

      item.appendChild(leftWrap);

      if (nodeInfo.shortcut) {
        const scEl = document.createElement('span');
        scEl.className = 'search-item-shortcut';
        scEl.textContent = nodeInfo.shortcut;
        item.appendChild(scEl);
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nodeCreationService.createNode(nodeInfo.type, { cursorPos: this.savedSpawnGraphPos });
        if (popup) popup.style.display = 'none';
        if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
          this.nodeCanvas.focus();
        }
      });

      list.appendChild(item);
    });
  }

  initNodeSearchPopup() {
    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    const list = document.getElementById('node-search-results');
    if (!popup || !input || !list) return;

    input.addEventListener('input', (e) => {
      this.renderNodeSearchList(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      const items = Array.from(list.querySelectorAll('.search-item'));
      let selectedIdx = items.findIndex(el => el.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx >= 0 && selectedIdx < items.length - 1) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx + 1].classList.add('selected');
            items[selectedIdx + 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[0].classList.add('selected');
            items[0].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx > 0) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx - 1].classList.add('selected');
            items[selectedIdx - 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[items.length - 1].classList.add('selected');
            items[items.length - 1].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = list.querySelector('.search-item.selected') || items[0];
        if (selected) {
          const type = selected.dataset.type || selected.querySelector('.search-item-name')?.textContent || selected.textContent.trim();
          this.nodeCreationService.createNode(type, { cursorPos: this.savedSpawnGraphPos });
          popup.style.display = 'none';
          if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
            this.nodeCanvas.focus();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        popup.style.display = 'none';
        if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
          this.nodeCanvas.focus();
        }
      }
    });

    // Close on outside click
    window.addEventListener('mousedown', (e) => {
      if (popup.style.display === 'block' && !popup.contains(e.target)) {
        popup.style.display = 'none';
      }
    });
  }

  spawnNodeFromSearch(type, spawnGraphPos = null) {
    const pos = spawnGraphPos || this.savedSpawnGraphPos;
    return this.nodeCreationService.createNode(type, { cursorPos: pos });
  }

  initLeftToolbar() {
    // Left Toolbar and Menu item node spawning buttons
    document.querySelectorAll('[data-create-node]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = btn.getAttribute('data-create-node');
        if (type) {
          this.nodeCreationService.createNode(type);
        }
      });
    });
  }

  initNodesTopMenu() {
    const menuDropdown = document.getElementById('menu-dropdown-nodes');
    const nodesBtn = document.getElementById('btn-nodes-menu');
    const searchInput = document.getElementById('nodes-menu-search-input');
    const listContainer = document.getElementById('nodes-menu-catalog-list');
    if (!menuDropdown || !nodesBtn || !searchInput || !listContainer) return;

    const CATEGORY_ORDER = [
      'Image', 'Draw', 'Time', 'Color', 'Filter', 'Keyer', 'Merge', 'Transform', '3D Stereo', '3D', 'Deep', 'Channel / Other', 'Viewer'
    ];

    const renderList = (filter = '') => {
      listContainer.innerHTML = '';
      const catalog = this.nodeCreationService.getCatalog();
      const query = filter.toLowerCase().trim();

      let matchedItems = [];
      if (!query) {
        matchedItems = [...catalog];
      } else {
        const scored = [];
        for (const item of catalog) {
          const typeLower = item.type.toLowerCase();
          const labelLower = item.label.toLowerCase();
          const catLower = item.category.toLowerCase();
          const shortcutLower = (item.shortcut || '').toLowerCase();

          let score = -1;
          if (typeLower === query) score = 0;
          else if (typeLower.startsWith(query)) score = 1;
          else if (labelLower.startsWith(query)) score = 2;
          else if (shortcutLower === query) score = 3;
          else if (typeLower.includes(query)) score = 4;
          else if (labelLower.includes(query)) score = 5;
          else if (catLower.includes(query)) score = 6;

          if (score !== -1) scored.push({ item, score });
        }
        scored.sort((a, b) => a.score !== b.score ? a.score - b.score : a.item.type.localeCompare(b.item.type));
        matchedItems = scored.map(s => s.item);
      }

      if (matchedItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nodes-menu-empty';
        empty.textContent = 'No matching nodes found';
        listContainer.appendChild(empty);
        return;
      }

      const closeMenu = () => {
        menuDropdown.classList.remove('open');
        if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
          this.nodeCanvas.focus();
        }
      };

      if (!query) {
        // Group by category in canonical VFX order
        const groups = new Map();
        for (const cat of CATEGORY_ORDER) groups.set(cat, []);
        for (const item of matchedItems) {
          const cat = groups.has(item.category) ? item.category : 'Channel / Other';
          groups.get(cat).push(item);
        }

        let first = true;
        for (const [catName, items] of groups.entries()) {
          if (items.length === 0) continue;
          items.sort((a, b) => a.type.localeCompare(b.type));

          const header = document.createElement('div');
          header.className = 'nodes-category-header';
          header.textContent = catName;
          listContainer.appendChild(header);

          for (const item of items) {
            const el = document.createElement('div');
            el.className = `nodes-menu-item ${first ? 'selected' : ''}`;
            el.dataset.type = item.type;
            if (first) first = false;

            const left = document.createElement('div');
            left.className = 'nodes-menu-item-left';

            const name = document.createElement('span');
            name.className = 'nodes-menu-item-name';
            name.textContent = item.type;
            left.appendChild(name);

            if (item.label && item.label !== item.type) {
              const desc = document.createElement('span');
              desc.className = 'nodes-menu-item-desc';
              desc.textContent = `(${item.label})`;
              left.appendChild(desc);
            }
            el.appendChild(left);

            if (item.shortcut) {
              const sc = document.createElement('span');
              sc.className = 'search-item-shortcut';
              sc.textContent = item.shortcut;
              el.appendChild(sc);
            }

            el.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.nodeCreationService.createNode(item.type);
              closeMenu();
            });

            listContainer.appendChild(el);
          }
        }
      } else {
        // Filtered search list
        matchedItems.forEach((item, idx) => {
          const el = document.createElement('div');
          el.className = `nodes-menu-item ${idx === 0 ? 'selected' : ''}`;
          el.dataset.type = item.type;

          const left = document.createElement('div');
          left.className = 'nodes-menu-item-left';

          const name = document.createElement('span');
          name.className = 'nodes-menu-item-name';
          name.textContent = item.type;
          left.appendChild(name);

          const catBadge = document.createElement('span');
          const catClass = `cat-${item.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
          catBadge.className = `search-item-category ${catClass}`;
          catBadge.textContent = item.category;
          left.appendChild(catBadge);

          el.appendChild(left);

          if (item.shortcut) {
            const sc = document.createElement('span');
            sc.className = 'search-item-shortcut';
            sc.textContent = item.shortcut;
            el.appendChild(sc);
          }

          el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.nodeCreationService.createNode(item.type);
            closeMenu();
          });

          listContainer.appendChild(el);
        });
      }
    };

    const openMenu = () => {
      menuDropdown.classList.add('open');
      searchInput.value = '';
      renderList('');
      setTimeout(() => {
        searchInput.focus();
        if (typeof searchInput.select === 'function') searchInput.select();
      }, 20);
    };

    const closeMenu = () => {
      menuDropdown.classList.remove('open');
      if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
        this.nodeCanvas.focus();
      }
    };

    // Toggle on Nodes menu button click
    nodesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menuDropdown.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Populate on mouseenter if empty
    menuDropdown.addEventListener('mouseenter', () => {
      if (listContainer.children.length === 0) {
        renderList(searchInput.value || '');
      }
    });

    // Dynamic filtering
    searchInput.addEventListener('input', (e) => {
      renderList(e.target.value);
    });

    // Keyboard navigation in search input
    searchInput.addEventListener('keydown', (e) => {
      const items = Array.from(listContainer.querySelectorAll('.nodes-menu-item'));
      const selectedIdx = items.findIndex(el => el.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx >= 0 && selectedIdx < items.length - 1) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx + 1].classList.add('selected');
            items[selectedIdx + 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[0].classList.add('selected');
            items[0].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx > 0) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx - 1].classList.add('selected');
            items[selectedIdx - 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[items.length - 1].classList.add('selected');
            items[items.length - 1].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = listContainer.querySelector('.nodes-menu-item.selected') || items[0];
        if (selected) {
          const type = selected.dataset.type || selected.querySelector('.nodes-menu-item-name')?.textContent;
          if (type) {
            this.nodeCreationService.createNode(type);
          }
          closeMenu();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    });

    // Close on outside click
    window.addEventListener('mousedown', (e) => {
      if (menuDropdown.classList.contains('open') && !menuDropdown.contains(e.target)) {
        menuDropdown.classList.remove('open');
      }
    });
  }

  spawnNodeAt(type, posX, posY) {
    return this.nodeCreationService.createNode(type, {
      posX,
      posY,
      forcePosition: (posX !== undefined)
    });
  }

  spawnNodeAtCenter(type) {
    return this.nodeCreationService.createNode(type);
  }

  initSplitters() {
    const wsContainer = document.getElementById('workspace-container');
    const splitterH = document.getElementById('splitter-viewer-dag');
    const splitterV = document.getElementById('splitter-center-props');
    const viewerPanel = document.querySelector('.viewer-panel');

    // Restore saved layout
    try {
      const saved = JSON.parse(localStorage.getItem('opencomp_panel_layout') || '{}');
      if (saved.propWidth && wsContainer) {
        wsContainer.style.setProperty('--properties-width', `${saved.propWidth}px`);
      }
      if (saved.viewerHeight && viewerPanel) {
        viewerPanel.style.setProperty('--viewer-height', `${saved.viewerHeight}px`);
      }
    } catch (e) { }

    // Horizontal Splitter (Viewer / DAG)
    if (splitterH && viewerPanel) {
      let isDraggingH = false;
      let startY = 0;
      let startH = 0;

      splitterH.addEventListener('mousedown', (e) => {
        isDraggingH = true;
        startY = e.clientY;
        startH = viewerPanel.offsetHeight;
        splitterH.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDraggingH) return;
        const delta = e.clientY - startY;
        const newH = Math.max(120, Math.min(window.innerHeight - 200, startH + delta));
        viewerPanel.style.setProperty('--viewer-height', `${newH}px`);
        this.viewerUI.resizeCanvas();
        this.nodeGraphUI.resizeCanvas();
      });

      window.addEventListener('mouseup', () => {
        if (isDraggingH) {
          isDraggingH = false;
          splitterH.classList.remove('dragging');
          document.body.style.cursor = 'default';
          this.savePanelLayout();
        }
      });
    }

    // Vertical Splitter (Center Stack / Properties Bin)
    if (splitterV && wsContainer) {
      let isDraggingV = false;
      let startX = 0;
      let startW = 0;

      splitterV.addEventListener('mousedown', (e) => {
        isDraggingV = true;
        startX = e.clientX;
        const propPanel = document.getElementById('properties-panel');
        startW = propPanel ? propPanel.offsetWidth : 340;
        splitterV.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDraggingV) return;
        const delta = startX - e.clientX;
        const newW = Math.max(220, Math.min(800, startW + delta));
        wsContainer.style.setProperty('--properties-width', `${newW}px`);
        this.viewerUI.resizeCanvas();
        this.nodeGraphUI.resizeCanvas();
      });

      window.addEventListener('mouseup', () => {
        if (isDraggingV) {
          isDraggingV = false;
          splitterV.classList.remove('dragging');
          document.body.style.cursor = 'default';
          this.savePanelLayout();
        }
      });
    }
  }

  savePanelLayout() {
    try {
      const viewerPanel = document.querySelector('.viewer-panel');
      const propPanel = document.getElementById('properties-panel');
      const layout = {
        viewerHeight: viewerPanel ? viewerPanel.offsetHeight : 450,
        propWidth: propPanel ? propPanel.offsetWidth : 340
      };
      localStorage.setItem('opencomp_panel_layout', JSON.stringify(layout));
    } catch (e) { }
  }

  initContextMenus() {
    const nodeGraphMenu = document.getElementById('nodegraph-context-menu');
    const viewerMenu = document.getElementById('viewer-context-menu');

    // Right-click on Node Graph canvas
    this.nodeCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (viewerMenu) viewerMenu.style.display = 'none';

      if (nodeGraphMenu) {
        nodeGraphMenu.style.display = 'block';
        nodeGraphMenu.style.left = `${Math.min(window.innerWidth - 220, e.clientX)}px`;
        nodeGraphMenu.style.top = `${Math.min(window.innerHeight - 380, e.clientY)}px`;
        const rect = this.nodeCanvas.getBoundingClientRect();
        this.lastContextGraphPos = this.nodeGraphUI.screenToGraph(
          e.clientX - rect.left,
          e.clientY - rect.top
        );
      }
    });

    // Right-click on Viewer canvas
    this.viewerCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (nodeGraphMenu) nodeGraphMenu.style.display = 'none';

      if (viewerMenu) {
        viewerMenu.style.display = 'block';
        viewerMenu.style.left = `${Math.min(window.innerWidth - 220, e.clientX)}px`;
        viewerMenu.style.top = `${Math.min(window.innerHeight - 250, e.clientY)}px`;
      }
    });

    // Close context menus on any click outside
    window.addEventListener('mousedown', (e) => {
      if (nodeGraphMenu && !nodeGraphMenu.contains(e.target)) {
        nodeGraphMenu.style.display = 'none';
      }
      if (viewerMenu && !viewerMenu.contains(e.target)) {
        viewerMenu.style.display = 'none';
      }
    });

    // Node Graph Context Menu Actions
    nodeGraphMenu?.querySelectorAll('[data-create-node]').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.getAttribute('data-create-node');
        if (type) {
          const spawnX = this.lastContextGraphPos ? this.lastContextGraphPos.x : undefined;
          const spawnY = this.lastContextGraphPos ? this.lastContextGraphPos.y : undefined;
          this.spawnNodeAt(type, spawnX, spawnY);
        }
        nodeGraphMenu.style.display = 'none';
      });
    });

    document.getElementById('ctx-action-duplicate')?.addEventListener('click', () => {
      this.nodeGraphUI.duplicateSelected();
      nodeGraphMenu.style.display = 'none';
    });

    document.getElementById('ctx-action-disable')?.addEventListener('click', () => {
      for (const id of this.nodeGraphUI.selectedNodes) {
        const n = this.graph.getNode(id);
        if (n) {
          n.disabled = !n.disabled;
          n.markDirty();
        }
      }
      this.nodeGraphUI.render();
      this.evaluateGraph();
      nodeGraphMenu.style.display = 'none';
    });

    document.getElementById('ctx-action-delete')?.addEventListener('click', () => {
      for (const id of this.nodeGraphUI.selectedNodes) {
        this.graph.removeNode(id);
      }
      this.nodeGraphUI.selectedNodes.clear();
      this.nodeGraphUI.render();
      this.evaluateGraph();
      nodeGraphMenu.style.display = 'none';
    });

    // Viewer Context Menu Actions
    document.getElementById('ctx-view-fit')?.addEventListener('click', () => {
      this.viewerUI.fitToView();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-100')?.addEventListener('click', () => {
      this.viewerUI.actualSize();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-reset-view')?.addEventListener('click', () => {
      this.viewerUI.resetView();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-rgba')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('RGBA');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-rgb')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('RGB');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-red')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('RED');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-green')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('GREEN');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-blue')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('BLUE');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-alpha')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('ALPHA');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-luma')?.addEventListener('click', () => {
      this.viewerUI.setChannelMode('LUMA');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-wipe')?.addEventListener('click', () => {
      if (this.viewerUI.activeViewerNode) {
        const cur = this.viewerUI.activeViewerNode.getKnobValue('compareMode');
        const next = cur === 'wipe_h' ? 'single' : 'wipe_h';
        this.viewerUI.activeViewerNode.setKnobValue('compareMode', next);
        this.evaluateGraph();
      }
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-scopes')?.addEventListener('click', () => {
      this.viewerUI.toggleScopes();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-pixel-analyzer')?.addEventListener('click', () => {
      this.viewerUI.toggleScopes(true);
      this.viewerUI.setScopeType('pixel_analyzer');
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-reset')?.addEventListener('click', () => {
      this.viewerUI.resetColorPipeline();
      viewerMenu.style.display = 'none';
    });
  }

  initMenuEvents() {
    // Presets
    document.getElementById('menu-preset-greenscreen')?.addEventListener('click', () => this.loadPresetGreenscreen());
    document.getElementById('menu-preset-grade')?.addEventListener('click', () => this.loadPresetColorGrade());
    document.getElementById('menu-preset-wipe')?.addEventListener('click', () => this.loadPresetWipeCompare());
    document.getElementById('menu-preset-cornerpin')?.addEventListener('click', () => this.loadPresetCornerPin());
    document.getElementById('menu-preset-curves')?.addEventListener('click', () => this.loadPresetCurves());
    document.getElementById('menu-preset-stereo')?.addEventListener('click', () => this.loadPresetStereoConversion());

    // File Actions
    document.getElementById('menu-save-project')?.addEventListener('click', () => this.saveProject());
    document.getElementById('menu-open-project')?.addEventListener('click', () => {
      document.getElementById('file-project-open')?.click();
    });
    document.getElementById('file-project-open')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.openProject(file);
    });

    // Script (.nk) Actions
    const exportBtn = document.getElementById('menu-export-script') || document.getElementById('menu-export-nuke');
    exportBtn?.addEventListener('click', () => this.exportNukeScript());

    const importBtn = document.getElementById('menu-import-script') || document.getElementById('menu-import-nuke');
    const fileInput = document.getElementById('file-script-open') || document.getElementById('file-nuke-open');
    importBtn?.addEventListener('click', () => {
      fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.importNukeScript(file);
    });

    // Clear Graph / New Project
    document.getElementById('menu-new-project')?.addEventListener('click', () => {
      if (confirm('Create new empty project? Current unsaved graph will be cleared.')) {
        this.graph.clear();
        this.propertiesUI.clear();
        this.viewerUI.setBuffer(null);
      }
    });

    // Render Frame
    document.getElementById('menu-render-frame')?.addEventListener('click', () => {
      const writeNode = this.graph.getAllNodes().find(n => n.type === 'Write');
      if (writeNode) {
        this.onExportRender(writeNode);
      } else {
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer && this.viewerUI.currentBuffer) {
          const canvas = document.createElement('canvas');
          canvas.width = this.viewerUI.currentBuffer.width;
          canvas.height = this.viewerUI.currentBuffer.height;
          const ctx = canvas.getContext('2d');
          const imgData = this.viewerUI.currentBuffer.toImageData();
          ctx.putImageData(imgData, 0, 0);
          canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OpenComp_Render_f${this.timelineUI.currentFrame}.png`;
            a.click();
            URL.revokeObjectURL(url);
          });
        } else {
          alert('No frame available to render.');
        }
      }
    });

    // Edit Actions
    document.getElementById('menu-undo')?.addEventListener('click', () => this.nodeGraphUI.onUndo());
    document.getElementById('menu-redo')?.addEventListener('click', () => this.nodeGraphUI.onRedo());
    document.getElementById('menu-select-all')?.addEventListener('click', () => {
      this.nodeGraphUI.selectedNodes.clear();
      this.graph.getAllNodes().forEach(n => this.nodeGraphUI.selectedNodes.add(n.id));
      this.nodeGraphUI.render();
    });
    document.getElementById('menu-delete-node')?.addEventListener('click', () => {
      for (const id of this.nodeGraphUI.selectedNodes) {
        this.graph.removeNode(id);
      }
      this.nodeGraphUI.selectedNodes.clear();
      this.propertiesUI.clear();
      this.nodeGraphUI.render();
      this.evaluateGraph();
    });
    document.getElementById('menu-disable-node')?.addEventListener('click', () => {
      for (const id of this.nodeGraphUI.selectedNodes) {
        const n = this.graph.getNode(id);
        if (n) {
          n.disabled = !n.disabled;
          n.markDirty();
        }
      }
      this.nodeGraphUI.render();
      this.evaluateGraph();
    });

    // Help Actions
    document.getElementById('menu-help-hotkeys')?.addEventListener('click', () => {
      alert('OpenComp Workstation Hotkeys:\n\n• Tab: Open Node Quick Finder\n• 1 - 9: Connect selected node to Viewer Input\n• M: Create Merge Node\n• G: Create Grade Node\n• C: Create ColorCorrect Node\n• B: Create Blur Node\n• T: Create Transform Node\n• K: Create Keyer Node\n• P: Create Premult Node\n• S: Create Shuffle Node\n• E: Create Erode Node\n• R: Create Read Node\n• W: Create Write Node\n• O: Create Roto Node\n• D: Disable / Bypass selected node\n• Del / Backspace: Delete selected node\n• F: Fit image to Viewer\n• H: 1:1 Pixel Size\n• Space: Play / Pause Timeline\n• Middle Mouse: Pan Canvas\n• Drag & Drop files: Drag images directly onto Node Graph');
    });

    document.getElementById('menu-help-about')?.addEventListener('click', () => {
      alert('OpenComp v1.0 VFX Workstation\n\nA professional 32-bit floating-point node-based VFX compositing workstation for visual effects studios.');
    });
  }

  initPhase1MenusAndModals() {
    // File Menu Extensions
    document.getElementById('menu-save-project-as')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.saveProjectAs();
    });

    // Edit Menu Extensions
    document.getElementById('menu-duplicate-node')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.nodeGraphUI.duplicateSelected();
    });

    document.getElementById('menu-invert-selection')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.invertSelection();
    });

    document.getElementById('menu-shortcuts')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.shortcutManager.openModal();
    });

    // Workspace Presets
    document.getElementById('menu-ws-composite')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.applyPreset('Composite');
      this.viewerUI?.setViewMode('2D');
      document.getElementById('tab-btn-nodegraph')?.click();
    });
    document.getElementById('menu-ws-roto')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.applyPreset('Roto');
      this.viewerUI?.setViewMode('2D');
    });
    document.getElementById('menu-ws-3d')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.applyPreset('3D');
      this.viewerUI?.setViewMode('3D');
      document.getElementById('tab-btn-scenegraph')?.click();
    });
    document.getElementById('menu-ws-deep-stereo')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.applyPreset('Deep / Stereo');
      document.getElementById('tab-btn-deepinspector')?.click();
    });
    document.getElementById('menu-ws-scripting')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.applyPreset('Scripting');
    });

    // Workspace Save / Delete / Reset
    const wsModal = document.getElementById('workspace-save-modal');
    const wsNameInput = document.getElementById('ws-save-name-input');
    document.getElementById('menu-ws-save')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (wsModal) {
        wsModal.style.display = 'flex';
        if (wsNameInput) {
          wsNameInput.value = '';
          setTimeout(() => wsNameInput.focus(), 30);
        }
      }
    });
    document.getElementById('btn-close-ws-modal')?.addEventListener('click', () => {
      if (wsModal) wsModal.style.display = 'none';
    });
    document.getElementById('btn-ws-cancel')?.addEventListener('click', () => {
      if (wsModal) wsModal.style.display = 'none';
    });
    document.getElementById('btn-ws-confirm-save')?.addEventListener('click', () => {
      const name = wsNameInput?.value?.trim();
      if (name) {
        this.dockManager.saveCustomWorkspace(name);
      }
      if (wsModal) wsModal.style.display = 'none';
    });

    document.getElementById('menu-ws-delete')?.addEventListener('click', (e) => {
      e.preventDefault();
      const customList = Array.from(this.dockManager.customWorkspaces.keys());
      if (customList.length === 0) {
        alert('No custom workspaces found to delete.');
      } else {
        const toDelete = prompt(`Enter name of workspace to delete:\nAvailable: ${customList.join(', ')}`);
        if (toDelete && this.dockManager.customWorkspaces.has(toDelete.trim())) {
          this.dockManager.deleteCustomWorkspace(toDelete.trim());
        }
      }
    });

    document.getElementById('menu-ws-reset')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dockManager.resetLayout();
    });

    // Panel Visibility Toggles
    const wireToggle = (id, panelId) => {
      const chk = document.getElementById(id);
      if (chk) {
        chk.addEventListener('change', (e) => {
          this.dockManager.togglePanel(panelId, e.target.checked);
        });
      }
    };
    wireToggle('toggle-panel-viewer', 'viewer');
    wireToggle('toggle-panel-nodegraph', 'nodegraph');
    wireToggle('toggle-panel-properties', 'properties');
    wireToggle('toggle-panel-timeline', 'timeline');

    const chkCurve = document.getElementById('toggle-panel-curveeditor');
    if (chkCurve) {
      chkCurve.addEventListener('change', (e) => {
        const tabBtn = e.target.checked
          ? document.getElementById('tab-btn-curveeditor')
          : document.getElementById('tab-btn-nodegraph');
        tabBtn?.click();
      });
    }

    // Viewer Menu Slots & Modes
    document.querySelectorAll('[data-viewer-slot]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const slot = el.getAttribute('data-viewer-slot');
        const inputSelect = document.getElementById('viewer-input-select');
        if (inputSelect) inputSelect.value = slot;
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('activeInput', slot);
          this.evaluateGraph();
        }
      });
    });

    document.querySelectorAll('[data-compare-mode]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = el.getAttribute('data-compare-mode');
        const compSelect = document.getElementById('viewer-compare-select');
        if (compSelect) {
          compSelect.value = mode;
          compSelect.dispatchEvent(new Event('change'));
        }
      });
    });

    document.getElementById('menu-view-fit')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.fitToView();
    });
    document.getElementById('menu-view-100')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.actualSize();
    });
    document.getElementById('menu-view-reset')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('btn-reset-exp')?.click();
      document.getElementById('btn-reset-gamma')?.click();
    });
    document.getElementById('menu-view-reset-pipeline')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.resetColorPipeline();
    });

    // Phase 2: Viewer Layout & Tools Menu Actions
    document.getElementById('menu-view-layout-single')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.setLayoutMode('single');
      const sel = document.getElementById('viewer-layout-select');
      if (sel) sel.value = 'single';
    });
    document.getElementById('menu-view-layout-dual')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.setLayoutMode('dual');
      const sel = document.getElementById('viewer-layout-select');
      if (sel) sel.value = 'dual';
    });
    document.getElementById('menu-view-layout-quad')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.setLayoutMode('quad');
      const sel = document.getElementById('viewer-layout-select');
      if (sel) sel.value = 'quad';
    });
    document.getElementById('menu-view-layout-reset')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.resetViewerLayout();
    });
    document.getElementById('menu-view-toggle-scopes')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('btn-toggle-scopes')?.click();
    });
    document.getElementById('menu-view-clear-roi')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.viewerUI.clearROI();
    });

    // Render Menu
    document.getElementById('menu-render-active-frame')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('menu-render-frame')?.click();
    });
    document.getElementById('menu-render-selected-write')?.addEventListener('click', (e) => {
      e.preventDefault();
      let writeNode = null;
      for (const id of this.nodeGraphUI.selectedNodes) {
        const n = this.graph.getNode(id);
        if (n && n.type === 'Write') {
          writeNode = n;
          break;
        }
      }
      if (!writeNode) {
        writeNode = this.graph.getAllNodes().find(n => n.type === 'Write');
      }
      if (writeNode) {
        this.onExportRender(writeNode);
      } else {
        alert('No Write node found in graph. Please create a Write node to render.');
      }
    });
    document.getElementById('menu-render-cli-info')?.addEventListener('click', (e) => {
      e.preventDefault();
      alert('OpenComp Batch Render CLI Usage:\n\nnode src/core/CliRenderer.js --script <path.comp|.nk> --frame <n> --out <output.exr>\n\nSupports headless rendering, resolution overrides, and tiled execution.');
    });
    document.getElementById('menu-render-farm-queue')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('tab-btn-production')?.click();
      if (this.productionUI) {
        this.productionUI.setSubTab('queue');
      }
    });
    document.getElementById('menu-render-pipeline-status')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('tab-btn-production')?.click();
      if (this.productionUI) {
        this.productionUI.setSubTab('diagnostics');
      }
    });

    // Cache Menu
    document.getElementById('menu-cache-clear-ram')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearRamCache();
    });
    document.getElementById('menu-cache-force-eval')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.forceReevaluateGraph();
    });

    // Help Menu
    document.getElementById('menu-help-shortcuts')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.shortcutManager.openModal();
    });
  }

  initShortcutKeyHandlers() {
    if (!this.shortcutManager) return;

    // Connect ShortcutManager action IDs to implementation handlers
    this.shortcutManager.setHandler('file.new', () => document.getElementById('menu-new-project')?.click());
    this.shortcutManager.setHandler('file.open', () => document.getElementById('file-project-open')?.click());
    this.shortcutManager.setHandler('file.save', () => this.saveProject());
    this.shortcutManager.setHandler('file.saveAs', () => this.saveProjectAs());
    this.shortcutManager.setHandler('file.exportFrame', () => document.getElementById('menu-render-frame')?.click());
    this.shortcutManager.setHandler('edit.undo', () => this.nodeGraphUI?.onUndo());
    this.shortcutManager.setHandler('edit.redo', () => this.nodeGraphUI?.onRedo());
    this.shortcutManager.setHandler('edit.shortcuts', () => this.shortcutManager.openModal());

    // Node graph actions: If customized from default, fire programmatic action
    this.shortcutManager.setHandler('node.tabSearch', () => {
      const sc = this.shortcutManager.shortcuts.get('node.tabSearch');
      if (sc && sc.key !== 'Tab') {
        this.nodeGraphUI?.onOpenSearchPopup();
        return true;
      }
      return false;
    });
    this.shortcutManager.setHandler('node.selectAll', () => {
      const sc = this.shortcutManager.shortcuts.get('node.selectAll');
      if (sc && sc.key !== 'Ctrl+A') {
        document.getElementById('menu-select-all')?.click();
        return true;
      }
      return false;
    });
    this.shortcutManager.setHandler('node.duplicate', () => {
      const sc = this.shortcutManager.shortcuts.get('node.duplicate');
      if (sc && sc.key !== 'Ctrl+D') {
        this.nodeGraphUI?.duplicateSelected();
        return true;
      }
      return false;
    });
    this.shortcutManager.setHandler('node.delete', () => {
      const sc = this.shortcutManager.shortcuts.get('node.delete');
      if (sc && sc.key !== 'Delete') {
        document.getElementById('menu-delete-node')?.click();
        return true;
      }
      return false;
    });
    this.shortcutManager.setHandler('node.disable', () => {
      const sc = this.shortcutManager.shortcuts.get('node.disable');
      if (sc && sc.key !== 'D') {
        document.getElementById('menu-disable-node')?.click();
        return true;
      }
      return false;
    });

    // Node spawning shortcuts
    const spawnMap = {
      'node.createGrade': 'Grade',
      'node.createColorCorrect': 'ColorCorrect',
      'node.createBlur': 'Blur',
      'node.createMerge': 'Merge',
      'node.createTransform': 'Transform',
      'node.createKeyer': 'Keyer',
      'node.createPremult': 'Premult',
      'node.createShuffle': 'Shuffle',
      'node.createErode': 'Erode',
      'node.createRead': 'Read',
      'node.createWrite': 'Write',
      'node.createRoto': 'Roto',
      'node.createDot': 'Dot'
    };
    for (const [actionId, nodeType] of Object.entries(spawnMap)) {
      this.shortcutManager.setHandler(actionId, () => {
        this.nodeCreationService?.createNode(nodeType);
      });
    }

    // Viewer slots 1 to 10: If customized or not handled by DAG focus
    for (let slot = 1; slot <= 10; slot++) {
      const slotStr = slot === 10 ? '0' : String(slot);
      this.shortcutManager.setHandler(`viewer.slot${slot}`, () => {
        const sc = this.shortcutManager.shortcuts.get(`viewer.slot${slot}`);
        if (sc && sc.key !== slotStr) {
          const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
          if (viewer) {
            viewer.setKnobValue('activeInput', String(slot));
            const sel = document.getElementById('viewer-input-select');
            if (sel) sel.value = String(slot);
            this.evaluateGraph();
          }
        }
      });
    }

    this.shortcutManager.setHandler('viewer.fit', () => this.viewerUI?.fitToView());
    this.shortcutManager.setHandler('viewer.actualSize', () => this.viewerUI?.actualSize());

    this.shortcutManager.setHandler('timeline.playPause', () => {
      const playBtn = document.getElementById('btn-timeline-play');
      playBtn?.click();
    });
    this.shortcutManager.setHandler('timeline.prevFrame', () => {
      const prevBtn = document.getElementById('btn-timeline-prev');
      prevBtn?.click();
    });
    this.shortcutManager.setHandler('timeline.nextFrame', () => {
      const nextBtn = document.getElementById('btn-timeline-next');
      nextBtn?.click();
    });
  }

  invertSelection() {
    const all = this.graph.getAllNodes().map(n => n.id);
    const inverted = new Set();
    for (const id of all) {
      if (!this.nodeGraphUI.selectedNodes.has(id)) {
        inverted.add(id);
      }
    }
    this.nodeGraphUI.selectedNodes = inverted;
    this.nodeGraphUI.render();
  }

  clearRamCache() {
    if (this.viewerUI) {
      this.viewerUI.setBuffer(null);
    }
    for (const node of this.graph.getAllNodes()) {
      node.markDirty();
    }
    this.evaluateGraph();
  }

  forceReevaluateGraph() {
    for (const node of this.graph.getAllNodes()) {
      node.markDirty();
    }
    this.evaluateGraph();
  }

  saveProjectAs(customName = null) {
    const filename = customName || (typeof prompt === 'function' ? prompt('Save Project As (.comp):', this.currentProjectName || 'OpenComp_Project.comp') : 'OpenComp_Project.comp');
    if (!filename) return;
    const finalName = filename.endsWith('.comp') ? filename : `${filename}.comp`;
    this.currentProjectName = finalName;
    this.saveProject(finalName);
  }

  saveProject(customFilename = null) {
    const data = this.graph.serialize();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = customFilename || this.currentProjectName || 'OpenComp_Project.comp';
    a.click();
    URL.revokeObjectURL(url);
  }

  loadProjectData(data) {
    if (!data) return;
    this.graph.deserialize(data, createNode);
    if (data.name) {
      this.currentProjectName = data.name;
    }
    const start = data.frameRange?.start ?? 1;
    const end = data.frameRange?.end ?? 100;
    if (data.frameRange && this.timelineUI) {
      if (data.frameRange.start !== undefined && data.frameRange.end !== undefined) {
        this.timelineUI.setFrameRange(data.frameRange.start, data.frameRange.end);
      }
      if (data.frameRange.fps !== undefined) {
        this.timelineUI.fps = data.frameRange.fps;
      }
      if (data.frameRange.current !== undefined) {
        this.timelineUI.setFrame(data.frameRange.current);
      }
    }
    this.prefetchShotSequences(start, end);
    this.nodeGraphUI.render();
    this.evaluateGraph();
    this.sceneGraphUI?.render();
    this.update3DCameraDropdown();
    this.viewerUI.fitToView();
  }

  openProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.loadProjectData(data);
        this.history.pushState(this.graph);
      } catch (err) {
        alert('Failed to load OpenComp project file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  exportNukeScript() {
    const nkContent = NukeScriptIO.exportToNukeScript(this.graph);
    const blob = new Blob([nkContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'OpenComp_Scene.nk';
    a.click();
    URL.revokeObjectURL(url);
  }

  importNukeScript(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        this.graph.clear();
        const importedNodes = NukeScriptIO.parseNukeScript(
          text,
          (type, id, x, y) => createNode(type, id, x, y),
          this.graph
        );
        if (!importedNodes || importedNodes.length === 0) {
          alert('OpenComp: No recognizable nodes found in .nk script.');
          return;
        }
        this.nodeGraphUI.render();
        this.evaluateGraph();
        this.viewerUI.fitToView();
      } catch (err) {
        alert('Failed to parse script: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // --- Preloaded VFX Presets ---

  loadPresetGreenscreen() {
    this.graph.clear();

    // 1. Background Read node
    const bgRead = createNode('Read', 'Read_BG', 80, 60);
    bgRead.setKnobValue('sourceType', 'background');
    this.graph.addNode(bgRead);

    // 2. Foreground Greenscreen Read node
    const fgRead = createNode('Read', 'Read_Actor', 320, 60);
    fgRead.setKnobValue('sourceType', 'greenscreen');
    this.graph.addNode(fgRead);

    // 3. Chroma Keyer Node
    const keyer = createNode('Keyer', 'Keyer1', 320, 160);
    keyer.setKnobValue('tolerance', 0.28);
    keyer.setKnobValue('softness', 0.16);
    keyer.setKnobValue('despill', 1.1);
    this.graph.addNode(keyer);
    this.graph.connect(fgRead.id, 'out', keyer.id, 'in');

    // 4. Color Grading on Actor to match Background lighting
    const grade = createNode('Grade', 'Grade_Actor', 320, 260);
    grade.setKnobValue('gain', 1.05);
    grade.setKnobValue('gamma', 1.15);
    grade.setKnobValue('lift', -0.02);
    this.graph.addNode(grade);
    this.graph.connect(keyer.id, 'out', grade.id, 'in');

    // 5. Merge Over Background
    const merge = createNode('Merge', 'Merge1', 200, 360);
    merge.setKnobValue('operation', 'over');
    this.graph.addNode(merge);
    this.graph.connect(bgRead.id, 'out', merge.id, 'B'); // B = Background
    this.graph.connect(grade.id, 'out', merge.id, 'A');  // A = Foreground

    // 6. Viewer node
    const viewer = createNode('Viewer', 'Viewer1', 200, 480);
    this.graph.addNode(viewer);
    this.graph.connect(merge.id, 'out', viewer.id, '1'); // Input 1: Final Composite
    this.graph.connect(fgRead.id, 'out', viewer.id, '2'); // Input 2: Raw Greenscreen

    // 7. Write Node for rendering
    const write = createNode('Write', 'Write1', 400, 480);
    this.graph.addNode(write);
    this.graph.connect(merge.id, 'out', write.id, 'in');

    this.nodeGraphUI.selectedNodes.clear();
    this.nodeGraphUI.selectedNodes.add(merge.id);
    this.propertiesUI.showNode(merge);

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }

  loadPresetColorGrade() {
    this.graph.clear();

    const read = createNode('Read', 'Read_City', 200, 60);
    read.setKnobValue('sourceType', 'background');
    this.graph.addNode(read);

    const cc = createNode('ColorCorrect', 'ColorCorrect1', 200, 160);
    cc.setKnobValue('saturation', 1.35);
    cc.setKnobValue('contrast', 1.18);
    this.graph.addNode(cc);
    this.graph.connect(read.id, 'out', cc.id, 'in');

    // Glow branch: Blur + Merge Plus
    const blur = createNode('Blur', 'Blur_Glow', 380, 240);
    blur.setKnobValue('size', 28.0);
    this.graph.addNode(blur);
    this.graph.connect(cc.id, 'out', blur.id, 'in');

    const gradeGlow = createNode('Grade', 'Grade_Glow', 380, 330);
    gradeGlow.setKnobValue('multiply', 0.85);
    this.graph.addNode(gradeGlow);
    this.graph.connect(blur.id, 'out', gradeGlow.id, 'in');

    const mergePlus = createNode('Merge', 'Merge_Plus', 200, 420);
    mergePlus.setKnobValue('operation', 'plus');
    this.graph.addNode(mergePlus);
    this.graph.connect(cc.id, 'out', mergePlus.id, 'B');
    this.graph.connect(gradeGlow.id, 'out', mergePlus.id, 'A');

    const viewer = createNode('Viewer', 'Viewer1', 200, 530);
    this.graph.addNode(viewer);
    this.graph.connect(mergePlus.id, 'out', viewer.id, '1');
    this.graph.connect(read.id, 'out', viewer.id, '2');

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }

  loadPresetWipeCompare() {
    this.graph.clear();

    const read = createNode('Read', 'Read1', 120, 60);
    read.setKnobValue('sourceType', 'background');
    this.graph.addNode(read);

    const grade = createNode('Grade', 'Grade_Cinematic', 280, 160);
    grade.setKnobValue('gamma', 1.4);
    grade.setKnobValue('gain', 1.2);
    grade.setKnobValue('lift', -0.05);
    this.graph.addNode(grade);
    this.graph.connect(read.id, 'out', grade.id, 'in');

    const viewer = createNode('Viewer', 'Viewer1', 200, 300);
    viewer.setKnobValue('compareMode', 'wipe_h');
    viewer.setKnobValue('wipePosition', 0.5);
    this.graph.addNode(viewer);
    this.graph.connect(grade.id, 'out', viewer.id, '1'); // Input 1: Graded
    this.graph.connect(read.id, 'out', viewer.id, '2');  // Input 2: Original

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }

  loadPresetCornerPin() {
    this.graph.clear();

    // 1. Background City scene
    const bgRead = createNode('Read', 'Read_BG', 120, 60);
    bgRead.setKnobValue('sourceType', 'background');
    this.graph.addNode(bgRead);

    // 2. Foreground Screen Graphics / Ramp
    const ramp = createNode('Ramp', 'Ramp_Screen', 340, 60);
    ramp.setKnobValue('type', 'smooth');
    ramp.setKnobValue('color0', 0.2);
    ramp.setKnobValue('color1', 1.4);
    this.graph.addNode(ramp);

    // 3. CornerPin 2D (Perspective homography quad warp onto billboard)
    const pin = createNode('CornerPin', 'CornerPin1', 340, 160);
    pin.setKnobValue('to1_x', 0.22);
    pin.setKnobValue('to1_y', 0.28);
    pin.setKnobValue('to2_x', 0.82);
    pin.setKnobValue('to2_y', 0.18);
    pin.setKnobValue('to3_x', 0.88);
    pin.setKnobValue('to3_y', 0.72);
    pin.setKnobValue('to4_x', 0.18);
    pin.setKnobValue('to4_y', 0.82);
    this.graph.addNode(pin);
    this.graph.connect(ramp.id, 'out', pin.id, 'in');

    // 4. Merge Screen Over City
    const merge = createNode('Merge', 'Merge_Screen', 220, 280);
    merge.setKnobValue('operation', 'plus');
    this.graph.addNode(merge);
    this.graph.connect(bgRead.id, 'out', merge.id, 'B');
    this.graph.connect(pin.id, 'out', merge.id, 'A');

    // 5. Viewer
    const viewer = createNode('Viewer', 'Viewer1', 220, 400);
    this.graph.addNode(viewer);
    this.graph.connect(merge.id, 'out', viewer.id, '1');
    this.graph.connect(pin.id, 'out', viewer.id, '2');

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }

  loadPresetCurves() {
    this.graph.clear();

    // Backdrop for organization
    const backdrop = createNode('Backdrop', 'Backdrop_Tonal', 80, 20);
    backdrop.setKnobValue('label', 'TONAL CURVES & CHANNEL PASS');
    backdrop.setKnobValue('noteColor', '#1e3a8a');
    backdrop.setKnobValue('boxWidth', 480);
    backdrop.setKnobValue('boxHeight', 360);
    this.graph.addNode(backdrop);

    const read = createNode('Read', 'Read_Plate', 160, 70);
    read.setKnobValue('sourceType', 'background');
    this.graph.addNode(read);

    // ColorLookup Tonal Curves (S-Curve contrast)
    const curves = createNode('ColorLookup', 'ColorLookup1', 160, 160);
    curves.setKnobValue('curvePreset', 's_curve');
    curves.setKnobValue('contrast', 1.25);
    curves.setKnobValue('pivot', 0.18);
    this.graph.addNode(curves);
    this.graph.connect(read.id, 'out', curves.id, 'in');

    // Shuffle & Erode
    const shuffle = createNode('Shuffle', 'Shuffle_Isolate', 340, 160);
    shuffle.setKnobValue('outRed', 'r');
    shuffle.setKnobValue('outGreen', 'g');
    shuffle.setKnobValue('outBlue', 'b');
    shuffle.setKnobValue('outAlpha', '1');
    this.graph.addNode(shuffle);
    this.graph.connect(read.id, 'out', shuffle.id, 'in');

    const viewer = createNode('Viewer', 'Viewer1', 160, 420);
    this.graph.addNode(viewer);
    this.graph.connect(curves.id, 'out', viewer.id, '1');
    this.graph.connect(shuffle.id, 'out', viewer.id, '2');

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }

  loadPresetStereoConversion() {
    this.graph.clear();

    const backdrop = createNode('Backdrop', 'Backdrop_Stereo', 80, 20);
    backdrop.setKnobValue('label', '2D-TO-3D STEREO CONVERSION PIPELINE');
    backdrop.setKnobValue('noteColor', '#701a75');
    backdrop.setKnobValue('boxWidth', 640);
    backdrop.setKnobValue('boxHeight', 460);
    this.graph.addNode(backdrop);

    // 1. Mono Source Plate
    const read = createNode('Read', 'Read_MonoPlate', 140, 80);
    read.setKnobValue('sourceType', 'background');
    this.graph.addNode(read);

    // 2. Roto Foreground Object
    const roto = createNode('Roto', 'Roto_Foreground', 340, 80);
    this.graph.addNode(roto);
    this.graph.connect(read.id, 'out', roto.id, 'in');

    // 3. Depth Generator (Ground plane + Roto Object depth)
    const depth = createNode('Depth', 'Depth_Map', 340, 190);
    depth.setKnobValue('gradientType', 'ground_plane');
    depth.setKnobValue('baseDepth', 0.85);
    depth.setKnobValue('objectDepth', 0.25); // Close foreground
    depth.setKnobValue('smoothRadius', 1);
    this.graph.addNode(depth);
    this.graph.connect(read.id, 'out', depth.id, 'in');
    this.graph.connect(roto.id, 'out', depth.id, 'roto');

    // 4. StereoWarp DIBR
    const warp = createNode('StereoWarp', 'StereoWarp_3D', 240, 300);
    warp.setKnobValue('convergence', 0.5);
    warp.setKnobValue('separation', 14.0);
    warp.setKnobValue('outputEye', 'anaglyph');
    this.graph.addNode(warp);
    this.graph.connect(read.id, 'out', warp.id, 'in');
    this.graph.connect(depth.id, 'out', warp.id, 'depth');

    // 5. Viewer
    const viewer = createNode('Viewer', 'Viewer_3D', 240, 410);
    this.graph.addNode(viewer);
    this.graph.connect(warp.id, 'out', viewer.id, '1');
    this.graph.connect(depth.id, 'out', viewer.id, '2');

    this.nodeGraphUI.render();
    this.evaluateGraph();
    setTimeout(() => this.viewerUI.fitToView(), 100);
  }
}

// Bootstrap on DOM ready or immediately if already loaded
function bootstrapOpenComp() {
  if (window.openComp) return;
  window.openComp = new OpenCompApp();
  window.app = window.openComp;

  if (window.location.search.includes('autotest=1')) {
    setTimeout(() => {
      import('./ui_forensic_test.js').then(m => m.runForensicUITest(window.openComp));
    }, 400);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrapOpenComp);
} else {
  bootstrapOpenComp();
}
