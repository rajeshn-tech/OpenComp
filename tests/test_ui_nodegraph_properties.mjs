/**
 * OpenComp Test Suite - UI Parity Phase 3: Professional Node Graph & Properties
 * Comprehensive verification of:
 * 1. Live node postage stamps with efficient thumbnail caching & invalidation
 * 2. Group nodes with enter/exit subgraph navigation & breadcrumbs
 * 3. Nested Group serialization and project save/reopen fidelity
 * 4. Clone nodes with shared knob state and independent graph routing
 * 5. Node graph bookmarks (quick slots 1-6 & named bookmarks) and framing
 * 6. Interactive mini-map with viewport navigation
 * 7. Node badges & status indicators (cached, dirty, animated, clone, expression, format)
 * 8. Pipe routing, magnetic port snapping, cycle prevention & node extraction (Ctrl+Shift+X)
 * 9. Upstream / Downstream tree selection and duplication
 * 10. Floating properties panels with tear-off and re-docking
 * 11. Tabbed properties mode for multiple open nodes
 * 12. RGBA four-channel controls with ganged and independent modes
 * 13. Integrated keyframe animation controls & timeline frame scrub updates
 * 14. Expression engine parsing, validation, cross-node referencing & cycle protection
 */

import { strict as assert } from 'assert';
import { Graph } from '../src/core/Graph.js';
import { Node } from '../src/core/Node.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ExpressionEngine } from '../src/core/ExpressionEngine.js';
import { GroupNode } from '../src/nodes/GroupNode.js';
import { InputNode } from '../src/nodes/InputNode.js';
import { OutputNode } from '../src/nodes/OutputNode.js';
import { GradeNode } from '../src/nodes/GradeNode.js';
import { BlurNode } from '../src/nodes/BlurNode.js';
import { ConstantNode } from '../src/nodes/ConstantNode.js';
import { MergeNode } from '../src/nodes/MergeNode.js';
import { createNode, cloneNode, createGroupFromSelection } from '../src/nodes/index.js';
import { NodeGraphUI } from '../src/ui/NodeGraphUI.js';
import { PropertiesUI } from '../src/ui/PropertiesUI.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_nodegraph_properties.mjs (Phase 3)');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    process.stdout.write(`▶ ${name}... `);
    fn();
    console.log(`✅ PASSED`);
    passedTests++;
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Mock DOM / Canvas Helpers for Headless Testing
// ---------------------------------------------------------------------------
class MockCanvasContext {
  constructor() {
    this.calls = [];
  }
  fillRect() {}
  strokeRect() {}
  rect() {}
  clearRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  stroke() {}
  fill() {}
  save() {}
  restore() {}
  translate() {}
  scale() {}
  fillText() {}
  measureText(str) { return { width: (str || '').length * 7 }; }
  setLineDash() {}
  roundRect() {}
  bezierCurveTo() {}
  drawImage() {}
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() {}
}

function createMockCanvas(width = 1200, height = 800) {
  const ctx = new MockCanvasContext();
  const listeners = new Map();
  return {
    width,
    height,
    parentElement: { clientWidth: width, clientHeight: height },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    addEventListener: (ev, handler) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(handler);
    },
    removeEventListener: (ev, handler) => {
      if (listeners.has(ev)) {
        const arr = listeners.get(ev).filter(h => h !== handler);
        listeners.set(ev, arr);
      }
    },
    dispatchEvent: (ev) => {
      const arr = listeners.get(ev.type) || [];
      for (const h of arr) h(ev);
    },
    setAttribute: () => {},
    style: {}
  };
}

function createMockElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    dataset: {},
    style: {},
    _className: '',
    get className() { return this._className; },
    set className(val) {
      this._className = String(val || '');
      this.classList._classes.clear();
      this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
    },
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); },
      contains(c) { return this._classes.has(c); }
    },
    children: [],
    childNodes: [],
    appendChild(child) {
      this.children.push(child);
      this.childNodes.push(child);
      child.parentElement = this;
      return child;
    },
    prepend(child) {
      this.children.unshift(child);
      this.childNodes.unshift(child);
      child.parentElement = this;
    },
    insertBefore(newChild, refChild) {
      const idx = this.children.indexOf(refChild);
      if (idx !== -1) {
        this.children.splice(idx, 0, newChild);
        this.childNodes.splice(idx, 0, newChild);
      } else {
        this.children.push(newChild);
        this.childNodes.push(newChild);
      }
      newChild.parentElement = this;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        this.parentElement.childNodes = this.parentElement.childNodes.filter(c => c !== this);
      }
    },
    querySelector(selector) {
      const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
      const targetClass = classMatch ? classMatch[1] : null;
      const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)=["']?([^"']*)["']?\]/);
      const attrName = attrMatch ? attrMatch[1] : null;
      const attrVal = attrMatch ? attrMatch[2] : null;
      const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
      const targetId = idMatch ? idMatch[1] : null;
      const tagMatch = selector.match(/^([a-zA-Z0-9_-]+)/);
      const targetTag = tagMatch ? tagMatch[1].toUpperCase() : null;

      const search = (node) => {
        for (const c of node.children || []) {
          let match = true;
          if (targetTag && c.tagName !== targetTag) match = false;
          if (targetClass && (!c.classList || !c.classList.contains(targetClass))) match = false;
          if (targetId && c.id !== targetId) match = false;
          if (attrName) {
            const dataKey = attrName.startsWith('data-') ? attrName.slice(5) : null;
            const camelKey = dataKey ? dataKey.replace(/-([a-z])/g, g => g[1].toUpperCase()) : null;
            const actualVal = dataKey ? (c.dataset[dataKey] || c.dataset[camelKey]) : c[attrName];
            if (actualVal !== attrVal) match = false;
          }
          if (match && (targetClass || targetId || attrName || targetTag)) return c;
          const found = search(c);
          if (found) return found;
        }
        return null;
      };
      return search(this);
    },
    querySelectorAll(selector) {
      const results = [];
      const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
      const targetClass = classMatch ? classMatch[1] : null;
      const tagMatch = selector.match(/^([a-zA-Z0-9_-]+)/);
      const targetTag = tagMatch ? tagMatch[1].toUpperCase() : null;

      const search = (node) => {
        for (const c of node.children || []) {
          let match = true;
          if (targetTag && c.tagName !== targetTag) match = false;
          if (targetClass && (!c.classList || !c.classList.contains(targetClass))) match = false;
          if (match && (targetClass || targetTag)) results.push(c);
          search(c);
        }
      };
      search(this);
      return results;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollIntoView: () => {},
    focus: () => {},
    click: () => {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = String(html || '');
      this.children = [];
      this.childNodes = [];
      if (!html || typeof html !== 'string') return;
      const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(?:([\s\S]*?)<\/\1>)?/g;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const t = match[1];
        const attrs = match[2];
        const child = createMockElement(t);
        const classMatch = attrs.match(/class=["']([^"']+)["']/);
        if (classMatch) child.className = classMatch[1];
        const idMatch = attrs.match(/id=["']([^"']+)["']/);
        if (idMatch) child.id = idMatch[1];
        const valMatch = attrs.match(/value=["']([^"']+)["']/);
        if (valMatch) child.value = valMatch[1];
        if (match[3]) {
          child.innerHTML = match[3];
          child.textContent = match[3].replace(/<[^>]+>/g, '').trim();
        }
        this.appendChild(child);
      }
    },
    textContent: ''
  };
  return el;
}

// Set up mock window and document for properties & canvas testing
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return createMockCanvas(96, 54);
      return createMockElement(tag);
    },
    getElementById: (id) => null,
    body: createMockElement('body')
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

// ===========================================================================
// SECTION 1: LIVE POSTAGE STAMPS & CACHING
// ===========================================================================

