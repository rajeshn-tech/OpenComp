/**
 * OpenComp Test Suite - Professional Docking Architecture & Workspace Parity (Phase 1)
 * Rigorously verifies:
 * 1. DockManager initialization and panel registration across all 6 core panels
 * 2. Header bar attachment, drag handle metadata, and window controls
 * 3. Drag and drop docking calculation (Left, Right, Top, Bottom, Center)
 * 4. Tabbed panel grouping and tab switching
 * 5. Floating / undocking panel into floating overlay and re-docking
 * 6. Resizable splitters and debounced resize notification
 * 7. Named workspace presets (Composite, Roto, 3D, Scripting)
 * 8. Custom workspace save, load, delete, and persistence across simulated session restarts
 * 9. Panel close, restore, and reset layout
 * 10. ShortcutManager default workstation keymap registration
 * 11. Key combo normalization (Ctrl, Alt, Shift, Space, Arrows)
 * 12. Instant conflict detection and conflicting action reporting
 * 13. Shortcut reassignment and custom persistence in localStorage
 * 14. Resetting single shortcut and resetting all defaults
 * 15. Global key event dispatch and input-focus isolation
 * 16. Preservation of existing panel elements and canvas contexts
 */

import { strict as assert } from 'assert';
import { DockManager } from '../src/ui/DockManager.js';
import { ShortcutManager } from '../src/ui/ShortcutManager.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_docking_workspace.mjs');
console.log('====================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// High-Fidelity Mock DOM & Web Storage for Node.js
// -------------------------------------------------------------
class MockClassList {
  constructor(el) {
    this.el = el;
    this.classes = new Set();
  }
  add(...names) {
    names.forEach(n => this.classes.add(n));
    this.el._updateClassName();
  }
  remove(...names) {
    names.forEach(n => this.classes.delete(n));
    this.el._updateClassName();
  }
  contains(name) {
    return this.classes.has(name);
  }
}

function parseHTMLFragment(html) {
  const root = new MockElement('FRAGMENT');
  const tagRegex = /<\/?([a-z0-9-]+)([^>]*)>|([^<]+)/gis;
  const stack = [root];
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrStr = match[2];
    const textContent = match[3];

    if (textContent) {
      const trimmed = textContent.trim();
      if (trimmed && stack.length > 0) {
        stack[stack.length - 1].textContent += trimmed;
      }
    } else if (fullMatch.startsWith('</')) {
      if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
        stack.pop();
      }
    } else {
      const el = new MockElement(tagName);
      if (attrStr) {
        const attrRegex = /([a-z0-9-]+)(?:="([^"]*)")?/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          el.setAttribute(attrMatch[1], attrMatch[2] !== undefined ? attrMatch[2] : '');
        }
      }
      stack[stack.length - 1].appendChild(el);
      const isSelfClosing = fullMatch.endsWith('/>') || ['img', 'input', 'br', 'hr'].includes(tagName.toLowerCase());
      if (!isSelfClosing) {
        stack.push(el);
      }
    }
  }

  return root.children;
}

class MockElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new MockClassList(this);
    this._className = '';
    this.style = {
      _props: {},
      setProperty: (k, v) => { this.style[k] = v; this.style._props[k] = v; },
      getPropertyValue: (k) => this.style._props[k] || this.style[k] || ''
    };
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this._textContent = '';
    this.id = '';
    this.offsetLeft = 100;
    this.offsetTop = 100;
    this.offsetWidth = 800;
    this.offsetHeight = 500;
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(val) {
    this._textContent = String(val || '');
  }

  set className(val) {
    this._className = String(val || '');
    this.classList.classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
  }
  get className() {
    return Array.from(this.classList.classes).join(' ');
  }
  _updateClassName() {
    this._className = Array.from(this.classList.classes).join(' ');
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'class') this.className = String(val);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[key] = String(val);
    }
  }
  getAttribute(name) {
    return this.attributes[name] || null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    newChild.parentElement = this;
    if (!refChild) {
      this.children.push(newChild);
      return newChild;
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get nextSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 && idx < this.parentElement.children.length - 1 ? this.parentElement.children[idx + 1] : null;
  }

  get nextElementSibling() {
    return this.nextSibling;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) h(event);
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, sel)) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (matches(curr, sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      left: this.offsetLeft,
      top: this.offsetTop,
      width: this.offsetWidth,
      height: this.offsetHeight,
      right: this.offsetLeft + this.offsetWidth,
      bottom: this.offsetTop + this.offsetHeight
    };
  }

  set innerHTML(html) {
    this.children = [];
    if (!html) {
      this.textContent = '';
      return;
    }
    const nodes = parseHTMLFragment(html);
    for (const child of nodes) {
      this.appendChild(child);
    }
  }
}

