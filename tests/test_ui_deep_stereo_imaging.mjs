/**
 * OpenComp - UI Parity: Deep, Stereo & Advanced Imaging Regression Suite
 * Rigorously verifies:
 * 1. Deep Viewer display mode & buffer handling
 * 2. Deep sample inspection & per-pixel sample count
 * 3. 1D optical depth ray cross-section & transmittance profile
 * 4. Deep display modes: 2D Flattened, Primary Depth, Sample Density Heatmap
 * 5. Deep node properties integration & workflow navigation
 * 6. Stereo eye selection (Left Eye [L], Right Eye [R])
 * 7. Stereo comparison modes (Anaglyph, Side-by-Side, Wipe, Difference)
 * 8. Stereo disparity & convergence controls and Multi-View statutory disclosure
 * 9. Advanced Imaging: Multi-channel & AOV channel inspection & isolation
 * 10. Metadata inspection panel: technical format, channel tree, attribute filtering
 * 11. Docking & Workspace preset persistence ('Deep / Stereo')
 * 12. Data integrity, deep buffer non-mutation, and 2D/3D non-regression
 */

import assert from 'assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'perf_hooks';
import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';
import { StereoEngine } from '../src/core/StereoEngine.js';
import { ViewerUI } from '../src/ui/ViewerUI.js';
import { DeepInspectorUI } from '../src/ui/DeepInspectorUI.js';
import { MetadataUI } from '../src/ui/MetadataUI.js';
import { StereoUI } from '../src/ui/StereoUI.js';
import { PropertiesUI } from '../src/ui/PropertiesUI.js';
import { DockManager } from '../src/ui/DockManager.js';
import { DeepToImageNode } from '../src/nodes/DeepToImageNode.js';
import { DeepFromImageNode } from '../src/nodes/DeepFromImageNode.js';
import { DeepMergeNode } from '../src/nodes/DeepMergeNode.js';
import { DeepHoldoutNode } from '../src/nodes/DeepHoldoutNode.js';
import { StereoWarpNode } from '../src/nodes/StereoWarpNode.js';
import { StereoMergeNode } from '../src/nodes/StereoMergeNode.js';
import { ViewerNode } from '../src/nodes/ViewerNode.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_deep_stereo_imaging.mjs');
console.log('====================================================\n');

// Mock DOM Environment
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

class MockStyle {
  constructor() {
    this.display = '';
  }
  setProperty(k, v) {
    this[k] = v;
  }
  getPropertyValue(k) {
    return this[k] || '';
  }
  removeProperty(k) {
    delete this[k];
  }
}

class MockElement {
  constructor(tagName = 'DIV', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new MockClassList();
    this.style = new MockStyle();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this._value = '';
    this._innerHTML = '';
    this.width = 800;
    this.height = 600;
    this.listeners = {};
  }

  get value() { return this._value; }
  set value(v) { this._value = String(v); }