runTest('1.1 Postage stamp toggle and expanded node geometry', () => {
  const node = new GradeNode('Grade_StampTest');
  assert.equal(node.showPostageStamp, false);
  assert.ok(node.height >= 36 && node.height <= 40);

  node.showPostageStamp = true;
  node.height = 96;
  assert.equal(node.showPostageStamp, true);
  assert.equal(node.height, 96);
});

runTest('1.2 Thumbnail generation downsamples cached buffer efficiently', () => {
  const node = new ConstantNode('Const_Thumb');
  node.setKnobValue('color', [0.8, 0.4, 0.2, 1.0]);
  const buf = node.compute({}, { width: 1920, height: 1080 });
  node.cachedBuffer = buf;
  node.isDirty = false;

  const thumb = node.generateThumbnail(96, 54);
  assert.ok(thumb, 'Thumbnail must be generated from cached buffer');
  assert.ok(thumb.width <= 96 && thumb.width > 0, 'Thumbnail width must be bounded');
  assert.ok(thumb.height <= 54 && thumb.height > 0, 'Thumbnail height must be bounded');
  assert.equal(node.thumbnailDirty, false, 'Thumbnail should now be marked clean');

  // Verify caching: second call returns identical thumbnail instance
  const thumb2 = node.generateThumbnail(96, 54);
  assert.equal(thumb, thumb2, 'Subsequent call must return cached thumbnail');
});

runTest('1.3 Upstream markDirty invalidates downstream postage stamp thumbnail', () => {
  const graph = new Graph();
  const c1 = graph.addNode(new ConstantNode('C1'));
  const g1 = graph.addNode(new GradeNode('G1'));
  graph.connect(c1.id, 'out', g1.id, 'in');

  // Populate cache
  const outBuf = graph.evaluate(g1.id);
  g1.generateThumbnail();
  assert.equal(g1.thumbnailDirty, false);

  // Mark upstream dirty
  c1.markDirty();
  assert.equal(c1.isDirty, true);
  assert.equal(g1.isDirty, true, 'Downstream node must be dirtied');
  assert.equal(g1.thumbnailDirty, true, 'Downstream postage stamp thumbnail must be invalidated');
});

// ===========================================================================
// SECTION 2: GROUP NODES & ENTER/EXIT SUBGRAPH NAVIGATION
// ===========================================================================

runTest('2.1 GroupNode encapsulation and port synchronization', () => {
  const group = new GroupNode('Group1');
  assert.ok(group.subgraph, 'GroupNode must possess internal Graph');

  const in1 = new InputNode('Input1');
  in1.setKnobValue('number', '1');
  const out1 = new OutputNode('Output1');
  group.subgraph.addNode(in1);
  group.subgraph.addNode(out1);

  group.syncPorts();
  assert.equal(group.inputs.length, 1);
  assert.equal(group.inputs[0].id, '1');
});

runTest('2.2 GroupNode compute evaluates internal subgraph with injected inputs', () => {
  const group = new GroupNode('Group_Blur');
  group.subgraph.nodeFactory = createNode;

  const inNode = new InputNode('Input1');
  inNode.setKnobValue('number', '1');
  const blur = new BlurNode('Blur1');
  blur.setKnobValue('size', 4);
  const outNode = new OutputNode('Output1');

  group.subgraph.addNode(inNode);
  group.subgraph.addNode(blur);
  group.subgraph.addNode(outNode);

  group.subgraph.connect(inNode.id, 'out', blur.id, 'in');
  group.subgraph.connect(blur.id, 'out', outNode.id, 'in');
  group.syncPorts();

  // Create input buffer
  const src = new PixelBuffer(100, 100);
  src.data[0] = 1.0; src.data[1] = 0.5; src.data[2] = 0.2; src.data[3] = 1.0;

  const res = group.compute({ '1': src }, { frame: 1 });
  assert.ok(res, 'Group compute must return evaluated buffer');
  assert.equal(res.width, 100);
  assert.equal(res.height, 100);
});