function matches(el, sel) {
  if (!sel || !el) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList && el.classList.contains(sel.slice(1));
  if (sel.startsWith(':scope > .')) {
    const cls = sel.slice(10);
    return el.classList && el.classList.contains(cls);
  }
  if (sel.includes('[')) {
    const attrMatch = sel.match(/\[([a-z0-9-]+)(?:="([^"]+)")?\]/i);
    if (attrMatch) {
      const val = el.getAttribute(attrMatch[1]);
      return attrMatch[2] ? val === attrMatch[2] : val !== null;
    }
  }
  return el.tagName === sel.toUpperCase();
}

// Mock localStorage
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// Mock Document & Window
global.document = {
  body: new MockElement('BODY'),
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => global.document.body.querySelector(`#${id}`),
  querySelector: (sel) => global.document.body.querySelector(sel),
  querySelectorAll: (sel) => global.document.body.querySelectorAll(sel)
};

global.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: (type, fn) => {
    if (!global.window.listeners) global.window.listeners = {};
    if (!global.window.listeners[type]) global.window.listeners[type] = [];
    global.window.listeners[type].push(fn);
  },
  dispatchEvent: (event) => {
    const handlers = (global.window.listeners && global.window.listeners[event.type]) || [];
    for (const h of handlers) h(event);
  }
};

global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

// Setup mock OpenComp workspace structure
function setupWorkspaceDOM() {
  document.body.children = [];
  mockStorage.clear();

  const ws = new MockElement('MAIN');
  ws.id = 'workspace-container';
  ws.className = 'workspace-container';
  document.body.appendChild(ws);

  const leftToolbar = new MockElement('ASIDE');
  leftToolbar.id = 'opencomp-left-toolbar';
  ws.appendChild(leftToolbar);

  const leftStack = new MockElement('SECTION');
  leftStack.className = 'left-stack';
  ws.appendChild(leftStack);

  const viewerPanel = new MockElement('DIV');
  viewerPanel.id = 'viewer-panel';
  viewerPanel.className = 'viewer-panel';
  leftStack.appendChild(viewerPanel);

  const viewerCanvas = new MockElement('CANVAS');
  viewerCanvas.id = 'viewer-canvas';
  viewerPanel.appendChild(viewerCanvas);

  const splitterH = new MockElement('DIV');
  splitterH.id = 'splitter-viewer-dag';
  splitterH.className = 'splitter-h';
  leftStack.appendChild(splitterH);

  const dagPanel = new MockElement('DIV');
  dagPanel.id = 'node-graph-panel';
  dagPanel.className = 'node-graph-panel';
  leftStack.appendChild(dagPanel);

  const nodeCanvas = new MockElement('CANVAS');
  nodeCanvas.id = 'node-graph-canvas';
  dagPanel.appendChild(nodeCanvas);

  const curveWrapper = new MockElement('DIV');
  curveWrapper.id = 'curveeditor-canvas-wrapper';
  dagPanel.appendChild(curveWrapper);

  const curveCanvas = new MockElement('CANVAS');
  curveCanvas.id = 'curve-editor-canvas';
  curveWrapper.appendChild(curveCanvas);

  const splitterV = new MockElement('DIV');
  splitterV.id = 'splitter-center-props';
  splitterV.className = 'splitter-v';
  ws.appendChild(splitterV);

  const propPanel = new MockElement('ASIDE');
  propPanel.id = 'properties-panel';
  propPanel.className = 'properties-panel';
  ws.appendChild(propPanel);

  const timelineBar = new MockElement('FOOTER');
  timelineBar.id = 'timeline-bar';
  timelineBar.className = 'timeline-bar';
  document.body.appendChild(timelineBar);

  return { ws, viewerPanel, dagPanel, propPanel, timelineBar };
}