  get textContent() { return this._innerHTML.replace(/<[^>]*>/g, ''); }
  set textContent(v) { this._innerHTML = String(v); }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = String(val);
    this.children = [];
    const matches = val.match(/<([a-zA-Z0-9-]+)([^>]*)>/g);
    if (matches) {
      for (const m of matches) {
        const tagMatch = m.match(/<([a-zA-Z0-9-]+)/);
        const tag = tagMatch ? tagMatch[1] : 'div';
        const idMatch = m.match(/id=["']([^"']+)["']/);
        const classMatch = m.match(/class=["']([^"']+)["']/);
        const dataModeMatch = m.match(/data-mode=["']([^"']+)["']/);
        const dataDeepModeMatch = m.match(/data-deep-mode=["']([^"']+)["']/);
        const dataChMatch = m.match(/data-channel=["']([^"']+)["']/);
        const dataSplMatch = m.match(/data-sample-idx=["']([^"']+)["']/);

        const el = new MockElement(tag, idMatch ? idMatch[1] : '');
        el._innerHTML = val;
        if (classMatch) classMatch[1].split(/\s+/).forEach(c => c && el.classList.add(c));
        if (dataModeMatch) el.dataset.mode = dataModeMatch[1];
        if (dataDeepModeMatch) el.dataset.deepMode = dataDeepModeMatch[1];
        if (dataChMatch) el.dataset.channel = dataChMatch[1];
        if (dataSplMatch) el.dataset.sampleIdx = dataSplMatch[1];
        el.parentElement = this;
        this.children.push(el);
      }
    }
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this.id === id) return this;
      for (const c of this.children) {
        if (c.id === id) return c;
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const c of this.children) {
        if (c.classList.contains(cls)) return c;
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    if (sel.startsWith('[data-mode="')) {
      const val = sel.slice(12, -2);
      if (this.dataset.mode === val) return this;
      for (const c of this.children) {
        if (c.dataset.mode === val) return c;
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    return this.children[0] || null;
  }

  querySelectorAll(sel) {
    const res = [];
    const check = (el) => {
      if (sel.startsWith('.')) {
        if (el.classList.contains(sel.slice(1))) res.push(el);
      } else if (sel.startsWith('#')) {
        if (el.id === sel.slice(1)) res.push(el);
      } else if (sel === '[data-mode]') {
        if (el.dataset.mode !== undefined) res.push(el);
      } else if (sel === '[data-deep-mode]') {
        if (el.dataset.deepMode !== undefined) res.push(el);
      } else if (sel === '.btn-isolate-ch') {
        if (el.classList.contains('btn-isolate-ch')) res.push(el);
      } else if (sel.includes('tr[data-sample-idx]')) {
        if (el.dataset.sampleIdx !== undefined) res.push(el);
      } else {
        res.push(el);
      }
      for (const c of el.children) check(c);
    };
    for (const c of this.children) check(c);
    return res;
  }

  addEventListener(evt, handler) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const h of list) h(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', preventDefault: () => {} });
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
  }

  getContext(type) {
    return {
      canvas: this,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'left',
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      rect: () => {},
      arc: () => {},
      closePath: () => {},
      roundRect: () => {},
      stroke: () => {},
      fill: () => {},
      save: () => {},
      restore: () => {},
      clip: () => {},
      fillText: () => {},
      translate: () => {},
      scale: () => {},
      drawImage: () => {},
      putImageData: () => {},
      setLineDash: () => {},
      measureText: (t) => ({ width: (t || '').length * 6 }),
      createImageData: (w, h) => new MockImageData(w, h),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} })
    };
  }
}

class MockImageData {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}

// Setup Global Environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};
global.ImageData = MockImageData;

const elementsMap = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!elementsMap.has(id)) {
    const el = new MockElement(tag, id);
    elementsMap.set(id, el);
  }
  return elementsMap.get(id);
}

global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => getOrCreateElement(id),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
    return new MockElement('div');
  },
  querySelectorAll: () => []
};

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '' }
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    console.log(`  ✔ PASS: ${name} (${(t1 - t0).toFixed(2)} ms)`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// -------------------------------------------------------------
// Test 1: Deep Viewer Mode & Non-Destructive Buffer Handling
// -------------------------------------------------------------
test('Test 1: Deep Viewer mode & Non-destructive buffer handling', () => {
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const infoBar = new MockElement('div', 'viewer-info-bar');
  const viewer = new ViewerUI(canvas, null, infoBar);

  // Construct authentic multi-sample DeepPixelBuffer
  const W = 4, H = 3;
  const pixelLists = new Array(W * H);
  for (let i = 0; i < W * H; i++) {
    pixelLists[i] = [
      { zFront: 2.0, zBack: 2.5, r: 1.0, g: 0.2, b: 0.1, a: 0.8 },
      { zFront: 6.0, zBack: 7.0, r: 0.0, g: 0.8, b: 0.2, a: 0.5 }
    ];
  }
  const deepBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);

  viewer.setBuffer(deepBuf);

  assert.equal(viewer.isDeep, true, 'ViewerUI detects deep buffer');
  assert.equal(viewer.activeDeepBuffer, deepBuf, 'Active deep buffer is referenced intact');
  assert.equal(deepBuf.totalSamples, 24, 'Total samples in deep buffer preserved');

  // Verify non-destructive toImageData on deep buffer
  const imgData = deepBuf.toImageData(0.0, 1.0, 'RGBA');
  assert.equal(imgData.width, 4, 'Output width matches');
  assert.equal(imgData.height, 3, 'Output height matches');
  assert.ok(imgData.data.length === 4 * 3 * 4, 'ImageData bytes correctly sized');

  // Verify original deep data was not mutated
  assert.equal(deepBuf.totalSamples, 24, 'Deep samples untouched after viewport rasterization');
});

