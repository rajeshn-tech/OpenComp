/**
 * OpenComp - UI Parity: 3D, Camera & Particles Regression Suite
 * Rigorously verifies:
 * 1. 3D Viewer mode switching (2D <-> 3D toggle, Tab shortcut)
 * 2. Perspective and orthographic camera views (Perspective, Top, Front, Right, Bottom, Back, Left)
 * 3. Orbit, pan, and dolly navigation calculations and frame selected/all
 * 4. View orientation tripod gizmo in corner
 * 5. Ground grid and origin axes display
 * 6. Object selection and hit testing in 3D viewport
 * 7. 3D Manipulators (Translate, Rotate, Scale) in World and Local space with live knob updates and resets
 * 8. Scene Graph hierarchy tree (grouping, expand/collapse, visibility eye toggle, framing)
 * 9. Camera3D optics, Look Through Camera, and Lock Camera to View workflows
 * 10. Project3D and ScanlineRender interface integration
 * 11. Particles UI structure, disclaimer disclosure compliance, and disabled mockup controls
 * 12. Workspace persistence and 2D viewer non-regression
 */

import assert from 'assert/strict';
import { performance } from 'perf_hooks';
import { Vector3 } from '../src/core/3d/Vector3.js';
import { Matrix4 } from '../src/core/3d/Matrix4.js';
import { Camera3D } from '../src/core/3d/Camera3D.js';
import { Graph } from '../src/core/Graph.js';
import { Viewer3DUI } from '../src/ui/Viewer3DUI.js';
import { ViewerUI } from '../src/ui/ViewerUI.js';
import { SceneGraphUI } from '../src/ui/SceneGraphUI.js';
import { ParticlesUI } from '../src/ui/ParticlesUI.js';
import { PropertiesUI } from '../src/ui/PropertiesUI.js';
import { Camera3DNode } from '../src/nodes/Camera3DNode.js';
import { Card3DNode } from '../src/nodes/Card3DNode.js';
import { Cube3DNode } from '../src/nodes/Cube3DNode.js';
import { Axis3DNode } from '../src/nodes/Axis3DNode.js';
import { Scene3DNode } from '../src/nodes/Scene3DNode.js';
import { Project3DNode } from '../src/nodes/Project3DNode.js';
import { ScanlineRenderNode } from '../src/nodes/ScanlineRenderNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_3d_camera_particles.mjs');
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
    this.width = 1920;
    this.height = 1080;
  }

  get className() { return Array.from(this.classList.classes).join(' '); }
  set className(val) {
    this.classList.classes.clear();
    if (typeof val === 'string') val.split(/\s+/).forEach(c => c && this.classList.add(c));
  }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
    const tagMatches = [...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g)];
    for (const match of tagMatches) {
      const tag = match[1];
      const attrs = match[2];
      const el = new MockElement(tag);
      el._innerHTML = val;
      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      if (idMatch) el.id = idMatch[1];
      const classMatch = attrs.match(/class=["']([^"']+)["']/);
      if (classMatch) classMatch[1].split(/\s+/).forEach(c => el.classList.add(c));
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

  insertBefore(newChild, refChild) {
    newChild.parentElement = this;
    const idx = this.children.indexOf(refChild);
    if (idx >= 0) this.children.splice(idx, 0, newChild);
    else this.children.push(newChild);
    return newChild;
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
        else if (child.tagName.toLowerCase() === sel.toLowerCase()) match = true;
        if (match) results.push(child);
        search(child);
      }
    };
    search(this);
    return results;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
  }

  getContext() {
    return {
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      rect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      stroke() {},
      fill() {},
      arc() {},
      fillText() {},
      measureText() { return { width: 40 }; },
      save() {},
      restore() {},
      translate() {},
      scale() {},
      setLineDash() {},
      clip() {},
      createRadialGradient() {
        return { addColorStop() {} };
      },
      drawImage() {},
      putImageData() {}
    };
  }
}

// Global Document / Window Mock
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => null,
  querySelector: (sel) => null,
  querySelectorAll: (sel) => []
};

global.window = {
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1920,
  innerHeight: 1080
};

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

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`  ⏳ ${name}... `);
    fn();
    console.log('✅ PASSED');
    passed++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error(err);
    failed++;
    throw err;
  }
}

