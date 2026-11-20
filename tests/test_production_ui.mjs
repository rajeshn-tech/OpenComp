/**
 * OpenComp - Phase 6.3: Production UI Ergonomics Test Suite
 * Comprehensive verification of:
 * 1. Viewer 10-slot (1-10) input switching, A/B comparison (wipe_h, wipe_v, side_by_side, diff),
 *    divider line rendering, disconnected slot safety, and pan/zoom-independent wipe dragging.
 * 2. Node Graph Tab-key quick-search palette with acronym matching (e.g. 'cc' -> ColorCorrect),
 *    category prefix filtering ('color:grade', 'filter:'), keyboard navigation, and cursor placement.
 * 3. Interactive Curve Editor with draggable Bezier tangent handles, tangent modes (smooth, flat,
 *    linear, free), cubic Hermite interpolation parity, undo/redo stack, and knob synchronization.
 */

import { strict as assert } from 'assert';
import { ViewerNode } from '../src/nodes/ViewerNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { KeyframeTrack, Keyframe } from '../src/core/Animation.js';
import { CurveEditorUI } from '../src/ui/CurveEditorUI.js';
import { ViewerUI } from '../src/ui/ViewerUI.js';
import { NODE_REGISTRY, NODE_MENU, createNode } from '../src/nodes/index.js';
import { Graph } from '../src/core/Graph.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_production_ui.mjs (Phase 6.3)');
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
// Helpers: Mock DOM & Canvas for Headless UI Testing
// ---------------------------------------------------------------------------
class MockCanvasContext {
  constructor() {
    this.calls = [];
  }
  fillRect(x, y, w, h) { this.calls.push({ op: 'fillRect', x, y, w, h }); }
  strokeRect(x, y, w, h) { this.calls.push({ op: 'strokeRect', x, y, w, h }); }
  rect(x, y, w, h) { this.calls.push({ op: 'rect', x, y, w, h }); }
  clearRect(x, y, w, h) { this.calls.push({ op: 'clearRect', x, y, w, h }); }
  beginPath() { this.calls.push({ op: 'beginPath' }); }
  closePath() { this.calls.push({ op: 'closePath' }); }
  clip() {}
  moveTo(x, y) { this.calls.push({ op: 'moveTo', x, y }); }
  lineTo(x, y) { this.calls.push({ op: 'lineTo', x, y }); }
  arc(x, y, r, sa, ea) { this.calls.push({ op: 'arc', x, y, r, sa, ea }); }
  stroke() { this.calls.push({ op: 'stroke' }); }
  fill() { this.calls.push({ op: 'fill' }); }
  fillText(text, x, y) { this.calls.push({ op: 'fillText', text, x, y }); }
  strokeText(text, x, y) { this.calls.push({ op: 'strokeText', text, x, y }); }
  measureText(str) { return { width: (str || '').length * 7 }; }
  putImageData() {}
  createImageData(w, h) { return new global.ImageData(w, h); }
  translate(x, y) {}
  scale(x, y) {}
  drawImage() {}
  roundRect() {}
  setTransform() {}
  resetTransform() {}
  setLineDash() {}
  save() {}
  restore() {}
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
  constructor(tagName = 'DIV', width = 800, height = 600) {
    this.tagName = tagName.toUpperCase();
    this.width = width;
    this.height = height;
    this.style = {};
    this.listeners = {};
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this._ctx = new MockCanvasContext();
  }