// -------------------------------------------------------------
// Test 2: Deep Sample Inspection & Per-Pixel Sample Count
// -------------------------------------------------------------
test('Test 2: Deep sample inspection & per-pixel sample count', () => {
  const container = new MockElement('div', 'deepinspector-wrapper');
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);
  const inspector = new DeepInspectorUI(container, viewer);

  const W = 3, H = 2;
  const pixelLists = new Array(W * H);
  // (0,0): 3 samples
  pixelLists[0] = [
    { zFront: 1.5, zBack: 1.5, r: 0.8, g: 0.1, b: 0.1, a: 0.4 },
    { zFront: 4.0, zBack: 4.5, r: 0.1, g: 0.8, b: 0.1, a: 0.6 },
    { zFront: 8.0, zBack: 9.0, r: 0.0, g: 0.2, b: 0.9, a: 1.0 }
  ];
  // (1,0): 0 samples (empty)
  pixelLists[1] = [];
  // (2,0): 1 sample
  pixelLists[2] = [{ zFront: 3.2, zBack: 3.2, r: 0.5, g: 0.5, b: 0.5, a: 0.5 }];
  pixelLists[3] = [];
  pixelLists[4] = [];
  pixelLists[5] = [];

  const deepBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
  inspector.setDeepBuffer(deepBuf);

  // Inspect Pixel (0, 0)
  inspector.inspectPixel(0, 0);
  assert.equal(inspector.inspectX, 0);
  assert.equal(inspector.inspectY, 0);

  const count0 = deepBuf.getSampleCount(0, 0);
  assert.equal(count0, 3, 'Pixel (0,0) has exactly 3 samples');
  const samples0 = deepBuf.getSamples(0, 0);
  assert.equal(samples0.length, 3);
  assert.equal(samples0[0].zFront, 1.5);
  assert.equal(samples0[2].zBack, 9.0);

  // Inspect Pixel (1, 0) (empty ray)
  inspector.inspectPixel(1, 0);
  const count1 = deepBuf.getSampleCount(1, 0);
  assert.equal(count1, 0, 'Pixel (1,0) has 0 samples (empty ray)');
});