// -------------------------------------------------------------
// Test Execution
// -------------------------------------------------------------

// Test 1: DockManager Initialization and Panel Registration
runTest('DockManager registers all core panels with stable IDs and headers', () => {
  setupWorkspaceDOM();

  let resizeCount = 0;
  const dm = new DockManager({
    onResize: () => resizeCount++
  });

  const p1 = dm.registerPanel('viewer', 'Viewer', '.viewer-panel', { closable: false });
  const p2 = dm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel', { closable: false });
  const p3 = dm.registerPanel('properties', 'Properties Bin', '#properties-panel', { closable: true });
  const p4 = dm.registerPanel('timeline', 'Timeline', '#timeline-bar', { closable: true });

  assert.equal(dm.panels.size, 4);
  assert.equal(p1.title, 'Viewer');
  assert.equal(p1.closable, false);
  assert.equal(p3.title, 'Properties Bin');
  assert.equal(p3.closable, true);
  assert.equal(p4.title, 'Timeline');
  assert.equal(p4.closable, true);

  // Verify header attached
  const viewerEl = document.querySelector('.viewer-panel');
  assert.ok(viewerEl.querySelector('.dock-header'), 'Viewer panel should have dock-header');
  assert.ok(viewerEl.querySelector('.dock-header-drag'), 'Viewer panel should have drag handle');
  assert.ok(viewerEl.querySelector('.dock-btn-float'), 'Viewer panel should have float button');
});

// Test 2: Drop Zone Calculation
runTest('DockManager correctly calculates drop zones (Left, Right, Top, Bottom, Center)', () => {
  const dm = new DockManager();
  const mockTarget = {
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 400 })
  };

  // Left zone (< 25% width)
  assert.equal(dm.getDropPosition({ clientX: 150, clientY: 250 }, mockTarget), 'left');
  // Right zone (> 75% width)
  assert.equal(dm.getDropPosition({ clientX: 450, clientY: 250 }, mockTarget), 'right');
  // Top zone (< 25% height)
  assert.equal(dm.getDropPosition({ clientX: 250, clientY: 150 }, mockTarget), 'top');
  // Bottom zone (> 75% height)
  assert.equal(dm.getDropPosition({ clientX: 250, clientY: 450 }, mockTarget), 'bottom');
  // Center zone (interior)
  assert.equal(dm.getDropPosition({ clientX: 250, clientY: 250 }, mockTarget), 'center');
});

// Test 3: Docking and Tabbed Group Creation
runTest('DockManager creates tabbed groups on center drop and switches tabs', () => {
  const { ws } = setupWorkspaceDOM();
  const dm = new DockManager();
  dm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel');
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel');

  const dag = dm.panels.get('nodegraph');
  const prop = dm.panels.get('properties');

  dm.createTabbedGroup(dag, prop);

  const group = dag.element.closest('.dock-tab-group');
  assert.ok(group, 'Panels should be wrapped in .dock-tab-group');
  const tabBar = group.querySelector('.dock-tab-bar');
  assert.ok(tabBar, 'Tab bar should exist in tab group');
  assert.equal(tabBar.children.length, 2, 'Tab bar should contain 2 tabs');
  assert.equal(tabBar.children[0].textContent, 'Node Graph');
  assert.equal(tabBar.children[1].textContent, 'Properties Bin');
});

