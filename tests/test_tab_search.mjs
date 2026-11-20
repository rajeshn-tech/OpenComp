/**
 * OpenComp Test Suite - Nuke-Style Tab Node Search & Auto-Connect Verification
 * Rigorously verifies:
 * 1. Catalog discovery of all 34 production nodes
 * 2. Tab key opening popup with node graph context
 * 3. Search input auto-focus and full catalog rendering
 * 4. Dynamic filtering & scoring (exact prefix ranked first)
 * 5. Case-insensitive search
 * 6. Partial name & category search
 * 7. Arrow Up / Down keyboard navigation
 * 8. Enter / Tab committing selection & node creation
 * 9. Escape dismissing popup without spawning
 * 10. Outside click dismissal
 * 11. Node placement at cursor coordinates and viewport center
 * 12. Nuke-style auto-connection rules for single selected node
 * 13. Focus isolation preventing popup when typing in properties bin
 */

import { strict as assert } from 'assert';
import { Graph } from '../src/core/Graph.js';
import { NODE_REGISTRY, NODE_MENU, createNode } from '../src/nodes/index.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_tab_search.mjs');
console.log('----------------------------------------------------');

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
// Minimal High-Fidelity Mock DOM Implementation for Node.js
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
  toggle(name) {
    if (this.classes.has(name)) {
      this.classes.delete(name);
      this.el._updateClassName();
      return false;
    }
    this.classes.add(name);
    this.el._updateClassName();
    return true;
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new MockClassList(this);
    this._className = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this.isContentEditable = false;
    this.width = 800;
    this.height = 600;
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
    if (name === 'class') {
      this.classList.classes.clear();
      String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
      this._updateClassName();
    }
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

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  set innerHTML(html) {
    this.children = [];
    if (!html) {
      this.textContent = '';
    }
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1 && idx < this.parentElement.children.length - 1) {
      return this.parentElement.children[idx + 1];
    }
    return null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    if (idx > 0) {
      return this.parentElement.children[idx - 1];
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 50,
      width: this.width || 800,
      height: this.height || 600,
      right: (100 + (this.width || 800)),
      bottom: (50 + (this.height || 600))
    };
  }

  getContext(type) {
    return {
      save() {},
      restore() {},
      fillRect() {},
      clearRect() {},
      beginPath() {},
      closePath() {},
      roundRect() {},
      fill() {},
      stroke() {},
      translate() {},
      scale() {},
      drawImage() {},
      fillText() {},
      strokeText() {},
      measureText() { return { width: 40 }; },
      arc() {},
      moveTo() {},
      lineTo() {},
      bezierCurveTo() {},
      setLineDash() {}
    };
  }

  focus() {
    if (global.document) {
      global.document.activeElement = this;
    }
    this.dispatchEvent(new MockEvent('focus'));
  }

  select() {}

  scrollIntoView() {}

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
    // Bubble up
    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  contains(other) {
    if (other === this) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr;
      if (selector.startsWith('.') && curr.classList.contains(selector.slice(1))) return curr;
      if (curr.tagName.toLowerCase() === selector.toLowerCase()) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (el) => {
      for (const child of el.children) {
        let match = false;
        if (selector.startsWith('#') && child.id === selector.slice(1)) match = true;
        else if (selector.startsWith('.')) {
          const parts = selector.split('.').filter(Boolean);
          match = parts.every(p => child.classList.contains(p));
        } else if (child.tagName.toLowerCase() === selector.toLowerCase()) match = true;

        if (match) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

class MockEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles !== undefined ? opts.bubbles : true;
    this.cancelable = opts.cancelable !== undefined ? opts.cancelable : true;
    this.defaultPrevented = false;
    this.target = null;
    this.key = opts.key || '';
    this.ctrlKey = Boolean(opts.ctrlKey);
    this.shiftKey = Boolean(opts.shiftKey);
    this.altKey = Boolean(opts.altKey);
    this.clientX = opts.clientX !== undefined ? opts.clientX : 200;
    this.clientY = opts.clientY !== undefined ? opts.clientY : 150;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {}
}

// Setup Global DOM Mock environment
const docBody = new MockElement('BODY');
docBody.id = 'body';

const mockDoc = {
  body: docBody,
  activeElement: docBody,
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return this.body.querySelector(`#${id}`);
  },
  querySelector(sel) {
    return this.body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  }
};

const mockWin = {
  document: mockDoc,
  listeners: {},
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  },
  removeEventListener(type, cb) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(f => f !== cb);
  },
  dispatchEvent(event) {
    if (this.listeners[event.type]) {
      for (const cb of this.listeners[event.type]) {
        cb(event);
      }
    }
  }
};