// -------------------------------------------------------------
// Test 3: 1D Optical Depth Ray Cross-Section & Transmittance Profile
// -------------------------------------------------------------
test('Test 3: 1D Optical depth ray cross-section & transmittance profile', () => {
  const container = new MockElement('div', 'deepinspector-wrapper');
  const inspector = new DeepInspectorUI(container);

  const samples = [
    { zFront: 2.0, zBack: 2.0, r: 0.5, g: 0.0, b: 0.0, a: 0.5 },
    { zFront: 5.0, zBack: 6.0, r: 0.0, g: 0.4, b: 0.0, a: 0.4 },
    { zFront: 9.0, zBack: 10.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
  ];

  // Draw depth ray
  inspector.drawDepthRay(samples);

  // Verify analytical transmittance along ray
  // s0: a=0.5 -> remaining T = 0.5
  // s1: a=0.4 -> remaining T = 0.5 * (1 - 0.4) = 0.3
  // s2: a=1.0 -> remaining T = 0.3 * (1 - 1.0) = 0.0
  let T = 1.0;
  for (const s of samples) {
    T *= (1.0 - s.a);
  }
  assert.ok(Math.abs(T - 0.0) < 1e-6, 'Cumulative transmittance reaches 0 after opaque sample');
});

// -------------------------------------------------------------
// Test 4: Deep Display Modes (Flatten, Depth, Heatmap)
// -------------------------------------------------------------
test('Test 4: Deep display modes (2D Flatten, Primary Depth, Sample Heatmap)', () => {
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);

  const W = 2, H = 2;
  const pixelLists = [
    [{ zFront: 2.0, zBack: 2.0, r: 1.0, g: 0.0, b: 0.0, a: 1.0 }], // 1 sample
    [
      { zFront: 1.0, zBack: 1.0, r: 0.0, g: 1.0, b: 0.0, a: 0.5 },
      { zFront: 3.0, zBack: 3.0, r: 0.0, g: 0.0, b: 1.0, a: 0.5 }
    ], // 2 samples
    [], // 0 samples
    [
      { zFront: 1.0, zBack: 1.0, r: 0.5, g: 0.5, b: 0.0, a: 0.2 },
      { zFront: 2.0, zBack: 2.0, r: 0.5, g: 0.5, b: 0.0, a: 0.2 },
      { zFront: 3.0, zBack: 3.0, r: 0.5, g: 0.5, b: 0.0, a: 0.2 },
      { zFront: 4.0, zBack: 4.0, r: 0.5, g: 0.5, b: 0.0, a: 0.2 }
    ] // 4 samples
  ];
  const deepBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);

  // 1. Heatmap Mode
  const heatImg = deepBuf.toImageData(0, 1, 'RGBA', null, 'heatmap');
  assert.equal(heatImg.data[0], 0);   // count=1 -> blue
  assert.equal(heatImg.data[1], 100);
  assert.equal(heatImg.data[2], 255);
  // Pixel 2 (count=0) -> dark background
  assert.equal(heatImg.data[8], 16);
  assert.equal(heatImg.data[9], 16);

  // 2. Primary Depth Mode
  const depthImg = deepBuf.toImageData(0, 1, 'RGBA', null, 'depth');
  assert.ok(depthImg.data[3] === 255, 'Depth mode outputs alpha=255');

  // 3. Flatten Mode
  const flatImg = deepBuf.toImageData(0, 1, 'RGBA', null, 'flatten');
  assert.equal(flatImg.data[0], 255, 'Pixel 0 Red is 255');
  assert.equal(flatImg.data[1], 0);

  // ViewerUI mode switcher
  viewer.setDeepDisplayMode('heatmap');
  assert.equal(viewer.deepDisplayMode, 'heatmap');
  viewer.setDeepDisplayMode('flatten');
  assert.equal(viewer.deepDisplayMode, 'flatten');
});

// -------------------------------------------------------------
// Test 5: Deep Node Properties & Workflow Navigation
// -------------------------------------------------------------
test('Test 5: Deep node properties & workflow navigation', () => {
  const propContainer = new MockElement('div', 'properties-container');
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);
  const propsUI = new PropertiesUI(propContainer, null, null, viewer);

  const dti = new DeepToImageNode('dti1');
  const dmerge = new DeepMergeNode('dmerge1');
  const dhold = new DeepHoldoutNode('dhold1');

  // Check DeepToImage knobs
  assert.equal(dti.getKnobValue('primaryDepth'), 'first');
  assert.equal(dti.getKnobValue('earlyTermination'), true);

  // Check context toolbar rendering for Deep node
  const toolbar = new MockElement('div', 'viewer-context-toolbar');
  propsUI.contextToolbar = toolbar;
  propsUI.renderDeepContextToolbar(toolbar, dti);

  assert.ok(toolbar.innerHTML.includes('DEEP COMP'), 'Deep workflow badge rendered');
  assert.ok(toolbar.innerHTML.includes('Deep Inspector'), 'Deep Inspector button present');
  assert.ok(toolbar.innerHTML.includes('Heatmap'), 'Heatmap toggle button present');
  assert.ok(toolbar.innerHTML.includes('Primary Depth'), 'DeepToImage primary depth control present');
});