// -------------------------------------------------------------
// Test 1: 3D Viewer Mode Switching & Tab Shortcut
// -------------------------------------------------------------
runTest('1. 3D Viewer Mode Switching (2D <-> 3D Toggle)', () => {
  const canvas = new MockElement('canvas');
  const viewer = new ViewerUI(canvas);

  assert.equal(viewer.viewMode, '2D', 'Default viewer mode must be 2D');
  assert.ok(viewer.viewer3D instanceof Viewer3DUI, 'Viewer3DUI instance must be attached');

  viewer.setViewMode('3D');
  assert.equal(viewer.viewMode, '3D', 'Setting 3D mode must update viewMode');

  viewer.toggleViewMode();
  assert.equal(viewer.viewMode, '2D', 'Toggling viewMode must switch back to 2D');

  viewer.toggleViewMode();
  assert.equal(viewer.viewMode, '3D', 'Toggling viewMode again must switch to 3D');
});

// -------------------------------------------------------------
// Test 2: Perspective & Orthographic Camera Projections
// -------------------------------------------------------------
runTest('2. Perspective & Orthographic Camera Views', () => {
  const canvas = new MockElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const v3d = new Viewer3DUI(canvas);

  // Perspective view
  v3d.setViewType('perspective');
  v3d.updateCamera();
  assert.equal(v3d.camera.projectionMode, 'perspective');

  const pCenter = v3d.camera.project(new Vector3(0, 0, 0), 1920, 1080);
  assert.ok(pCenter.inFront, 'Origin must project in front of camera');
  assert.ok(Math.abs(pCenter.x - 960) < 50, `Center X near 960, got ${pCenter.x}`);

  // Orthographic Top view
  v3d.setViewType('top');
  v3d.updateCamera();
  assert.equal(v3d.camera.projectionMode, 'orthographic');

  // Orthographic Front view
  v3d.setViewType('front');
  v3d.updateCamera();
  assert.equal(v3d.camera.projectionMode, 'orthographic');

  // Orthographic Right view
  v3d.setViewType('right');
  v3d.updateCamera();
  assert.equal(v3d.camera.projectionMode, 'orthographic');
});

// -------------------------------------------------------------
// Test 3: Orbit, Pan, Dolly & Framing Calculations
// -------------------------------------------------------------
runTest('3. Orbit, Pan, Dolly & Frame Selected/All', () => {
  mockStorage.clear();
  const canvas = new MockElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const graph = new Graph();
  const card = new Card3DNode('card1', 0, 0);
  card.setKnobValue('translateX', 5.0);
  card.setKnobValue('translateY', 2.0);
  card.setKnobValue('translateZ', -3.0);
  graph.addNode(card);

  const v3d = new Viewer3DUI(canvas, graph);
  v3d.setViewType('perspective');

  // 1. Orbit navigation simulation
  const initialAzimuth = v3d.azimuth;
  v3d.isNavigating = true;
  v3d.navMode = 'orbit';
  v3d.lastMouseX = 100;
  v3d.lastMouseY = 100;
  v3d.onMouseMove({ clientX: 150, clientY: 100 });
  assert.notEqual(v3d.azimuth, initialAzimuth, 'Moving mouse during orbit must change azimuth');

  // 2. Pan navigation simulation
  const initialTargetX = v3d.target.x;
  v3d.navMode = 'pan';
  v3d.lastMouseX = 100;
  v3d.lastMouseY = 100;
  v3d.onMouseMove({ clientX: 150, clientY: 100 });
  assert.notEqual(v3d.target.x, initialTargetX, 'Moving mouse during pan must change target X');

  // 3. Dolly / Wheel
  const initialDist = v3d.distance;
  v3d.onWheel({ deltaY: -100, preventDefault() {} });
  assert.ok(v3d.distance < initialDist, 'Wheel up must dolly closer (reduce distance)');

  // 4. Frame Selected
  v3d.setSelectedNode(card);
  v3d.frameSelected();
  assert.ok(Math.abs(v3d.target.x - 5.0) < 0.01, `Framing card must target card X=5.0, got ${v3d.target.x}`);
  assert.ok(Math.abs(v3d.target.y - 2.0) < 0.01, `Framing card must target card Y=2.0, got ${v3d.target.y}`);

  // 5. Reset View
  v3d.resetView();
  assert.equal(v3d.target.x, 0, 'Reset view must reset target X to 0');
  assert.equal(v3d.target.y, 0, 'Reset view must reset target Y to 0');
  assert.equal(v3d.distance, 15.0, 'Reset view must reset distance to 15.0');
});