global.window = mockWin;
global.document = mockDoc;

// Assemble OpenComp DOM elements
const nodeGraphPanel = new MockElement('DIV');
nodeGraphPanel.id = 'node-graph-panel';
nodeGraphPanel.className = 'node-graph-panel';
docBody.appendChild(nodeGraphPanel);

const canvasWrapper = new MockElement('DIV');
canvasWrapper.className = 'canvas-wrapper';
nodeGraphPanel.appendChild(canvasWrapper);

const nodeCanvas = new MockElement('CANVAS');
nodeCanvas.id = 'node-graph-canvas';
nodeCanvas.width = 800;
nodeCanvas.height = 600;
canvasWrapper.appendChild(nodeCanvas);

const searchPopup = new MockElement('DIV');
searchPopup.id = 'node-search-popup';
searchPopup.className = 'search-popup';
searchPopup.style.display = 'none';
nodeGraphPanel.appendChild(searchPopup);

const searchBox = new MockElement('DIV');
searchBox.className = 'search-input-box';
searchPopup.appendChild(searchBox);

const searchInput = new MockElement('INPUT');
searchInput.id = 'node-search-input';
searchInput.type = 'text';
searchBox.appendChild(searchInput);

const searchResults = new MockElement('DIV');
searchResults.id = 'node-search-results';
searchResults.className = 'search-results';
searchPopup.appendChild(searchResults);

const propertiesPanel = new MockElement('ASIDE');
propertiesPanel.id = 'properties-panel';
propertiesPanel.className = 'properties-panel';
docBody.appendChild(propertiesPanel);

const propInput = new MockElement('INPUT');
propInput.id = 'prop-gain-input';
propertiesPanel.appendChild(propInput);

// Import application and UI components
const { NodeGraphUI } = await import('../src/ui/NodeGraphUI.js');

// Helper to simulate OpenCompApp spawner & search controller
class AppSearchHarness {
  constructor(canvas, graph) {
    this.nodeCanvas = canvas;
    this.graph = graph;
    this.nodeGraphUI = new NodeGraphUI(canvas, graph, () => {}, () => {});
    this.propertiesUI = {
      activeNode: null,
      showNode: (n) => { this.propertiesUI.activeNode = n; }
    };
    this.savedSpawnGraphPos = null;

    this.nodeGraphUI.onOpenSearchPopup = (clientPos, graphPos) => {
      this.openNodeSearchPopup(clientPos, graphPos);
    };

    this.initNodeSearchPopup();
  }

  buildNodeCatalog() {
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

  openNodeSearchPopup(clientPos = null, graphPos = null) {
    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    const list = document.getElementById('node-search-results');
    if (!popup || !input || !list) return;

    if (graphPos) {
      this.savedSpawnGraphPos = graphPos;
    } else if (this.nodeGraphUI && this.nodeGraphUI.lastMouseGraphPos) {
      this.savedSpawnGraphPos = this.nodeGraphUI.lastMouseGraphPos;
    } else if (this.nodeCanvas && this.nodeGraphUI) {
      this.savedSpawnGraphPos = this.nodeGraphUI.screenToGraph(this.nodeCanvas.width * 0.5, this.nodeCanvas.height * 0.5);
    } else {
      this.savedSpawnGraphPos = { x: 0, y: 0 };
    }

    const panel = document.getElementById('node-graph-panel') || (this.nodeCanvas ? this.nodeCanvas.parentElement : null);
    const panelRect = panel ? panel.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };

    let x = clientPos ? (clientPos.x - panelRect.left) : (panelRect.width * 0.5 - 160);
    let y = clientPos ? (clientPos.y - panelRect.top) : (panelRect.height * 0.25);

    const popupWidth = 320;
    const popupHeight = 280;
    const pad = 10;
    x = Math.max(pad, Math.min(x, (panelRect.width || 800) - popupWidth - pad));
    y = Math.max(35, Math.min(y, (panelRect.height || 600) - popupHeight - pad));

    popup.style.left = `${Math.round(x)}px`;
    popup.style.top = `${Math.round(y)}px`;
    popup.style.transform = 'none';
    popup.style.display = 'block';

    input.value = '';
    this.renderNodeSearchList('');
    input.focus();
  }

