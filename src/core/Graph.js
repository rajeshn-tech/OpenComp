/**
 * OpenComp - DAG Node Graph Manager
 * Handles node lifecycle, connections, topological sorting, and pull-based evaluation.
 */

export class Graph {
  constructor() {
    /** @type {Map<string, import('./Node.js').Node>} */
    this.nodes = new Map();
    this.listeners = new Set();
    this.evaluating = false;
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyChange(type, details = {}) {
    for (const listener of this.listeners) {
      try {
        listener(type, details);
      } catch (err) {
        console.error('Graph listener error:', err);
      }
    }
  }

  addNode(node) {
    node.graph = this;
    this.nodes.set(node.id, node);
    this.notifyChange('nodeAdded', { node });
    return node;
  }

  createNode(type, id = null, x = 0, y = 0) {
    if (this.nodeFactory) {
      const node = this.nodeFactory(type, id, x, y);
      if (node) {
        this.addNode(node);
        return node;
      }
    }
    return null;
  }

  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Disconnect downstream connections to this node
    for (const other of this.nodes.values()) {
      for (const input of other.inputs) {
        if (input.connection && input.connection.nodeId === nodeId) {
          input.connection = null;
          other.markDirty();
        }
      }
    }

    this.nodes.delete(nodeId);
    this.notifyChange('nodeRemoved', { nodeId });
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  connect(fromNodeId, fromPortId, toNodeId, toInputId) {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) return false;

    // Cycle check: can toNode reach fromNode?
    if (this.canReach(toNodeId, fromNodeId)) {
      console.warn('OpenComp: Connection rejected to prevent cyclic dependency.');
      return false;
    }

    const input = toNode.inputs.find(inp => inp.id === toInputId);
    if (!input) return false;

    input.connection = {
      nodeId: fromNodeId,
      outputPortId: fromPortId
    };

    toNode.markDirty();
    this.notifyChange('connectionChanged', { fromNodeId, toNodeId, toInputId });
    return true;
  }

  disconnect(toNodeId, toInputId) {
    const toNode = this.nodes.get(toNodeId);
    if (!toNode) return;

    const input = toNode.inputs.find(inp => inp.id === toInputId);
    if (input && input.connection) {
      input.connection = null;
      toNode.markDirty();
      this.notifyChange('connectionChanged', { toNodeId, toInputId });
    }
  }

  canReach(startId, targetId, visited = new Set()) {
    if (startId === targetId) return true;
    if (visited.has(startId)) return false;
    visited.add(startId);

    const node = this.nodes.get(startId);
    if (!node) return false;

    for (const other of this.nodes.values()) {
      for (const input of other.inputs) {
        if (input.connection && input.connection.nodeId === startId) {
          if (this.canReach(other.id, targetId, visited)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  markDependentsDirty(nodeId) {
    for (const other of this.nodes.values()) {
      for (const input of other.inputs) {
        if (input.connection && input.connection.nodeId === nodeId) {
          if (!other.isDirty) {
            other.isDirty = true;
            other.cachedBuffer = null;
            other.thumbnailDirty = true;
            other.status = 'dirty';
            this.markDependentsDirty(other.id);
          }
        }
      }
    }
  }

  hasSubtreeAnimation(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    if (node.isTimeDependent || node.category === 'Time') return true;
    for (const knob of Object.values(node.knobs)) {
      if (knob.keyframes && Object.keys(knob.keyframes).length > 0) return true;
    }
    if (node.type === 'Read') {
      const file = node.getKnobValue('file');
      if (file && (file.includes('%') || file.includes('#'))) return true;
      if (node.sequenceFrames && node.sequenceFrames.size > 1) return true;
    }
    if (node.type === 'Roto' && Array.isArray(node.shapes)) {
      for (const s of node.shapes) {
        if (s.points && s.points.some(p => p.posTrack && p.posTrack.keys && p.posTrack.keys.length > 1)) return true;
      }
    }
    for (const input of node.inputs) {
      if (input.connection && this.hasSubtreeAnimation(input.connection.nodeId, visited)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns nodes in topological evaluation order (leaves/generators first, outputs last)
   * @returns {string[]} Array of node IDs
   */
  getTopologicalOrder() {
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (nodeId) => {
      if (visiting.has(nodeId)) {
        throw new Error(`Cycle detected involving node ${nodeId}`);
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const input of node.inputs) {
          if (input.connection) {
            visit(input.connection.nodeId);
          }
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      order.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }

    return order;
  }

  /**
   * Evaluate a node and all of its upstream dependencies
   * @param {string} targetNodeId 
   * @param {Object} context 
   * @returns {import('./PixelBuffer.js').PixelBuffer|null}
   */
  evaluate(targetNodeId, context = {}) {
    const targetNode = this.nodes.get(targetNodeId);
    if (!targetNode) return null;

    const currentFrame = context.frame !== undefined ? context.frame : 1;
    const subtreeHasAnimation = this.hasSubtreeAnimation(targetNodeId);

    if (!targetNode.isDirty && targetNode.cachedBuffer) {
      if (!subtreeHasAnimation || targetNode.cachedFrame === currentFrame) {
        return targetNode.cachedBuffer;
      }
    }

    // Recursively collect inputs
    const inputBuffers = {};
    for (const input of targetNode.inputs) {
      if (input.connection) {
        const inputContext = targetNode.getInputContext 
          ? targetNode.getInputContext(input.id, context) 
          : context;
        const upstreamBuffer = this.evaluate(input.connection.nodeId, inputContext);
        if (upstreamBuffer) {
          inputBuffers[input.id] = upstreamBuffer;
        }
      }
    }

    // Compute target node
    try {
      const result = targetNode.compute(inputBuffers, context);
      targetNode.cachedBuffer = result;
      targetNode.cachedFrame = currentFrame;
      targetNode.isDirty = false;
      return result;
    } catch (err) {
      console.error(`Error computing node ${targetNode.id}:`, err);
      return null;
    }
  }

  clear() {
    this.nodes.clear();
    this.notifyChange('graphCleared');
  }

  serialize() {
    return {
      version: '1.0',
      nodes: Array.from(this.nodes.values()).map(n => n.serialize())
    };
  }

  deserialize(data, nodeFactory = null) {
    this.clear();
    if (!data || !Array.isArray(data.nodes)) return;

    const factory = nodeFactory || this.nodeFactory || Graph.defaultNodeFactory;
    if (!factory) {
      console.error('Graph.deserialize: No nodeFactory provided or set on graph');
      return;
    }

    // 1. Instantiate nodes
    for (const nodeData of data.nodes) {
      const node = factory(nodeData.type, nodeData.id);
      if (node) {
        node.graph = this;
        node.deserialize(nodeData, factory);
        this.nodes.set(node.id, node);
      }
    }

    // 2. Mark all dirty
    for (const node of this.nodes.values()) {
      node.markDirty();
    }

    this.notifyChange('graphLoaded');
  }
}