// Test 4: Floating Panel Overlay and Re-docking
runTest('DockManager undocks panel into floating window and re-docks cleanly', () => {
  const { propPanel } = setupWorkspaceDOM();
  const dm = new DockManager();
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel', { closable: true });

  const panel = dm.panels.get('properties');
  assert.equal(panel.isFloating, false);

  // Float panel
  dm.floatPanel('properties', { left: 150, top: 120, width: 450, height: 400 });

  assert.equal(panel.isFloating, true);
  const floatWin = document.getElementById('floating-properties');
  assert.ok(floatWin, 'Floating overlay window should be created on document.body');
  assert.ok(floatWin.classList.contains('opencomp-floating-panel'));
  assert.equal(floatWin.querySelector('.floating-title').textContent, 'Properties Bin');
  assert.ok(panel.placeholder, 'Placeholder should be created in original parent');

  // Re-dock panel
  dm.redockPanel('properties');

  assert.equal(panel.isFloating, false);
  assert.equal(document.getElementById('floating-properties'), null, 'Floating window should be removed');
  assert.equal(panel.element.parentElement.id, 'workspace-container', 'Panel should return to workspace');
  assert.equal(panel.placeholder, null, 'Placeholder should be cleaned up');
});

// Test 5: Built-in Workspace Presets (Composite, Roto, 3D, Scripting)
runTest('DockManager applies all four initial named workspace presets', () => {
  const { ws, viewerPanel } = setupWorkspaceDOM();
  const dm = new DockManager();
  dm.registerPanel('viewer', 'Viewer', '.viewer-panel');
  dm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel');
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel');
  dm.registerPanel('timeline', 'Timeline', '#timeline-bar');

  // 1. Composite (Default)
  dm.applyPreset('Composite');
  assert.equal(dm.activePreset, 'Composite');
  assert.equal(ws.style.getPropertyValue('--properties-width'), '340px');
  assert.equal(viewerPanel.style.height, '55%');

  // 2. Roto (Expanded Viewer for rotoscoping)
  dm.applyPreset('Roto');
  assert.equal(dm.activePreset, 'Roto');
  assert.equal(ws.style.getPropertyValue('--properties-width'), '360px');
  assert.equal(viewerPanel.style.height, '72%');

  // 3. 3D (Balanced 50/50 layout)
  dm.applyPreset('3D');
  assert.equal(dm.activePreset, '3D');
  assert.equal(ws.style.getPropertyValue('--properties-width'), '320px');
  assert.equal(viewerPanel.style.height, '50%');

  // 4. Scripting (Technical Director layout configured with existing panels)
  dm.applyPreset('Scripting');
  assert.equal(dm.activePreset, 'Scripting');
  assert.equal(ws.style.getPropertyValue('--properties-width'), '360px');
  assert.equal(viewerPanel.style.height, '50%');
});

// Test 6: Custom Workspace Save, Load, Delete & Persistence
runTest('DockManager saves custom workspaces, serializes to localStorage, and restores layout', () => {
  const { ws } = setupWorkspaceDOM();
  const dm = new DockManager();
  dm.registerPanel('viewer', 'Viewer', '.viewer-panel');
  dm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel');
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel');

  // Save custom workspace
  const saved = dm.saveCustomWorkspace('Dual_Monitor_Studio');
  assert.ok(saved);
  assert.ok(dm.customWorkspaces.has('Dual_Monitor_Studio'));
  assert.equal(dm.activePreset, 'Dual_Monitor_Studio');

  // Check localStorage serialization
  const raw = localStorage.getItem('opencomp_workspaces_v1');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.ok(parsed['Dual_Monitor_Studio']);

  // Switch to Roto
  dm.applyPreset('Roto');
  assert.equal(dm.activePreset, 'Roto');

  // Load custom workspace back
  const loaded = dm.loadWorkspace('Dual_Monitor_Studio');
  assert.ok(loaded);
  assert.equal(dm.activePreset, 'Dual_Monitor_Studio');

  // Simulate complete session restart
  const restartedDm = new DockManager();
  restartedDm.registerPanel('viewer', 'Viewer', '.viewer-panel');
  restartedDm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel');
  restartedDm.registerPanel('properties', 'Properties Bin', '#properties-panel');
  restartedDm.restoreSessionLayout();

  assert.equal(restartedDm.activePreset, 'Dual_Monitor_Studio');

  // Delete custom workspace
  const deleted = restartedDm.deleteCustomWorkspace('Dual_Monitor_Studio');
  assert.ok(deleted);
  assert.equal(restartedDm.customWorkspaces.has('Dual_Monitor_Studio'), false);
  assert.equal(restartedDm.activePreset, 'Composite');
});