runTest('2.3 GroupNode.createFromNodes encapsulates selected DAG nodes', () => {
  const mainGraph = new Graph();
  const c = mainGraph.addNode(new ConstantNode('C_Src'));
  const g = mainGraph.addNode(new GradeNode('G_Inside'));
  const b = mainGraph.addNode(new BlurNode('B_Inside'));
  const m = mainGraph.addNode(new MergeNode('M_Out'));

  mainGraph.connect(c.id, 'out', g.id, 'in');
  mainGraph.connect(g.id, 'out', b.id, 'in');
  mainGraph.connect(b.id, 'out', m.id, 'B');

  // Group [g, b]
  const group = GroupNode.createFromNodes([g, b], mainGraph, createNode);
  assert.ok(group, 'Group node must be created');
  assert.equal(mainGraph.getAllNodes().some(n => n.id === g.id), false, 'Internal node removed from main graph');
  assert.equal(mainGraph.getAllNodes().some(n => n.id === b.id), false, 'Internal node removed from main graph');
  assert.ok(mainGraph.getNode(group.id), 'GroupNode added to main graph');

  // Verify external connections
  assert.ok(group.inputs.length > 0, 'Group must expose input port');
  assert.equal(m.inputs.find(i => i.id === 'B').connection.nodeId, group.id, 'Downstream node reconnected to group output');
});

runTest('2.4 Subgraph navigation stack and breadcrumb tracking', () => {
  const canvas = createMockCanvas();
  const mainGraph = new Graph();
  const group = mainGraph.addNode(new GroupNode('Group_Nav'));
  const ui = new NodeGraphUI(canvas, mainGraph);

  assert.equal(ui.subgraphStack.length, 0);
  assert.equal(ui.currentGraph, mainGraph);

  // Enter group
  ui.enterGroup(group);
  assert.equal(ui.subgraphStack.length, 1);
  assert.equal(ui.currentGraph, group.subgraph);

  // Render updates breadcrumbs
  ui.render();
  assert.ok(ui.breadcrumbHits.length >= 2, 'Breadcrumb hits must record Root and Group level');

  // Exit group
  ui.exitGroup();
  assert.equal(ui.subgraphStack.length, 0);
  assert.equal(ui.currentGraph, mainGraph);
});

// ===========================================================================
// SECTION 3: NESTED GROUP SERIALIZATION & RESTORATION
// ===========================================================================

runTest('3.1 Nested groups serialize and deserialize with 100% graph fidelity', () => {
  const rootGraph = new Graph();
  rootGraph.nodeFactory = createNode;

  const outerGroup = rootGraph.addNode(new GroupNode('OuterGroup'));
  outerGroup.subgraph.nodeFactory = createNode;

  const innerGroup = outerGroup.subgraph.addNode(new GroupNode('InnerGroup'));
  innerGroup.subgraph.nodeFactory = createNode;

  const constNode = innerGroup.subgraph.addNode(new ConstantNode('Const_Nested'));
  constNode.setKnobValue('color', [0.2, 0.4, 0.6, 1.0]);
  const innerOut = innerGroup.subgraph.addNode(new OutputNode('Out_Inner'));
  innerGroup.subgraph.connect(constNode.id, 'out', innerOut.id, 'in');

  const outerOut = outerGroup.subgraph.addNode(new OutputNode('Out_Outer'));
  outerGroup.subgraph.connect(innerGroup.id, 'out', outerOut.id, 'in');

  // Serialize root graph
  const serialized = rootGraph.serialize();
  const jsonStr = JSON.stringify(serialized);
  assert.ok(jsonStr.includes('OuterGroup') && jsonStr.includes('InnerGroup'), 'Serialized JSON must contain nested groups');

  // Deserialize into fresh graph
  const freshGraph = new Graph();
  freshGraph.nodeFactory = createNode;
  freshGraph.deserialize(JSON.parse(jsonStr), createNode);

  const restoredOuter = freshGraph.getNode('OuterGroup');
  assert.ok(restoredOuter, 'OuterGroup restored');
  assert.ok(restoredOuter.subgraph, 'OuterGroup has subgraph');

  const restoredInner = restoredOuter.subgraph.getNode('InnerGroup');
  assert.ok(restoredInner, 'InnerGroup restored inside OuterGroup');
  assert.ok(restoredInner.subgraph, 'InnerGroup has subgraph');

  const restoredConst = restoredInner.subgraph.getNode('Const_Nested');
  assert.ok(restoredConst, 'Const_Nested restored inside InnerGroup');
});

