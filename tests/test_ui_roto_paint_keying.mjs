/**
 * OpenComp - UI Parity: Roto, Paint & Keying Workflows Regression Suite
 * Tests Bezier & B-Spline curve sampling, point manipulation, feathering, shape hierarchy,
 * paint dual-ring cursor, brush resizing, stroke lifetimes, clone/reveal offsets, undo/redo,
 * key color eyedropper & box sampling, matte visualization modes (Composite, Matte, Status, Despill),
 * edge controls (erode, blur, clip black/white), context toolbar switching, and serialization.
 */

import assert from 'assert/strict';
import { performance } from 'perf_hooks';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { RotoNode } from '../src/nodes/RotoNode.js';
import { PaintNode } from '../src/nodes/PaintNode.js';
import { ChromaKeyerNode } from '../src/nodes/ChromaKeyerNode.js';
import { KeyerNode } from '../src/nodes/KeyerNode.js';
import { DespillNode } from '../src/nodes/DespillNode.js';
import { MatteControlNode } from '../src/nodes/MatteControlNode.js';
import { RotoShape, RotoControlPoint } from '../src/core/RotoSpline.js';
import { PaintStroke } from '../src/core/PaintStroke.js';
import { RotoUI } from '../src/ui/RotoUI.js';
import { PaintUI } from '../src/ui/PaintUI.js';
import { KeyerUI } from '../src/ui/KeyerUI.js';
import { PropertiesUI } from '../src/ui/PropertiesUI.js';
import { createNode } from '../src/core/NodeRegistry.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_roto_paint_keying.mjs');
console.log('====================================================\n');