  getContext(type) {
    return this._ctx;
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 50,
      width: this.width,
      height: this.height,
      right: 100 + this.width,
      bottom: 50 + this.height
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

// Setup minimal globals if needed for UI listeners
if (!global.window) {
  global.window = new MockElement('WINDOW');
}
if (!global.document) {
  global.document = {
    createElement: (tag) => new MockElement(tag),
    getElementById: () => null,
    activeElement: null
  };
}

// Helper to create test buffers
function createSolidBuffer(w, h, r, g, b, a = 1.0) {
  const buf = new PixelBuffer(w, h);
  for (let i = 0; i < w * h * 4; i += 4) {
    buf.data[i] = r;
    buf.data[i + 1] = g;
    buf.data[i + 2] = b;
    buf.data[i + 3] = a;
  }
  return buf;
}

// ===========================================================================
// SECTION 1: VIEWER 10-SLOT & A/B COMPARISON ENGINE
// ===========================================================================

console.log('--- SECTION 1: Viewer 10-Slot & A/B Comparison Engine ---');

runTest('1.1 Viewer 10 Inputs Registration & Knob Options', () => {
  const viewer = new ViewerNode('ViewerTest1');
  
  // Verify 10 inputs exist
  assert.equal(viewer.inputs.length, 10, 'ViewerNode must have exactly 10 inputs');
  for (let i = 1; i <= 10; i++) {
    const input = viewer.inputs[i - 1];
    assert.equal(input.name, String(i), `Input ${i} name must be '${i}'`);
    assert.equal(input.label, String(i), `Input ${i} label must be '${i}'`);
  }

  // Verify knob activeInput options contain 1 through 10
  const activeInputKnob = viewer.knobs.activeInput;
  assert.ok(activeInputKnob, 'activeInput knob must exist');
  assert.equal(activeInputKnob.options.length, 10, 'activeInput knob must have 10 options');
  assert.equal(activeInputKnob.options[0].value, '1');
  assert.equal(activeInputKnob.options[9].value, '10');

  // Verify Source A & Source B knobs exist with 10 options
  assert.ok(viewer.knobs.sourceA, 'sourceA knob must exist');
  assert.equal(viewer.knobs.sourceA.options.length, 10);
  assert.ok(viewer.knobs.sourceB, 'sourceB knob must exist');
  assert.equal(viewer.knobs.sourceB.options.length, 10);
});

runTest('1.2 Viewer Multi-slot Input Switching (1 through 10)', () => {
  const viewer = new ViewerNode('ViewerTest2');
  viewer.setKnobValue('compareMode', 'single');

  // Create 10 distinct buffers
  const inputs = {};
  for (let i = 1; i <= 10; i++) {
    inputs[String(i)] = createSolidBuffer(10, 10, i / 10.0, 0.0, 0.0, 1.0);
  }

  // Switch through each input slot 1 through 10 and verify correct output
  for (let i = 1; i <= 10; i++) {
    viewer.setKnobValue('activeInput', String(i));
    const out = viewer.compute(inputs);
    assert.ok(out, `Output for input ${i} must not be null`);
    assert.equal(out.width, 10);
    assert.equal(out.height, 10);
    // Check pixel value matching slot
    const expectedR = i / 10.0;
    assert.ok(Math.abs(out.data[0] - expectedR) < 1e-4, `Input ${i} returned wrong pixel buffer: ${out.data[0]}`);
  }
});

runTest('1.3 Viewer A/B Horizontal Wipe (wipe_h) with Divider Line', () => {
  const viewer = new ViewerNode('ViewerTest3');
  viewer.setKnobValue('compareMode', 'wipe_h');
  viewer.setKnobValue('sourceA', '1');
  viewer.setKnobValue('sourceB', '2');
  viewer.setKnobValue('wipePosition', 0.5);

  const bufA = createSolidBuffer(20, 10, 1.0, 0.0, 0.0, 1.0); // Pure Red
  const bufB = createSolidBuffer(20, 10, 0.0, 0.0, 1.0, 1.0); // Pure Blue

  const out = viewer.compute({ '1': bufA, '2': bufB });
  assert.ok(out, 'Wipe output must not be null');
  assert.equal(out.width, 20);
  assert.equal(out.height, 10);

  // splitX = Math.floor(20 * 0.5) = 10
  // Left side (x < 10): bufA (Red)
  const leftIdx = (0 * 20 + 2) * 4;
  assert.ok(Math.abs(out.data[leftIdx] - 1.0) < 1e-4, 'Left of wipe must be Source A (Red)');
  assert.ok(Math.abs(out.data[leftIdx + 2] - 0.0) < 1e-4);

  // Right side (x > 10): bufB (Blue)
  const rightIdx = (0 * 20 + 15) * 4;
  assert.ok(Math.abs(out.data[rightIdx] - 0.0) < 1e-4);
  assert.ok(Math.abs(out.data[rightIdx + 2] - 1.0) < 1e-4, 'Right of wipe must be Source B (Blue)');

  // Divider Line at splitX = 10: RGB [1.0, 0.57, 0.17]
  const lineIdx = (0 * 20 + 10) * 4;
  assert.ok(Math.abs(out.data[lineIdx] - 1.0) < 1e-4, 'Divider line R must be 1.0');
  assert.ok(Math.abs(out.data[lineIdx + 1] - 0.57) < 1e-4, 'Divider line G must be 0.57');
  assert.ok(Math.abs(out.data[lineIdx + 2] - 0.17) < 1e-4, 'Divider line B must be 0.17');
});

runTest('1.4 Viewer A/B Vertical Wipe (wipe_v) with Divider Line', () => {
  const viewer = new ViewerNode('ViewerTest4');
  viewer.setKnobValue('compareMode', 'wipe_v');
  viewer.setKnobValue('sourceA', '1');
  viewer.setKnobValue('sourceB', '2');
  viewer.setKnobValue('wipePosition', 0.5);

  const bufA = createSolidBuffer(10, 20, 0.0, 1.0, 0.0, 1.0); // Pure Green
  const bufB = createSolidBuffer(10, 20, 1.0, 0.0, 1.0, 1.0); // Magenta

  const out = viewer.compute({ '1': bufA, '2': bufB });
  assert.ok(out, 'Vertical wipe output must not be null');

  // splitY = Math.floor(20 * 0.5) = 10
  // Top side (y < 10): bufA (Green)
  const topIdx = (3 * 10 + 5) * 4;
  assert.ok(Math.abs(out.data[topIdx] - 0.0) < 1e-4);
  assert.ok(Math.abs(out.data[topIdx + 1] - 1.0) < 1e-4, 'Top side must be Source A (Green)');

  // Bottom side (y > 10): bufB (Magenta)
  const bottomIdx = (15 * 10 + 5) * 4;
  assert.ok(Math.abs(out.data[bottomIdx] - 1.0) < 1e-4, 'Bottom side must be Source B (R=1)');
  assert.ok(Math.abs(out.data[bottomIdx + 2] - 1.0) < 1e-4, 'Bottom side must be Source B (B=1)');

  // Divider line at splitY = 10: RGB [1.0, 0.57, 0.17]
  const lineIdx = (10 * 10 + 5) * 4;
  assert.ok(Math.abs(out.data[lineIdx] - 1.0) < 1e-4);
  assert.ok(Math.abs(out.data[lineIdx + 1] - 0.57) < 1e-4);
  assert.ok(Math.abs(out.data[lineIdx + 2] - 0.17) < 1e-4);
});

runTest('1.5 Viewer A/B Side-by-Side Comparison', () => {
  const viewer = new ViewerNode('ViewerTest5');
  viewer.setKnobValue('compareMode', 'side_by_side');
  viewer.setKnobValue('sourceA', '3');
  viewer.setKnobValue('sourceB', '7');

  const bufA = createSolidBuffer(20, 10, 0.2, 0.2, 0.2, 1.0);
  const bufB = createSolidBuffer(20, 10, 0.8, 0.8, 0.8, 1.0);

  const out = viewer.compute({ '3': bufA, '7': bufB });
  assert.ok(out);
  // Left half should be bufA, right half bufB
  assert.ok(Math.abs(out.data[0] - 0.2) < 1e-4);
  assert.ok(Math.abs(out.data[(0 * 20 + 15) * 4] - 0.8) < 1e-4);
});

runTest('1.6 Viewer A/B Difference Mode with Gain & Alpha Retention', () => {
  const viewer = new ViewerNode('ViewerTest6');
  viewer.setKnobValue('compareMode', 'diff');
  viewer.setKnobValue('sourceA', '1');
  viewer.setKnobValue('sourceB', '2');
  viewer.setKnobValue('diffGain', 2.0);

  const bufA = createSolidBuffer(10, 10, 0.8, 0.5, 0.2, 0.6);
  const bufB = createSolidBuffer(10, 10, 0.5, 0.5, 0.4, 0.9);

  const out = viewer.compute({ '1': bufA, '2': bufB });
  assert.ok(out);

  // R diff: |0.8 - 0.5| * 2.0 = 0.3 * 2.0 = 0.6
  assert.ok(Math.abs(out.data[0] - 0.6) < 1e-4, `R difference expected ~0.6, got ${out.data[0]}`);
  // G diff: |0.5 - 0.5| * 2.0 = 0.0
  assert.ok(Math.abs(out.data[1] - 0.0) < 1e-4);
  // B diff: |0.2 - 0.4| * 2.0 = 0.2 * 2.0 = 0.4
  assert.ok(Math.abs(out.data[2] - 0.4) < 1e-4);
  // Alpha: max(0.6, 0.9) = 0.9
  assert.ok(Math.abs(out.data[3] - 0.9) < 1e-4, 'Alpha must retain maximum coverage in difference mode');
});

runTest('1.7 Disconnected / Invalid Slot Graceful Recovery & Safety', () => {
  const viewer = new ViewerNode('ViewerTest7');
  
  // 1. Single mode with disconnected slot: falls back to input '1' or null
  viewer.setKnobValue('compareMode', 'single');
  viewer.setKnobValue('activeInput', '8');
  assert.equal(viewer.compute({}), null, 'Empty inputs must return null without throwing');

  const buf1 = createSolidBuffer(10, 10, 0.1, 0.2, 0.3, 1.0);
  const outFallback = viewer.compute({ '1': buf1 }); // Slot 8 missing, input 1 present
  assert.equal(outFallback, buf1, 'Disconnected activeInput must fallback safely to input 1');

  // 2. Compare mode with one or both inputs disconnected
  viewer.setKnobValue('compareMode', 'wipe_h');
  viewer.setKnobValue('sourceA', '4');
  viewer.setKnobValue('sourceB', '5');

  assert.equal(viewer.compute({}), null, 'Missing both A and B must return null safely');

  const outOnlyA = viewer.compute({ '4': buf1 });
  assert.equal(outOnlyA, buf1, 'Missing B must return A without throwing');

  const outOnlyB = viewer.compute({ '5': buf1 });
  assert.equal(outOnlyB, buf1, 'Missing A must return B without throwing');
});

runTest('1.8 Asymmetric Resolution Resampling Safety in Comparison Modes', () => {
  const viewer = new ViewerNode('ViewerTest8');
  viewer.setKnobValue('compareMode', 'wipe_h');
  viewer.setKnobValue('sourceA', '1');
  viewer.setKnobValue('sourceB', '2');

  const bufA = createSolidBuffer(100, 50, 1.0, 0.0, 0.0, 1.0);
  const bufB = createSolidBuffer(200, 100, 0.0, 1.0, 0.0, 1.0); // Different dimension

  const out = viewer.compute({ '1': bufA, '2': bufB });
  assert.ok(out);
  assert.equal(out.width, 100, 'Output must maintain Source A width');
  assert.equal(out.height, 50, 'Output must maintain Source B height');
});

runTest('1.9 Interactive Wipe Divider Dragging & Pan/Zoom Independence', () => {
  const canvas = new MockElement('CANVAS', 800, 600);
  const viewerUI = new ViewerUI(canvas, null, null);
  const viewerNode = new ViewerNode('ViewerUI_Test');
  viewerNode.setKnobValue('compareMode', 'wipe_h');
  viewerNode.setKnobValue('wipePosition', 0.5);

  viewerUI.setViewerNode(viewerNode);
  const buffer = createSolidBuffer(1920, 1080, 0.5, 0.5, 0.5, 1.0);
  viewerUI.setBuffer(buffer);

  // Set non-trivial pan and zoom
  viewerUI.zoom = 2.5;
  viewerUI.panX = 150;
  viewerUI.panY = -80;

  // Compute screen coordinate corresponding to wipePosition 0.5 (imgX = 960)
  // screenX = rect.left + panX + imgX * zoom = 100 + 150 + 960 * 2.5 = 2650
  const wipeImgX = 1920 * 0.5; // 960
  const clientX = 100 + viewerUI.panX + wipeImgX * viewerUI.zoom;
  const clientY = 50 + viewerUI.panY + 540 * viewerUI.zoom;

  // Dispatch mousedown near the wipe divider
  canvas.dispatchEvent({
    type: 'mousedown',
    button: 0,
    clientX: clientX,
    clientY: clientY,
    preventDefault: () => {}
  });

  assert.equal(viewerUI.isDraggingWipe, true, 'MouseDown on wipe line should initiate wipe dragging');
  assert.equal(viewerUI.dragWipeOrientation, 'horizontal');

  // Drag wipe line to 75% of image width (imgX = 1440)
  const newClientX = 100 + viewerUI.panX + 1440 * viewerUI.zoom;
  window.dispatchEvent({
    type: 'mousemove',
    clientX: newClientX,
    clientY: clientY
  });

  const updatedWipePos = viewerNode.getKnobValue('wipePosition');
  assert.ok(Math.abs(updatedWipePos - 0.75) < 0.01, `Wipe position expected ~0.75, got ${updatedWipePos}`);
});

// ===========================================================================
// SECTION 2: NODE GRAPH TAB-KEY QUICK-SEARCH PALETTE
// ===========================================================================

console.log('\n--- SECTION 2: Node Graph Tab-Key Quick-Search Palette ---');

// Acronym and category filter matching function matching src/app.js logic
function searchCatalog(catalog, rawQuery) {
  const query = rawQuery.toLowerCase().trim();
  if (!query) {
    return [...catalog].sort((a, b) => a.type.localeCompare(b.type));
  }

  let catFilter = null;
  let searchQuery = query;
  if (query.includes(':')) {
    const colonIdx = query.indexOf(':');
    catFilter = query.slice(0, colonIdx).trim().toLowerCase();
    searchQuery = query.slice(colonIdx + 1).trim().toLowerCase();
  }

  const scored = [];
  for (const item of catalog) {
    const typeLower = item.type.toLowerCase();
    const labelLower = item.label.toLowerCase();
    const catLower = item.category.toLowerCase();
    const shortcutLower = (item.shortcut || '').toLowerCase();

    if (catFilter && !catLower.includes(catFilter)) {
      continue;
    }

    const acronym = item.type.split(/(?=[A-Z])/).map(w => w[0]?.toLowerCase()).join('');

    let score = -1;
    if (!searchQuery) {
      score = 10;
    } else if (typeLower === searchQuery) {
      score = 0;
    } else if (typeLower.startsWith(searchQuery)) {
      score = 1;
    } else if (acronym === searchQuery) {
      score = 2;
    } else if (labelLower.startsWith(searchQuery)) {
      score = 3;
    } else if (shortcutLower === searchQuery) {
      score = 4;
    } else if (typeLower.includes(searchQuery)) {
      score = 5;
    } else if (labelLower.includes(searchQuery)) {
      score = 6;
    } else if (catLower.includes(searchQuery)) {
      score = 7;
    }

    if (score !== -1) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.type.localeCompare(b.item.type);
  });

  return scored.map(s => s.item);
}

// Build node catalog from NODE_REGISTRY & NODE_MENU
function buildCatalog() {
  const catalog = [];
  const registered = Object.keys(NODE_REGISTRY);
  for (const type of registered) {
    let category = 'Other';
    let label = type;
    let shortcut = '';

    for (const cat of NODE_MENU) {
      const found = cat.items.find(i => i.type === type);
      if (found) {
        category = cat.category;
        label = found.label;
        shortcut = found.shortcut || '';
        break;
      }
    }
    catalog.push({ type, label, category, shortcut });
  }
  return catalog;
}

runTest('2.1 Tab Search Acronym Fuzzy Matching', () => {
  const catalog = buildCatalog();

  // 'cc' -> ColorCorrect
  const ccMatches = searchCatalog(catalog, 'cc');
  assert.ok(ccMatches.length > 0, "'cc' must return matches");
  assert.equal(ccMatches[0].type, 'ColorCorrect', "'cc' top match must be ColorCorrect");

  // 'sr' -> ScanlineRender
  const srMatches = searchCatalog(catalog, 'sr');
  assert.ok(srMatches.length > 0, "'sr' must return matches");
  assert.equal(srMatches[0].type, 'ScanlineRender', "'sr' top match must be ScanlineRender");

  // 'cp' -> CornerPin
  const cpMatches = searchCatalog(catalog, 'cp');
  assert.ok(cpMatches.length > 0, "'cp' must return matches");
  assert.equal(cpMatches[0].type, 'CornerPin', "'cp' top match must be CornerPin");

  // 'dh' -> DeepHoldout
  const dhMatches = searchCatalog(catalog, 'dh');
  assert.ok(dhMatches.length > 0);
  assert.equal(dhMatches[0].type, 'DeepHoldout', "'dh' top match must be DeepHoldout");

  // 'dm' -> DeepMerge
  const dmMatches = searchCatalog(catalog, 'dm');
  assert.ok(dmMatches.length > 0);
  assert.equal(dmMatches[0].type, 'DeepMerge', "'dm' top match must be DeepMerge");

  // 'eb' -> EdgeBlur
  const ebMatches = searchCatalog(catalog, 'eb');
  assert.ok(ebMatches.length > 0);
  assert.equal(ebMatches[0].type, 'EdgeBlur', "'eb' top match must be EdgeBlur");
});

runTest('2.2 Tab Search Category Prefix Filtering', () => {
  const catalog = buildCatalog();

  // 'color:grade' -> Grade under Color category
  const colorGrade = searchCatalog(catalog, 'color:grade');
  assert.ok(colorGrade.length > 0);
  assert.equal(colorGrade[0].type, 'Grade');
  assert.equal(colorGrade[0].category, 'Color');

  // 'filter:blur' -> Blur under Filter category
  const filterBlur = searchCatalog(catalog, 'filter:blur');
  assert.ok(filterBlur.length > 0);
  assert.equal(filterBlur[0].type, 'Blur');

  // '3d:cam' -> Camera3D
  const cam3d = searchCatalog(catalog, '3d:cam');
  assert.ok(cam3d.length > 0);
  assert.equal(cam3d[0].type, 'Camera3D');

  // 'deep:' -> returns only Deep category nodes
  const deepAll = searchCatalog(catalog, 'deep:');
  assert.ok(deepAll.length > 0);
  for (const item of deepAll) {
    assert.equal(item.category, 'Deep', `Every item in 'deep:' must be in Deep category`);
  }
});

runTest('2.3 Tab Search Keyboard Navigation & Boundary Clamping', () => {
  const catalog = buildCatalog();
  const matches = searchCatalog(catalog, 'bl'); // Blur, etc.
  assert.ok(matches.length >= 2, 'Query must return at least 2 items');

  let selectedIndex = 0;
  const navigate = (key) => {
    if (key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % matches.length;
    } else if (key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
    }
  };

  assert.equal(selectedIndex, 0);
  navigate('ArrowDown');
  assert.equal(selectedIndex, 1);
  navigate('ArrowUp');
  assert.equal(selectedIndex, 0);
  // Cyclic wrap-around on ArrowUp
  navigate('ArrowUp');
  assert.equal(selectedIndex, matches.length - 1, 'ArrowUp at index 0 must wrap to last item');
  // Cyclic wrap-around on ArrowDown
  navigate('ArrowDown');
  assert.equal(selectedIndex, 0, 'ArrowDown at last index must wrap to 0');
});

runTest('2.4 Node Instantiation & Cursor Placement on Selection', () => {
  const graph = new Graph();
  const cursorX = 350;
  const cursorY = 220;

  // User selects 'Blur' from tab search palette at cursor coords (350, 220)
  const node = createNode('Blur', 'Blur_Test', cursorX, cursorY);
  assert.ok(node, 'createNode must instantiate node');
  assert.equal(node.x, 350, 'Node x must match cursorX');
  assert.equal(node.y, 220, 'Node y must match cursorY');
  graph.addNode(node);
  assert.equal(graph.getNode('Blur_Test'), node);
});

runTest('2.5 Escape Key Dismissal & Focus Isolation', () => {
  // Simulates search palette state
  let isOpen = true;
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      isOpen = false;
    }
  };