  renderNodeSearchList(filter = '') {
    const list = document.getElementById('node-search-results');
    const popup = document.getElementById('node-search-popup');
    if (!list) return;

    list.innerHTML = '';
    const catalog = this.buildNodeCatalog();
    const query = filter.toLowerCase().trim();

    let matches = [];
    if (!query) {
      matches = [...catalog].sort((a, b) => a.type.localeCompare(b.type));
    } else {
      const scored = [];
      for (const item of catalog) {
        const typeLower = item.type.toLowerCase();
        const labelLower = item.label.toLowerCase();
        const catLower = item.category.toLowerCase();
        const shortcutLower = (item.shortcut || '').toLowerCase();

        let score = -1;
        if (typeLower === query) {
          score = 0;
        } else if (typeLower.startsWith(query)) {
          score = 1;
        } else if (labelLower.startsWith(query)) {
          score = 2;
        } else if (shortcutLower === query) {
          score = 3;
        } else if (typeLower.includes(query)) {
          score = 4;
        } else if (labelLower.includes(query)) {
          score = 5;
        } else if (catLower.includes(query)) {
          score = 6;
        }

        if (score !== -1) {
          scored.push({ item, score });
        }
      }

      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.item.type.localeCompare(b.item.type);
      });

      matches = scored.map(s => s.item);
    }

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-item-empty';
      empty.textContent = 'No matching nodes found';
      list.appendChild(empty);
      return;
    }

    matches.forEach((nodeInfo, index) => {
      const item = document.createElement('div');
      item.className = `search-item ${index === 0 ? 'selected' : ''}`;
      item.dataset.type = nodeInfo.type;

      const leftWrap = document.createElement('div');
      leftWrap.className = 'search-item-left';

      const nameEl = document.createElement('span');
      nameEl.className = 'search-item-name';
      nameEl.textContent = nodeInfo.type;
      leftWrap.appendChild(nameEl);

      const catBadge = document.createElement('span');
      const catClass = `cat-${nodeInfo.category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      catBadge.className = `search-item-category ${catClass}`;
      catBadge.textContent = nodeInfo.category;
      leftWrap.appendChild(catBadge);

      item.appendChild(leftWrap);

      if (nodeInfo.shortcut) {
        const scEl = document.createElement('span');
        scEl.className = 'search-item-shortcut';
        scEl.textContent = nodeInfo.shortcut;
        item.appendChild(scEl);
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.spawnNodeFromSearch(nodeInfo.type, this.savedSpawnGraphPos);
        if (popup) popup.style.display = 'none';
        if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
          this.nodeCanvas.focus();
        }
      });

      list.appendChild(item);
    });
  }

  initNodeSearchPopup() {
    const popup = document.getElementById('node-search-popup');
    const input = document.getElementById('node-search-input');
    const list = document.getElementById('node-search-results');
    if (!popup || !input || !list) return;

    input.addEventListener('input', (e) => {
      this.renderNodeSearchList(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      const items = Array.from(list.querySelectorAll('.search-item'));
      let selectedIdx = items.findIndex(el => el.classList.contains('selected'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx >= 0 && selectedIdx < items.length - 1) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx + 1].classList.add('selected');
            items[selectedIdx + 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[0].classList.add('selected');
            items[0].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length > 0) {
          if (selectedIdx > 0) {
            items[selectedIdx].classList.remove('selected');
            items[selectedIdx - 1].classList.add('selected');
            items[selectedIdx - 1].scrollIntoView({ block: 'nearest' });
          } else if (selectedIdx === -1) {
            items[items.length - 1].classList.add('selected');
            items[items.length - 1].scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = list.querySelector('.search-item.selected') || items[0];
        if (selected) {
          const type = selected.dataset.type || selected.querySelector('.search-item-name')?.textContent || selected.textContent.trim();
          this.spawnNodeFromSearch(type, this.savedSpawnGraphPos);
          popup.style.display = 'none';
          if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
            this.nodeCanvas.focus();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        popup.style.display = 'none';
        if (this.nodeCanvas && typeof this.nodeCanvas.focus === 'function') {
          this.nodeCanvas.focus();
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (popup.style.display === 'block' && !popup.contains(e.target)) {
        popup.style.display = 'none';
      }
    });
  }

  spawnNodeFromSearch(type, spawnGraphPos = null) {
    const pos = spawnGraphPos || this.savedSpawnGraphPos;
    return this.spawnNodeAt(type, pos ? pos.x : undefined, pos ? pos.y : undefined);
  }

  spawnNodeAt(type, posX, posY) {
    const c = this.nodeCanvas;
    let spawnX = posX;
    let spawnY = posY;

    const selectedIds = this.nodeGraphUI ? Array.from(this.nodeGraphUI.selectedNodes) : [];
    let selectedNode = null;
    if (selectedIds.length === 1) {
      selectedNode = this.graph.getNode(selectedIds[0]);
    }

    if (spawnX === undefined || spawnY === undefined) {
      if (selectedNode) {
        spawnX = selectedNode.x;
        spawnY = selectedNode.y + selectedNode.height + 40;
      } else if (c && this.nodeGraphUI) {
        const centerGraph = this.nodeGraphUI.screenToGraph(c.width * 0.5, c.height * 0.5);
        spawnX = centerGraph.x - 55;
        spawnY = centerGraph.y - 18;
      } else {
        spawnX = 0;
        spawnY = 0;
      }
    } else if (selectedNode) {
      spawnX = selectedNode.x;
      spawnY = selectedNode.y + selectedNode.height + 40;
    } else {
      spawnX = spawnX - 55;
      spawnY = spawnY - 18;
    }

    const node = createNode(type, null, spawnX, spawnY);
    if (node) {
      this.graph.addNode(node);

      const isGenerator = type === 'Read' || type === 'Constant' || type === 'Ramp' || type === 'Backdrop';
      const isViewerOrBackdrop = selectedNode && (selectedNode.type === 'Viewer' || selectedNode.type === 'Backdrop');

      if (selectedNode && !isGenerator && !isViewerOrBackdrop && Array.isArray(selectedNode.outputs) && selectedNode.outputs.length > 0) {
        const outputPortId = selectedNode.outputs[0].id;

        if (Array.isArray(node.inputs) && node.inputs.length > 0) {
          let primaryInputId = null;
          if (node.inputs.some(inp => inp.id === 'in')) {
            primaryInputId = 'in';
          } else if (node.inputs.some(inp => inp.id === 'B')) {
            primaryInputId = 'B';
          } else if (node.inputs.some(inp => inp.id === 'left')) {
            primaryInputId = 'left';
          } else if (node.inputs.some(inp => inp.id === '0')) {
            primaryInputId = '0';
          } else if (node.inputs.some(inp => inp.id === '1')) {
            primaryInputId = '1';
          } else {
            primaryInputId = node.inputs[0].id;
          }

          if (primaryInputId && !this.graph.canReach(node.id, selectedNode.id)) {
            const targetInput = node.inputs.find(inp => inp.id === primaryInputId);
            if (targetInput && !targetInput.connection) {
              this.graph.connect(selectedNode.id, outputPortId, node.id, primaryInputId);
            }
          }
        }
      }

      if (this.nodeGraphUI) {
        this.nodeGraphUI.selectedNodes.clear();
        this.nodeGraphUI.selectedNodes.add(node.id);
        this.nodeGraphUI.render();
      }
      if (this.propertiesUI) {
        this.propertiesUI.showNode(node);
      }
      if (c && typeof c.focus === 'function') {
        c.focus();
      }
      return node;
    }
    return null;
  }
}

// Instantiate test harness
const testGraph = new Graph();
const app = new AppSearchHarness(nodeCanvas, testGraph);

// -------------------------------------------------------------
// Test Case 1: All registered production nodes are discoverable
// -------------------------------------------------------------
runTest('Catalog: All registered nodes are discoverable without duplicates', () => {
  const registeredTypes = Object.keys(NODE_REGISTRY);
  const expectedCount = registeredTypes.length;
  assert(expectedCount >= 34, `Expected at least 34 registered nodes, got ${expectedCount}`);

  const catalog = app.buildNodeCatalog();
  assert.equal(catalog.length, expectedCount, `Expected catalog length ${expectedCount}, got ${catalog.length}`);

  const catalogTypes = new Set(catalog.map(c => c.type));
  assert.equal(catalogTypes.size, expectedCount, `Expected ${expectedCount} unique node types in catalog`);

  for (const type of registeredTypes) {
    assert(catalogTypes.has(type), `Registered node "${type}" must be discoverable in catalog`);
  }

  // Verify categories and labels
  for (const item of catalog) {
    assert(item.category && item.category.length > 0, `Node ${item.type} must have a valid category`);
    assert(item.label && item.label.length > 0, `Node ${item.type} must have a valid label`);
  }
});

// -------------------------------------------------------------
// Test Case 2: Tab opens popup with Node Graph focus
// -------------------------------------------------------------
runTest('Behavior: Tab key opens popup when Node Graph is focused', () => {
  searchPopup.style.display = 'none';
  app.nodeGraphUI.isMouseOverGraph = true;
  nodeCanvas.focus();

  const tabEvent = new MockEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  tabEvent.target = nodeCanvas;
  window.dispatchEvent(tabEvent);

  assert.equal(tabEvent.defaultPrevented, true, 'Tab key default navigation must be prevented in Node Graph');
  assert.equal(searchPopup.style.display, 'block', 'Popup display must be "block"');
});

// -------------------------------------------------------------
// Test Case 3: Search input automatically receives focus
// -------------------------------------------------------------
runTest('Behavior: Search input receives focus and renders full catalog on open', () => {
  assert.equal(document.activeElement, searchInput, 'Search input must receive focus');
  assert.equal(searchInput.value, '', 'Search input must be initialized with empty text');

  const items = searchResults.querySelectorAll('.search-item');
  const expectedCount = Object.keys(NODE_REGISTRY).length;
  assert.equal(items.length, expectedCount, `Expected all ${expectedCount} nodes in results list when opened, got ${items.length}`);
  assert.equal(items[0].classList.contains('selected'), true, 'First item must be selected by default');
});

// -------------------------------------------------------------
// Test Case 4: Typing filters nodes dynamically
// -------------------------------------------------------------
runTest('Filter: Typing filters nodes dynamically', () => {
  searchInput.value = 'Blur';
  searchInput.dispatchEvent(new MockEvent('input'));

  const items = searchResults.querySelectorAll('.search-item');
  const matchedTypes = items.map(el => el.dataset.type);

  assert(matchedTypes.includes('Blur'), 'Should match Blur');
  assert(matchedTypes.includes('EdgeBlur'), 'Should match EdgeBlur');
  assert(!matchedTypes.includes('Grade'), 'Should not match Grade');
  assert.equal(matchedTypes[0], 'Blur', 'Blur exact/prefix match should be ranked first');
});

// -------------------------------------------------------------
// Test Case 5: Case-insensitive search works
// -------------------------------------------------------------
runTest('Filter: Case-insensitive search works across upper/lower/mixed casing', () => {
  const variations = ['grade', 'GRADE', 'GrAdE'];
  for (const q of variations) {
    searchInput.value = q;
    searchInput.dispatchEvent(new MockEvent('input'));

    const items = searchResults.querySelectorAll('.search-item');
    assert(items.length > 0, `Query "${q}" must return results`);
    assert.equal(items[0].dataset.type, 'Grade', `Query "${q}" should have Grade as first match`);
    assert.equal(items[0].classList.contains('selected'), true);
  }
});

// -------------------------------------------------------------
// Test Case 6: Partial name and category search
// -------------------------------------------------------------
runTest('Filter: Partial name search correctly identifies substring matches', () => {
  // Test "defocus" matching ZDefocus
  searchInput.value = 'defocus';
  searchInput.dispatchEvent(new MockEvent('input'));
  let items = searchResults.querySelectorAll('.search-item');
  assert(items.some(el => el.dataset.type === 'ZDefocus'), 'Partial "defocus" should match ZDefocus');

  // Test "lookup" matching ColorLookup
  searchInput.value = 'lookup';
  searchInput.dispatchEvent(new MockEvent('input'));
  items = searchResults.querySelectorAll('.search-item');
  assert(items.some(el => el.dataset.type === 'ColorLookup'), 'Partial "lookup" should match ColorLookup');

  // Test "warp" matching StereoWarp
  searchInput.value = 'warp';
  searchInput.dispatchEvent(new MockEvent('input'));
  items = searchResults.querySelectorAll('.search-item');
  assert(items.some(el => el.dataset.type === 'StereoWarp'), 'Partial "warp" should match StereoWarp');
});

// -------------------------------------------------------------
// Test Case 7: Arrow Up / Down navigation changes selection
// -------------------------------------------------------------
runTest('Navigation: Arrow Up / Down keys navigate list selection', () => {
  // Empty filter to list all 34 nodes
  searchInput.value = '';
  searchInput.dispatchEvent(new MockEvent('input'));

  const items = searchResults.querySelectorAll('.search-item');
  assert(items.length >= 3, 'Must have at least 3 items to test arrow navigation');

  assert.equal(items[0].classList.contains('selected'), true);
  assert.equal(items[1].classList.contains('selected'), false);

  // ArrowDown 1
  searchInput.dispatchEvent(new MockEvent('keydown', { key: 'ArrowDown' }));
  assert.equal(items[0].classList.contains('selected'), false);
  assert.equal(items[1].classList.contains('selected'), true);

  // ArrowDown 2
  searchInput.dispatchEvent(new MockEvent('keydown', { key: 'ArrowDown' }));
  assert.equal(items[1].classList.contains('selected'), false);
  assert.equal(items[2].classList.contains('selected'), true);

  // ArrowUp 1
  searchInput.dispatchEvent(new MockEvent('keydown', { key: 'ArrowUp' }));
  assert.equal(items[2].classList.contains('selected'), false);
  assert.equal(items[1].classList.contains('selected'), true);

  // ArrowUp 2
  searchInput.dispatchEvent(new MockEvent('keydown', { key: 'ArrowUp' }));
  assert.equal(items[1].classList.contains('selected'), false);
  assert.equal(items[0].classList.contains('selected'), true);
});

// -------------------------------------------------------------
// Test Case 8: Enter creates the selected node and closes popup
// -------------------------------------------------------------
runTest('Creation: Enter key creates selected node, closes popup and selects new node', () => {
  testGraph.clear();
  app.nodeGraphUI.selectedNodes.clear();

  searchInput.value = 'Blur';
  searchInput.dispatchEvent(new MockEvent('input'));

  const enterEvent = new MockEvent('keydown', { key: 'Enter' });
  searchInput.dispatchEvent(enterEvent);

  assert.equal(searchPopup.style.display, 'none', 'Popup must close after Enter');

  const nodes = testGraph.getAllNodes();
  assert.equal(nodes.length, 1, 'One node should have been added to the graph');
  assert.equal(nodes[0].type, 'Blur', 'Created node should be of type Blur');

  // Verify node is selected
  assert(app.nodeGraphUI.selectedNodes.has(nodes[0].id), 'Created node must be selected in graph');
  assert.equal(app.propertiesUI.activeNode, nodes[0], 'Created node must be opened in Properties Bin');
});

// -------------------------------------------------------------
// Test Case 9: Escape closes the popup without creating a node
// -------------------------------------------------------------
runTest('Dismissal: Escape key closes popup without creating any node', () => {
  const nodeCountBefore = testGraph.getAllNodes().length;
  searchPopup.style.display = 'block';

  const escEvent = new MockEvent('keydown', { key: 'Escape' });
  searchInput.dispatchEvent(escEvent);

  assert.equal(searchPopup.style.display, 'none', 'Popup must close on Escape');
  assert.equal(testGraph.getAllNodes().length, nodeCountBefore, 'No node should be created on Escape');
});

// -------------------------------------------------------------
// Test Case 10: Clicking outside closes popup
// -------------------------------------------------------------
runTest('Dismissal: Clicking outside dismisses search popup', () => {
  searchPopup.style.display = 'block';

  // Click on background canvas wrapper
  const outsideEvent = new MockEvent('mousedown');
  outsideEvent.target = canvasWrapper;
  window.dispatchEvent(outsideEvent);

  assert.equal(searchPopup.style.display, 'none', 'Popup must dismiss on outside mousedown');
});

// -------------------------------------------------------------
// Test Case 11: Node is placed at correct graph position
// -------------------------------------------------------------
runTest('Placement: Node placed at cursor coordinates when no node is selected', () => {
  testGraph.clear();
  app.nodeGraphUI.selectedNodes.clear();

  const targetCursorPos = { x: 300, y: 250 };
  const newNode = app.spawnNodeFromSearch('Grade', targetCursorPos);

  assert(newNode, 'Grade node must be returned');
  // Node is 110x36, centered around target cursor (300 - 55, 250 - 18) = (245, 232)
  assert.equal(newNode.x, 245, `Expected node.x to be 245, got ${newNode.x}`);
  assert.equal(newNode.y, 232, `Expected node.y to be 232, got ${newNode.y}`);
});

// -------------------------------------------------------------
// Test Case 12: Automatic connection when a single node is selected
// -------------------------------------------------------------
runTest('Auto-Connect: Upstream node automatically connects to newly spawned downstream node', () => {
  testGraph.clear();
  app.nodeGraphUI.selectedNodes.clear();

  // 1. Create a Read node
  const readNode = createNode('Read', 'Read1', 100, 100);
  testGraph.addNode(readNode);
  app.nodeGraphUI.selectedNodes.add(readNode.id);

  // 2. Spawn Grade while Read is selected
  const gradeNode = app.spawnNodeFromSearch('Grade');
  assert(gradeNode, 'Grade node must be spawned');

  // Verify position below selected node
  assert.equal(gradeNode.x, readNode.x, 'Downstream node X should align with upstream node');
  assert.equal(gradeNode.y, readNode.y + readNode.height + 40, 'Downstream node Y should be spaced below upstream node');

  // Verify automatic wire connection Read1:out -> Grade1:in
  const gradeInPort = gradeNode.inputs.find(inp => inp.id === 'in');
  assert(gradeInPort, 'Grade node must have "in" port');
  assert(gradeInPort.connection, 'Grade "in" port must be connected');
  assert.equal(gradeInPort.connection.nodeId, readNode.id, 'Connection should come from Read1');
  assert.equal(gradeInPort.connection.outputPortId, 'out', 'Connection should come from port "out"');

  // 3. Grade is now selected. Spawn Merge node
  assert(app.nodeGraphUI.selectedNodes.has(gradeNode.id), 'Grade should be currently selected');
  const mergeNode = app.spawnNodeFromSearch('Merge');
  assert(mergeNode, 'Merge node must be spawned');

  // In Nuke, Merge primary input is 'B'
  const mergeBPort = mergeNode.inputs.find(inp => inp.id === 'B');
  assert(mergeBPort, 'Merge node must have "B" port');
  assert(mergeBPort.connection, 'Merge "B" port must be auto-connected');
  assert.equal(mergeBPort.connection.nodeId, gradeNode.id, 'Connection should come from Grade');

  // 4. Test Generator Node Safety: Spawn Constant while Merge is selected
  // Generators (Constant, Ramp, Read) have 0 inputs and must never receive auto-connections
  const constNode = app.spawnNodeFromSearch('Constant');
  assert(constNode, 'Constant node must be spawned');
  assert.equal(constNode.inputs.length, 0, 'Constant node has no inputs');

  // 5. Test Multi-Selection Ambiguity: When multiple nodes are selected, DO NOT auto-connect
  app.nodeGraphUI.selectedNodes.clear();
  app.nodeGraphUI.selectedNodes.add(readNode.id);
  app.nodeGraphUI.selectedNodes.add(gradeNode.id);

  const blurNode = app.spawnNodeFromSearch('Blur');
  assert(blurNode, 'Blur node must be spawned');
  const blurInPort = blurNode.inputs.find(inp => inp.id === 'in');
  assert.equal(blurInPort.connection, null, 'Multi-selection must not create ambiguous auto-connections');
});

// -------------------------------------------------------------
// Test Case 13: Focus isolation: No popup when Tab is pressed in property inputs
// -------------------------------------------------------------
runTest('Focus Isolation: Tab in property input fields does NOT open popup or prevent default', () => {
  searchPopup.style.display = 'none';

  // Simulate artist actively editing Gain property in Properties Bin
  propInput.focus();
  assert.equal(document.activeElement, propInput);

  const propTabEvent = new MockEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  propTabEvent.target = propInput;
  window.dispatchEvent(propTabEvent);

  assert.equal(propTabEvent.defaultPrevented, false, 'Tab key in property inputs must NOT be prevented');
  assert.equal(searchPopup.style.display, 'none', 'Search popup must NOT open when editing property knobs');
});

console.log('\n====================================================');
console.log(`🎉 test_tab_search.mjs PASSED: All ${passedTests} test cases succeeded!`);
console.log('====================================================');