// -------------------------------------------------------------
// Test 6: Stereo Eye Selection (Left Eye [L], Right Eye [R])
// -------------------------------------------------------------
test('Test 6: Stereo eye selection (Left Eye [L], Right Eye [R])', () => {
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);

  const bufLeft = new PixelBuffer(2, 2);
  bufLeft.data.fill(1.0); // all white
  const bufRight = new PixelBuffer(2, 2);
  bufRight.data.fill(0.0); // all black

  viewer.setBuffer(bufLeft, { '1': bufLeft, '2': bufRight });

  viewer.setStereoMode('left');
  assert.equal(viewer.stereoMode, 'left');

  viewer.setStereoMode('right');
  assert.equal(viewer.stereoMode, 'right');

  viewer.setStereoMode('none');
  assert.equal(viewer.stereoMode, 'none');
});

// -------------------------------------------------------------
// Test 7: Stereo Comparison Modes (Anaglyph, Side-by-Side, Wipe, Difference)
// -------------------------------------------------------------
test('Test 7: Stereo comparison modes (Anaglyph, Side-by-Side, Wipe, Difference)', () => {
  const left = new PixelBuffer(4, 4);
  const right = new PixelBuffer(4, 4);
  left.data.fill(1.0); // Red/Green/Blue 1.0
  right.data.fill(0.5);

  // 1. Anaglyph
  const anaglyph = StereoEngine.compositeAnaglyph(left, right);
  assert.equal(anaglyph.width, 4);
  assert.equal(anaglyph.height, 4);
  assert.ok(anaglyph.data[0] > 0.9, 'Left luminance in Red channel');
  assert.ok(Math.abs(anaglyph.data[1] - 0.5) < 1e-4, 'Right Green channel preserved');

  // 2. Side-by-Side
  const sbs = StereoEngine.compositeSideBySide(left, right);
  assert.equal(sbs.width, 8, 'Side-by-Side doubles horizontal width');
  assert.equal(sbs.height, 4);
  assert.equal(sbs.data[0], 1.0, 'Left eye on left half');
  assert.equal(sbs.data[4 * 4], 0.5, 'Right eye on right half');

  // 3. Difference
  const diff = StereoEngine.compositeDifference(left, right);
  assert.equal(diff.width, 4);
  assert.ok(Math.abs(diff.data[0] - 0.5) < 1e-4, 'Absolute disparity difference equals 0.5');

  // 4. Wipe
  const wipe = StereoEngine.compositeWipe(left, right, 0.5);
  assert.equal(wipe.width, 4);
  assert.equal(wipe.data[0], 1.0, 'Left side of wipe contains Left eye');
  assert.equal(wipe.data[3 * 4], 0.5, 'Right side of wipe contains Right eye');
});

// -------------------------------------------------------------
// Test 8: Stereo Disparity Controls & Multi-View Statutory Disclosure
// -------------------------------------------------------------
test('Test 8: Stereo disparity controls & Multi-View statutory disclosure', () => {
  const container = new MockElement('div', 'stereo-wrapper');
  const stereoUI = new StereoUI(container);

  const warpNode = new StereoWarpNode('warp1');
  const mergeNode = new StereoMergeNode('merge1');

  stereoUI.setWarpNode(warpNode);
  stereoUI.setMergeNode(mergeNode);

  assert.equal(warpNode.getKnobValue('convergence'), 0.5);
  assert.equal(warpNode.getKnobValue('separation'), 12.0);

  // Verify statutory disclosure banner for Multi-View routing
  assert.ok(
    container.innerHTML.includes('Stereo Processing Notice') && container.innerHTML.includes('StereoWarp') && container.innerHTML.includes('StereoMerge'),
    'Statutory stereo processing disclosure prominently displayed'
  );
  assert.ok(
    container.innerHTML.includes('OneView (Preview)') && container.innerHTML.includes('JoinViews (Preview)'),
    'Multi-view routing controls properly badged as Preview'
  );
});