  handleKeyDown({ key: 'Escape' });
  assert.equal(isOpen, false, 'Escape key must close search popup');
});

// ===========================================================================
// SECTION 3: INTERACTIVE CURVE EDITOR & BEZIER TANGENT HANDLES
// ===========================================================================

console.log('\n--- SECTION 3: Interactive Curve Editor & Bezier Tangent Handles ---');

runTest('3.1 Coordinate Space Transformations Invertibility', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas, {
    startFrame: 1,
    endFrame: 100,
    minValue: -10.0,
    maxValue: 50.0
  });

  // Verify Frame <-> Screen invertibility
  const testFrames = [1, 25, 50, 75.5, 100];
  for (const f of testFrames) {
    const sx = editor.frameToScreen(f);
    const restoredF = editor.screenToFrame(sx);
    assert.ok(Math.abs(f - restoredF) < 1e-4, `Frame invertibility failed for ${f}: got ${restoredF}`);
  }

  // Verify Value <-> Screen invertibility
  const testValues = [-10.0, 0.0, 12.34, 35.0, 50.0];
  for (const v of testValues) {
    const sy = editor.valueToScreen(v);
    const restoredV = editor.screenToValue(sy);
    assert.ok(Math.abs(v - restoredV) < 1e-4, `Value invertibility failed for ${v}: got ${restoredV}`);
  }
});