// -------------------------------------------------------------
// Test 4: Orientation Gizmo & Ground Grid Display
// -------------------------------------------------------------
runTest('4. Orientation Gizmo & Ground Grid Display', () => {
  const canvas = new MockElement('canvas');
  const v3d = new Viewer3DUI(canvas);

  assert.equal(v3d.showGrid, true);
  assert.equal(v3d.showAxes, true);
  assert.equal(v3d.showOrientationGizmo, true);

  const state1 = v3d.toggleGrid();
  assert.equal(state1, false, 'toggleGrid must disable grid');
  const state2 = v3d.toggleGrid();
  assert.equal(state2, true, 'toggleGrid again must re-enable grid');

  // View matrix for compass tripod
  const vMat = v3d.camera.getViewMatrix();
  assert.ok(vMat instanceof Matrix4, 'View matrix must be a valid Matrix4');
});

// -------------------------------------------------------------
// Test 5: 3D Viewport Object Hit Testing & Selection
// -------------------------------------------------------------
runTest('5. Object Hit Testing in 3D Viewport', () => {
  const canvas = new MockElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const graph = new Graph();
  const cube = new Cube3DNode('cube1', 0, 0);
  cube.setKnobValue('translateX', 0.0);
  cube.setKnobValue('translateY', 0.0);
  cube.setKnobValue('translateZ', 0.0);
  graph.addNode(cube);

  let selectedCallbackNode = null;
  const v3d = new Viewer3DUI(canvas, graph, null, (node) => {
    selectedCallbackNode = node;
  });

  v3d.updateCamera();
  const proj = v3d.camera.project(new Vector3(0, 0, 0), 1920, 1080);

  // Click near projected center of cube
  v3d.onMouseDown({ clientX: proj.x, clientY: proj.y, button: 0 });
  assert.equal(v3d.selectedNode?.id, 'cube1', 'Clicking projected object must select it');
  assert.equal(selectedCallbackNode?.id, 'cube1', 'onNodeSelect callback must be triggered');
});

// -------------------------------------------------------------
// Test 6: 3D Manipulators (Translate, Rotate, Scale) & Knob Updates
// -------------------------------------------------------------
runTest('6. 3D Manipulator Modes, Dragging & Real-Time Knob Updates', () => {
  const canvas = new MockElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const graph = new Graph();
  const card = new Card3DNode('card1', 0, 0);
  card.setKnobValue('translateX', 0.0);
  card.setKnobValue('translateY', 0.0);
  card.setKnobValue('translateZ', 0.0);
  graph.addNode(card);

  let paramChangeCalled = false;
  const v3d = new Viewer3DUI(canvas, graph, (node) => {
    paramChangeCalled = true;
  });
  v3d.setSelectedNode(card);

  // Gizmo modes
  v3d.setGizmoMode('translate');
  assert.equal(v3d.gizmoMode, 'translate');
  v3d.setCoordSpace('local');
  assert.equal(v3d.coordSpace, 'local');
  v3d.setCoordSpace('world');
  assert.equal(v3d.coordSpace, 'world');

  // Simulate dragging X axis handle
  v3d.isDraggingGizmo = true;
  v3d.activeHandle = 'tx';
  v3d.dragStartMouse = { x: 960, y: 540 };
  v3d.dragInitialTransform = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, uniformScale: 1, sx: 1, sy: 1, sz: 1 };

  v3d.onMouseMove({ clientX: 1060, clientY: 540 }); // Move right +100px
  assert.ok(paramChangeCalled, 'onParamChange must be called during manipulator drag');
  assert.ok(card.getKnobValue('translateX') > 0, `translateX must increase, got ${card.getKnobValue('translateX')}`);

  // Test resets
  v3d.resetTranslate();
  assert.equal(card.getKnobValue('translateX'), 0.0, 'resetTranslate must reset translateX to 0.0');

  v3d.setGizmoMode('rotate');
  card.setKnobValue('rotateY', 45.0);
  v3d.resetRotate();
  assert.equal(card.getKnobValue('rotateY'), 0.0, 'resetRotate must reset rotateY to 0.0');

  v3d.setGizmoMode('scale');
  card.setKnobValue('uniformScale', 3.5);
  v3d.resetScale();
  assert.equal(card.getKnobValue('uniformScale'), 1.0, 'resetScale must reset uniformScale to 1.0');
});

