/**
 * OpenComp Test Suite - Advanced Viewer & Color Pipeline Verification
 * Comprehensive verification of:
 * 1. Single, Dual (H & V), and Quad layout switching & bounds calculation
 * 2. Independent viewer input selection (slots 1–10) across viewports
 * 3. A/B Horizontal & Vertical Wipe, Difference mode, and Side-by-Side comparison
 * 4. Linked vs Independent Pan & Zoom navigation (syncZoomPan toggle)
 * 5. Fit to view, 1:1 actual size, reset view, and zoom presets (25%, 50%, 100%, 200%, 400%, 800%)
 * 6. Channel isolation modes: RGBA, RGB (opaque alpha verification), Red, Green, Blue, Alpha, Luminance
 * 7. Exposure (-5 to +5 EV) and Gamma (0.2 to 3.0) verification with zero buffer mutation
 * 8. OCIO Display & View selection, working space reporting, and OCIO bypass toggle
 * 9. Safe areas (Action 90%, Title 80%) and format guides / aspect ratio masks (16:9, 1.85:1, 2.39:1, 4:3, 1:1, 9:16)
 * 10. ROI selection, movement, 8-handle resizing, boundary clamping, and clear
 * 11. Pixel sampler: accurate float & display values, hex, pinned target
 * 12. Zoom-dependent pixel inspection: pixel grid & hover cell highlight at zoom >= 8.0x
 * 13. Scopes: Waveform, RGB Parade, Histogram, Vectorscope, and Pixel Analyzer (statistical metrics, NaN/Inf detection, clipping stats, and ROI reflection)
 * 14. Scope resizing and docking modes (overlay vs docked)
 * 15. Keyboard shortcuts & context menu dispatch
 * 16. Preferences save/restore in localStorage
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ViewerNode } from '../src/nodes/ViewerNode.js';
import { ViewerUI } from '../src/ui/ViewerUI.js';
import { ViewerScopes } from '../src/ui/ViewerScopes.js';
import { ViewerOverlay } from '../src/ui/ViewerOverlay.js';
import { globalOCIO } from '../src/core/OCIOManager.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_viewer_pipeline.mjs');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    process.stdout.write(`▶ ${name}... `);
    mockStorageMap.clear();
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
// Mock DOM, LocalStorage & Canvas Context for Headless Environment
// ---------------------------------------------------------------------------
class MockCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
    this.fillStyle = '#000';
    this.strokeStyle = '#fff';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'left';
  }
  fillRect(x, y, w, h) { this.calls.push({ op: 'fillRect', x, y, w, h }); }
  strokeRect(x, y, w, h) { this.calls.push({ op: 'strokeRect', x, y, w, h }); }
  rect(x, y, w, h) { this.calls.push({ op: 'rect', x, y, w, h }); }
  clearRect(x, y, w, h) { this.calls.push({ op: 'clearRect', x, y, w, h }); }
  beginPath() { this.calls.push({ op: 'beginPath' }); }
  closePath() { this.calls.push({ op: 'closePath' }); }
  clip() { this.calls.push({ op: 'clip' }); }
  moveTo(x, y) { this.calls.push({ op: 'moveTo', x, y }); }
  lineTo(x, y) { this.calls.push({ op: 'lineTo', x, y }); }
  arc(x, y, r, sa, ea) { this.calls.push({ op: 'arc', x, y, r, sa, ea }); }
  stroke() { this.calls.push({ op: 'stroke' }); }
  fill() { this.calls.push({ op: 'fill' }); }
  fillText(text, x, y) { this.calls.push({ op: 'fillText', text, x, y }); }
  strokeText(text, x, y) { this.calls.push({ op: 'strokeText', text, x, y }); }
  measureText(str) { return { width: (str || '').length * 7 }; }
  putImageData() { }
  createImageData(w, h) { return new global.ImageData(w, h); }
  translate(x, y) { }
  scale(x, y) { }
  drawImage() { }
  roundRect() { }
  setTransform() { }
  resetTransform() { }
  setLineDash() { }
  save() { this.calls.push({ op: 'save' }); }
  restore() { this.calls.push({ op: 'restore' }); }
}

if (!global.ImageData) {
  global.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height;
      }
    }
  };
}

class MockElement {
  constructor(tagName = 'DIV', width = 1920, height = 1080) {
    this.tagName = tagName.toUpperCase();
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.style = {};
    this.listeners = {};
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, state) => {
        if (state !== undefined) {
          if (state) this.classList._classes.add(c);
          else this.classList._classes.delete(c);
        } else {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        }
      },
      contains: (c) => this.classList._classes.has(c)
    };
    this._ctx = new MockCanvasContext(this);
  }

  getContext(type) {
    return this._ctx;
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height
    };
  }

  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }

  removeEventListener(type, cb) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(f => f !== cb);
  }

  dispatchEvent(event) {
    event.target = this;
    if (this.listeners[event.type]) {
      for (const cb of this.listeners[event.type]) {
        cb(event);
      }
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

// LocalStorage mock
const mockStorageMap = new Map();
global.localStorage = {
  getItem: (k) => mockStorageMap.get(k) || null,
  setItem: (k, v) => mockStorageMap.set(k, String(v)),
  removeItem: (k) => mockStorageMap.delete(k),
  clear: () => mockStorageMap.clear()
};

const mockElements = new Map();
if (!global.window) {
  global.window = new MockElement('WINDOW');
}
if (!global.document) {
  global.document = {
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (!mockElements.has(id)) {
        mockElements.set(id, new MockElement('DIV'));
      }
      return mockElements.get(id);
    },
    querySelector: (sel) => null,
    querySelectorAll: (sel) => [],
    activeElement: null
  };
}

// Helper to create test buffers
function createSolidBuffer(w, h, r, g, b, a = 1.0) {
  const buf = new PixelBuffer(w, h);
  for (let i = 0; i < w * h; i++) {
    buf.data[i * 4 + 0] = r;
    buf.data[i * 4 + 1] = g;
    buf.data[i * 4 + 2] = b;
    buf.data[i * 4 + 3] = a;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// TEST 1: Single, Dual (H & V), and Quad layout switching & bounds calculation
// ---------------------------------------------------------------------------
runTest('1. Single, Dual (H & V), and Quad layout switching & bounds calculation', () => {
  const canvas = new MockElement('CANVAS', 1920, 1080);
  const viewerUI = new ViewerUI(canvas);

  // Single layout
  viewerUI.setLayoutMode('single');
  assert.equal(viewerUI.layoutMode, 'single');
  const bSingle = viewerUI.getViewportBounds(0, 1920, 1080);
  assert.deepEqual({ x: bSingle.x, y: bSingle.y, w: bSingle.w, h: bSingle.h }, { x: 0, y: 0, w: 1920, h: 1080 });

  // Dual horizontal layout
  viewerUI.setLayoutMode('dual_h');
  assert.equal(viewerUI.layoutMode, 'dual_h');
  const bDualH0 = viewerUI.getViewportBounds(0, 1920, 1080);
  const bDualH1 = viewerUI.getViewportBounds(1, 1920, 1080);
  assert.deepEqual({ x: bDualH0.x, y: bDualH0.y, w: bDualH0.w, h: bDualH0.h }, { x: 0, y: 0, w: 960, h: 1080 });
  assert.deepEqual({ x: bDualH1.x, y: bDualH1.y, w: bDualH1.w, h: bDualH1.h }, { x: 960, y: 0, w: 960, h: 1080 });
  assert.equal(viewerUI.getViewportAtPoint(400, 500), 0);
  assert.equal(viewerUI.getViewportAtPoint(1200, 500), 1);

  // Dual vertical layout
  viewerUI.setLayoutMode('dual_v');
  assert.equal(viewerUI.layoutMode, 'dual_v');
  const bDualV0 = viewerUI.getViewportBounds(0, 1920, 1080);
  const bDualV1 = viewerUI.getViewportBounds(1, 1920, 1080);
  assert.deepEqual({ x: bDualV0.x, y: bDualV0.y, w: bDualV0.w, h: bDualV0.h }, { x: 0, y: 0, w: 1920, h: 540 });
  assert.deepEqual({ x: bDualV1.x, y: bDualV1.y, w: bDualV1.w, h: bDualV1.h }, { x: 0, y: 540, w: 1920, h: 540 });
  assert.equal(viewerUI.getViewportAtPoint(500, 200), 0);
  assert.equal(viewerUI.getViewportAtPoint(500, 700), 1);

  // Quad layout
  viewerUI.setLayoutMode('quad');
  assert.equal(viewerUI.layoutMode, 'quad');
  const bQ0 = viewerUI.getViewportBounds(0, 1920, 1080);
  const bQ1 = viewerUI.getViewportBounds(1, 1920, 1080);
  const bQ2 = viewerUI.getViewportBounds(2, 1920, 1080);
  const bQ3 = viewerUI.getViewportBounds(3, 1920, 1080);
  assert.deepEqual({ x: bQ0.x, y: bQ0.y, w: bQ0.w, h: bQ0.h }, { x: 0, y: 0, w: 960, h: 540 });
  assert.deepEqual({ x: bQ1.x, y: bQ1.y, w: bQ1.w, h: bQ1.h }, { x: 960, y: 0, w: 960, h: 540 });
  assert.deepEqual({ x: bQ2.x, y: bQ2.y, w: bQ2.w, h: bQ2.h }, { x: 0, y: 540, w: 960, h: 540 });
  assert.deepEqual({ x: bQ3.x, y: bQ3.y, w: bQ3.w, h: bQ3.h }, { x: 960, y: 540, w: 960, h: 540 });
  assert.equal(viewerUI.getViewportAtPoint(400, 200), 0);
  assert.equal(viewerUI.getViewportAtPoint(1200, 200), 1);
  assert.equal(viewerUI.getViewportAtPoint(400, 700), 2);
  assert.equal(viewerUI.getViewportAtPoint(1200, 700), 3);
});

// ---------------------------------------------------------------------------
// TEST 2: Independent viewer input selection (slots 1–10) across viewports
// ---------------------------------------------------------------------------
runTest('2. Independent viewer input selection (slots 1–10) across viewports', () => {
  const canvas = new MockElement('CANVAS', 1920, 1080);
  const viewerUI = new ViewerUI(canvas);

  const buffers = {};
  for (let i = 1; i <= 10; i++) {
    buffers[String(i)] = createSolidBuffer(100, 100, i * 0.1, 0, 0, 1.0);
  }
  viewerUI.setBuffer(buffers['1'], buffers);

  // In Quad mode, map independent slots
  viewerUI.setLayoutMode('quad');
  viewerUI.setViewportSlot(0, '3');
  viewerUI.setViewportSlot(1, '5');
  viewerUI.setViewportSlot(2, '7');
  viewerUI.setViewportSlot(3, '10');

  assert.equal(viewerUI.getBufferForViewport(0), buffers['3']);
  assert.equal(viewerUI.getBufferForViewport(1), buffers['5']);
  assert.equal(viewerUI.getBufferForViewport(2), buffers['7']);
  assert.equal(viewerUI.getBufferForViewport(3), buffers['10']);

  // Set active input for active viewport
  viewerUI.activeViewportIdx = 1;
  viewerUI.setActiveInput('9');
  assert.equal(viewerUI.viewports[1].slot, '9');
  assert.equal(viewerUI.getBufferForViewport(1), buffers['9']);

  // In Dual mode, verify slots A and B
  viewerUI.setLayoutMode('dual');
  viewerUI.setViewportSlot(0, '2');
  viewerUI.setViewportSlot(1, '8');
  assert.equal(viewerUI.sourceA, '2');
  assert.equal(viewerUI.sourceB, '8');
  assert.equal(viewerUI.getBufferForViewport(0), buffers['2']);
  assert.equal(viewerUI.getBufferForViewport(1), buffers['8']);
});

// ---------------------------------------------------------------------------
// TEST 3: A/B Horizontal & Vertical Wipe, Difference mode, and Side-by-Side comparison
// ---------------------------------------------------------------------------
runTest('3. A/B Horizontal & Vertical Wipe, Difference mode, and Side-by-Side comparison', () => {
  const node = new ViewerNode();
  const bufA = createSolidBuffer(100, 100, 1.0, 0.0, 0.0, 1.0); // Pure Red
  const bufB = createSolidBuffer(100, 100, 0.0, 0.0, 1.0, 1.0); // Pure Blue

  const inputs = { '1': bufA, '2': bufB };

  // 1. Horizontal Wipe at 50%
  node.setKnobValue('compareMode', 'wipe_h');
  node.setKnobValue('wipePosition', 0.5);
  const outWipeH = node.compute(inputs);
  assert(outWipeH, 'Output buffer must exist');
  // Left side (x = 25) should be bufA (Red)
  const [rLeft, gLeft, bLeft] = outWipeH.getPixel(25, 50);
  assert.equal(rLeft, 1.0);
  assert.equal(bLeft, 0.0);
  // Right side (x = 75) should be bufB (Blue)
  const [rRight, gRight, bRight] = outWipeH.getPixel(75, 50);
  assert.equal(rRight, 0.0);
  assert.equal(bRight, 1.0);

  // 2. Vertical Wipe at 50%
  node.setKnobValue('compareMode', 'wipe_v');
  node.setKnobValue('wipePosition', 0.5);
  const outWipeV = node.compute(inputs);
  // Top side (y = 25) should be bufA (Red)
  const [rTop, , bTop] = outWipeV.getPixel(50, 25);
  assert.equal(rTop, 1.0);
  assert.equal(bTop, 0.0);
  // Bottom side (y = 75) should be bufB (Blue)
  const [rBot, , bBot] = outWipeV.getPixel(50, 75);
  assert.equal(rBot, 0.0);
  assert.equal(bBot, 1.0);

  // 3. Difference mode
  node.setKnobValue('compareMode', 'diff');
  const outDiff = node.compute(inputs);
  const [rDiff, gDiff, bDiff] = outDiff.getPixel(50, 50);
  // |1.0 - 0.0| = 1.0 for Red, |0.0 - 1.0| = 1.0 for Blue
  assert.equal(rDiff, 1.0);
  assert.equal(gDiff, 0.0);
  assert.equal(bDiff, 1.0);

  // 4. Side-by-Side mode
  node.setKnobValue('compareMode', 'side_by_side');
  const outSBS = node.compute(inputs);
  assert.equal(outSBS.width, 100);
  assert.equal(outSBS.height, 100);

  // 5. Interactive wipe overlay rendering test
  const overlay = new ViewerOverlay();
  const ctx = new MockCanvasContext(new MockElement('CANVAS', 800, 600));
  overlay.drawWipeHandle(ctx, 'wipe_h', 0.5, 800, 600, 1.0, 0, 0);
  assert(ctx.calls.length > 0, 'drawWipeHandle must render divider line and grip');
});

// ---------------------------------------------------------------------------
// TEST 4: Linked vs Independent Pan & Zoom navigation (syncZoomPan toggle)
// ---------------------------------------------------------------------------
runTest('4. Linked vs Independent Pan & Zoom navigation (syncZoomPan toggle)', () => {
  const canvas = new MockElement('CANVAS', 1920, 1080);
  const viewerUI = new ViewerUI(canvas);
  viewerUI.setLayoutMode('quad');

  // When syncZoomPan is true (default)
  assert.equal(viewerUI.syncZoomPan, true);
  viewerUI.zoom = 2.5;
  viewerUI.panX = 120;
  viewerUI.panY = -80;
  for (let i = 0; i < 4; i++) {
    assert.equal(viewerUI.viewports[i].zoom, 2.5);
    assert.equal(viewerUI.viewports[i].panX, 120);
    assert.equal(viewerUI.viewports[i].panY, -80);
  }

  // When syncZoomPan is false
  viewerUI.setSyncZoomPan(false);
  assert.equal(viewerUI.syncZoomPan, false);

  viewerUI.viewports[1].zoom = 0.5;
  viewerUI.viewports[1].panX = 40;
  viewerUI.viewports[1].panY = 10;

  // Viewport 0 and others must not be affected
  assert.equal(viewerUI.viewports[0].zoom, 2.5);
  assert.equal(viewerUI.viewports[1].zoom, 0.5);
  assert.equal(viewerUI.viewports[2].zoom, 2.5);

  // Re-synchronize
  viewerUI.activeViewportIdx = 1;
  viewerUI.toggleSyncZoomPan();
  assert.equal(viewerUI.syncZoomPan, true);
  // All viewports should now be synchronized to active viewport (viewport 1: 0.5)
  for (let i = 0; i < 4; i++) {
    assert.equal(viewerUI.viewports[i].zoom, 0.5);
    assert.equal(viewerUI.viewports[i].panX, 40);
    assert.equal(viewerUI.viewports[i].panY, 10);
  }
});

// ---------------------------------------------------------------------------
// TEST 5: Fit to view, 1:1 actual size, reset view, and zoom presets
// ---------------------------------------------------------------------------
runTest('5. Fit to view, 1:1 actual size, reset view, and zoom presets', () => {
  mockStorageMap.clear();
  const canvas = new MockElement('CANVAS', 1920, 1080);
  const viewerUI = new ViewerUI(canvas);
  viewerUI.setLayoutMode('single');
  const buf = createSolidBuffer(3840, 2160, 0.5, 0.5, 0.5);
  viewerUI.setBuffer(buf);

  // Fit to view
  viewerUI.fitToView();
  // Available width is 1920 - 40 = 1880; 1880 / 3840 = 0.489583
  assert(viewerUI.zoom > 0.45 && viewerUI.zoom < 0.50, `Fit zoom should be ~0.49, got ${viewerUI.zoom}`);

  // Actual size 1:1
  viewerUI.actualSize();
  assert.equal(viewerUI.zoom, 1.0);
  assert.equal(viewerUI.viewports[0].zoom, 1.0);

  // Reset view
  viewerUI.resetView();
  assert.equal(viewerUI.zoom, 1.0);

  // Zoom presets: 25%, 50%, 100%, 200%, 400%, 800%
  const presets = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
  for (const p of presets) {
    viewerUI.setZoomPreset(p);
    assert.equal(viewerUI.zoom, p, `Zoom preset ${p} should match`);
  }
});

// ---------------------------------------------------------------------------
// TEST 6: Channel isolation modes: RGBA, RGB (opaque alpha), Red, Green, Blue, Alpha, Luminance
// ---------------------------------------------------------------------------
runTest('6. Channel isolation modes: RGBA, RGB (opaque alpha), Red, Green, Blue, Alpha, Luminance', () => {
  const buf = new PixelBuffer(2, 2);
  // Pixel with r=0.4, g=0.6, b=0.8, a=0.25 (transparent)
  for (let i = 0; i < 4; i++) {
    buf.data[i * 4 + 0] = 0.4;
    buf.data[i * 4 + 1] = 0.6;
    buf.data[i * 4 + 2] = 0.8;
    buf.data[i * 4 + 3] = 0.25;
  }

  // 1. RGBA mode
  const imgRGBA = buf.toImageData({ channelMode: 'RGBA' });
  assert.equal(imgRGBA.data[0], Math.round(0.4 * 255));
  assert.equal(imgRGBA.data[1], Math.round(0.6 * 255));
  assert.equal(imgRGBA.data[2], Math.round(0.8 * 255));
  assert.equal(imgRGBA.data[3], Math.round(0.25 * 255)); // Transparent alpha preserved

  // 2. RGB mode (Alpha MUST BE 255 / 1.0 fully opaque)
  const imgRGB = buf.toImageData({ channelMode: 'RGB' });
  assert.equal(imgRGB.data[0], Math.round(0.4 * 255));
  assert.equal(imgRGB.data[1], Math.round(0.6 * 255));
  assert.equal(imgRGB.data[2], Math.round(0.8 * 255));
  assert.equal(imgRGB.data[3], 255, 'RGB mode alpha must be 255 (opaque)');

  // 3. RED mode (R mapped to RGB)
  const imgR = buf.toImageData({ channelMode: 'RED' });
  assert.equal(imgR.data[0], Math.round(0.4 * 255));
  assert.equal(imgR.data[1], Math.round(0.4 * 255));
  assert.equal(imgR.data[2], Math.round(0.4 * 255));
  assert.equal(imgR.data[3], 255);

  // 4. GREEN mode (G mapped to RGB)
  const imgG = buf.toImageData({ channelMode: 'GREEN' });
  assert.equal(imgG.data[0], Math.round(0.6 * 255));
  assert.equal(imgG.data[1], Math.round(0.6 * 255));
  assert.equal(imgG.data[2], Math.round(0.6 * 255));
  assert.equal(imgG.data[3], 255);

  // 5. BLUE mode (B mapped to RGB)
  const imgB = buf.toImageData({ channelMode: 'BLUE' });
  assert.equal(imgB.data[0], Math.round(0.8 * 255));
  assert.equal(imgB.data[1], Math.round(0.8 * 255));
  assert.equal(imgB.data[2], Math.round(0.8 * 255));
  assert.equal(imgB.data[3], 255);

  // 6. ALPHA mode (A mapped to RGB)
  const imgA = buf.toImageData({ channelMode: 'ALPHA' });
  assert.equal(imgA.data[0], Math.round(0.25 * 255));
  assert.equal(imgA.data[1], Math.round(0.25 * 255));
  assert.equal(imgA.data[2], Math.round(0.25 * 255));
  assert.equal(imgA.data[3], 255);

  // 7. LUMA mode (0.2126*r + 0.7152*g + 0.0722*b)
  const expLuma = 0.2126 * 0.4 + 0.7152 * 0.6 + 0.0722 * 0.8; // ~0.57192
  const imgLuma = buf.toImageData({ channelMode: 'LUMA' });
  assert.equal(imgLuma.data[0], Math.round(expLuma * 255));
  assert.equal(imgLuma.data[1], Math.round(expLuma * 255));
  assert.equal(imgLuma.data[2], Math.round(expLuma * 255));
  assert.equal(imgLuma.data[3], 255);
});

// ---------------------------------------------------------------------------
// TEST 7: Exposure (-5 to +5 EV) and Gamma (0.2 to 3.0) verification with zero buffer mutation
// ---------------------------------------------------------------------------
runTest('7. Exposure (-5 to +5 EV) and Gamma (0.2 to 3.0) verification with zero buffer mutation', () => {
  const canvas = new MockElement('CANVAS', 800, 600);
  const viewerUI = new ViewerUI(canvas);

  const testBuf = new PixelBuffer(4, 4);
  const originalFloats = new Float32Array(4 * 4 * 4);
  for (let i = 0; i < testBuf.data.length; i += 4) {
    testBuf.data[i + 0] = 0.18; // 18% gray
    testBuf.data[i + 1] = 0.50;
    testBuf.data[i + 2] = 0.80;
    testBuf.data[i + 3] = 1.0;
  }
  originalFloats.set(testBuf.data);
  viewerUI.setBuffer(testBuf);

  // Test across full EV and Gamma ranges
  const testCases = [
    { ev: 0.0, gamma: 1.0 },
    { ev: -5.0, gamma: 1.0 },
    { ev: 2.0, gamma: 2.2 },
    { ev: 5.0, gamma: 0.2 },
    { ev: -2.0, gamma: 3.0 }
  ];

  for (const tc of testCases) {
    viewerUI.setExposure(tc.ev);
    viewerUI.setGamma(tc.gamma);
    assert.equal(viewerUI.exposure, tc.ev);
    assert.equal(viewerUI.gamma, tc.gamma);

    // Verify mathematical correctness of display mapping
    const sample = viewerUI.samplePixel(0, 0);
    const expMult = Math.pow(2.0, tc.ev);
    const invGamma = 1.0 / tc.gamma;
    const expDR = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(0, 0.18 * expMult), invGamma) * 255)));
    assert.equal(sample.display.r, expDR, `Display R must match mathematical formula for EV=${tc.ev}, Gamma=${tc.gamma}`);

    // Verify source buffer is completely unmutated
    for (let i = 0; i < testBuf.data.length; i++) {
      assert.equal(testBuf.data[i], originalFloats[i], 'Source buffer data must NOT be mutated');
    }
  }
});

// ---------------------------------------------------------------------------
// TEST 8: OCIO Display & View selection, working space reporting, and OCIO bypass toggle
// ---------------------------------------------------------------------------
runTest('8. OCIO Display & View selection, working space reporting, and OCIO bypass toggle', () => {
  const canvas = new MockElement('CANVAS', 800, 600);
  const viewerUI = new ViewerUI(canvas);

  // Default OCIO settings
  assert.equal(viewerUI.workingSpace, 'ACEScg');
  assert.equal(viewerUI.ocioProcessEnabled, true);

  const displays = globalOCIO.getDisplays();
  assert(displays.length > 0, 'Global OCIO displays must exist');

  // Change display
  const targetDisplay = displays[displays.length - 1];
  viewerUI.setOCIODisplay(targetDisplay);
  assert.equal(viewerUI.ocioDisplay, targetDisplay);

  // Views for this display
  const views = globalOCIO.getViews(targetDisplay);
  assert(views.length > 0, 'Views must exist for selected display');
  const targetView = views[views.length - 1];
  viewerUI.setOCIOView(targetView);
  assert.equal(viewerUI.ocioView, targetView);

  // Toggle OCIO bypass
  viewerUI.toggleOCIOProcess();
  assert.equal(viewerUI.ocioProcessEnabled, false);
  viewerUI.toggleOCIOProcess(true);
  assert.equal(viewerUI.ocioProcessEnabled, true);
});

// ---------------------------------------------------------------------------
// TEST 9: Safe areas (Action 90%, Title 80%) and format guides / aspect ratio masks
// ---------------------------------------------------------------------------
runTest('9. Safe areas (Action 90%, Title 80%) and format guides / aspect ratio masks', () => {
  const overlay = new ViewerOverlay();
  const imgW = 1920;
  const imgH = 1080;

  // Safe Areas
  const actionSafe = overlay.getActionSafeRect(imgW, imgH);
  // 5% margin -> 90% dimension
  assert.equal(actionSafe.x, 96);
  assert.equal(actionSafe.y, 54);
  assert.equal(actionSafe.width, 1728);
  assert.equal(actionSafe.height, 972);

  const titleSafe = overlay.getTitleSafeRect(imgW, imgH);
  // 10% margin -> 80% dimension
  assert.equal(titleSafe.x, 192);
  assert.equal(titleSafe.y, 108);
  assert.equal(titleSafe.width, 1536);
  assert.equal(titleSafe.height, 864);

  // Format Guides
  // 16:9 on 1920x1080 -> exact match
  const f16_9 = overlay.getFormatGuideRect(imgW, imgH, 16 / 9);
  assert.equal(f16_9.width, 1920);
  assert.equal(f16_9.height, 1080);

  // 2.39:1 (Scope) on 1920x1080 -> letterboxed
  const fScope = overlay.getFormatGuideRect(imgW, imgH, 2.39);
  assert.equal(fScope.width, 1920);
  assert(fScope.height < 1080, 'Scope guide must letterbox');
  assert(fScope.y > 0, 'Scope guide y offset must be positive');

  // 1.85:1 (Flat) on 1920x1080 -> letterboxed
  const fFlat = overlay.getFormatGuideRect(imgW, imgH, 1.85);
  assert.equal(fFlat.width, 1920);
  assert(fFlat.height < 1080);

  // 4:3 Academy on 1920x1080 -> pillarboxed
  const f4_3 = overlay.getFormatGuideRect(imgW, imgH, 4 / 3);
  assert(f4_3.width < 1920, '4:3 guide must pillarbox');
  assert.equal(f4_3.height, 1080);
  assert(f4_3.x > 0);

  // 1:1 Square on 1920x1080 -> pillarboxed
  const fSquare = overlay.getFormatGuideRect(imgW, imgH, 1.0);
  assert.equal(fSquare.width, 1080);
  assert.equal(fSquare.height, 1080);
  assert.equal(fSquare.x, (1920 - 1080) / 2);

  // 9:16 Vertical on 1920x1080 -> pillarboxed
  const fVertical = overlay.getFormatGuideRect(imgW, imgH, 9 / 16);
  assert.equal(fVertical.height, 1080);
  assert(fVertical.width < 1080);

  // Guide modes dispatch
  overlay.setGuideMode('format_2_39');
  assert.equal(overlay.guides.format2_39, true);
  assert.equal(overlay.guides.format16_9, false);

  overlay.setGuideMode('all_safe');
  assert.equal(overlay.guides.actionSafe, true);
  assert.equal(overlay.guides.titleSafe, true);
});

// ---------------------------------------------------------------------------
// TEST 10: ROI selection, movement, 8-handle resizing, boundary clamping, and clear
// ---------------------------------------------------------------------------
runTest('10. ROI selection, movement, 8-handle resizing, boundary clamping, and clear', () => {
  const overlay = new ViewerOverlay();

  // Set ROI
  overlay.setROI(100, 100, 300, 200);
  assert.equal(overlay.hasROI(), true);
  assert.deepEqual(overlay.getROI(), { x: 100, y: 100, width: 300, height: 200 });

  // Move ROI
  overlay.moveROI(50, -30);
  assert.deepEqual(overlay.getROI(), { x: 150, y: 70, width: 300, height: 200 });

  // 8-handle Resizing:
  // East (+20)
  overlay.resizeROI('e', 20, 0);
  assert.equal(overlay.getROI().width, 320);

  // West (-20)
  overlay.resizeROI('w', -20, 0);
  assert.equal(overlay.getROI().x, 130);
  assert.equal(overlay.getROI().width, 340);

  // South (+30)
  overlay.resizeROI('s', 0, 30);
  assert.equal(overlay.getROI().height, 230);

  // North (-30)
  overlay.resizeROI('n', 0, -30);
  assert.equal(overlay.getROI().y, 40);
  assert.equal(overlay.getROI().height, 260);

  // Corner Handles (SE, SW, NE, NW)
  overlay.resizeROI('se', 10, 10);
  assert.equal(overlay.getROI().width, 350);
  assert.equal(overlay.getROI().height, 270);

  overlay.resizeROI('nw', -10, -10);
  assert.equal(overlay.getROI().x, 120);
  assert.equal(overlay.getROI().y, 30);
  assert.equal(overlay.getROI().width, 360);
  assert.equal(overlay.getROI().height, 280);

  // Clamp ROI inside bounds (300 x 200 max)
  overlay.clampROI(300, 200);
  const clamped = overlay.getROI();
  assert(clamped.x + clamped.width <= 300);
  assert(clamped.y + clamped.height <= 200);

  // Clear ROI
  overlay.clearROI();
  assert.equal(overlay.hasROI(), false);
  assert.equal(overlay.getROI(), null);
});

// ---------------------------------------------------------------------------
// TEST 11: Pixel sampler: accurate float & display values, hex, pinned target
// ---------------------------------------------------------------------------
runTest('11. Pixel sampler: accurate float & display values, hex, pinned target', () => {
  const canvas = new MockElement('CANVAS', 800, 600);
  const viewerUI = new ViewerUI(canvas);

  const buf = new PixelBuffer(10, 10);
  // Set pixel (5, 5) to known colors: r=1.0, g=0.5, b=0.25, a=0.75
  buf.setPixel(5, 5, [1.0, 0.5, 0.25, 0.75]);
  viewerUI.setBuffer(buf);

  // Sample pixel at (5, 5) with exposure=0, gamma=1.0
  const sample = viewerUI.samplePixel(5, 5);
  assert(sample, 'Sample must not be null');
  assert.equal(sample.linear.r, 1.0);
  assert.equal(sample.linear.g, 0.5);
  assert.equal(sample.linear.b, 0.25);
  assert.equal(sample.linear.a, 0.75);

  assert.equal(sample.display.r, 255);
  assert.equal(sample.display.g, 128);
  assert.equal(sample.display.b, 64);
  assert.equal(sample.hex, '#ff8040');

  // Pinned Target
  viewerUI.overlay.setPinnedSample(5, 5);
  assert.deepEqual(viewerUI.overlay.getPinnedSample(), { x: 5, y: 5 });
  viewerUI.overlay.clearPinnedSample();
  assert.equal(viewerUI.overlay.getPinnedSample(), null);
});

// ---------------------------------------------------------------------------
// TEST 12: Zoom-dependent pixel inspection: pixel grid & hover cell highlight at zoom >= 8.0x
// ---------------------------------------------------------------------------
runTest('12. Zoom-dependent pixel inspection: pixel grid & hover cell highlight at zoom >= 8.0x', () => {
  const overlay = new ViewerOverlay();
  const ctx = new MockCanvasContext(new MockElement('CANVAS', 800, 600));
  const buf = createSolidBuffer(50, 50, 0.2, 0.4, 0.6);

  // 1. Zoom < 8.0x -> No grid drawn
  ctx.calls = [];
  overlay.drawPixelGrid(ctx, 50, 50, 4.0, 0, 0);
  assert.equal(ctx.calls.length, 0, 'Grid should not draw below 8x zoom');

  // 2. Zoom >= 8.0x -> Grid lines drawn
  ctx.calls = [];
  overlay.drawPixelGrid(ctx, 50, 50, 8.0, 0, 0);
  assert(ctx.calls.length > 0, 'Grid lines must be rendered at 8x zoom');
  const lineCalls = ctx.calls.filter(c => c.op === 'lineTo');
  assert(lineCalls.length > 0, 'lineTo calls must exist for grid boundaries');

  // 3. Zoom >= 8.0x with hovered pixel -> Cell highlight
  ctx.calls = [];
  overlay.drawPixelGrid(ctx, 50, 50, 8.0, 0, 0, { x: 5, y: 5 }, buf);
  const strokeRectCalls = ctx.calls.filter(c => c.op === 'strokeRect');
  assert(strokeRectCalls.length > 0, 'Cell highlight rect must be drawn');

  // 4. Zoom >= 24.0x with hovered pixel -> RGB text inside cell
  ctx.calls = [];
  overlay.drawPixelGrid(ctx, 50, 50, 24.0, 0, 0, { x: 5, y: 5 }, buf);
  const fillTextCalls = ctx.calls.filter(c => c.op === 'fillText');
  assert(fillTextCalls.length > 0, 'RGB text must be rendered inside cell at >=24x zoom');
});

// ---------------------------------------------------------------------------
// TEST 13: Scopes: Waveform, RGB Parade, Histogram, Vectorscope, and Pixel Analyzer
// ---------------------------------------------------------------------------
runTest('13. Scopes: Waveform, RGB Parade, Histogram, Vectorscope, and Pixel Analyzer', () => {
  const scopesCanvas = new MockElement('CANVAS', 320, 240);
  const scopes = new ViewerScopes(scopesCanvas);
  scopes.enabled = true;

  const buf = new PixelBuffer(100, 100);
  // Fill gradient and edge values: HDR (>1.0), negative (<0.0), and regular values
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const idx = (y * 100 + x) * 4;
      if (x === 0 && y === 0) {
        // HDR highlight
        buf.data[idx] = 4.5; buf.data[idx + 1] = 2.0; buf.data[idx + 2] = 1.5; buf.data[idx + 3] = 1.0;
      } else if (x === 1 && y === 0) {
        // Negative / out of gamut
        buf.data[idx] = -0.2; buf.data[idx + 1] = 0.5; buf.data[idx + 2] = 0.5; buf.data[idx + 3] = 1.0;
      } else if (x === 2 && y === 0) {
        // NaN test
        buf.data[idx] = NaN; buf.data[idx + 1] = 0.0; buf.data[idx + 2] = 0.0; buf.data[idx + 3] = 1.0;
      } else if (x === 3 && y === 0) {
        // Infinity test
        buf.data[idx] = Infinity; buf.data[idx + 1] = 0.0; buf.data[idx + 2] = 0.0; buf.data[idx + 3] = 1.0;
      } else {
        buf.data[idx] = x / 100;
        buf.data[idx + 1] = y / 100;
        buf.data[idx + 2] = 0.5;
        buf.data[idx + 3] = 1.0;
      }
    }
  }

  // 1. Waveform
  const wf = scopes.computeWaveform(buf, null, 100);
  assert(wf, 'Waveform data must exist');
  assert(wf.grid.length > 0);

  // 2. Parade
  const parade = scopes.computeParade(buf, null, 100);
  assert(parade, 'Parade data must exist');
  assert(parade.r.length > 0 && parade.g.length > 0 && parade.b.length > 0);

  // 3. Histogram
  const hist = scopes.computeHistogram(buf, null);
  assert(hist, 'Histogram data must exist');
  assert.equal(hist.binsR.length, 256);
  assert.equal(hist.binsG.length, 256);
  assert.equal(hist.binsB.length, 256);

  // 4. Vectorscope
  const vs = scopes.computeVectorscope(buf, null, 1000);
  assert(vs, 'Vectorscope data must exist');
  assert(vs.pointsCb.length > 0);
  assert(vs.targets.R && vs.targets.G && vs.targets.B);

  // 5. Pixel Analyzer
  const analyzer = scopes.computePixelAnalyzer(buf, null);
  assert(analyzer, 'Pixel Analyzer data must exist');
  assert.equal(analyzer.valid, true);
  assert.equal(analyzer.nanCount, 1, 'Should detect 1 NaN value');
  assert.equal(analyzer.infCount, 1, 'Should detect 1 Infinity value');
  assert.equal(analyzer.negCount, 1, 'Should detect 1 negative value');
  assert(analyzer.clipHighCount >= 1, 'Should detect HDR values > 1.0');
  assert(analyzer.dynamicRangeEV > 0, 'Dynamic range EV must be calculated');
  assert(analyzer.stdDev > 0, 'Standard deviation / RMS contrast must be calculated');

  // Pixel Analyzer with ROI restriction
  const roi = { x: 50, y: 50, width: 20, height: 20 };
  const roiAnalyzer = scopes.computePixelAnalyzer(buf, roi);
  assert.equal(roiAnalyzer.nanCount, 0, 'ROI outside (0,0) must have 0 NaNs');
  assert.equal(roiAnalyzer.negCount, 0, 'ROI outside (0,0) must have 0 negatives');
});

// ---------------------------------------------------------------------------
// TEST 14: Scope resizing and docking modes (overlay vs docked)
// ---------------------------------------------------------------------------
runTest('14. Scope resizing and docking modes (overlay vs docked)', () => {
  const scopesCanvas = new MockElement('CANVAS', 300, 200);
  const scopes = new ViewerScopes(scopesCanvas);

  // Dock mode
  scopes.setDockMode('docked');
  assert.equal(scopes.dockMode, 'docked');
  scopes.setDockMode('overlay');
  assert.equal(scopes.dockMode, 'overlay');

  // Resize
  scopes.resize(480, 360);
  assert.equal(scopesCanvas.width, 480);
  assert.equal(scopesCanvas.height, 360);

  // Minimum size clamping (160x120)
  scopes.resize(50, 50);
  assert.equal(scopesCanvas.width, 160);
  assert.equal(scopesCanvas.height, 120);
});

// ---------------------------------------------------------------------------
// TEST 15: Keyboard shortcuts & context menu dispatch
// ---------------------------------------------------------------------------
runTest('15. Keyboard shortcuts & context menu dispatch', () => {
  const canvas = new MockElement('CANVAS', 800, 600);
  const viewerUI = new ViewerUI(canvas);
  const node = new ViewerNode();
  viewerUI.setViewerNode(node);

  // Dispatch key events to global window
  function pressKey(key) {
    global.window.dispatchEvent({ type: 'keydown', key });
  }

  // Navigation shortcuts
  let fitCalled = false;
  let actualCalled = false;
  let resetCalled = false;
  viewerUI.fitToView = () => { fitCalled = true; };
  viewerUI.actualSize = () => { actualCalled = true; };
  viewerUI.resetView = () => { resetCalled = true; };

  pressKey('f');
  assert.equal(fitCalled, true, 'Key f must call fitToView');
  pressKey('h');
  assert.equal(actualCalled, true, 'Key h must call actualSize');
  pressKey('Home');
  assert.equal(resetCalled, true, 'Key Home must call resetView');

  // Channel shortcuts
  pressKey('r');
  assert.equal(viewerUI.channelMode, 'RED');
  pressKey('g');
  assert.equal(viewerUI.channelMode, 'GREEN');
  pressKey('b');
  assert.equal(viewerUI.channelMode, 'BLUE');
  pressKey('a');
  assert.equal(viewerUI.channelMode, 'ALPHA');
  pressKey('y');
  assert.equal(viewerUI.channelMode, 'LUMA');
  pressKey('c');
  assert.equal(viewerUI.channelMode, 'RGB');
  pressKey('~');
  assert.equal(viewerUI.channelMode, 'RGBA');

  // Wipe shortcut
  assert.equal(node.getKnobValue('compareMode'), 'single');
  pressKey('w');
  assert.equal(node.getKnobValue('compareMode'), 'wipe_h');
  pressKey('w');
  assert.equal(node.getKnobValue('compareMode'), 'single');

  // Input shortcuts 1..9, 0
  pressKey('3');
  assert.equal(viewerUI.viewports[0].slot, '3');
  pressKey('0');
  assert.equal(viewerUI.viewports[0].slot, '10');
});

// ---------------------------------------------------------------------------
// TEST 16: Preferences save/restore in localStorage
// ---------------------------------------------------------------------------
runTest('16. Preferences save/restore in localStorage', () => {
  mockStorageMap.clear();

  const canvas1 = new MockElement('CANVAS', 800, 600);
  const viewer1 = new ViewerUI(canvas1);

  // Set non-default preferences
  viewer1.setLayoutMode('quad');
  viewer1.setSyncZoomPan(false);
  viewer1.setChannelMode('RGB');
  viewer1.setExposure(1.5);
  viewer1.setGamma(2.2);
  viewer1.toggleOCIOProcess(false);
  viewer1.setScopeType('pixel_analyzer');
  viewer1.toggleScopes(true);
  viewer1.overlay.setGuideMode('format_2_39');

  viewer1.savePreferences();

  // Verify saved in localStorage
  const savedRaw = global.localStorage.getItem('opencomp_viewer_preferences_v1');
  assert(savedRaw, 'Preferences must be stored in localStorage');
  const saved = JSON.parse(savedRaw);
  assert.equal(saved.layoutMode, 'quad');
  assert.equal(saved.syncZoomPan, false);
  assert.equal(saved.channelMode, 'RGB');
  assert.equal(saved.exposure, 1.5);
  assert.equal(saved.gamma, 2.2);
  assert.equal(saved.ocioProcessEnabled, false);
  assert.equal(saved.scopeType, 'pixel_analyzer');
  assert.equal(saved.scopesEnabled, true);
  assert.equal(saved.guideMode, 'format_2_39');

  // Create fresh ViewerUI instance and verify loadPreferences restores state
  const canvas2 = new MockElement('CANVAS', 800, 600);
  const viewer2 = new ViewerUI(canvas2);

  assert.equal(viewer2.layoutMode, 'quad');
  assert.equal(viewer2.syncZoomPan, false);
  assert.equal(viewer2.channelMode, 'RGB');
  assert.equal(viewer2.exposure, 1.5);
  assert.equal(viewer2.gamma, 2.2);
  assert.equal(viewer2.ocioProcessEnabled, false);
  assert.equal(viewer2.scopes.scopeType, 'pixel_analyzer');
  assert.equal(viewer2.scopes.enabled, true);
  assert.equal(viewer2.overlay.guides.format2_39, true);
});

console.log('\n====================================================');
console.log(`🎉 TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
console.log('====================================================');
process.exit(0);