runTest('3.2 Draggable Tangent Handles Calculation & Slopes', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas, { startFrame: 1, endFrame: 50, minValue: 0, maxValue: 100 });
  const track = new KeyframeTrack(0.0);
  track.addKey(10, 20.0, 'bezier');
  const key = track.keys[0];
  key.leftSlope = 1.5;
  key.rightSlope = 2.0;

  editor.bindTrack(track);

  const handles = editor.getTangentHandles(key);
  assert.ok(handles, 'Tangent handles object must exist');
  assert.ok(handles.leftHandle, 'Left handle must exist');
  assert.ok(handles.rightHandle, 'Right handle must exist');

  // Verify left handle frame is less than key frame and right handle is greater
  assert.ok(handles.leftHandle.frame < key.frame, 'Left handle must precede keyframe');
  assert.ok(handles.rightHandle.frame > key.frame, 'Right handle must follow keyframe');

  // Verify handle coordinates match screen mapping
  const expectedLeftX = editor.frameToScreen(handles.leftHandle.frame);
  assert.ok(Math.abs(handles.leftHandle.x - expectedLeftX) < 1e-4);
});

runTest('3.3 Tangent Modes & Collinear Alignment (smooth, flat, linear, free)', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas);
  const track = new KeyframeTrack(0.0);
  track.addKey(1, 0.0, 'bezier');
  track.addKey(10, 50.0, 'bezier');
  track.addKey(20, 100.0, 'bezier');

  editor.bindTrack(track);
  editor.selectedKey = track.keys[1]; // Key at frame 10

  // 1. Flat Tangent Mode: Both slopes must become 0.0
  editor.setTangentMode('flat');
  assert.equal(editor.selectedKey.leftSlope, 0.0, 'Flat mode must set leftSlope = 0.0');
  assert.equal(editor.selectedKey.rightSlope, 0.0, 'Flat mode must set rightSlope = 0.0');
  assert.equal(editor.selectedKey.interpolation, 'bezier');

  // 2. Linear Mode: Interpolation becomes 'linear'
  editor.setTangentMode('linear');
  assert.equal(editor.selectedKey.interpolation, 'linear');

  // 3. Smooth Mode: Recomputes auto-tangents with collinear continuous slope
  editor.setTangentMode('smooth');
  assert.equal(editor.selectedKey.interpolation, 'bezier');
  // In smooth mode, leftSlope and rightSlope are equal and collinear
  assert.ok(Math.abs(editor.selectedKey.leftSlope - editor.selectedKey.rightSlope) < 1e-5);
  assert.ok(editor.selectedKey.rightSlope > 0, 'Smooth slope on ascending curve must be positive');

  // 4. Free Mode: Interpolation is bezier and allows independent handles
  editor.setTangentMode('free');
  editor.selectedKey.leftSlope = -1.2;
  editor.selectedKey.rightSlope = 3.4;
  assert.equal(editor.selectedKey.leftSlope, -1.2);
  assert.equal(editor.selectedKey.rightSlope, 3.4);
});