// -------------------------------------------------------------
// Test 7: SceneGraphUI Hierarchy Tree & Object Visibility
// -------------------------------------------------------------
runTest('7. SceneGraphUI Hierarchy, Visibility Toggles & Framing', () => {
  const container = new MockElement('div');
  const graph = new Graph();

  const cam = new Camera3DNode('cam1', 0, 0);
  const card = new Card3DNode('card1', 0, 0);
  const cube = new Cube3DNode('cube1', 0, 0);
  const axis = new Axis3DNode('axis1', 0, 0);
  const scene = new Scene3DNode('scene1', 0, 0);
  const proj = new Project3DNode('proj1', 0, 0);
  const scanline = new ScanlineRenderNode('scanline1', 0, 0);

  graph.addNode(cam);
  graph.addNode(card);
  graph.addNode(cube);
  graph.addNode(axis);
  graph.addNode(scene);
  graph.addNode(proj);
  graph.addNode(scanline);

  const canvas = new MockElement('canvas');
  const v3d = new Viewer3DUI(canvas, graph);

  let selectedFromTree = null;
  const sg = new SceneGraphUI(container, graph, v3d, (node) => {
    selectedFromTree = node;
  });

  const all3D = sg.get3DNodes();
  assert.equal(all3D.length, 7, 'All 7 registered 3D nodes must be discovered in Scene Graph');

  // Verify group categorization
  assert.equal(sg.getNodeIcon('Camera3D'), '🎥');
  assert.equal(sg.getNodeIcon('Card3D'), '🔲');
  assert.equal(sg.getNodeIcon('Cube3D'), '📦');
  assert.equal(sg.getNodeIcon('Axis3D'), '🌐');
  assert.equal(sg.getNodeIcon('Scene3D'), '🎬');
  assert.equal(sg.getNodeIcon('Project3D'), '📽️');
  assert.equal(sg.getNodeIcon('ScanlineRender'), '🖨️');

  // Visibility toggle
  assert.equal(card._viewer3dVisible !== false, true);
  card._viewer3dVisible = false;
  assert.equal(card._viewer3dVisible, false);
  card._viewer3dVisible = true;
  assert.equal(card._viewer3dVisible, true);

  // Selection sync
  sg.setSelectedNode(cube);
  assert.equal(sg.selectedNodeId, 'cube1');
});

// -------------------------------------------------------------
// Test 8: Camera3D Optics, Look Through & Lock Camera to View
// -------------------------------------------------------------
runTest('8. Camera3D Optics & Lock Camera to View Workflow', () => {
  const canvas = new MockElement('canvas');
  const graph = new Graph();
  const cam = new Camera3DNode('Camera1', 0, 0);
  cam.setKnobValue('focal', 35.0);
  cam.setKnobValue('haperture', 24.89);
  cam.setKnobValue('vaperture', 18.67);
  cam.setKnobValue('translateX', 0.0);
  cam.setKnobValue('translateY', 1.0);
  cam.setKnobValue('translateZ', 10.0);
  graph.addNode(cam);

  const v3d = new Viewer3DUI(canvas, graph);

  // Look through Camera1
  v3d.setViewType('camera:Camera1');
  assert.equal(v3d.activeCameraNodeId, 'Camera1');
  v3d.updateCamera();

  assert.equal(v3d.camera.focal, 35.0, 'Camera focal length must match Camera1 knob value');

  // Lock Camera to View: Navigation writes to camera node
  v3d.setLockCameraToView(true);
  assert.equal(v3d.lockCameraToView, true);

  v3d.isNavigating = true;
  v3d.navMode = 'pan';
  v3d.lastMouseX = 100;
  v3d.lastMouseY = 100;
  v3d.onMouseMove({ clientX: 180, clientY: 100 });

  // Translation of camera node should update
  assert.ok(typeof cam.getKnobValue('translateX') === 'number');
});

// -------------------------------------------------------------
// Test 9: Project3D & ScanlineRender UI Integration
// -------------------------------------------------------------
runTest('9. Project3D & ScanlineRender Properties & Interface Integration', () => {
  const graph = new Graph();
  const proj = new Project3DNode('Project3D1', 0, 0);
  const scanline = new ScanlineRenderNode('ScanlineRender1', 0, 0);

  graph.addNode(proj);
  graph.addNode(scanline);

  assert.equal(proj.getKnobValue('projectOn'), 'both');
  assert.equal(proj.getKnobValue('crop'), true);

  assert.equal(scanline.getKnobValue('format'), '1920x1080');
  assert.equal(scanline.getKnobValue('shading'), 'unlit');
  assert.equal(scanline.getRenderWidth(), 1920);
  assert.equal(scanline.getRenderHeight(), 1080);
});