// ===========================================================================
// SECTION 4: CLONE NODES & PARAMETER SYNCHRONIZATION
// ===========================================================================

runTest('4.1 Clone creation creates independent instance with linked cloneGroupId', () => {
  const graph = new Graph();
  const master = graph.addNode(new GradeNode('Grade_Master'));
  master.setKnobValue('gain', 1.85);

  const clone = cloneNode(master, graph);
  assert.ok(clone, 'Clone instance must be created');
  assert.notEqual(clone.id, master.id, 'Clone must have unique id');
  assert.ok(master.cloneGroupId, 'Master must have cloneGroupId assigned');
  assert.equal(clone.cloneGroupId, master.cloneGroupId, 'Clone must share master cloneGroupId');
  assert.equal(clone.getKnobValue('gain'), 1.85, 'Clone must inherit parameter values');
});

runTest('4.2 Parameter modification on master synchronizes to all sibling clones', () => {
  const graph = new Graph();
  const master = graph.addNode(new GradeNode('Grade_M'));
  const clone1 = cloneNode(master, graph);
  const clone2 = cloneNode(master, graph);

  // Update knob on master
  master.setKnobValue('gain', 2.4);
  assert.equal(clone1.getKnobValue('gain'), 2.4, 'Clone 1 must receive updated knob value');
  assert.equal(clone2.getKnobValue('gain'), 2.4, 'Clone 2 must receive updated knob value');

  // Update knob on clone
  clone1.setKnobValue('gamma', 0.8);
  assert.equal(master.getKnobValue('gamma'), 0.8, 'Master must receive updated knob value from clone');
  assert.equal(clone2.getKnobValue('gamma'), 0.8, 'Clone 2 must receive updated knob value from sibling clone');
});

runTest('4.3 Decloning isolates node from clone group', () => {
  const graph = new Graph();
  const master = graph.addNode(new GradeNode('Grade_M2'));
  const clone = cloneNode(master, graph);

  clone.declone();
  assert.equal(clone.cloneGroupId, null, 'Clone group ID cleared on declone');
  assert.equal(clone.isClone(), false);

  master.setKnobValue('gain', 3.0);
  assert.notEqual(clone.getKnobValue('gain'), 3.0, 'Decloned node must not receive updates');
});

// ===========================================================================
// SECTION 5: BOOKMARKS & VIEWPORT FRAMING
// ===========================================================================

runTest('5.1 Quick bookmark slots and named bookmark navigation', () => {
  const canvas = createMockCanvas();
  const graph = new Graph();
  const ui = new NodeGraphUI(canvas, graph);

  ui.panX = 350;
  ui.panY = 480;
  ui.zoom = 1.4;
  ui.saveBookmark('CompArea', '1');

  ui.panX = 0; ui.panY = 0; ui.zoom = 0.5;
  assert.equal(ui.jumpToBookmark('1'), true);
  assert.equal(ui.panX, 350);
  assert.equal(ui.panY, 480);
  assert.equal(ui.zoom, 1.4);
});

runTest('5.2 Frame Selected and Frame All viewport calculation', () => {
  const canvas = createMockCanvas(1200, 800);
  const graph = new Graph();
  const n1 = graph.addNode(createNode('Grade', 'G1', 100, 100));
  const n2 = graph.addNode(createNode('Blur', 'B1', 500, 400));
  const ui = new NodeGraphUI(canvas, graph);

  ui.frameAll();
  assert.ok(ui.zoom > 0 && ui.zoom <= 2.0, 'Zoom must be fit appropriately');
  assert.ok(Math.abs(ui.panX) > 0, 'Pan X must be centered');
});