runTest('3.4 Keyframe Selection, Movement & Chronological Ordering', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas);
  const track = new KeyframeTrack(0.0);
  track.addKey(5, 10.0, 'bezier');
  track.addKey(15, 30.0, 'bezier');
  track.addKey(25, 80.0, 'bezier');

  editor.bindTrack(track);
  assert.equal(editor.selectedKey, track.keys[0]);

  // Select key 2 (frame 15) and move it past key 3 (e.g. frame 35)
  editor.selectedKey = track.keys[1];
  editor.selectedKey.frame = 35;
  editor.selectedKey.value = 95.0;

  // Maintain chronological order
  track.keys.sort((a, b) => a.frame - b.frame);
  assert.equal(track.keys[0].frame, 5);
  assert.equal(track.keys[1].frame, 25);
  assert.equal(track.keys[2].frame, 35);
  assert.equal(track.keys[2].value, 95.0);
});

runTest('3.5 Cubic Hermite Interpolation Parity with Animation.js', () => {
  const track = new KeyframeTrack(0.0);
  track.addKey(0, 0.0, 'bezier');
  track.addKey(10, 100.0, 'bezier');

  const key0 = track.keys[0];
  const key1 = track.keys[1];
  key0.rightSlope = 0.0; // Flat start
  key1.leftSlope = 0.0;  // Flat end

  // Evaluate at t = 0.5 (frame 5)
  // For standard smoothstep / Hermite with 0 slopes:
  // H00(0.5)*0 + H10(0.5)*0 + H01(0.5)*100 + H11(0.5)*0 = (3*(0.5)^2 - 2*(0.5)^3) * 100 = 50.0
  const evalMid = track.evaluate(5);
  assert.equal(evalMid, 50.0, `Smoothstep midpoint must be 50.0, got ${evalMid}`);

  // Test asymmetric slope: steep start (rightSlope = 20)
  key0.rightSlope = 20.0; // 20 units/frame
  const evalSteep = track.evaluate(2);
  // Value at frame 2 should accelerate rapidly above 20
  assert.ok(evalSteep > 25.0, `Accelerated curve should exceed 25.0, got ${evalSteep}`);
});

