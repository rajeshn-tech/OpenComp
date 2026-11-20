/**
 * OpenComp - DAG Node Graph Viewport UI (Phase 3 Professional Parity)
 * Interactive node canvas with:
 * - Live node postage stamps with efficient thumbnail caching and invalidation
 * - Group nodes with hierarchical enter/exit subgraph navigation & breadcrumbs
 * - Clone nodes with parameter synchronization and independent graph routing
 * - Node graph bookmarks (quick slots 1-6 & named bookmarks) and frame selected/all
 * - Interactive mini-map with real-time viewport navigation
 * - Node badges and status indicators (cached, dirty, animated, expression, clone, error, format)
 * - Improved pipe routing, magnetic port snapping, and connection validation feedback
 * - Professional selection, duplication, node extraction (Ctrl+Shift+X), and context-menu workflows
 */

import { NODE_REGISTRY, NODE_MENU, createNode, cloneNode, createGroupFromSelection } from '../nodes/index.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class NodeGraphUI {
  constructor(canvasElement, graph, onSelectNode, onDoubleClickNode) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.graph = graph;
    this.activeGraph = graph;
    this.onSelectNode = onSelectNode;
    this.onDoubleClickNode = onDoubleClickNode;

    // Viewport transform
    this.panX = 120;
    this.panY = 120;
    this.zoom = 1.0;

    this.selectedNodes = new Set();
    this.hoveredPort = null; // { nodeId, portId, isInput, x, y }
    this.snappedPort = null;

    // Dragging, Snapping & Marquee state
    this.isPanning = false;
    this.isDraggingNodes = false;
    this.isConnecting = false;
    this.isBoxSelecting = false;
    this.boxSelectStart = { x: 0, y: 0 };
    this.boxSelectCurrent = { x: 0, y: 0 };
    this.dragStart = { x: 0, y: 0 };
    this.wireSource = null; // { nodeId, portId, isInput }
    this.currentWireMouse = { x: 0, y: 0 };

    // Grid snapping (optional, toggleable)
    this.gridSnap = false;
    this.gridSnapSize = 12;

    // Mini-map
    this.showMiniMap = true;
    this.isDraggingMiniMap = false;
    this.miniMapBounds = { x: 0, y: 0, w: 160, h: 110 };

    // Subgraph / Group navigation stack
    this.subgraphStack = []; // [{ graph, groupNode, panX, panY, zoom }]
    this.breadcrumbHits = []; // [{ label, level, x, y, w, h }]

    // Bookmarks (quick slots 1-6 and named)
    this.bookmarks = new Map();

    // Clipboard & Undo/Redo callbacks
    this.clipboard = [];
    this.onUndo = null;
    this.onRedo = null;

    // Mouse tracking & focus context
    this.lastMouseClientPos = null;
    this.lastMouseCanvasPos = null;
    this.lastMouseGraphPos = null;
    this.isMouseOverGraph = false;
    this.isFocused = false;
    this.onOpenSearchPopup = null;

    // Active context menu DOM element
    this.activeContextMenuEl = null;

    this.initEvents();
  }

  get currentGraph() {
    return this.activeGraph || this.graph;
  }

  initEvents() {
    const c = this.canvas;

    if (c) {
      c.setAttribute('tabindex', '0');
      c.style.outline = 'none';

      c.addEventListener('mouseenter', () => {
        this.isMouseOverGraph = true;
      });

      c.addEventListener('mouseleave', () => {
        this.isMouseOverGraph = false;
      });

      c.addEventListener('focus', () => {
        this.isFocused = true;
      });

      c.addEventListener('blur', () => {
        this.isFocused = false;
      });
    }

    const panel = document.getElementById('node-graph-panel');
    if (panel) {
      panel.addEventListener('mouseenter', () => {
        this.isMouseOverGraph = true;
      });
      panel.addEventListener('mouseleave', () => {
        this.isMouseOverGraph = false;
      });
    }

    // Close context menu on global click
    window.addEventListener('click', (e) => {
      if (this.activeContextMenuEl && !this.activeContextMenuEl.contains(e.target)) {
        this.closeContextMenu();
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newZoom = Math.max(0.15, Math.min(3.5, this.zoom * zoomFactor));

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.render();
    }, { passive: false });

    // Right-Click Context Menu
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const graphPos = this.screenToGraph(mouseX, mouseY);

      const hitNode = this.findNodeAt(graphPos.x, graphPos.y);
      this.openContextMenu(e.clientX, e.clientY, hitNode, graphPos);
    });

    c.addEventListener('mousedown', (e) => {
      this.closeContextMenu();
      if (typeof c.focus === 'function') {
        c.focus();
      }
      this.isFocused = true;

      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 1. Check breadcrumb bar clicks (Group navigation)
      if (this.subgraphStack.length > 0) {
        for (const hit of this.breadcrumbHits) {
          if (mouseX >= hit.x && mouseX <= hit.x + hit.w && mouseY >= hit.y && mouseY <= hit.y + hit.h) {
            this.navigateToBreadcrumb(hit.level);
            return;
          }
        }
      }

      // 2. Check Mini-Map interaction
      if (this.showMiniMap && this.isPointInMiniMap(mouseX, mouseY)) {
        this.isDraggingMiniMap = true;
        this.navigateMiniMap(mouseX, mouseY);
        return;
      }

      const graphPos = this.screenToGraph(mouseX, mouseY);
      this.lastMouseClientPos = { x: e.clientX, y: e.clientY };
      this.lastMouseCanvasPos = { x: mouseX, y: mouseY };
      this.lastMouseGraphPos = graphPos;

      // Pan with middle mouse, Alt+Click, or Space+Click
      if (e.button === 1 || (e.button === 0 && (e.altKey || e.spaceKey))) {
        this.isPanning = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        c.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        // Check port click (starting a connection wire)
        const port = this.findPortAt(graphPos.x, graphPos.y);
        if (port) {
          this.isConnecting = true;
          this.wireSource = port;
          this.currentWireMouse = graphPos;
          this.snappedPort = null;
          e.preventDefault();
          return;
        }

        // Check node click
        const node = this.findNodeAt(graphPos.x, graphPos.y);
        if (node) {
          if (!e.shiftKey && !this.selectedNodes.has(node.id)) {
            this.selectedNodes.clear();
          }
          this.selectedNodes.add(node.id);
          this.isDraggingNodes = true;
          this.dragStart = graphPos;

          // Standard behavior: moving a Backdrop automatically moves contained child nodes
          this.backdropChildNodes = new Set();
          for (const selId of this.selectedNodes) {
            const selNode = this.currentGraph.getNode(selId);
            if (selNode && selNode.type === 'Backdrop') {
              const bw = Number(selNode.getKnobValue('boxWidth')) || selNode.width || 360;
              const bh = Number(selNode.getKnobValue('boxHeight')) || selNode.height || 240;
              for (const other of this.currentGraph.getAllNodes()) {
                if (other.id !== selNode.id && !this.selectedNodes.has(other.id)) {
                  if (other.x >= selNode.x && (other.x + other.width) <= (selNode.x + bw) &&
                    other.y >= selNode.y && (other.y + other.height) <= (selNode.y + bh)) {
                    this.backdropChildNodes.add(other.id);
                  }
                }
              }
            }
          }

          if (this.onSelectNode) this.onSelectNode(node);
        } else {
          // Clicked empty background: initiate Marquee Box Selection
          if (!e.shiftKey) {
            this.selectedNodes.clear();
          }
          this.isBoxSelecting = true;
          this.boxSelectStart = graphPos;
          this.boxSelectCurrent = graphPos;
          if (this.onSelectNode) this.onSelectNode(null);
        }
        this.render();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDraggingMiniMap) {
        this.navigateMiniMap(mouseX, mouseY);
        return;
      }

      const graphPos = this.screenToGraph(mouseX, mouseY);
      this.isMouseOverGraph = (mouseX >= 0 && mouseX <= rect.width && mouseY >= 0 && mouseY <= rect.height);
      this.lastMouseClientPos = { x: e.clientX, y: e.clientY };
      this.lastMouseCanvasPos = { x: mouseX, y: mouseY };
      this.lastMouseGraphPos = graphPos;

      if (this.isPanning) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        this.panX += dx;
        this.panY += dy;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.render();
      } else if (this.isBoxSelecting) {
        this.boxSelectCurrent = graphPos;
        const minX = Math.min(this.boxSelectStart.x, this.boxSelectCurrent.x);
        const maxX = Math.max(this.boxSelectStart.x, this.boxSelectCurrent.x);
        const minY = Math.min(this.boxSelectStart.y, this.boxSelectCurrent.y);
        const maxY = Math.max(this.boxSelectStart.y, this.boxSelectCurrent.y);

        for (const n of this.currentGraph.getAllNodes()) {
          const w = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxWidth')) || n.width) : n.width;
          const h = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxHeight')) || n.height) : (n.showPostageStamp ? 96 : n.height);
          // Check box intersection
          if (n.x + w >= minX && n.x <= maxX && n.y + h >= minY && n.y <= maxY) {
            this.selectedNodes.add(n.id);
          }
        }
        this.render();
      } else if (this.isDraggingNodes) {
        const dx = graphPos.x - this.dragStart.x;
        const dy = graphPos.y - this.dragStart.y;
        const nodesToMove = new Set([...this.selectedNodes, ...(this.backdropChildNodes || [])]);
        for (const id of nodesToMove) {
          const node = this.currentGraph.getNode(id);
          if (node) {
            node.x += dx;
            node.y += dy;
            if (this.gridSnap) {
              node.x = Math.round(node.x / this.gridSnapSize) * this.gridSnapSize;
              node.y = Math.round(node.y / this.gridSnapSize) * this.gridSnapSize;
            }
          }
        }
        this.dragStart = graphPos;
        this.render();
      } else if (this.isConnecting) {
        // Magnetic port snapping
        const snapRadius = 24;
        let bestPort = null;
        let bestDist = snapRadius;

        for (const node of this.currentGraph.getAllNodes()) {
          if (node.id === this.wireSource.nodeId) continue;
          // Target must be opposite port type
          if (this.wireSource.isInput) {
            // Dragging input wire -> looking for output ports
            const outX = node.x + node.width * 0.5;
            const outY = node.y + (node.showPostageStamp ? 96 : node.height);
            const d = Math.hypot(graphPos.x - outX, graphPos.y - outY);
            if (d < bestDist) {
              bestDist = d;
              bestPort = { nodeId: node.id, portId: 'out', isInput: false, x: outX, y: outY, label: 'out' };
            }
          } else {
            // Dragging output wire -> looking for input ports
            const inCount = node.inputs.length;
            for (let i = 0; i < inCount; i++) {
              const inp = node.inputs[i];
              const px = node.x + (node.width / (inCount + 1)) * (i + 1);
              const py = node.y;
              const d = Math.hypot(graphPos.x - px, graphPos.y - py);
              if (d < bestDist) {
                bestDist = d;
                bestPort = { nodeId: node.id, portId: inp.id, isInput: true, x: px, y: py, label: inp.label };
              }
            }
          }
        }

        if (bestPort) {
          this.snappedPort = bestPort;
          this.currentWireMouse = { x: bestPort.x, y: bestPort.y };
        } else {
          this.snappedPort = null;
          this.currentWireMouse = graphPos;
        }

        this.hoveredPort = this.findPortAt(graphPos.x, graphPos.y);
        this.render();
      } else {
        // Hover state
        this.hoveredPort = this.findPortAt(graphPos.x, graphPos.y);
        c.style.cursor = this.hoveredPort ? 'pointer' : 'default';
      }
    });

    window.addEventListener('mouseup', (e) => {
      this.isDraggingMiniMap = false;

      if (this.isConnecting && this.wireSource) {
        const targetPort = this.snappedPort || (() => {
          const rect = c.getBoundingClientRect();
          const graphPos = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
          return this.findPortAt(graphPos.x, graphPos.y);
        })();

        if (targetPort && targetPort.nodeId !== this.wireSource.nodeId) {
          // Output to Input connection
          if (!this.wireSource.isInput && targetPort.isInput) {
            this.currentGraph.connect(this.wireSource.nodeId, this.wireSource.portId, targetPort.nodeId, targetPort.portId);
          } else if (this.wireSource.isInput && !targetPort.isInput) {
            this.currentGraph.connect(targetPort.nodeId, targetPort.portId, this.wireSource.nodeId, this.wireSource.portId);
          }
        } else if (!targetPort && this.wireSource.isInput) {
          // Dragged input off into space: disconnect
          this.currentGraph.disconnect(this.wireSource.nodeId, this.wireSource.portId);
        }
      }

      this.isPanning = false;
      this.isDraggingNodes = false;
      this.backdropChildNodes = null;
      this.isConnecting = false;
      this.isBoxSelecting = false;
      this.wireSource = null;
      this.snappedPort = null;
      this.render();
    });

    // Double click to open node properties or enter Group
    c.addEventListener('dblclick', (e) => {
      const rect = c.getBoundingClientRect();
      const graphPos = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
      const node = this.findNodeAt(graphPos.x, graphPos.y);
      if (node) {
        if (node.type === 'Group' && (e.ctrlKey || e.metaKey)) {
          this.enterGroup(node);
          return;
        }
        if (this.onDoubleClickNode) {
          this.onDoubleClickNode(node);
        }
      }
    });

    // Drag & Drop external footage/images directly onto Node Graph
    c.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    c.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;

      const rect = c.getBoundingClientRect();
      const dropPos = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          const targetPos = { x: dropPos.x + i * 40, y: dropPos.y + i * 40 };
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

              const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
              const readNode = createNode('Read', `Read_${cleanName}`, targetPos.x, targetPos.y);
              if (readNode) {
                readNode.setUploadedImage(buf);
                this.currentGraph.addNode(readNode);
                this.selectedNodes.clear();
                this.selectedNodes.add(readNode.id);
                if (this.onSelectNode) this.onSelectNode(readNode);
                this.render();
              }
            };
            img.src = event.target.result;
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // Keybindings (Workstation Shortcuts)
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      const isFormElement = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(e.target && e.target.isContentEditable);
      const isInsideProperties = Boolean(e.target && e.target.closest && e.target.closest('#properties-panel'));
      const isInsideSearchPopup = Boolean(e.target && e.target.closest && e.target.closest('#node-search-popup'));

      if (isFormElement || isInsideProperties || isInsideSearchPopup) {
        return;
      }

      const selectedList = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
      const primaryNode = selectedList[0];

      // Ctrl+Enter: Enter selected Group node
      if (e.ctrlKey && e.key === 'Enter' && primaryNode && primaryNode.type === 'Group') {
        e.preventDefault();
        this.enterGroup(primaryNode);
        return;
      }

      // Ctrl+Backspace or Backspace with no selection in group: Exit Group
      if ((e.ctrlKey && e.key === 'Backspace') || (e.key === 'Escape' && this.subgraphStack.length > 0)) {
        if (this.subgraphStack.length > 0) {
          e.preventDefault();
          this.exitGroup();
          return;
        }
      }

      // Alt+K: Clone Selected Node
      if (e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        this.cloneSelected();
        return;
      }

      // Alt+P: Toggle Live Postage Stamp
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        this.togglePostageStamp();
        return;
      }

      // Ctrl+G: Group Selected Nodes
      if (e.ctrlKey && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        this.groupSelected();
        return;
      }

      // Ctrl+Shift+X: Extract Selected Node
      if (e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        this.extractSelectedNode();
        return;
      }

      // Ctrl+Up: Select Upstream Tree
      if (e.ctrlKey && e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectUpstream();
        return;
      }

      // Ctrl+Down: Select Downstream Tree
      if (e.ctrlKey && e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectDownstream();
        return;
      }

      // 'F': Frame Selected Nodes
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.frameSelected();
        return;
      }

      // 'A' or 'H': Frame All Nodes
      if ((e.key === 'a' || e.key === 'A' || e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.frameAll();
        return;
      }

      // 'M': Toggle Mini-Map
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.showMiniMap = !this.showMiniMap;
        this.render();
        return;
      }

      // Quick Bookmarks 1-6
      if (e.ctrlKey && e.altKey && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        this.saveBookmark(`Bookmark ${e.key}`, e.key);
        return;
      } else if (e.altKey && !e.ctrlKey && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        this.jumpToBookmark(e.key);
        return;
      }

      // Ctrl+A: Select All Nodes
      if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        for (const n of this.currentGraph.getAllNodes()) {
          this.selectedNodes.add(n.id);
        }
        this.render();
        return;
      }

      // Ctrl+C: Copy Selected Nodes
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        this.copySelected();
        return;
      }

      // Ctrl+V: Paste Nodes
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        this.paste();
        return;
      }

      // Ctrl+D: Duplicate Selected Nodes
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.duplicateSelected();
        return;
      }

      // Ctrl+Z: Undo
      if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (this.onUndo) this.onUndo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if ((e.ctrlKey && (e.key === 'y' || e.key === 'Y')) || (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault();
        if (this.onRedo) this.onRedo();
        return;
      }

      // Tab key: open Node Spawner Search
      if (e.key === 'Tab') {
        if (this.isConnecting) return;
        e.preventDefault();
        this.openNodeSearchPopup();
        return;
      }

      // Delete or Backspace: Remove selected nodes
      if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey)) {
        for (const node of selectedList) {
          this.currentGraph.removeNode(node.id);
        }
        this.selectedNodes.clear();
        this.render();
        return;
      }

      // 'D': Disable / Enable node (Toggle shortcut)
      if (e.key === 'd' || e.key === 'D') {
        for (const node of selectedList) {
          node.disabled = !node.disabled;
          node.markDirty();
        }
        this.render();
        return;
      }

      // Number keys 1-9 and 0: Connect to Viewer Input 1-10
      if (((e.key >= '1' && e.key <= '9') || e.key === '0') && primaryNode) {
        let viewer = this.currentGraph.getAllNodes().find(n => n.type === 'Viewer');
        if (!viewer) {
          viewer = createNode('Viewer', 'Viewer1', primaryNode.x, primaryNode.y + 160);
          this.currentGraph.addNode(viewer);
        }
        const portId = e.key === '0' ? '10' : e.key;
        this.currentGraph.connect(primaryNode.id, 'out', viewer.id, portId);
        viewer.setKnobValue('activeInput', portId);
        this.render();
        return;
      }

      // Fast node creation hotkeys
      const keyUpper = e.key.toUpperCase();
      let spawnType = null;
      if (keyUpper === 'M') spawnType = 'Merge';
      else if (keyUpper === 'G') spawnType = 'Grade';
      else if (keyUpper === 'C') spawnType = 'ColorCorrect';
      else if (keyUpper === 'B') spawnType = 'Blur';
      else if (keyUpper === 'T') spawnType = 'Transform';
      else if (keyUpper === 'K') spawnType = 'Keyer';
      else if (keyUpper === 'R') spawnType = 'Read';
      else if (keyUpper === 'W') spawnType = 'Write';
      else if (keyUpper === 'O') spawnType = 'Roto';
      else if (keyUpper === 'P') spawnType = 'Premult';
      else if (keyUpper === 'S') spawnType = 'Shuffle';
      else if (keyUpper === 'E') spawnType = 'Erode';
      else if (e.key === '.') spawnType = 'Dot';

      if (spawnType) {
        const posX = primaryNode ? primaryNode.x : this.screenToGraph(c.width * 0.5, c.height * 0.5).x;
        const posY = primaryNode ? primaryNode.y + 80 : this.screenToGraph(c.width * 0.5, c.height * 0.5).y;
        const newNode = createNode(spawnType, null, posX, posY);
        if (newNode) {
          this.currentGraph.addNode(newNode);
          if (primaryNode && newNode.inputs.length > 0) {
            const inPort = newNode.inputs.find(inp => inp.id === 'B' || inp.id === 'in');
            if (inPort) {
              this.currentGraph.connect(primaryNode.id, 'out', newNode.id, inPort.id);
            }
          }
          this.selectedNodes.clear();
          this.selectedNodes.add(newNode.id);
          if (this.onSelectNode) this.onSelectNode(newNode);
          this.render();
        }
      }
    });

    window.addEventListener('resize', () => this.resizeCanvas());
    this.resizeCanvas();
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render();
  }

  screenToGraph(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom
    };
  }

  graphToScreen(gx, gy) {
    return {
      x: gx * this.zoom + this.panX,
      y: gy * this.zoom + this.panY
    };
  }

  findNodeAt(gx, gy) {
    const nodes = this.currentGraph.getAllNodes();
    // 1. Check normal nodes first
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === 'Backdrop') continue;
      const h = n.showPostageStamp ? 96 : n.height;
      if (gx >= n.x && gx <= n.x + n.width && gy >= n.y && gy <= n.y + h) {
        return n;
      }
    }
    // 2. Check Backdrops second
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type !== 'Backdrop') continue;
      const bw = Number(n.getKnobValue('boxWidth')) || n.width;
      const bh = Number(n.getKnobValue('boxHeight')) || n.height;
      if (gx >= n.x && gx <= n.x + bw && gy >= n.y && gy <= n.y + bh) {
        return n;
      }
    }
    return null;
  }

  findPortAt(gx, gy) {
    const hitRadius = 14;
    for (const node of this.currentGraph.getAllNodes()) {
      // Check inputs
      const inCount = node.inputs.length;
      for (let i = 0; i < inCount; i++) {
        const inp = node.inputs[i];
        const portX = node.x + (node.width / (inCount + 1)) * (i + 1);
        const portY = node.y;
        const d = Math.hypot(gx - portX, gy - portY);
        if (d <= hitRadius) {
          return { nodeId: node.id, portId: inp.id, isInput: true, x: portX, y: portY, label: inp.label };
        }
      }

      // Check outputs
      const outCount = node.outputs.length;
      const nodeH = node.showPostageStamp ? 96 : node.height;
      for (let i = 0; i < outCount; i++) {
        const out = node.outputs[i];
        const portX = node.x + (node.width / (outCount + 1)) * (i + 1);
        const portY = node.y + nodeH;
        const d = Math.hypot(gx - portX, gy - portY);
        if (d <= hitRadius) {
          return { nodeId: node.id, portId: out.id, isInput: false, x: portX, y: portY, label: out.name };
        }
      }
    }
    return null;
  }

  enterGroup(groupNode) {
    if (!groupNode || groupNode.type !== 'Group' || !groupNode.subgraph) return;
    this.subgraphStack.push({
      graph: this.activeGraph,
      groupNode,
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom
    });

    this.activeGraph = groupNode.subgraph;
    this.selectedNodes.clear();
    this.frameAll();
    this.render();
  }

  exitGroup() {
    if (this.subgraphStack.length === 0) return;
    const prev = this.subgraphStack.pop();
    this.activeGraph = prev.graph;
    this.panX = prev.panX;
    this.panY = prev.panY;
    this.zoom = prev.zoom;
    this.selectedNodes.clear();
    if (prev.groupNode) {
      this.selectedNodes.add(prev.groupNode.id);
      if (this.onSelectNode) this.onSelectNode(prev.groupNode);
    }
    this.render();
  }

  navigateToBreadcrumb(level) {
    while (this.subgraphStack.length > level) {
      const prev = this.subgraphStack.pop();
      this.activeGraph = prev.graph;
      this.panX = prev.panX;
      this.panY = prev.panY;
      this.zoom = prev.zoom;
    }
    this.selectedNodes.clear();
    this.render();
  }

  saveBookmark(name, slot = null) {
    const key = slot ? String(slot) : name;
    this.bookmarks.set(key, {
      name,
      slot,
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
      timestamp: Date.now()
    });
  }

  jumpToBookmark(slotOrName) {
    const key = String(slotOrName);
    const bm = this.bookmarks.get(key);
    if (bm) {
      this.panX = bm.panX;
      this.panY = bm.panY;
      this.zoom = bm.zoom;
      this.render();
      return true;
    }
    return false;
  }

  frameSelected() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    if (selected.length === 0) {
      this.frameAll();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of selected) {
      const w = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxWidth')) || n.width) : n.width;
      const h = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxHeight')) || n.height) : (n.showPostageStamp ? 96 : n.height);
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + w);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + h);
    }

    this.frameBounds(minX, minY, maxX, maxY);
  }

  frameAll() {
    const nodes = this.currentGraph.getAllNodes();
    if (nodes.length === 0) {
      this.panX = this.canvas.width * 0.5;
      this.panY = this.canvas.height * 0.5;
      this.zoom = 1.0;
      this.render();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxWidth')) || n.width) : n.width;
      const h = n.type === 'Backdrop' ? (Number(n.getKnobValue('boxHeight')) || n.height) : (n.showPostageStamp ? 96 : n.height);
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + w);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + h);
    }

    this.frameBounds(minX, minY, maxX, maxY);
  }

  frameBounds(minX, minY, maxX, maxY) {
    const c = this.canvas;
    const margin = 80;
    const w = Math.max(100, maxX - minX);
    const h = Math.max(100, maxY - minY);

    const availW = Math.max(100, c.width - margin * 2);
    const availH = Math.max(100, c.height - margin * 2);

    const fitZoom = Math.max(0.25, Math.min(2.0, Math.min(availW / w, availH / h)));
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;

    this.zoom = fitZoom;
    this.panX = c.width * 0.5 - centerX * this.zoom;
    this.panY = c.height * 0.5 - centerY * this.zoom;
    this.render();
  }

  togglePostageStamp() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    for (const node of selected) {
      if (node.type === 'Backdrop' || node.type === 'Dot') continue;
      node.showPostageStamp = !node.showPostageStamp;
      node.height = node.showPostageStamp ? 96 : 36;
      node.markDirty();
    }
    this.render();
  }

  cloneSelected() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    if (selected.length === 0) return;

    const newClones = [];
    for (const master of selected) {
      const clone = cloneNode(master, this.currentGraph);
      if (clone) {
        newClones.push(clone);
      }
    }

    this.selectedNodes.clear();
    for (const c of newClones) {
      this.selectedNodes.add(c.id);
    }
    if (newClones.length > 0 && this.onSelectNode) {
      this.onSelectNode(newClones[0]);
    }
    this.render();
  }

  groupSelected() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    if (selected.length === 0) return;

    const group = createGroupFromSelection(selected, this.currentGraph);
    if (group) {
      this.selectedNodes.clear();
      this.selectedNodes.add(group.id);
      if (this.onSelectNode) this.onSelectNode(group);
      this.render();
    }
  }

  extractSelectedNode() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    for (const node of selected) {
      // Find upstream primary connection
      let primaryInput = null;
      for (const inp of node.inputs) {
        if (inp.connection) {
          primaryInput = inp.connection;
          break;
        }
      }

      // Reconnect downstream nodes to upstream
      for (const other of this.currentGraph.getAllNodes()) {
        for (const inp of other.inputs) {
          if (inp.connection && inp.connection.nodeId === node.id) {
            if (primaryInput) {
              inp.connection = { ...primaryInput };
              other.markDirty();
            } else {
              inp.connection = null;
              other.markDirty();
            }
          }
        }
      }

      // Disconnect node
      for (const inp of node.inputs) {
        inp.connection = null;
      }
      node.x += 40;
      node.markDirty();
    }
    this.render();
  }

  selectUpstream() {
    const selected = Array.from(this.selectedNodes);
    const toVisit = [...selected];
    const visited = new Set(selected);

    while (toVisit.length > 0) {
      const id = toVisit.pop();
      const node = this.currentGraph.getNode(id);
      if (node) {
        for (const inp of node.inputs) {
          if (inp.connection && !visited.has(inp.connection.nodeId)) {
            visited.add(inp.connection.nodeId);
            toVisit.push(inp.connection.nodeId);
            this.selectedNodes.add(inp.connection.nodeId);
          }
        }
      }
    }
    this.render();
  }

  selectDownstream() {
    const selected = Array.from(this.selectedNodes);
    const toVisit = [...selected];
    const visited = new Set(selected);

    while (toVisit.length > 0) {
      const id = toVisit.pop();
      for (const other of this.currentGraph.getAllNodes()) {
        for (const inp of other.inputs) {
          if (inp.connection && inp.connection.nodeId === id && !visited.has(other.id)) {
            visited.add(other.id);
            toVisit.push(other.id);
            this.selectedNodes.add(other.id);
          }
        }
      }
    }
    this.render();
  }

  isPointInMiniMap(sx, sy) {
    const c = this.canvas;
    const mb = this.miniMapBounds;
    mb.x = c.width - mb.w - 16;
    mb.y = c.height - mb.h - 16;
    return (sx >= mb.x && sx <= mb.x + mb.w && sy >= mb.y && sy <= mb.y + mb.h);
  }

  navigateMiniMap(sx, sy) {
    const c = this.canvas;
    const mb = this.miniMapBounds;
    const nodes = this.currentGraph.getAllNodes();
    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.width);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + (n.showPostageStamp ? 96 : n.height));
    }
    const pad = 200;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const mapW = maxX - minX;
    const mapH = maxY - minY;

    const relX = (sx - mb.x) / mb.w;
    const relY = (sy - mb.y) / mb.h;

    const targetGX = minX + relX * mapW;
    const targetGY = minY + relY * mapH;

    this.panX = c.width * 0.5 - targetGX * this.zoom;
    this.panY = c.height * 0.5 - targetGY * this.zoom;
    this.render();
  }

  openContextMenu(clientX, clientY, node, graphPos) {
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

    if (node) {
      const header = document.createElement('div');
      header.className = 'ctx-header';
      header.textContent = `${node.name} (${node.type})`;
      menu.appendChild(header);

      addItem('Properties...', '', () => {
        if (this.onDoubleClickNode) this.onDoubleClickNode(node);
      });
      addItem('Disable / Enable', 'D', () => {
        node.disabled = !node.disabled;
        node.markDirty();
        this.render();
      });
      addItem('Clone Node', 'Alt+K', () => this.cloneSelected());
      addItem('Toggle Postage Stamp', 'Alt+P', () => this.togglePostageStamp());
      addItem('Group Selected', 'Ctrl+G', () => this.groupSelected());
      addItem('Extract Node', 'Ctrl+Shift+X', () => this.extractSelectedNode());
      addHr();
      addItem('Duplicate', 'Ctrl+D', () => this.duplicateSelected());
      addItem('Copy', 'Ctrl+C', () => this.copySelected());
      addItem('Frame Selected', 'F', () => this.frameSelected());
      addHr();
      addItem('Delete', 'Del', () => {
        this.currentGraph.removeNode(node.id);
        this.selectedNodes.delete(node.id);
        this.render();
      });
    } else {
      const header = document.createElement('div');
      header.className = 'ctx-header';
      header.textContent = this.subgraphStack.length > 0 ? 'Group Subgraph' : 'Node Graph';
      menu.appendChild(header);

      addItem('Add Node...', 'Tab', () => this.openNodeSearchPopup(this.lastMouseClientPos, graphPos));
      addItem('Paste', 'Ctrl+V', () => this.paste());
      addItem('Frame All', 'A', () => this.frameAll());
      addItem('Toggle Mini-Map', 'M', () => {
        this.showMiniMap = !this.showMiniMap;
        this.render();
      });
      if (this.subgraphStack.length > 0) {
        addHr();
        addItem('Exit Group', 'Ctrl+Backspace', () => this.exitGroup());
      }
    }

    document.body.appendChild(menu);
    this.activeContextMenuEl = menu;

    // Boundary check so menu doesn't overflow screen
    const mRect = menu.getBoundingClientRect();
    if (mRect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - mRect.width - 8}px`;
    }
    if (mRect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - mRect.height - 8}px`;
    }
  }

  closeContextMenu() {
    if (this.activeContextMenuEl) {
      this.activeContextMenuEl.remove();
      this.activeContextMenuEl = null;
    }
  }

  openNodeSearchPopup(clientPos = null, graphPos = null) {
    const cPos = clientPos || (this.isMouseOverGraph ? this.lastMouseClientPos : null);
    const gPos = graphPos || (this.isMouseOverGraph ? this.lastMouseGraphPos : null) || this.screenToGraph(this.canvas.width * 0.5, this.canvas.height * 0.5);

    if (typeof this.onOpenSearchPopup === 'function') {
      this.onOpenSearchPopup(cPos, gPos);
      return;
    }

    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    if (!popup || !input) return;

    popup.style.display = 'block';
    input.value = '';
    input.focus();
    setTimeout(() => {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }, 10);
  }

  render() {
    const ctx = this.ctx;
    const c = this.canvas;

    ctx.save();
    // Background
    ctx.fillStyle = '#232323';
    ctx.fillRect(0, 0, c.width, c.height);

    // Grid dots
    const gridSize = 24 * this.zoom;
    const offsetX = this.panX % gridSize;
    const offsetY = this.panY % gridSize;

    ctx.fillStyle = '#2e2e2e';
    for (let x = offsetX; x < c.width; x += gridSize) {
      for (let y = offsetY; y < c.height; y += gridSize) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 0. Draw Backdrop Nodes
    for (const node of this.currentGraph.getAllNodes()) {
      if (node.type !== 'Backdrop') continue;
      const isSelected = this.selectedNodes.has(node.id);
      const bw = Number(node.getKnobValue('boxWidth')) || node.width;
      const bh = Number(node.getKnobValue('boxHeight')) || node.height;
      const tint = node.getKnobValue('noteColor') || '#334155';
      const label = node.getKnobValue('label') || node.name;

      ctx.fillStyle = tint + '33';
      ctx.strokeStyle = isSelected ? '#ff922b' : tint;
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.roundRect(node.x, node.y, bw, bh, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.roundRect(node.x, node.y, bw, 26, [6, 6, 0, 0]);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, node.x + 12, node.y + 13);
    }

    // 1. Draw Connection Wires (Cubic Bezier pipes)
    for (const node of this.currentGraph.getAllNodes()) {
      const inCount = node.inputs.length;
      for (let i = 0; i < inCount; i++) {
        const inp = node.inputs[i];
        if (inp.connection) {
          const upstream = this.currentGraph.getNode(inp.connection.nodeId);
          if (upstream) {
            const startX = upstream.x + upstream.width * 0.5;
            const startY = upstream.y + (upstream.showPostageStamp ? 96 : upstream.height);
            const endX = node.x + (node.width / (inCount + 1)) * (i + 1);
            const endY = node.y;

            this.drawWire(ctx, startX, startY, endX, endY, inp.id === 'mask' ? '#4dabf7' : '#e6a100');
          }
        }
      }
    }

    // Draw active wire currently being dragged
    if (this.isConnecting && this.wireSource) {
      let wireColor = '#ffbb33';
      if (this.snappedPort) {
        const isCycle = !this.wireSource.isInput 
          ? this.currentGraph.canReach(this.snappedPort.nodeId, this.wireSource.nodeId)
          : this.currentGraph.canReach(this.wireSource.nodeId, this.snappedPort.nodeId);
        wireColor = isCycle ? '#fa5252' : '#51cf66';
      }
      this.drawWire(ctx, this.wireSource.x, this.wireSource.y, this.currentWireMouse.x, this.currentWireMouse.y, wireColor, true);

      // Port glow on snapped target
      if (this.snappedPort) {
        ctx.strokeStyle = wireColor;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(this.snappedPort.x, this.snappedPort.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 2. Draw Nodes
    for (const node of this.currentGraph.getAllNodes()) {
      if (node.type === 'Backdrop') continue;
      const isSelected = this.selectedNodes.has(node.id);
      const isPostage = !!node.showPostageStamp;
      const nodeH = isPostage ? 96 : node.height;

      if (node.type === 'Dot') {
        ctx.fillStyle = isSelected ? '#ff922b' : node.color;
        ctx.beginPath();
        ctx.arc(node.x + 8, node.y + 8, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();
        continue;
      }

      // Box Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;

      // Node Body
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.roundRect(node.x, node.y, node.width, nodeH, 4);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Selection Highlight Border
      ctx.strokeStyle = isSelected ? '#ff922b' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.stroke();

      // Live Postage Stamp Preview
      if (isPostage) {
        // Dark inner frame
        ctx.fillStyle = '#161616';
        ctx.beginPath();
        ctx.roundRect(node.x + 12, node.y + 24, node.width - 24, 60, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const thumb = node.generateThumbnail ? node.generateThumbnail(node.width - 24, 60) : null;
        if (thumb) {
          const drawW = thumb.width;
          const drawH = thumb.height;
          const drawX = node.x + 12 + ((node.width - 24) - drawW) * 0.5;
          const drawY = node.y + 24 + (60 - drawH) * 0.5;
          ctx.drawImage(thumb, drawX, drawY, drawW, drawH);
        } else {
          ctx.fillStyle = '#555';
          ctx.font = '9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Thumbnail', node.x + node.width * 0.5, node.y + 56);
        }

        // Header Title text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.name, node.x + node.width * 0.5, node.y + 12);
      } else {
        // Standard Node Label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.name, node.x + node.width * 0.5, node.y + 16);

        // Subtitle format badge (e.g. 1920x1080)
        if (node.cachedBuffer && node.cachedBuffer.width) {
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = '8px Inter, sans-serif';
          ctx.fillText(`${node.cachedBuffer.width}×${node.cachedBuffer.height}`, node.x + node.width * 0.5, node.y + 28);
        }
      }

      // Disabled State Overlay
      if (node.disabled) {
        ctx.strokeStyle = '#fa5252';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(node.x + node.width, node.y + nodeH);
        ctx.moveTo(node.x + node.width, node.y);
        ctx.lineTo(node.x, node.y + nodeH);
        ctx.stroke();
      }

      // Status Badges (Top-Right of Node)
      const badgeY = node.y + 5;
      let badgeX = node.x + node.width - 6;

      // 1. Status Indicator (Cached / Dirty / Error)
      ctx.beginPath();
      if (node.status === 'error') {
        ctx.fillStyle = '#fa5252';
        ctx.arc(badgeX, badgeY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (node.cachedBuffer && !node.isDirty) {
        ctx.fillStyle = '#51cf66';
        ctx.arc(badgeX, badgeY, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fab005';
        ctx.arc(badgeX, badgeY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      badgeX -= 9;

      // 2. Clone Badge [C]
      if (node.isClone && node.isClone()) {
        ctx.fillStyle = '#ff922b';
        ctx.font = 'bold 8px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('C', badgeX, badgeY + 3);
        badgeX -= 9;
      }

      // 3. Keyframe Animation Badge [◆]
      if (node.hasAnyKeyframes && node.hasAnyKeyframes()) {
        ctx.fillStyle = '#ffd43b';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('◆', badgeX, badgeY + 3);
        badgeX -= 9;
      }

      // 4. Expression Badge [f(x)]
      if (node.hasAnyExpressions && node.hasAnyExpressions()) {
        ctx.fillStyle = '#339af0';
        ctx.font = 'bold 7px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('fx', badgeX, badgeY + 3);
        badgeX -= 11;
      }

      // Input Ports
      const inCount = node.inputs.length;
      for (let i = 0; i < inCount; i++) {
        const inp = node.inputs[i];
        const px = node.x + (node.width / (inCount + 1)) * (i + 1);
        const py = node.y;

        ctx.fillStyle = inp.connection ? '#ffbb33' : '#777';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        if (inCount > 1) {
          ctx.font = '9px Inter, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillText(inp.id, px, py - 8);
        }
      }

      // Output Port
      const outX = node.x + node.width * 0.5;
      const outY = node.y + nodeH;
      ctx.fillStyle = '#ffbb33';
      ctx.beginPath();
      ctx.arc(outX, outY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Draw Marquee Selection Box
    if (this.isBoxSelecting) {
      const minX = Math.min(this.boxSelectStart.x, this.boxSelectCurrent.x);
      const maxX = Math.max(this.boxSelectStart.x, this.boxSelectCurrent.x);
      const minY = Math.min(this.boxSelectStart.y, this.boxSelectCurrent.y);
      const maxY = Math.max(this.boxSelectStart.y, this.boxSelectCurrent.y);

      ctx.fillStyle = 'rgba(255, 146, 43, 0.12)';
      ctx.strokeStyle = 'rgba(255, 146, 43, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.setLineDash([]);
    }

    ctx.restore();

    // =========================================================================
    // Screen-Space Overlays (Breadcrumbs & Mini-Map)
    // =========================================================================

    // 4. Subgraph Breadcrumbs
    this.breadcrumbHits = [];
    if (this.subgraphStack.length > 0) {
      let curX = 16;
      const curY = 16;
      ctx.save();
      ctx.font = '11px Inter, sans-serif';

      // Root item
      const rootText = 'Root Graph';
      const rootW = ctx.measureText(rootText).width + 16;
      ctx.fillStyle = 'rgba(30, 30, 30, 0.88)';
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(curX, curY, rootW, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ff922b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rootText, curX + rootW * 0.5, curY + 12);
      this.breadcrumbHits.push({ label: 'Root', level: 0, x: curX, y: curY, w: rootW, h: 24 });
      curX += rootW + 6;

      // Group levels
      for (let lvl = 0; lvl < this.subgraphStack.length; lvl++) {
        // Arrow separator
        ctx.fillStyle = '#888';
        ctx.fillText('›', curX, curY + 12);
        curX += 10;

        const entry = this.subgraphStack[lvl];
        const gName = entry.groupNode.name || 'Group';
        const gW = ctx.measureText(gName).width + 16;

        const isCurrent = (lvl === this.subgraphStack.length - 1);
        ctx.fillStyle = isCurrent ? '#4a6b5d' : 'rgba(30, 30, 30, 0.88)';
        ctx.strokeStyle = isCurrent ? '#51cf66' : '#444';
        ctx.beginPath();
        ctx.roundRect(curX, curY, gW, 24, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.fillText(gName, curX + gW * 0.5, curY + 12);
        this.breadcrumbHits.push({ label: gName, level: lvl + 1, x: curX, y: curY, w: gW, h: 24 });
        curX += gW + 6;
      }

      // Exit Group button
      const exitText = '✕ Exit Group [Esc]';
      const exitW = ctx.measureText(exitText).width + 14;
      curX += 8;
      ctx.fillStyle = 'rgba(250, 82, 82, 0.2)';
      ctx.strokeStyle = '#fa5252';
      ctx.beginPath();
      ctx.roundRect(curX, curY, exitW, 24, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fa5252';
      ctx.fillText(exitText, curX + exitW * 0.5, curY + 12);
      this.breadcrumbHits.push({ label: 'Exit', level: this.subgraphStack.length - 1, x: curX, y: curY, w: exitW, h: 24 });

      ctx.restore();
    }

    // 5. Mini-Map Viewport Navigator
    if (this.showMiniMap) {
      const mb = this.miniMapBounds;
      mb.x = c.width - mb.w - 16;
      mb.y = c.height - mb.h - 16;

      ctx.save();
      // Mini-map card background
      ctx.fillStyle = 'rgba(25, 25, 25, 0.88)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(mb.x, mb.y, mb.w, mb.h, 6);
      ctx.fill();
      ctx.stroke();

      const nodes = this.currentGraph.getAllNodes();
      if (nodes.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
          minX = Math.min(minX, n.x);
          maxX = Math.max(maxX, n.x + n.width);
          minY = Math.min(minY, n.y);
          maxY = Math.max(maxY, n.y + (n.showPostageStamp ? 96 : n.height));
        }
        const pad = 160;
        minX -= pad; maxX += pad; minY -= pad; maxY += pad;
        const mapW = maxX - minX || 1;
        const mapH = maxY - minY || 1;

        // Draw mini node blocks
        for (const n of nodes) {
          const nx = mb.x + ((n.x - minX) / mapW) * mb.w;
          const ny = mb.y + ((n.y - minY) / mapH) * mb.h;
          const nw = Math.max(3, (n.width / mapW) * mb.w);
          const nh = Math.max(2, ((n.showPostageStamp ? 96 : n.height) / mapH) * mb.h);

          ctx.fillStyle = n.color || '#888';
          ctx.fillRect(nx, ny, nw, nh);
        }

        // Viewport frustum box
        const vp0 = this.screenToGraph(0, 0);
        const vp1 = this.screenToGraph(c.width, c.height);

        const vx = mb.x + ((vp0.x - minX) / mapW) * mb.w;
        const vy = mb.y + ((vp0.y - minY) / mapH) * mb.h;
        const vw = ((vp1.x - vp0.x) / mapW) * mb.w;
        const vh = ((vp1.y - vp0.y) / mapH) * mb.h;

        ctx.fillStyle = 'rgba(255, 146, 43, 0.18)';
        ctx.strokeStyle = '#ff922b';
        ctx.lineWidth = 1.2;
        if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(vx, vy, vw, vh);
        }
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(vx, vy, vw, vh);
        }
      }

      ctx.restore();
    }
  }

  copySelected() {
    const selected = Array.from(this.selectedNodes).map(id => this.currentGraph.getNode(id)).filter(Boolean);
    if (selected.length === 0) return;
    this.clipboard = selected.map(n => n.serialize());
  }

  paste(offset = { x: 40, y: 40 }) {
    if (!this.clipboard || this.clipboard.length === 0) return;

    const idMap = new Map();
    const newNodes = [];

    // First pass: create new nodes with fresh IDs
    for (const data of this.clipboard) {
      const newNode = createNode(data.type, null, (data.x || 0) + offset.x, (data.y || 0) + offset.y);
      if (newNode) {
        newNode.deserialize(data);
        newNode.x = (data.x || 0) + offset.x;
        newNode.y = (data.y || 0) + offset.y;
        idMap.set(data.id, newNode.id);
        newNodes.push(newNode);
      }
    }

    // Second pass: remap internal connections among copied nodes
    for (const newNode of newNodes) {
      for (const inp of newNode.inputs) {
        if (inp.connection && idMap.has(inp.connection.nodeId)) {
          inp.connection.nodeId = idMap.get(inp.connection.nodeId);
        } else if (inp.connection && !this.currentGraph.getNode(inp.connection.nodeId)) {
          inp.connection = null;
        }
      }
      this.currentGraph.addNode(newNode);
    }

    this.selectedNodes.clear();
    for (const newNode of newNodes) {
      this.selectedNodes.add(newNode.id);
    }
    if (newNodes.length > 0 && this.onSelectNode) {
      this.onSelectNode(newNodes[0]);
    }
    this.render();
  }

  duplicateSelected() {
    this.copySelected();
    this.paste({ x: 30, y: 50 });
  }

  drawWire(ctx, x0, y0, x1, y1, color = '#e6a100', dashed = false) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    if (dashed) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }

    const dy = Math.max(30, Math.abs(y1 - y0) * 0.5);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0, y0 + dy, x1, y1 - dy, x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