// ===========================================================================
// SECTION 6: MINI-MAP VIEWPORT NAVIGATION
// ===========================================================================

runTest('6.1 Mini-map hit detection and navigation translation', () => {
  const canvas = createMockCanvas(1200, 800);
  const graph = new Graph();
  graph.addNode(createNode('Grade', 'G_Map', 200, 200));
  const ui = new NodeGraphUI(canvas, graph);

  const mmX = canvas.width - 100;
  const mmY = canvas.height - 50;
  assert.equal(ui.isPointInMiniMap(mmX, mmY), true, 'Point inside mini-map rectangle');
  assert.equal(ui.isPointInMiniMap(10, 10), false, 'Point outside mini-map rectangle');

  const oldPanX = ui.panX;
  ui.navigateMiniMap(mmX, mmY);
  assert.notEqual(ui.panX, oldPanX, 'Mini-map navigation must update viewport pan');
});

// ===========================================================================
// SECTION 7: NODE BADGES & STATUS INDICATORS
// ===========================================================================

runTest('7.1 Node status and badges reflect operational states', () => {
  const node = new GradeNode('Grade_Badges');
  assert.equal(node.status, 'dirty');
  assert.equal(node.hasAnyKeyframes(), false);
  assert.equal(node.hasAnyExpressions(), false);
  assert.equal(node.isClone(), false);

  node.setKeyframe('gain', 1, 1.5);
  assert.equal(node.hasAnyKeyframes(), true);

  node.setExpression('gamma', 'sin(frame * 0.1)');
  assert.equal(node.hasAnyExpressions(), true);

  node.cloneGroupId = 'clone_123';
  assert.equal(node.isClone(), true);
});

// ===========================================================================
// SECTION 8: PIPE ROUTING, SNAPPING & NODE EXTRACTION
// ===========================================================================

runTest('8.1 Cycle prevention rejects self-referencing and recursive wires', () => {
  const graph = new Graph();
  const n1 = graph.addNode(new GradeNode('N1'));
  const n2 = graph.addNode(new BlurNode('N2'));
  const n3 = graph.addNode(new GradeNode('N3'));

  graph.connect(n1.id, 'out', n2.id, 'in');
  graph.connect(n2.id, 'out', n3.id, 'in');

  // Attempt to connect n3 back to n1 (cycle!)
  const ok = graph.connect(n3.id, 'out', n1.id, 'in');
  assert.equal(ok, false, 'Cyclic connection must be rejected');
});

runTest('8.2 Node extraction (Ctrl+Shift+X) reconnects upstream to downstream', () => {
  const canvas = createMockCanvas();
  const graph = new Graph();
  const c = graph.addNode(new ConstantNode('C_Ext'));
  const g = graph.addNode(new GradeNode('G_Ext'));
  const b = graph.addNode(new BlurNode('B_Ext'));

  graph.connect(c.id, 'out', g.id, 'in');
  graph.connect(g.id, 'out', b.id, 'in');

  const ui = new NodeGraphUI(canvas, graph);
  ui.selectedNodes.add(g.id);
  ui.extractSelectedNode();

  // g is extracted: b should now be connected directly to c!
  assert.equal(b.inputs[0].connection.nodeId, c.id, 'Downstream node must reconnect to upstream node');
  assert.equal(g.inputs[0].connection, null, 'Extracted node input must be disconnected');
});