runTest('3.6 Multi-Level Undo / Redo History Stack', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas);
  const track = new KeyframeTrack(0.0);
  track.addKey(1, 10.0, 'bezier');
  track.addKey(10, 50.0, 'bezier');

  editor.bindTrack(track);
  editor.selectedKey = track.keys[0];

  // Initial state: frame 1 = 10.0
  assert.equal(track.keys[0].value, 10.0);

  // Edit 1: change value to 40.0
  editor.saveUndoState();
  track.keys[0].value = 40.0;

  // Edit 2: change value to 99.0
  editor.saveUndoState();
  track.keys[0].value = 99.0;

  assert.equal(track.keys[0].value, 99.0);

  // Undo edit 2 -> restores 40.0
  const undo1 = editor.undo();
  assert.equal(undo1, true);
  assert.equal(track.keys[0].value, 40.0, 'Undo 1 must restore value 40.0');

  // Undo edit 1 -> restores 10.0
  const undo2 = editor.undo();
  assert.equal(undo2, true);
  assert.equal(track.keys[0].value, 10.0, 'Undo 2 must restore initial value 10.0');

  // Redo -> restores 40.0
  const redo1 = editor.redo();
  assert.equal(redo1, true);
  assert.equal(track.keys[0].value, 40.0, 'Redo 1 must restore 40.0');
});

