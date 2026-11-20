/**
 * OpenComp - Group Node
 * Encapsulates an arbitrary sub-DAG with full enter/exit navigation,
 * dynamic Input/Output port mapping, hierarchical evaluation, and serialization.
 */

import { Node } from '../core/Node.js';
import { Graph } from '../core/Graph.js';
import { BBox } from '../core/BBox.js';
import { InputNode } from './InputNode.js';
import { OutputNode } from './OutputNode.js';

export class GroupNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Group', 'Tool', x, y);
    this.color = '#386350';
    this.width = 120;
    this.height = 42;

    this.subgraph = new Graph();
    this.subgraph.parentGroup = this;

    // Listen to changes inside subgraph to keep ports in sync
    this.subgraph.addListener(() => {
      this.syncPorts();
      this.markDirty();
    });

    this.syncPorts();
  }

  /**
   * Synchronize external input ports with internal InputNodes
   */
  syncPorts() {
    const inputNodes = this.subgraph.getAllNodes().filter(n => n.type === 'Input');
    const existingConnections = new Map();
    for (const inp of this.inputs) {
      if (inp.connection) {
        existingConnections.set(inp.id, inp.connection);
      }
    }

    this.inputs = [];

    if (inputNodes.length === 0) {
      // Default fallback input if no InputNode exists yet
      this.addInput('in', 'Input', 'in');
    } else {
      // Sort input nodes by number or position
      inputNodes.sort((a, b) => {
        const numA = Number(a.getKnobValue('number')) || 999;
        const numB = Number(b.getKnobValue('number')) || 999;
        return numA - numB || (a.x - b.x);
      });

      for (const inNode of inputNodes) {
        const portId = String(inNode.getKnobValue('number') || inNode.name || inNode.id);
        const label = inNode.getKnobValue('label') || portId;
        this.addInput(portId, inNode.name, label);
      }
    }

    // Restore connections if port IDs still match
    for (const inp of this.inputs) {
      if (existingConnections.has(inp.id)) {
        inp.connection = existingConnections.get(inp.id);
      }
    }
  }

  getBBox(inputBuffers = {}, context = {}) {
    if (this.disabled) {
      return super.getBBox(inputBuffers, context);
    }
    const outputNode = this.subgraph.getAllNodes().find(n => n.type === 'Output');
    if (outputNode) {
      return outputNode.getBBox(inputBuffers, context);
    }
    return new BBox(0, 0, 0, 0);
  }

  compute(inputBuffers, context = {}) {
    if (this.disabled) {
      const firstInput = this.inputs[0];
      if (firstInput && inputBuffers[firstInput.id]) {
        return inputBuffers[firstInput.id];
      }
      return null;
    }

    const subContext = {
      ...context,
      parentGroup: this
    };

    // 1. Inject external buffers into internal Input nodes
    const inputNodes = this.subgraph.getAllNodes().filter(n => n.type === 'Input');
    if (inputNodes.length === 0) {
      // If no InputNode, map 'in' to any initial node
    } else {
      for (const inNode of inputNodes) {
        const portId = String(inNode.getKnobValue('number') || inNode.name || inNode.id);
        const buf = inputBuffers[portId] || inputBuffers['in'] || null;
        inNode.injectedBuffer = buf;
        inNode.markDirty();
      }
    }

    // 2. Find OutputNode
    const outputNode = this.subgraph.getAllNodes().find(n => n.type === 'Output');
    if (!outputNode) {
      // Return null or evaluate last node
      return null;
    }

    // 3. Evaluate subgraph from OutputNode
    return this.subgraph.evaluate(outputNode.id, subContext);
  }

  serialize() {
    const data = super.serialize();
    data.subgraph = this.subgraph.serialize();
    return data;
  }

  deserialize(data, nodeFactory = null) {
    super.deserialize(data);
    if (data.subgraph) {
      const factory = nodeFactory || this.subgraph.nodeFactory || (this.graph ? this.graph.nodeFactory : null) || Graph.defaultNodeFactory;
      if (factory) {
        this.subgraph.nodeFactory = factory;
        this.subgraph.deserialize(data.subgraph, factory);
      }
      this.syncPorts();
    }
  }

  /**
   * Helper to package selected nodes from a parent graph into a new GroupNode
   * @param {Node[]} selectedNodes 
   * @param {Graph} parentGraph 
   * @param {Function} createNodeFn 
   * @returns {GroupNode}
   */
  static createFromNodes(selectedNodes, parentGraph, createNodeFn) {
    if (!selectedNodes || selectedNodes.length === 0) return null;

    const selectedSet = new Set(selectedNodes.map(n => n.id));

    // Calculate center position for the new GroupNode
    let avgX = 0, avgY = 0;
    for (const n of selectedNodes) {
      avgX += n.x;
      avgY += n.y;
    }
    avgX = Math.round(avgX / selectedNodes.length);
    avgY = Math.round(avgY / selectedNodes.length);

    const groupNode = createNodeFn('Group', null, avgX, avgY);
    groupNode.subgraph.nodeFactory = createNodeFn;

    // Identify incoming external connections
    const externalInputs = []; // { sourceNodeId, sourcePortId, internalNodeId, internalPortId }
    for (const n of selectedNodes) {
      for (const inp of n.inputs) {
        if (inp.connection && !selectedSet.has(inp.connection.nodeId)) {
          externalInputs.push({
            sourceNodeId: inp.connection.nodeId,
            sourcePortId: inp.connection.outputPortId,
            internalNodeId: n.id,
            internalPortId: inp.id
          });
          inp.connection = null; // Detach
        }
      }
    }

    // Identify outgoing external connections
    const externalOutputs = []; // { internalNodeId, downstreamNodeId, downstreamPortId }
    for (const other of parentGraph.getAllNodes()) {
      if (selectedSet.has(other.id)) continue;
      for (const inp of other.inputs) {
        if (inp.connection && selectedSet.has(inp.connection.nodeId)) {
          externalOutputs.push({
            internalNodeId: inp.connection.nodeId,
            downstreamNodeId: other.id,
            downstreamPortId: inp.id
          });
          inp.connection = null; // Detach
        }
      }
    }

    // Move selected nodes from parentGraph into groupNode.subgraph
    for (const n of selectedNodes) {
      parentGraph.removeNode(n.id);
      groupNode.subgraph.addNode(n);
    }

    // Create Input nodes inside group
    if (externalInputs.length > 0) {
      let inIdx = 1;
      for (const extIn of externalInputs) {
        const inNode = createNodeFn('Input', `Input${inIdx}`, avgX - 180, avgY - 120 + (inIdx * 60));
        inNode.setKnobValue('number', String(inIdx));
        inNode.setKnobValue('label', `in${inIdx}`);
        groupNode.subgraph.addNode(inNode);
        groupNode.subgraph.connect(inNode.id, 'out', extIn.internalNodeId, extIn.internalPortId);
        inIdx++;
      }
    }

    // Create Output node inside group
    const outNode = createNodeFn('Output', 'Output1', avgX, avgY + 160);
    groupNode.subgraph.addNode(outNode);

    // If an external output was found, connect that internal node to OutputNode
    if (externalOutputs.length > 0) {
      groupNode.subgraph.connect(externalOutputs[0].internalNodeId, 'out', outNode.id, 'in');
    } else {
      // Connect lowest node to Output
      let lowest = selectedNodes[0];
      for (const n of selectedNodes) {
        if (n.y > lowest.y) lowest = n;
      }
      groupNode.subgraph.connect(lowest.id, 'out', outNode.id, 'in');
    }

    // Add groupNode to parentGraph
    parentGraph.addNode(groupNode);
    groupNode.syncPorts();

    // Reconnect external upstream nodes to GroupNode's inputs
    if (externalInputs.length > 0) {
      let inIdx = 1;
      for (const extIn of externalInputs) {
        parentGraph.connect(extIn.sourceNodeId, extIn.sourcePortId, groupNode.id, String(inIdx));
        inIdx++;
      }
    }

    // Reconnect downstream nodes to GroupNode's output
    for (const extOut of externalOutputs) {
      parentGraph.connect(groupNode.id, 'out', extOut.downstreamNodeId, extOut.downstreamPortId);
    }

    return groupNode;
  }
}