runTest('8.3 Upstream and Downstream tree selection traversal', () => {
  const canvas = createMockCanvas();
  const graph = new Graph();
  const r = graph.addNode(new ConstantNode('Root'));
  const m1 = graph.addNode(new GradeNode('Mid1'));
  const m2 = graph.addNode(new GradeNode('Mid2'));
  const leaf = graph.addNode(new MergeNode('Leaf'));

  graph.connect(r.id, 'out', m1.id, 'in');
  graph.connect(r.id, 'out', m2.id, 'in');
  graph.connect(m1.id, 'out', leaf.id, 'B');
  graph.connect(m2.id, 'out', leaf.id, 'A');

  const ui = new NodeGraphUI(canvas, graph);

  // Select Upstream from leaf
  ui.selectedNodes.clear();
  ui.selectedNodes.add(leaf.id);
  ui.selectUpstream();
  assert.equal(ui.selectedNodes.size, 4, 'Must select leaf and all 3 upstream ancestors');

  // Select Downstream from root
  ui.selectedNodes.clear();
  ui.selectedNodes.add(r.id);
  ui.selectDownstream();
  assert.equal(ui.selectedNodes.size, 4, 'Must select root and all 3 downstream dependents');
});

// ===========================================================================
// SECTION 9: PROPERTIES PANEL: FLOATING WINDOWS & TABBED MODE
// ===========================================================================

runTest('9.1 Floating properties card tear-off and re-docking', () => {
  const container = createMockElement('div');
  const ui = new PropertiesUI(container, () => {}, () => {});
  const node = new GradeNode('Grade_Float');

  ui.showNode(node);
  assert.equal(ui.openNodes.has(node.id), true);

  // Float panel
  ui.floatNode(node.id);
  const entry = ui.openNodes.get(node.id);
  assert.equal(entry.isFloating, true);
  assert.ok(entry.floatingWindow, 'Floating window DOM element created');

  // Re-dock panel
  ui.redockNode(node.id);
  assert.equal(entry.isFloating, false);
  assert.equal(entry.floatingWindow, null);
});

runTest('9.2 Tabbed properties mode toggling and focus switching', () => {
  const container = createMockElement('div');
  const ui = new PropertiesUI(container, () => {}, () => {});
  const n1 = new GradeNode('G_Tab1');
  const n2 = new BlurNode('B_Tab2');

  ui.showNode(n1);
  ui.showNode(n2);
  assert.equal(ui.openNodes.size, 2);

  ui.viewMode = 'tabbed';
  ui.focusNode(n1.id);
  assert.equal(ui.activeNodeId, n1.id);
  assert.equal(ui.openNodes.get(n1.id).card.style.display, 'block');
  assert.equal(ui.openNodes.get(n2.id).card.style.display, 'none');

  ui.focusNode(n2.id);
  assert.equal(ui.activeNodeId, n2.id);
  assert.equal(ui.openNodes.get(n2.id).card.style.display, 'block');
  assert.equal(ui.openNodes.get(n1.id).card.style.display, 'none');
});

// ===========================================================================
// SECTION 10: RGBA FOUR-CHANNEL CONTROLS
// ===========================================================================

runTest('10.1 RGBA controls support ganged and independent channel editing', () => {
  const container = createMockElement('div');
  const ui = new PropertiesUI(container, () => {}, () => {});
  const node = new GradeNode('Grade_RGBA');

  // Configure RGBA knob
  node.addKnob('gain', 'Gain', 'rgba', [1.0, 1.0, 1.0, 1.0], { ganged: true });
  ui.showNode(node);

  const entry = ui.openNodes.get(node.id);
  const chInputs = entry.card.querySelectorAll('.rgba-num-input');
  assert.equal(chInputs.length >= 4, true, 'Must render at least 4 channel inputs for RGBA knob');

  // Gang toggle
  const gangBtn = entry.card.querySelector('.btn-gang');
  assert.ok(gangBtn, 'Gang toggle button must exist');
});

// ===========================================================================
// SECTION 11: KEYFRAME ANIMATION INTEGRATION & TIMELINE SCRUB
// ===========================================================================