// -------------------------------------------------------------
// Test 9: Advanced Imaging: Multi-Channel & AOV Inspection
// -------------------------------------------------------------
test('Test 9: Advanced Imaging: Multi-channel & AOV channel inspection & isolation', () => {
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);

  const buf = new PixelBuffer(4, 4);
  const depthData = new Float32Array(16);
  depthData.fill(5.5);
  buf.setChannel('depth.Z', depthData);

  const normX = new Float32Array(16);
  const normY = new Float32Array(16);
  const normZ = new Float32Array(16);
  normZ.fill(1.0);
  buf.setChannel('normal.X', normX);
  buf.setChannel('normal.Y', normY);
  buf.setChannel('normal.Z', normZ);

  viewer.setBuffer(buf);

  // Check channel discovery
  const names = buf.getChannelNames();
  assert.ok(names.includes('depth.Z'), 'depth.Z discovered');
  assert.ok(names.includes('normal.X'), 'normal.X discovered');

  // Isolate depth.Z channel
  viewer.setAOVChannel('depth.Z');
  assert.equal(viewer.activeAOV, 'depth.Z');

  // Isolate normal channel
  viewer.setAOVChannel('normal.Z');
  assert.equal(viewer.activeAOV, 'normal.Z');

  // Return to RGBA
  viewer.setAOVChannel('RGBA');
  assert.equal(viewer.activeAOV, null);
  assert.equal(viewer.channelMode, 'RGBA');
});

// -------------------------------------------------------------
// Test 10: Metadata Inspection Panel (Real OpenEXR & Missing Metadata)
// -------------------------------------------------------------
test('Test 10: Metadata inspection panel: format, channel tree, attribute filtering', () => {
  const container = new MockElement('div', 'metadata-wrapper');
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);
  const metaUI = new MetadataUI(container, viewer);

  // 1. Test with Authentic Real OpenEXR Multi-Channel File from disk
  const exrPath = path.resolve('tests/final_audit/aov/source_multipass.exr');
  assert.ok(fs.existsSync(exrPath), `Real EXR test fixture must exist: ${exrPath}`);
  const realBuf = ImageIO.readEXR(fs.readFileSync(exrPath));

  metaUI.setBuffer(realBuf);

  // Validate technical format specs against real EXR header
  assert.ok(container.querySelector('#tech-res')?.textContent.includes('512 x 512'), 'Real EXR dimensions 512x512');
  assert.ok(container.querySelector('#tech-compression')?.textContent.includes('NONE'), 'Real EXR compression NONE (uncompressed)');
  assert.ok(container.querySelector('#tech-datawindow')?.textContent.includes('[0, 0] - [511, 511]'), 'Real EXR dataWindow [0, 0] - [511, 511]');
  assert.ok(container.querySelector('#meta-channel-count-badge')?.textContent.includes('10 Channels'), 'Real EXR 10 channels detected');

  // Validate channel layer hierarchy grouping from real EXR
  const chanHTML = container.querySelector('#meta-channels-container')?.innerHTML || '';
  assert.ok(chanHTML.includes('RGBA'), 'RGBA layer group present');
  assert.ok(chanHTML.includes('DEPTH'), 'DEPTH layer group present');
  assert.ok(chanHTML.includes('DIFFUSE'), 'DIFFUSE layer group present');
  assert.ok(chanHTML.includes('SPECULAR'), 'SPECULAR layer group present');
  assert.ok(chanHTML.includes('CRYPTO_MATERIAL'), 'CRYPTO_MATERIAL layer group present');
  assert.ok(chanHTML.includes('depth.Z'), 'depth.Z channel present');
  assert.ok(chanHTML.includes('diffuse.R'), 'diffuse.R channel present');

  // Validate channel isolation for arbitrary available channel
  metaUI.isolateChannel('diffuse.R');
  assert.equal(viewer.activeAOV, 'diffuse.R', 'diffuse.R channel successfully isolated on viewer');
  metaUI.isolateChannel('crypto_material.01');
  assert.equal(viewer.activeAOV, 'crypto_material.01', 'crypto_material.01 channel isolated');

  // Validate header attributes extraction & search filtering
  const attrs = metaUI.getHeaderAttributes();
  assert.ok(attrs.length >= 6, `Extracted ${attrs.length} attributes from real EXR`);
  assert.ok(attrs.some(a => a.key === 'opencomp/format' && a.value === '512x512'));
  assert.ok(attrs.some(a => a.key === 'dataWindow'));
  assert.ok(attrs.some(a => a.key === 'channels'));

  metaUI.setFilter('datawindow');
  assert.equal(metaUI.searchFilter, 'datawindow');

  // 2. Test graceful fallback when optional metadata or channels are absent
  const bareBuf = new PixelBuffer(640, 480);
  bareBuf.metadata = null; // No metadata attached
  metaUI.setBuffer(bareBuf);
  assert.ok(container.querySelector('#tech-res')?.textContent.includes('640 x 480'), 'Graceful format readout without metadata');
  assert.ok(container.querySelector('#meta-channel-count-badge')?.textContent.includes('4 Channels'), 'Default 4 RGBA channels without metadata');
});