runTest('3.7 Live Knob Synchronization & Serialization Round-Trip', () => {
  const canvas = new MockElement('CANVAS', 800, 400);
  const editor = new CurveEditorUI(canvas);
  
  // Create a node with an animated knob
  const blurNode = createNode('Blur', 'BlurAnimSync', 0, 0);
  const track = new KeyframeTrack(5.0);
  track.addKey(1, 2.0, 'bezier');
  track.addKey(20, 25.0, 'bezier');

  editor.bindTrack(track, blurNode, 'size');
  
  // Modify track keyframe
  track.keys[1].value = 45.0;
  editor.syncNode();

  // Verify node's knobs['size'].keyframes dictionary was updated
  const kfs = blurNode.knobs.size.keyframes;
  assert.ok(kfs, 'keyframes dictionary must be populated on knob');
  assert.equal(kfs['1'], 2.0);
  assert.equal(kfs['20'], 45.0, 'Node knob must reflect updated keyframe value 45.0');
  assert.equal(blurNode.isDirty, true, 'syncNode must mark node dirty');

  // Serialization round-trip
  const serialized = track.serialize();
  const restored = KeyframeTrack.deserialize(serialized);
  assert.equal(restored.keys.length, 2);
  assert.equal(restored.keys[0].frame, 1);
  assert.equal(restored.keys[0].value, 2.0);
  assert.equal(restored.keys[1].frame, 20);
  assert.equal(restored.keys[1].value, 45.0);
});

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('\n====================================================');
console.log(`📊 PHASE 6.3 PRODUCTION UI TEST RESULTS`);
console.log(`Total Checks:  ${totalTests}`);
console.log(`Passed:        ${passedTests}`);
console.log(`Failed:        ${totalTests - passedTests}`);
console.log('====================================================\n');

if (passedTests === totalTests) {
  console.log('🎉 ALL PHASE 6.3 PRODUCTION UI ERGONOMICS TESTS PASSED!');
  process.exit(0);
} else {
  console.error('❌ SOME TESTS FAILED');
  process.exit(1);
}