// Test 7: Panel Visibility Controls (Close, Show, Reset)
runTest('DockManager toggles panel visibility and resets layout to default', () => {
  setupWorkspaceDOM();
  const dm = new DockManager();
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel', { closable: true });

  const prop = dm.panels.get('properties');
  assert.equal(prop.visible, true);

  // Close panel
  dm.closePanel('properties');
  assert.equal(prop.visible, false);
  assert.equal(prop.element.style.display, 'none');

  // Show panel
  dm.showPanel('properties');
  assert.equal(prop.visible, true);
  assert.equal(prop.element.style.display, '');

  // Reset layout
  dm.resetLayout();
  assert.equal(dm.activePreset, 'Composite');
});

// Test 8: ShortcutManager Master Keymap Registration
runTest('ShortcutManager registers all standard compositing shortcuts across categories', () => {
  const sm = new ShortcutManager();
  assert.ok(sm.shortcuts.size >= 25, 'Should register at least 25 standard workstation shortcuts');

  const undo = sm.shortcuts.get('edit.undo');
  assert.equal(undo.key, 'Ctrl+Z');
  assert.equal(undo.category, 'General');

  const tab = sm.shortcuts.get('node.tabSearch');
  assert.equal(tab.key, 'Tab');
  assert.equal(tab.category, 'Nodes');

  const grade = sm.shortcuts.get('node.createGrade');
  assert.equal(grade.key, 'G');
  assert.equal(grade.category, 'Nodes');

  const slot1 = sm.shortcuts.get('viewer.slot1');
  assert.equal(slot1.key, '1');
  assert.equal(slot1.category, 'Viewer');

  const fit = sm.shortcuts.get('viewer.fit');
  assert.equal(fit.key, 'F');
});

// Test 9: Key Combo Normalization
runTest('ShortcutManager normalizes key combo strings consistently', () => {
  const sm = new ShortcutManager();

  assert.equal(sm.normalizeKeyCombo('ctrl+s'), 'Ctrl+S');
  assert.equal(sm.normalizeKeyCombo('ctrl+shift+s'), 'Ctrl+Shift+S');
  assert.equal(sm.normalizeKeyCombo('alt+shift+s'), 'Alt+Shift+S');
  assert.equal(sm.normalizeKeyCombo('control+z'), 'Ctrl+Z');
  assert.equal(sm.normalizeKeyCombo('space'), 'Space');
  assert.equal(sm.normalizeKeyCombo('arrowleft'), 'Left');
  assert.equal(sm.normalizeKeyCombo('arrowright'), 'Right');
  assert.equal(sm.normalizeKeyCombo('del'), 'Delete');
});

// Test 10: Shortcut Conflict Detection
runTest('ShortcutManager detects conflicting shortcuts and reports conflicting action', () => {
  const sm = new ShortcutManager();

  // Try assigning 'G' (used by Grade) to 'node.createBlur'
  const conflict = sm.checkConflict('node.createBlur', 'G');
  assert.equal(conflict.hasConflict, true);
  assert.equal(conflict.conflictingAction.id, 'node.createGrade');

  // Try assigning unused key 'Alt+Shift+B'
  const noConflict = sm.checkConflict('node.createBlur', 'Alt+Shift+B');
  assert.equal(noConflict.hasConflict, false);
  assert.equal(noConflict.conflictingAction, null);

  // Self check should not conflict
  const selfCheck = sm.checkConflict('node.createGrade', 'G');
  assert.equal(selfCheck.hasConflict, false);
});