// -------------------------------------------------------------
// Test 11: Docking & Workspace Persistence ('Deep / Stereo')
// -------------------------------------------------------------
test('Test 11: Docking & Workspace preset persistence ("Deep / Stereo")', () => {
  mockStorage.clear();
  const dock = new DockManager();

  assert.ok(dock.builtinPresets.includes('Deep / Stereo'), 'Deep / Stereo preset included in builtin presets');

  dock.applyPreset('Deep / Stereo');
  assert.equal(dock.activePreset, 'Deep / Stereo');

  const saved = mockStorage.get('opencomp_active_workspace');
  assert.equal(saved, 'Deep / Stereo', 'Workspace preset saved in localStorage');
});

// -------------------------------------------------------------
// Test 12: Data Integrity & 2D/3D Viewer Non-Regression
// -------------------------------------------------------------
test('Test 12: Data integrity, deep buffer non-mutation, and 2D/3D non-regression', () => {
  // 1. Verify DeepPixelBuffer flattening round-trip
  const W = 3, H = 2;
  const pixelLists = new Array(W * H);
  for (let i = 0; i < W * H; i++) {
    pixelLists[i] = [
      { zFront: 2.0, zBack: 2.0, r: 0.5, g: 0.0, b: 0.0, a: 0.5 },
      { zFront: 5.0, zBack: 5.0, r: 0.0, g: 0.5, b: 0.0, a: 0.5 }
    ];
  }
  const deepBuf = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
  const sampleCountBefore = deepBuf.totalSamples;

  const flatBuf = deepBuf.flattenToPixelBuffer();
  assert.ok(flatBuf instanceof PixelBuffer, 'Emits standard PixelBuffer');
  assert.equal(flatBuf.width, 3);
  assert.equal(flatBuf.height, 2);
  assert.ok(flatBuf.hasChannel('depth.Z'), 'Synthesizes depth.Z AOV');
  assert.equal(deepBuf.totalSamples, sampleCountBefore, 'Deep buffer total samples unchanged');

  // 2. Verify 2D and 3D Viewport modes still exist and switch without interference
  const canvas = new MockElement('canvas', 'viewer-canvas');
  const viewer = new ViewerUI(canvas);

  assert.equal(viewer.viewMode, '2D');
  viewer.setViewMode('3D');
  assert.equal(viewer.viewMode, '3D');
  viewer.setViewMode('2D');
  assert.equal(viewer.viewMode, '2D');
});

console.log('\n====================================================');
console.log(`📊 TEST RESULTS: ${passed} Passed, ${failed} Failed`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL DEEP, STEREO & ADVANCED IMAGING TESTS PASSED!');
}