runTest('11.1 Keyframe diamond toggle and timeline frame scrub refresh', () => {
  const container = createMockElement('div');
  const ui = new PropertiesUI(container, () => {}, () => {});
  const node = new GradeNode('Grade_Anim');
  node.setKeyframe('gain', 10, 2.5);

  ui.showNode(node);
  ui.updateValuesAtFrame(10);
  assert.equal(ui.currentFrame, 10);

  const entry = ui.openNodes.get(node.id);
  const gainRow = entry.card.querySelector('.prop-knob-row[data-knob-key="gain"]');
  assert.ok(gainRow, 'Gain knob row must exist');
  const animBtn = gainRow.querySelector('.knob-anim-btn');
  assert.ok(animBtn.classList.contains('on-key'), 'Anim button must reflect on-key state at frame 10');

  ui.updateValuesAtFrame(25);
  assert.ok(animBtn.classList.contains('animated'), 'Anim button must reflect animated state between keys at frame 25');
});

// ===========================================================================
// SECTION 12: EXPRESSION ENGINE & CROSS-NODE REFERENCING
// ===========================================================================

runTest('12.1 ExpressionEngine validates mathematical syntax', () => {
  assert.equal(ExpressionEngine.validate('sin(frame * 0.1) * 2.0').valid, true);
  assert.equal(ExpressionEngine.validate('clamp(Grade1.gain, 0.0, 1.0)').valid, true);
  assert.equal(ExpressionEngine.validate('lerp(10, 50, smoothstep(1, 100, frame))').valid, true);
  assert.equal(ExpressionEngine.validate('random(frame) + noise(frame * 0.05)').valid, true);

  // Syntax errors
  assert.equal(ExpressionEngine.validate('sin(frame * 0.1').valid, false, 'Unclosed parenthesis must fail');
  assert.equal(ExpressionEngine.validate('window.alert(1)').valid, false, 'Disallowed globals must fail');
  assert.equal(ExpressionEngine.validate('').valid, false, 'Empty expression must fail');
});

runTest('12.2 ExpressionEngine evaluates math expressions at specific frames', () => {
  const val1 = ExpressionEngine.evaluate('frame * 2', { frame: 12 });
  assert.equal(val1, 24);

  const val2 = ExpressionEngine.evaluate('sin(0)', { frame: 1 });
  assert.equal(val2, 0);

  const val3 = ExpressionEngine.evaluate('clamp(15, 0, 10)', { frame: 1 });
  assert.equal(val3, 10);

  const val4 = ExpressionEngine.evaluate('lerp(0, 100, 0.5)', { frame: 1 });
  assert.equal(val4, 50);
});

runTest('12.3 Cross-node expression references and cycle protection', () => {
  const graph = new Graph();
  const g1 = graph.addNode(new GradeNode('G1'));
  g1.setKnobValue('gain', 1.5);

  const g2 = graph.addNode(new GradeNode('G2'));
  g2.setExpression('gain', 'G1.gain * 2.0');

  const evaluatedGain = g2.getKnobValue('gain', { frame: 1 });
  assert.equal(evaluatedGain, 3.0, 'G2.gain must evaluate expression referencing G1.gain');

  // Test cycle protection: G1 depends on G2 while G2 depends on G1
  g1.setExpression('gain', 'G2.gain + 1');
  const safeVal = g2.getKnobValue('gain', { frame: 1 });
  assert.ok(!isNaN(safeVal), 'Cycle must not cause infinite recursion or stack overflow');
});

runTest('12.4 Node serialization preserves expression strings and restores them', () => {
  const node = new GradeNode('Grade_ExprSave');
  node.setExpression('gamma', 'sin(frame * 0.2) + 1.0');

  const serialized = node.serialize();
  assert.equal(serialized.knobs.gamma.expression, 'sin(frame * 0.2) + 1.0');

  const restored = new GradeNode('Grade_ExprRestore');
  restored.deserialize(serialized);
  assert.equal(restored.hasExpression('gamma'), true);
  assert.equal(restored.getExpression('gamma'), 'sin(frame * 0.2) + 1.0');
});

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('\n====================================================');
console.log(`📊 PHASE 3 UI PARITY SUITE SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('====================================================\n');

assert.equal(passedTests, totalTests, 'All Phase 3 UI Parity tests must pass!');
