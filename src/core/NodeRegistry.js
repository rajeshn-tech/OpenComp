/**
 * OpenComp - Node Registry & Creation Service
 * Central authority for registering, categorizing, discovering, and creating all production nodes.
 */

import { NODE_REGISTRY, NODE_MENU, createNode } from '../nodes/index.js';

export { NODE_REGISTRY, NODE_MENU, createNode };

/**
 * NodeCreationService
 * Single authoritative service for node instantiation, placement, auto-connection,
 * DAG registration, Properties Bin display, and viewport evaluation.
 * Used uniformly by Tab Search, Top Nodes Menu, Left Palette, Context Menus, and Shortcuts.
 */
export class NodeCreationService {
  /**
   * @param {import('../app.js').OpenCompApp} app 
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Builds the comprehensive, dynamic 34-node catalog with category, label, and shortcut metadata.
   * @returns {Array<{type: string, category: string, label: string, shortcut: string}>}
   */
  getCatalog() {
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

  /**
   * Instantiates, positions, auto-connects, selects, displays, and evaluates any node.
   * @param {string} type - Node type (e.g. 'Grade', 'Blur', 'Merge')
   * @param {Object} options - Placement and connection options
   * @param {number} [options.posX] - Explicit graph X
   * @param {number} [options.posY] - Explicit graph Y
   * @param {{x: number, y: number}} [options.cursorPos] - Client or graph cursor coordinates
   * @param {boolean} [options.autoConnect=true] - Whether to auto-connect to upstream selected node
   * @param {boolean} [options.forcePosition=false] - If true, bypasses automatic downstream placement
   * @param {string} [options.customId] - Optional custom node ID
   * @returns {import('./Node.js').Node|null} The created node instance
   */
  createNode(type, options = {}) {
    const NodeClass = NODE_REGISTRY[type];
    if (!NodeClass) {
      console.error(`[NodeCreationService] Unknown node type: ${type}`);
      return null;
    }

    const graph = this.app.graph;
    const nodeGraphUI = this.app.nodeGraphUI;
    const canvas = this.app.nodeCanvas;

    // 1. Check upstream selected node for auto-connection
    const selectedIds = nodeGraphUI ? Array.from(nodeGraphUI.selectedNodes) : [];
    let selectedNode = null;
    if (selectedIds.length === 1) {
      selectedNode = graph.getNode(selectedIds[0]);
    }

    // 2. Compute placement coordinates
    let spawnX = options.posX;
    let spawnY = options.posY;

    if (spawnX === undefined || spawnY === undefined) {
      if (selectedNode && !options.forcePosition) {
        // Downstream creation below selected node
        spawnX = selectedNode.x;
        spawnY = selectedNode.y + selectedNode.height + 40;
      } else if (options.cursorPos) {
        spawnX = options.cursorPos.x - 55;
        spawnY = options.cursorPos.y - 18;
      } else if (nodeGraphUI && nodeGraphUI.lastMouseGraphPos && nodeGraphUI.isMouseOverGraph) {
        spawnX = nodeGraphUI.lastMouseGraphPos.x - 55;
        spawnY = nodeGraphUI.lastMouseGraphPos.y - 18;
      } else if (canvas && nodeGraphUI) {
        const center = nodeGraphUI.screenToGraph(canvas.width * 0.5, canvas.height * 0.5);
        spawnX = center.x - 55;
        spawnY = center.y - 18;
      } else {
        spawnX = 200;
        spawnY = 200;
      }
    } else if (selectedNode && !options.forcePosition) {
      spawnX = selectedNode.x;
      spawnY = selectedNode.y + selectedNode.height + 40;
    } else {
      spawnX = spawnX - 55;
      spawnY = spawnY - 18;
    }

    // 3. Instantiate node
    const node = createNode(type, options.customId || null, Math.round(spawnX), Math.round(spawnY));
    if (!node) return null;

    // 4. Add to DAG
    graph.addNode(node);

    // 5. Downstream auto-connection
    const autoConnect = options.autoConnect !== false;
    if (autoConnect && selectedNode) {
      const isGenerator = type === 'Read' || type === 'Constant' || type === 'Ramp' || type === 'Backdrop';
      const isViewerOrBackdrop = selectedNode.type === 'Viewer' || selectedNode.type === 'Backdrop';

      if (!isGenerator && !isViewerOrBackdrop && Array.isArray(selectedNode.outputs) && selectedNode.outputs.length > 0) {
        const outputPortId = selectedNode.outputs[0].id;

        if (Array.isArray(node.inputs) && node.inputs.length > 0) {
          let primaryInputId = null;
          if (node.inputs.some(inp => inp.id === 'in')) {
            primaryInputId = 'in';
          } else if (node.inputs.some(inp => inp.id === 'B')) {
            primaryInputId = 'B'; // Merge primary background
          } else if (node.inputs.some(inp => inp.id === 'left')) {
            primaryInputId = 'left'; // StereoMerge primary left eye
          } else if (node.inputs.some(inp => inp.id === '0')) {
            primaryInputId = '0'; // Switch / ContactSheet primary
          } else if (node.inputs.some(inp => inp.id === '1')) {
            primaryInputId = '1'; // Viewer primary
          } else {
            primaryInputId = node.inputs[0].id;
          }

          if (primaryInputId && !graph.canReach(node.id, selectedNode.id)) {
            const targetInput = node.inputs.find(inp => inp.id === primaryInputId);
            if (targetInput && !targetInput.connection) {
              graph.connect(selectedNode.id, outputPortId, node.id, primaryInputId);
            }
          }
        }
      }
    }

    // 6. Select newly created node in Node Graph
    if (nodeGraphUI) {
      nodeGraphUI.selectedNodes.clear();
      nodeGraphUI.selectedNodes.add(node.id);
      nodeGraphUI.render();
    }

    // 7. Display in Properties Bin
    if (this.app.propertiesUI) {
      this.app.propertiesUI.showNode(node);
    }

    // 8. Update timeline keyframe markers
    if (typeof this.app.updateTimelineKeyframes === 'function') {
      this.app.updateTimelineKeyframes(node);
    }

    // 9. Evaluate DAG
    if (typeof this.app.evaluateGraph === 'function') {
      this.app.evaluateGraph();
    }

    // 10. Focus canvas for subsequent keyboard shortcuts
    if (canvas && typeof canvas.focus === 'function') {
      canvas.focus();
    }

    return node;
  }
}

