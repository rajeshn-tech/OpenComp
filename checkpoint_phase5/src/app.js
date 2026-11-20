/**
 * OpenComp - Main Application Orchestrator
 * Coordinates DAG graph execution, Viewer rendering, Node Graph, Properties, and Menu Actions.
 */

import { Graph } from './core/Graph.js';
import { createNode, NODE_REGISTRY, NODE_MENU } from './nodes/index.js';
import { ViewerUI } from './ui/ViewerUI.js';
import { NodeGraphUI } from './ui/NodeGraphUI.js';
import { PropertiesUI } from './ui/PropertiesUI.js';
import { TimelineUI } from './ui/TimelineUI.js';
import { NukeScriptIO } from './core/NukeScriptIO.js';
import { HistoryManager } from './core/HistoryManager.js';

class OpenCompApp {
  constructor() {
    this.graph = new Graph();
    this.history = new HistoryManager();

    // DOM Elements
    this.viewerCanvas = document.getElementById('viewer-canvas');
    this.viewerControls = document.getElementById('viewer-toolbar');
    this.viewerInfo = document.getElementById('viewer-info-bar');
    this.nodeCanvas = document.getElementById('node-graph-canvas');
    this.propertiesContainer = document.getElementById('properties-container');
    this.propertiesPanelTitle = document.getElementById('properties-panel-title');
    this.timelineContainer = document.getElementById('timeline-bar');

    // UI Modules
    this.viewerUI = new ViewerUI(this.viewerCanvas, this.viewerControls, this.viewerInfo);
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
    });

    this.initToolbarEvents();
    this.initLeftToolbar();
    this.initNodeSearchPopup();
    this.initMenuEvents();
    this.initSplitters();
    this.initContextMenus();

    // Load default production VFX preset
    this.loadPresetGreenscreen();
    this.history.pushState(this.graph);

    // Automatic Background Project Autosave (every 30 seconds)
    setInterval(() => {
      try {
        const data = this.graph.serialize();
        localStorage.setItem('opencomp_autosave_project', JSON.stringify(data));
      } catch (err) {}
    }, 30000);
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

    this.viewerUI.setBuffer(outputBuffer);
  }

  onNodeParamChange(node) {
    this.nodeGraphUI.render();
    this.evaluateGraph();
  }

  onFrameChange(frame) {
    this.evaluateGraph();
  }

  onExportRender(writeNode) {
    const outputBuffer = this.graph.evaluate(writeNode.id);
    if (outputBuffer) {
      writeNode.exportFrame(outputBuffer);
    } else {
      alert('OpenComp: Nothing to export. Please connect an input to the Write node.');
    }
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

    // View Input 1 / Input 2 toggle
    const btnInput1 = document.getElementById('btn-view-input-1');
    const btnInput2 = document.getElementById('btn-view-input-2');
    if (btnInput1 && btnInput2) {
      btnInput1.addEventListener('click', () => {
        btnInput1.classList.add('active');
        btnInput2.classList.remove('active');
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('activeInput', '1');
          this.evaluateGraph();
        }
      });
      btnInput2.addEventListener('click', () => {
        btnInput2.classList.add('active');
        btnInput1.classList.remove('active');
        const viewer = this.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (viewer) {
          viewer.setKnobValue('activeInput', '2');
          this.evaluateGraph();
        }
      });
    }

    // Fit View button
    const btnFit = document.getElementById('btn-fit-view');
    if (btnFit) {
      btnFit.addEventListener('click', () => this.viewerUI.fitToView());
    }
  }

  initNodeSearchPopup() {
    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    const list = document.getElementById('node-search-results');
    if (!popup || !input || !list) return;

    const renderList = (filter = '') => {
      list.innerHTML = '';
      const filterLower = filter.toLowerCase().trim();
      const nodeTypes = Object.keys(NODE_REGISTRY);

      const matches = nodeTypes.filter(type => type.toLowerCase().includes(filterLower));
      matches.forEach((type, index) => {
        const item = document.createElement('div');
        item.className = `search-item ${index === 0 ? 'selected' : ''}`;
        item.textContent = type;
        item.addEventListener('click', () => {
          this.spawnNodeFromSearch(type);
          popup.style.display = 'none';
        });
        list.appendChild(item);
      });
    };

    input.addEventListener('input', (e) => {
      renderList(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      const items = list.querySelectorAll('.search-item');
      let selectedIdx = Array.from(items).findIndex(el => el.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIdx < items.length - 1) {
          items[selectedIdx].classList.remove('selected');
          items[selectedIdx + 1].classList.add('selected');
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIdx > 0) {
          items[selectedIdx].classList.remove('selected');
          items[selectedIdx - 1].classList.add('selected');
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = list.querySelector('.search-item.selected') || items[0];
        if (selected) {
          this.spawnNodeFromSearch(selected.textContent);
          popup.style.display = 'none';
        }
      } else if (e.key === 'Escape') {
        popup.style.display = 'none';
      }
    });

    // Close on outside click
    window.addEventListener('mousedown', (e) => {
      if (popup.style.display === 'block' && !popup.contains(e.target)) {
        popup.style.display = 'none';
      }
    });
  }

  spawnNodeFromSearch(type) {
    this.spawnNodeAtCenter(type);
  }

  initLeftToolbar() {
    // Left Toolbar and Menu item node spawning buttons
    document.querySelectorAll('[data-create-node]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = btn.getAttribute('data-create-node');
        if (type) {
          this.spawnNodeAtCenter(type);
        }
      });
    });
  }

  spawnNodeAt(type, posX, posY) {
    const c = this.nodeCanvas;
    let spawnX = posX;
    let spawnY = posY;

    const selectedIds = Array.from(this.nodeGraphUI.selectedNodes);
    let selectedNode = null;
    if (selectedIds.length > 0) {
      selectedNode = this.graph.getNode(selectedIds[0]);
    }

    if (spawnX === undefined || spawnY === undefined) {
      if (selectedNode) {
        spawnX = selectedNode.x;
        spawnY = selectedNode.y + 70;
      } else {
        const centerGraph = this.nodeGraphUI.screenToGraph(c.width * 0.5, c.height * 0.5);
        spawnX = centerGraph.x;
        spawnY = centerGraph.y;
      }
    }

    const node = createNode(type, null, spawnX, spawnY);
    if (node) {
      this.graph.addNode(node);

      // Nuke-style auto-connection: connect selected node output to new node's first input
      if (selectedNode && selectedNode.outputs && selectedNode.outputs['out']) {
        if (node.inputs['in']) {
          this.graph.connect(selectedNode.id, 'out', node.id, 'in');
        } else if (node.inputs['B']) {
          this.graph.connect(selectedNode.id, 'out', node.id, 'B');
        } else if (node.inputs['0']) {
          this.graph.connect(selectedNode.id, 'out', node.id, '0');
        }
      }

      this.nodeGraphUI.selectedNodes.clear();
      this.nodeGraphUI.selectedNodes.add(node.id);
      this.propertiesUI.showNode(node);
      this.nodeGraphUI.render();
      this.evaluateGraph();
    }
  }

  spawnNodeAtCenter(type) {
    this.spawnNodeAt(type);
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
    } catch (e) {}

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
    } catch (e) {}
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

    document.getElementById('ctx-view-rgba')?.addEventListener('click', () => {
      this.viewerUI.channelMode = 'RGBA';
      this.viewerUI.render();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-rgb')?.addEventListener('click', () => {
      this.viewerUI.channelMode = 'RGB';
      this.viewerUI.render();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-alpha')?.addEventListener('click', () => {
      this.viewerUI.channelMode = 'ALPHA';
      this.viewerUI.render();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-luma')?.addEventListener('click', () => {
      this.viewerUI.channelMode = 'LUMA';
      this.viewerUI.render();
      viewerMenu.style.display = 'none';
    });

    document.getElementById('ctx-view-reset')?.addEventListener('click', () => {
      this.viewerUI.exposure = 0.0;
      this.viewerUI.gamma = 1.0;
      const expSlider = document.getElementById('viewer-exposure-slider');
      const expVal = document.getElementById('viewer-exposure-val');
      const gammaSlider = document.getElementById('viewer-gamma-slider');
      const gammaVal = document.getElementById('viewer-gamma-val');
      if (expSlider) expSlider.value = '0.0';
      if (expVal) expVal.textContent = '0.0';
      if (gammaSlider) gammaSlider.value = '1.0';
      if (gammaVal) gammaVal.textContent = '1.0';
      this.viewerUI.render();
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

    // Nuke .nk Script Actions
    document.getElementById('menu-export-nuke')?.addEventListener('click', () => this.exportNukeScript());
    document.getElementById('menu-import-nuke')?.addEventListener('click', () => {
      document.getElementById('file-nuke-open')?.click();
    });
    document.getElementById('file-nuke-open')?.addEventListener('change', (e) => {
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
      alert('OpenComp Nuke Hotkeys:\n\n• Tab: Open Node Quick Finder\n• 1 - 9: Connect selected node to Viewer Input\n• M: Create Merge Node\n• G: Create Grade Node\n• C: Create ColorCorrect Node\n• B: Create Blur Node\n• T: Create Transform Node\n• K: Create Keyer Node\n• P: Create Premult Node\n• S: Create Shuffle Node\n• E: Create Erode Node\n• R: Create Read Node\n• W: Create Write Node\n• O: Create Roto Node\n• D: Disable / Bypass selected node\n• Del / Backspace: Delete selected node\n• F: Fit image to Viewer\n• H: 1:1 Pixel Size\n• Space: Play / Pause Timeline\n• Middle Mouse: Pan Canvas\n• Drag & Drop files: Drag images directly onto Node Graph');
    });

    document.getElementById('menu-help-about')?.addEventListener('click', () => {
      alert('OpenComp v1.0 VFX Workstation\n\nA professional 32-bit floating-point node-based VFX compositing software built as an open-source alternative to Foundry Nuke for visual effects studios.');
    });
  }

  saveProject() {
    const data = this.graph.serialize();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'OpenComp_Project.comp';
    a.click();
    URL.revokeObjectURL(url);
  }

  openProject(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.graph.deserialize(data, (type, id) => createNode(type, id));
        this.nodeGraphUI.render();
        this.evaluateGraph();
        this.viewerUI.fitToView();
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
          alert('OpenComp: No recognizable Nuke nodes found in .nk file.');
          return;
        }
        this.nodeGraphUI.render();
        this.evaluateGraph();
        this.viewerUI.fitToView();
      } catch (err) {
        alert('Failed to parse Nuke script: ' + err.message);
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

// Bootstrap on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.openComp = new OpenCompApp();

  if (window.location.search.includes('autotest=1')) {
    setTimeout(() => {
      import('./ui_forensic_test.js').then(m => m.runForensicUITest(window.openComp));
    }, 400);
  }
});