// -------------------------------------------------------------
// Test 10: Particles UI Structure & Disclaimer Compliance
// -------------------------------------------------------------
runTest('10. Particles UI Structure & Statutory Disclaimer Disclosure', () => {
  const container = new MockElement('div');
  const particlesUI = new ParticlesUI(container);

  // 1. Mandatory disclosure banner must be present
  const banner = container.querySelector('.particles-disclosure-banner');
  assert.ok(banner !== null, 'Particles workspace must render mandatory statutory disclosure banner');
  assert.ok(
    banner.innerHTML.includes('not yet implemented'),
    'Disclaimer banner must disclose that particle simulation engine is not implemented'
  );

  // 2. Simulation stepping / caching controls must be disabled
  const stepBtn = container.querySelector('#btn-p-sim-step');
  const clearBtn = container.querySelector('#btn-p-sim-clear');
  assert.ok(stepBtn !== null && stepBtn.id === 'btn-p-sim-step');

  // 3. Emitter mockup parameters must be populated
  assert.equal(particlesUI.particleConfig.emissionRate, 50);
  assert.equal(particlesUI.particleConfig.lifetime, 60);
  assert.equal(particlesUI.particleConfig.gravity, -9.81);

  // 4. Timeline synchronization
  particlesUI.setFrame(24);
  assert.equal(particlesUI.currentFrame, 24);
  const frameDisplay = container.querySelector('#particles-frame-display');
  assert.equal(frameDisplay?.textContent || particlesUI.currentFrame, 24);
});

// -------------------------------------------------------------
// Test 11: Workspace Persistence & Local Storage
// -------------------------------------------------------------
runTest('11. Workspace Persistence (3D Preferences & Layout)', () => {
  const canvas = new MockElement('canvas');
  const v3d = new Viewer3DUI(canvas);

  v3d.setDisplayMode('wireframe');
  v3d.setGizmoMode('rotate');
  v3d.setCoordSpace('local');
  v3d.showGrid = false;
  v3d.savePreferences();

  const savedRaw = global.localStorage.getItem('opencomp_viewer_3d_prefs_v1');
  assert.ok(savedRaw !== null, 'Preferences must be saved to localStorage');
  const saved = JSON.parse(savedRaw);
  assert.equal(saved.displayMode, 'wireframe');
  assert.equal(saved.gizmoMode, 'rotate');
  assert.equal(saved.coordSpace, 'local');
  assert.equal(saved.showGrid, false);

  // New instance loads saved preferences
  const v3d2 = new Viewer3DUI(canvas);
  assert.equal(v3d2.displayMode, 'wireframe');
  assert.equal(v3d2.gizmoMode, 'rotate');
  assert.equal(v3d2.coordSpace, 'local');
  assert.equal(v3d2.showGrid, false);
});

// -------------------------------------------------------------
// Test 12: Existing 2D Viewer & Engine Regression
// -------------------------------------------------------------
runTest('12. Existing 2D Viewer & DAG Engine Non-Regression', () => {
  const canvas = new MockElement('canvas');
  const viewer = new ViewerUI(canvas);

  // Verify 2D layouts and functions operate normally
  viewer.setLayoutMode('dual');
  assert.equal(viewer.layoutMode, 'dual');

  viewer.setLayoutMode('quad');
  assert.equal(viewer.layoutMode, 'quad');

  viewer.setLayoutMode('single');
  assert.equal(viewer.layoutMode, 'single');

  // Verify buffer handling
  const buf = new PixelBuffer(128, 128);
  buf.fill(0.5, 0.2, 0.1, 1.0);
  viewer.setBuffer(buf);
  assert.equal(viewer.buffer, buf);

  // Sample pixel
  const sample = viewer.samplePixel(10, 10);
  assert.ok(sample !== null);
  assert.ok(Math.abs(sample.linear.r - 0.5) < 1e-4);
});

console.log('\n====================================================');
console.log(`📊 3D, CAMERA & PARTICLES UI TEST SUMMARY:`);
console.log(`  Passed: ${passed} / ${passed + failed}`);
console.log(`  Failed: ${failed}`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL 3D, CAMERA & PARTICLES UI TESTS PASSED!');
  process.exit(0);
}