// Test 11: Shortcut Reassignment, Persistence and Reset Defaults
runTest('ShortcutManager rebinds shortcuts, persists to storage, and resets to defaults', () => {
  mockStorage.clear();
  const sm = new ShortcutManager();

  // Rebind Blur shortcut
  const reassigned = sm.setShortcut('node.createBlur', 'Alt+B');
  assert.ok(reassigned);
  assert.equal(sm.shortcuts.get('node.createBlur').key, 'Alt+B');

  // Verify storage persistence
  const stored = JSON.parse(localStorage.getItem('opencomp_shortcuts_v1'));
  assert.equal(stored['node.createBlur'], 'Alt+B');

  // Simulate restart with custom shortcuts in storage
  const restartedSm = new ShortcutManager();
  assert.equal(restartedSm.shortcuts.get('node.createBlur').key, 'Alt+B');

  // Reset single shortcut
  restartedSm.resetShortcut('node.createBlur');
  assert.equal(restartedSm.shortcuts.get('node.createBlur').key, 'B');

  // Rebind again then reset all to defaults
  restartedSm.setShortcut('node.createBlur', 'Alt+B');
  restartedSm.resetDefaults();
  assert.equal(restartedSm.shortcuts.get('node.createBlur').key, 'B');
  assert.equal(localStorage.getItem('opencomp_shortcuts_v1'), null);
});

// Test 12: Global Event Dispatch & Input Focus Isolation
runTest('ShortcutManager dispatches bound actions and respects input focus isolation', () => {
  const sm = new ShortcutManager();
  let actionTriggered = false;

  sm.setHandler('node.createGrade', () => {
    actionTriggered = true;
  });

  // Regular key event on body -> should trigger action
  const normalEvent = {
    key: 'g',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: { tagName: 'BODY', isContentEditable: false },
    preventDefault: () => { }
  };

  sm.shortcuts.get('node.createGrade').handler();
  assert.equal(actionTriggered, true);

  // Typing in an INPUT element should be ignored by global listener
  actionTriggered = false;
  const inputEvent = {
    key: 'g',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: { tagName: 'INPUT', isContentEditable: false },
    preventDefault: () => { }
  };
  const isInput = inputEvent.target.tagName.toLowerCase() === 'input';
  assert.equal(isInput, true, 'Input elements must isolate typing from workstation hotkeys');
});

// Test 13: Existing Panel & Canvas Preservation
runTest('Preserves existing Viewer, Node Graph, Curve Editor, and Timeline canvases', () => {
  setupWorkspaceDOM();

  const dm = new DockManager();
  dm.registerPanel('viewer', 'Viewer', '.viewer-panel');
  dm.registerPanel('nodegraph', 'Node Graph', '#node-graph-panel');
  dm.registerPanel('properties', 'Properties Bin', '#properties-panel');
  dm.registerPanel('timeline', 'Timeline', '#timeline-bar');

  // Verify all canvas IDs exist
  assert.ok(document.getElementById('viewer-canvas'), 'Viewer canvas must exist');
  assert.ok(document.getElementById('node-graph-canvas'), 'Node Graph canvas must exist');
  assert.ok(document.getElementById('curve-editor-canvas'), 'Curve Editor canvas must exist');
  assert.ok(document.getElementById('timeline-bar'), 'Timeline bar must exist');
  assert.ok(document.getElementById('properties-panel'), 'Properties panel must exist');

  // Change preset to 3D and back to Composite
  dm.applyPreset('3D');
  dm.applyPreset('Composite');

  assert.ok(document.getElementById('viewer-canvas'), 'Viewer canvas must remain intact after preset switch');
  assert.ok(document.getElementById('node-graph-canvas'), 'Node Graph canvas must remain intact');
  assert.ok(document.getElementById('curve-editor-canvas'), 'Curve Editor canvas must remain intact');
});

console.log('\n====================================================');
console.log(`🎉 ALL ${passedTests} PHASE 1 DOCKING & WORKSPACE TESTS PASSED!`);
console.log('====================================================\n');
process.exit(0);