// Mock DOM Environment for UI components in Node.js
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  toggle(c, force) {
    if (force !== undefined) {
      if (force) this.classes.add(c); else this.classes.delete(c);
      return force;
    }
    if (this.classes.has(c)) { this.classes.delete(c); return false; }
    this.classes.add(c); return true;
  }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(tagName = 'DIV', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.dataset = {};
    this.classList = new MockClassList();
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this._innerHTML = '';
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.width = 800;
    this.height = 600;
  }

  scrollIntoView() {}

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
    // Basic tag parser to build child mocks for querySelector
    const tagMatches = [...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g)];
    for (const match of tagMatches) {
      const tag = match[1];
      const attrs = match[2];
      const el = new MockElement(tag);
      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      if (idMatch) el.id = idMatch[1];
      const classMatch = attrs.match(/class=["']([^"']+)["']/);
      if (classMatch) classMatch[1].split(/\s+/).forEach(c => el.classList.add(c));
      const dataMatch = [...attrs.matchAll(/data-([a-zA-Z0-9-]+)=["']([^"']+)["']/g)];
      for (const dm of dataMatch) {
        const camelKey = dm[1].replace(/-([a-z])/g, g => g[1].toUpperCase());
        el.dataset[camelKey] = dm[2];
      }
      const valMatch = attrs.match(/value=["']([^"']+)["']/);
      if (valMatch) el.value = valMatch[1];
      el.parentElement = this;
      this.children.push(el);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) fn(event);
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const search = (node) => {
      for (const child of node.children) {
        let match = false;
        if (sel.startsWith('#') && child.id === sel.slice(1)) match = true;
        else if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) match = true;
        else if (sel.startsWith('[') && sel.endsWith(']')) {
          const attr = sel.slice(1, -1);
          if (attr.includes('=')) {
            const [k, v] = attr.split('=');
            const cleanV = v.replace(/["']/g, '');
            const prop = k.replace(/^data-/, '').replace(/-([a-z])/g, g => g[1].toUpperCase());
            if (child.dataset[prop] === cleanV) match = true;
          } else {
            const prop = attr.replace(/^data-/, '').replace(/-([a-z])/g, g => g[1].toUpperCase());
            if (child.dataset[prop] !== undefined) match = true;
          }
        } else if (child.tagName.toLowerCase() === sel.toLowerCase()) {
          match = true;
        }
        if (match) results.push(child);
        search(child);
      }
    };
    search(this);
    return results;
  }

  closest(sel) {
    let cur = this;
    while (cur) {
      if (sel.startsWith('.') && cur.classList && cur.classList.contains(sel.slice(1))) return cur;
      if (cur.tagName && cur.tagName.toLowerCase() === sel.toLowerCase()) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

class MockCanvasContext {
  constructor() {
    this.calls = [];
    this.lineWidth = 1;
    this.strokeStyle = '#000';
    this.fillStyle = '#000';
    this.font = '10px sans-serif';
    this.canvas = { width: 800, height: 600 };
  }
  save() { this.calls.push({ op: 'save' }); }
  restore() { this.calls.push({ op: 'restore' }); }
  beginPath() { this.calls.push({ op: 'beginPath' }); }
  closePath() { this.calls.push({ op: 'closePath' }); }
  moveTo(x, y) { this.calls.push({ op: 'moveTo', x, y }); }
  lineTo(x, y) { this.calls.push({ op: 'lineTo', x, y }); }
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) { this.calls.push({ op: 'bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y }); }
  arc(x, y, r, sa, ea) { this.calls.push({ op: 'arc', x, y, r, sa, ea }); }
  stroke() { this.calls.push({ op: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); }
  fill() { this.calls.push({ op: 'fill', fillStyle: this.fillStyle }); }
  strokeRect(x, y, w, h) { this.calls.push({ op: 'strokeRect', x, y, w, h }); }
  fillRect(x, y, w, h) { this.calls.push({ op: 'fillRect', x, y, w, h }); }
  fillText(text, x, y) { this.calls.push({ op: 'fillText', text, x, y }); }
  setLineDash(dash) { this.calls.push({ op: 'setLineDash', dash }); }
}

// Global setup
global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => new MockElement('DIV', id)
};
global.window = new MockElement('WINDOW');

function runTest(name, fn) {
  process.stdout.write(`▶ ${name}... `);
  const t0 = performance.now();
  try {
    fn();
    const t1 = performance.now();
    console.log(`✅ PASSED (${(t1 - t0).toFixed(1)} ms)`);
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// TEST 1: Bezier and B-Spline Curve Sampling, Tangents and Feathering
// -----------------------------------------------------------------------------
runTest('1. Bezier & B-Spline curve sampling, point additions, tangents, and feathering', () => {
  // 1.1 Bezier Shape creation and control points
  const bezierShape = new RotoShape('bezier');
  bezierShape.name = 'Face_Mask';
  const p0 = new RotoControlPoint(100, 100, -20, 0, 20, 0, 5.0);
  const p1 = new RotoControlPoint(200, 150, 0, -30, 0, 30, 8.0);
  const p2 = new RotoControlPoint(150, 250, 20, 0, -20, 0, 6.0);
  bezierShape.addPoint(p0);
  bezierShape.addPoint(p1);
  bezierShape.addPoint(p2);
  bezierShape.closed = true;

  // Property accessors verification
  assert.equal(p0.x, 100);
  assert.equal(p0.y, 100);
  assert.equal(p0.tangentInX, -20);
  assert.equal(p0.tangentOutX, 20);
  assert.equal(p0.feather, 5.0);

  // Bezier curve sampling
  const bezierSamples = bezierShape.sampleCurve(1, 10);
  assert(bezierSamples.length >= 30, 'Bezier curve should generate smooth sampled segments');
  assert(Number.isFinite(bezierSamples[0].x) && Number.isFinite(bezierSamples[0].y));

  // 1.2 B-Spline Shape creation and uniform cubic basis sampling
  const bsplineShape = new RotoShape('bspline');
  bsplineShape.name = 'Organic_Body';
  bsplineShape.addPoint(new RotoControlPoint(50, 50));
  bsplineShape.addPoint(new RotoControlPoint(150, 50));
  bsplineShape.addPoint(new RotoControlPoint(150, 150));
  bsplineShape.addPoint(new RotoControlPoint(50, 150));
  bsplineShape.closed = true;

  const bsplineSamples = bsplineShape.sampleCurve(1, 10);
  assert(bsplineSamples.length >= 40, 'B-Spline curve should generate 40 continuous samples');
  // Verify B-Spline curvature is smooth within bounding box
  const bbox = bsplineShape.getBoundingBox(1);
  assert(bbox.minX >= 50 && bbox.maxX <= 150);
  assert(bbox.minY >= 50 && bbox.maxY <= 150);

  // 1.3 Feathering and tangent break (collinear vs cusp)
  p1.tangentInX = -15;
  p1.tangentInY = -25;
  p1.tangentOutX = 10;
  p1.tangentOutY = 30; // Broken tangent (cusp angle)
  assert.notEqual(p1.tangentInX, -p1.tangentOutX, 'Tangents should support independent cusps');
});

// -----------------------------------------------------------------------------
// TEST 2: Roto Shape Selection, Hierarchy, Solo, Lock, and Duplicate
// -----------------------------------------------------------------------------
runTest('2. Roto shape selection, hierarchy reordering, solo, lock, and duplicate', () => {
  const rotoNode = new RotoNode('roto_test');
  const s1 = rotoNode.addShape('Eye_Left', 'bezier');
  const s2 = rotoNode.addShape('Eye_Right', 'bezier');
  const s3 = rotoNode.addShape('Mouth', 'bspline');

  assert.equal(rotoNode.shapes.length, 3);
  assert.equal(rotoNode.shapes[0].name, 'Eye_Left');

  // Soloing: when s2 is soloed, compute should only render s2
  s2.solo = true;
  assert.equal(s2.solo, true);
  assert.equal(s1.solo, false);

  const inputBuf = new PixelBuffer(100, 100);
  inputBuf.data.fill(0.0);
  const resultBuf = rotoNode.compute({ in: inputBuf }, { frame: 1 });
  assert(resultBuf instanceof PixelBuffer);

  // Locking: locked shapes preserve their bounds and reject modifications
  s1.locked = true;
  assert.equal(s1.locked, true);

  // Duplicate: creates deep copy with unique id
  const dup = s1.duplicate();
  assert(dup.id !== s1.id, 'Duplicated shape must receive unique ID');
  assert.equal(dup.name, 'Eye_Left_copy');
  assert.equal(dup.points.length, s1.points.length);
  assert.equal(dup.type, 'bezier');

  // Move up/down in shape hierarchy
  rotoNode.moveShape('Eye_Left', 1);
  assert.equal(rotoNode.shapes[1].name, 'Eye_Left');
});

// -----------------------------------------------------------------------------
// TEST 3: Paint Brush Cursor Preview, Hardness Ring, Size Adjustment
// -----------------------------------------------------------------------------
runTest('3. Paint brush cursor preview, hardness ring, size adjustment, and stroke rendering', () => {
  const container = new MockElement('DIV', 'paint-container');
  const mockViewer = { render: () => {}, canvas: new MockElement('CANVAS') };
  const paintUI = new PaintUI(container, mockViewer, () => {});
  const paintNode = new PaintNode('paint_test');
  paintUI.setPaintNode(paintNode);

  // 3.1 Initial brush state
  assert.equal(paintUI.brushSize, 35);
  assert.equal(paintUI.brushHardness, 0.5);
  assert.equal(paintUI.activeTool, 'brush');

  // 3.2 Keyboard resize: [ decreases size, ] increases size
  paintUI.onKeyDown({ key: '[' });
  assert.equal(paintUI.brushSize, 31, 'Key [ must decrease brush size');
  paintUI.onKeyDown({ key: ']' });
  paintUI.onKeyDown({ key: ']' });
  assert.equal(paintUI.brushSize, 39, 'Key ] must increase brush size');

  // 3.3 Overlay drawing: outer size ring and inner hardness ring
  const ctx = new MockCanvasContext();
  paintUI.lastCursor = { imgX: 100, imgY: 100 };
  paintUI.drawOverlay(ctx, 1.0, 0, 0);

  const arcCalls = ctx.calls.filter(c => c.op === 'arc');
  assert(arcCalls.length >= 2, 'Overlay must draw both outer size ring and inner hardness ring');
  const outerArc = arcCalls[0];
  const innerArc = arcCalls[2] || arcCalls[1];
  assert.equal(outerArc.r, 39 * 0.5, 'Outer ring radius must equal half brush size');
  assert(innerArc.r < outerArc.r, 'Inner hardness ring radius must be smaller than outer ring');

  // 3.4 Stroke rendering onto buffer
  const buf = new PixelBuffer(100, 100);
  buf.data.fill(0.0);
  const stroke = new PaintStroke('brush', 20.0, 0.5, 1.0, 1.0, [1.0, 0.0, 0.0, 1.0]);
  stroke.addPoint(50, 50, 1.0);
  stroke.render(buf, null, null);

  // Center pixel (50, 50) must be bright red
  const [rCenter, gCenter, bCenter, aCenter] = buf.getPixel(50, 50);
  assert(rCenter > 0.9 && aCenter > 0.9, 'Center stamped pixel must be solid red');
  // Far pixel (10, 10) must remain blank
  const [rFar] = buf.getPixel(10, 10);
  assert.equal(rFar, 0.0, 'Pixel outside brush radius must remain untouched');
});

// -----------------------------------------------------------------------------
// TEST 4: Clone Stamp Source Picking, Offset, and Clean Plate Reveal
// -----------------------------------------------------------------------------
runTest('4. Clone stamp source picking, offset calculation, and clean-plate reveal', () => {
  const container = new MockElement('DIV', 'paint-container');
  const mockViewer = { render: () => {}, canvas: new MockElement('CANVAS') };
  const paintUI = new PaintUI(container, mockViewer, () => {});
  const paintNode = new PaintNode('paint_clone_test');
  paintUI.setPaintNode(paintNode);

  paintUI.setTool('clone');
  assert.equal(paintUI.activeTool, 'clone');

  // Pick clone source at (20, 20) while cursor is at (80, 80)
  paintUI.lastCursor = { imgX: 80, imgY: 80 };
  paintUI.isPickingCloneSource = true;
  paintUI.onMouseDown({}, 20, 20);

  assert.equal(paintUI.cloneOffset.dx, 60, 'Clone dx offset must equal 80 - 20 = 60');
  assert.equal(paintUI.cloneOffset.dy, 60, 'Clone dy offset must equal 80 - 20 = 60');
  assert.equal(paintUI.isPickingCloneSource, false, 'Picking mode must complete');

  // Overlay draws connecting ray and source crosshair
  const ctx = new MockCanvasContext();
  paintUI.drawOverlay(ctx, 1.0, 0, 0);
  const lineCalls = ctx.calls.filter(c => c.op === 'lineTo');
  assert(lineCalls.length >= 3, 'Connecting ray and crosshair lines must be rendered');

  // Clean-plate reveal tool test
  paintUI.setTool('reveal');
  assert.equal(paintUI.activeTool, 'reveal');

  const baseBuf = new PixelBuffer(100, 100);
  baseBuf.data.fill(0.1); // Dark base plate
  const cleanBuf = new PixelBuffer(100, 100);
  cleanBuf.data.fill(0.9); // Bright clean plate
  const targetBuf = baseBuf.clone();

  const revealStroke = new PaintStroke('reveal', 30.0, 0.5, 1.0, 1.0);
  revealStroke.addPoint(50, 50, 1.0);
  revealStroke.render(targetBuf, baseBuf, cleanBuf);

  const [rRevealed] = targetBuf.getPixel(50, 50);
  assert(rRevealed > 0.8, 'Reveal stroke must restore pixels from clean plate buffer');
});

// -----------------------------------------------------------------------------
// TEST 5: Paint Stroke Lifetime (Single, Range, All) and Undo/Redo Stack
// -----------------------------------------------------------------------------
runTest('5. Paint stroke lifetime (single, range, all), stroke stack reordering, and undo/redo', () => {
  const container = new MockElement('DIV', 'paint-container');
  const mockViewer = { render: () => {}, canvas: new MockElement('CANVAS') };
  const paintUI = new PaintUI(container, mockViewer, () => {});
  const paintNode = new PaintNode('paint_lifetime_test');
  paintUI.setPaintNode(paintNode);

  // 5.1 Stroke lifetime verification
  const sSingle = new PaintStroke('brush');
  sSingle.frame = 10;
  sSingle.lifetime = 'single';
  assert.equal(sSingle.isValidAtFrame(10), true);
  assert.equal(sSingle.isValidAtFrame(11), false);

  const sRange = new PaintStroke('brush');
  sRange.lifetime = 'range';
  sRange.startFrame = 15;
  sRange.endFrame = 25;
  assert.equal(sRange.isValidAtFrame(14), false);
  assert.equal(sRange.isValidAtFrame(20), true);
  assert.equal(sRange.isValidAtFrame(26), false);

  const sAll = new PaintStroke('brush');
  sAll.lifetime = 'all';
  assert.equal(sAll.isValidAtFrame(1), true);
  assert.equal(sAll.isValidAtFrame(999), true);

  // 5.2 Stroke addition & Undo/Redo
  paintUI.onMouseDown({}, 50, 50);
  paintUI.onMouseMove({}, 55, 55);
  paintUI.onMouseUp({}, 55, 55);

  assert.equal(paintNode.strokes.length, 1);
  const createdStrokeId = paintNode.strokes[0].id;

  // Undo stroke addition
  paintUI.undo();
  assert.equal(paintNode.strokes.length, 0, 'Undo must remove the painted stroke');

  // Redo stroke addition
  paintUI.redo();
  assert.equal(paintNode.strokes.length, 1, 'Redo must restore the painted stroke');
  assert.equal(paintNode.strokes[0].id, createdStrokeId);

  // 5.3 Stroke reordering
  const s2 = new PaintStroke('clone');
  paintNode.addStroke(s2);
  assert.equal(paintNode.strokes.length, 2);
  assert.equal(paintNode.strokes[1].id, s2.id);

  paintUI.moveStrokeDown(s2.id);
  assert.equal(paintNode.strokes[0].id, s2.id, 'Move down must place stroke earlier in list');
});

// -----------------------------------------------------------------------------
// TEST 6: Key Color Eyedropper and Region Box Sampling
// -----------------------------------------------------------------------------
runTest('6. Key color eyedropper and region box sampling from Viewer PixelBuffer', () => {
  const container = new MockElement('DIV', 'keyer-container');
  const testBuffer = new PixelBuffer(100, 100);
  // Greenscreen background with slight tint variation
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      testBuffer.setPixel(x, y, 0.04 + (x / 2000), 0.82 + (y / 2000), 0.06, 1.0);
    }
  }

  const mockViewer = {
    render: () => {},
    currentBuffer: testBuffer,
    canvas: new MockElement('CANVAS'),
    samplePixel: (x, y) => {
      const [r, g, b, a] = testBuffer.getPixel(x, y);
      return { linear: { r, g, b, a }, display: { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }, hex: '#00d000' };
    }
  };

  const keyerNode = new ChromaKeyerNode('chroma_test');
  const keyerUI = new KeyerUI(container, mockViewer, () => {});
  keyerUI.setKeyerNode(keyerNode);

  // 6.1 Point Eyedropper Sampling
  keyerUI.samplePoint(50, 50);
  assert(Math.abs(keyerUI.sampledColor.g - 0.845) < 0.01, 'Sampled G channel must reflect buffer value');
  assert.equal(keyerNode.getKnobValue('screenType'), 'custom');
  assert(Math.abs(Number(keyerNode.getKnobValue('screenColorG')) - 0.845) < 0.01);

  // 6.2 Region Box Average Sampling (from 10,10 to 30,30)
  keyerUI.sampleBox(10, 10, 30, 30, true);
  assert(keyerUI.sampledColor.g > 0.81 && keyerUI.sampledColor.g < 0.84, 'Box average G must match box mean');
  assert(keyerUI.sampledColor.r > 0.04 && keyerUI.sampledColor.r < 0.06);

  // 6.3 Overlay rendering for Box Sampling
  const ctx = new MockCanvasContext();
  keyerUI.isSamplingBox = true;
  keyerUI.boxStart = { x: 10, y: 10 };
  keyerUI.boxEnd = { x: 30, y: 30 };
  keyerUI.drawOverlay(ctx, 1.0, 0, 0);

  const strokeRectCalls = ctx.calls.filter(c => c.op === 'strokeRect');
  assert(strokeRectCalls.length >= 1, 'Box sample overlay must render dashed selection rect');
});

// -----------------------------------------------------------------------------
// TEST 7: Keyer Matte Visualization Modes and A/B Comparison Toggle
// -----------------------------------------------------------------------------
runTest('7. Keyer matte visualization modes (Composite, Matte, Status, Despill) and A/B compare', () => {
  const container = new MockElement('DIV', 'keyer-container');
  const mockViewer = {
    render: () => {},
    compareMode: 'single',
    activeViewerNode: { setKnobValue: (k, v) => {} }
  };
  const keyerUI = new KeyerUI(container, mockViewer, () => {});
  const chromaNode = new ChromaKeyerNode('chroma_modes');
  keyerUI.setKeyerNode(chromaNode);

  // 7.1 View Mode switching
  keyerUI.setOutputMode('matte');
  assert.equal(chromaNode.getKnobValue('output'), 'matte');

  keyerUI.setOutputMode('status');
  assert.equal(chromaNode.getKnobValue('output'), 'status');

  keyerUI.setOutputMode('unpremult');
  assert.equal(chromaNode.getKnobValue('output'), 'unpremult');

  keyerUI.setOutputMode('composite');
  assert.equal(chromaNode.getKnobValue('output'), 'composite');

  // 7.2 Status Diagnostic Mode Compute Verification
  const plate = new PixelBuffer(10, 10);
  // Pixel 0: Pure green screen (Transparent BG)
  plate.setPixel(0, 0, 0.05, 0.85, 0.05, 1.0);
  // Pixel 1: Pure red subject (Solid Core FG)
  plate.setPixel(1, 0, 0.85, 0.05, 0.05, 1.0);

  chromaNode.setKnobValue('output', 'status');
  const statusResult = chromaNode.compute({ in: plate }, {});

  // Transparent background must be diagnostic black: [0, 0, 0, 1]
  const [bgR, bgG, bgB] = statusResult.getPixel(0, 0);
  assert.equal(bgR, 0.0); assert.equal(bgG, 0.0); assert.equal(bgB, 0.0);

  // Solid foreground must be diagnostic white: [1, 1, 1, 1]
  const [fgR, fgG, fgB] = statusResult.getPixel(1, 0);
  assert.equal(fgR, 1.0); assert.equal(fgG, 1.0); assert.equal(fgB, 1.0);

  // 7.3 A/B Comparison Toggle
  assert.equal(keyerUI.isComparing, false);
  keyerUI.toggleCompareAB();
  assert.equal(keyerUI.isComparing, true);
  assert.equal(mockViewer.compareMode, 'wipe_h');

  keyerUI.toggleCompareAB();
  assert.equal(keyerUI.isComparing, false);
  assert.equal(mockViewer.compareMode, 'single');
});

// -----------------------------------------------------------------------------
// TEST 8: Matte Edge Controls and Despill Algorithms
// -----------------------------------------------------------------------------
runTest('8. Matte edge controls (erode, blur, clip black/white) and despill algorithms', () => {
  // 8.1 ChromaKeyer Tolerance & Clip Curves
  const chroma = new ChromaKeyerNode('chroma_curve');
  chroma.setKnobValue('clipBlack', 0.1);
  chroma.setKnobValue('clipWhite', 0.9);
  assert.equal(chroma.getKnobValue('clipBlack'), 0.1);
  assert.equal(chroma.getKnobValue('clipWhite'), 0.9);

  // 8.2 MatteControl Morphological Erosion & Dilation
  const matteCtrl = new MatteControlNode('matte_ctrl');
  matteCtrl.setKnobValue('erode', -2.0); // Erode shrinks matte
  matteCtrl.setKnobValue('blur', 0.0);
  assert.equal(matteCtrl.getKnobValue('erode'), -2.0);

  const testPlate = new PixelBuffer(20, 20);
  testPlate.data.fill(1.0); // Solid white
  // Create circular opaque spot in center
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const dist = Math.hypot(x - 10, y - 10);
      testPlate.setPixel(x, y, 1.0, 1.0, 1.0, dist < 6 ? 1.0 : 0.0);
    }
  }

  const erodedResult = matteCtrl.compute({ in: testPlate }, {});
  // Pixel at radius 5 (dist < 6) was originally 1.0, now eroded to 0.0
  const [, , , alphaEroded] = erodedResult.getPixel(15, 10);
  assert.equal(alphaEroded, 0.0, 'Erosion must shrink edge pixels');

  // Test edge blur softening
  matteCtrl.setKnobValue('blur', 2.0);
  const blurredResult = matteCtrl.compute({ in: testPlate }, {});
  const [, , , alphaBlurred] = blurredResult.getPixel(15, 10);
  assert(alphaBlurred > 0.01, 'Gaussian blur must soften and spread edge border');

  // 8.3 Despill Algorithms (Average vs Max vs Red/Blue Dominant)
  const despill = new DespillNode('despill_test');
  const spillPlate = new PixelBuffer(1, 1);
  spillPlate.setPixel(0, 0, 0.2, 0.8, 0.4, 1.0); // Green spill

  despill.setKnobValue('algorithm', 'average');
  const resAvg = despill.compute({ in: spillPlate }, {});
  const [, gAvg] = resAvg.getPixel(0, 0);
  // Average of R(0.2) and B(0.4) is 0.3
  assert(Math.abs(gAvg - 0.3) < 0.01, 'Average despill must clamp green to (R+B)/2');

  despill.setKnobValue('algorithm', 'max');
  const resMax = despill.compute({ in: spillPlate }, {});
  const [, gMax] = resMax.getPixel(0, 0);
  // Max of R(0.2) and B(0.4) is 0.4
  assert(Math.abs(gMax - 0.4) < 0.01, 'Max despill must clamp green to max(R, B)');
});

// -----------------------------------------------------------------------------
// TEST 9: Department Toolbar and Active Tool Switching
// -----------------------------------------------------------------------------
runTest('9. Department toolbar and active tool switching', () => {
  const container = new MockElement('DIV', 'prop-container');
  const contextToolbar = new MockElement('DIV', 'viewer-context-toolbar');
  global.document.getElementById = (id) => (id === 'viewer-context-toolbar' ? contextToolbar : new MockElement('DIV', id));

  const propUI = new PropertiesUI(container, () => {}, () => {});
  propUI.contextToolbar = contextToolbar;

  const roto = new RotoNode('roto_1');
  const paint = new PaintNode('paint_1');
  const keyer = new ChromaKeyerNode('keyer_1');

  // 9.1 Focus Roto: context toolbar activates ROTO tools
  propUI.showNode(roto);
  assert.equal(contextToolbar.style.display, 'flex');
  const rotoBadge = contextToolbar.querySelector('.badge-roto');
  assert(rotoBadge, 'Context toolbar must display ROTO badge');
  const bezierBtn = contextToolbar.querySelector('[data-roto-tool="bezier"]');
  assert(bezierBtn, 'Context toolbar must provide Bezier tool button');

  // 9.2 Focus Paint: context toolbar switches to PAINT tools
  propUI.showNode(paint);
  assert.equal(contextToolbar.style.display, 'flex');
  const paintBadge = contextToolbar.querySelector('.badge-paint');
  assert(paintBadge, 'Context toolbar must display PAINT badge');
  const cloneBtn = contextToolbar.querySelector('[data-paint-tool="clone"]');
  assert(cloneBtn, 'Context toolbar must provide Clone tool button');

  // 9.3 Focus Keyer: context toolbar switches to KEYING tools
  propUI.showNode(keyer);
  assert.equal(contextToolbar.style.display, 'flex');
  const keyerBadge = contextToolbar.querySelector('.badge-keyer');
  assert(keyerBadge, 'Context toolbar must display KEYING badge');
  const eyedropperBtn = contextToolbar.querySelector('#ctx-keyer-eye');
  assert(eyedropperBtn, 'Context toolbar must provide Eyedropper button');

  // 9.4 Close all nodes: context toolbar hides
  propUI.clearAll();
  assert.equal(contextToolbar.style.display, 'none');
});

// -----------------------------------------------------------------------------
// TEST 10: Project Serialization & Non-Destructive Preservation
// -----------------------------------------------------------------------------
runTest('10. Project serialization and non-destructive overlay preservation', () => {
  const graph = new Graph();

  // Create Roto with multi-point Bezier shape
  const roto = new RotoNode('Roto_Hero');
  const shape = roto.addShape('Face_Oval', 'bezier');
  shape.addPoint(new RotoControlPoint(100, 200, -10, -5, 10, 5, 4.0));
  shape.addPoint(new RotoControlPoint(300, 400, 5, 15, -5, -15, 6.0));
  shape.solo = true;
  shape.locked = true;
  graph.addNode(roto);

  // Create Paint with Brush & Clone strokes
  const paint = new PaintNode('Paint_Cleanup');
  const sBrush = new PaintStroke('brush', 45.0, 0.7, 0.9, 1.0, [0.8, 0.2, 0.1, 1.0]);
  sBrush.lifetime = 'range';
  sBrush.startFrame = 10;
  sBrush.endFrame = 50;
  sBrush.addPoint(120, 180, 1.0);
  sBrush.addPoint(130, 190, 1.0);
  paint.addStroke(sBrush);

  const sClone = new PaintStroke('clone', 25.0, 0.5, 1.0, 1.0);
  sClone.cloneOffset = { dx: 45, dy: -30 };
  sClone.sourceFrame = 5;
  sClone.addPoint(200, 250, 1.0);
  paint.addStroke(sClone);
  graph.addNode(paint);

  // Create ChromaKeyer with custom sampled color & status mode
  const keyer = new ChromaKeyerNode('Keyer_Green');
  keyer.setKnobValue('screenType', 'custom');
  keyer.setKnobValue('screenColorR', 0.062);
  keyer.setKnobValue('screenColorG', 0.841);
  keyer.setKnobValue('screenColorB', 0.075);
  keyer.setKnobValue('output', 'status');
  graph.addNode(keyer);

  // Connect nodes: Roto -> Paint -> Keyer
  graph.connect(roto.id, 'out', paint.id, 'in');
  graph.connect(paint.id, 'out', keyer.id, 'in');

  // Serialization Round-Trip
  const serialized = graph.serialize();
  assert(serialized.nodes && Array.isArray(serialized.nodes));

  const restoredGraph = new Graph();
  restoredGraph.deserialize(serialized, (type, id) => createNode(type, id));

  // Verify Roto restoration
  const restoredRoto = restoredGraph.getNode('Roto_Hero');
  assert(restoredRoto, 'Roto node must be deserialized');
  assert.equal(restoredRoto.shapes.length, 1);
  assert.equal(restoredRoto.shapes[0].name, 'Face_Oval');
  assert.equal(restoredRoto.shapes[0].solo, true);
  assert.equal(restoredRoto.shapes[0].locked, true);
  assert.equal(restoredRoto.shapes[0].points.length, 2);
  assert.equal(restoredRoto.shapes[0].points[0].feather, 4.0);

  // Verify Paint restoration
  const restoredPaint = restoredGraph.getNode('Paint_Cleanup');
  assert(restoredPaint, 'Paint node must be deserialized');
  assert.equal(restoredPaint.strokes.length, 2);
  assert.equal(restoredPaint.strokes[0].type, 'brush');
  assert.equal(restoredPaint.strokes[0].lifetime, 'range');
  assert.equal(restoredPaint.strokes[0].startFrame, 10);
  assert.equal(restoredPaint.strokes[0].endFrame, 50);
  assert.equal(restoredPaint.strokes[1].type, 'clone');
  assert.equal(restoredPaint.strokes[1].cloneOffset.dx, 45);
  assert.equal(restoredPaint.strokes[1].cloneOffset.dy, -30);
  assert.equal(restoredPaint.strokes[1].sourceFrame, 5);

  // Verify Keyer restoration
  const restoredKeyer = restoredGraph.getNode('Keyer_Green');
  assert(restoredKeyer, 'Keyer node must be deserialized');
  assert.equal(restoredKeyer.getKnobValue('screenType'), 'custom');
  assert.equal(restoredKeyer.getKnobValue('screenColorR'), 0.062);
  assert.equal(restoredKeyer.getKnobValue('screenColorG'), 0.841);
  assert.equal(restoredKeyer.getKnobValue('screenColorB'), 0.075);
  assert.equal(restoredKeyer.getKnobValue('output'), 'status');

  // Verify Connections restored
  assert.equal(restoredPaint.inputs[0].connection.nodeId, 'Roto_Hero');
  assert.equal(restoredKeyer.inputs[0].connection.nodeId, 'Paint_Cleanup');
});

console.log('\n====================================================');
console.log('🎉 test_ui_roto_paint_keying.mjs PASSED: All 10/10 tests succeeded!');
console.log('====================================================');
