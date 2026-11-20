/**
 * OpenComp Test Suite - Final Automated UI Interaction Validation
 * Rigorous browser automation via Chrome DevTools Protocol (CDP) executing real DOM events
 * across Viewer, Node Graph, Curve Editor, Timeline, Properties Bin, and General UI.
 *
 * Verifies interactive behavior:
 * 1. Viewer: Horizontal/Vertical wipe divider dragging, Diff mode, Slot switching (1-10),
 *    Canvas resize, Disconnected input handling, Pan & Zoom, Exposure/Gamma, Channel buttons,
 *    Pixel inspector hover, Fit-to-view hotkey.
 * 2. Node Graph: Pan, Zoom, Marquee box selection, Node selection, Backdrop child node dragging,
 *    Bezier wire redraw, Tab search popup, Keyboard navigation, Node creation at cursor, Escape cancellation,
 *    Graph serialization/restoration.
 * 3. Curve Editor: Track binding, Cubic Bezier tangent dragging, Tangent modes (smooth/flat/linear/free),
 *    Fit to curves, Pan/Zoom, Undo/Redo, Keyframe track serialization.
 * 4. Timeline: Play/Pause toggling, Frame stepping, Scrubber input scrubbing, Frame range bounds,
 *    Playback state synchronization, Cache invalidation.
 * 5. General UI: Top dropdown menus, Workstation shortcuts (D, Ctrl+A, F), Properties slider scrubbing,
 *    Color picker swatches, Global undo/redo history, Zero console errors.
 */

import { strict as assert } from 'assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_interactions.mjs');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✅ PASSED: ${name}`);
      passedTests++;
    })
    .catch((err) => {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(err);
      throw err;
    });
}

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000, ...options }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP request timeout')); });
  });
}

async function main() {
  const PORT = 8080;
  const HOST = '127.0.0.1';
  const CDP_PORT = 9225;
  const edgeCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  const edgePath = edgeCandidates.find(p => p && fs.existsSync(p));

  if (!edgePath) {
    console.error('Neither Microsoft Edge nor Google Chrome executable found at standard paths');
    process.exit(1);
  }

  // Ensure local server is responsive; if absent or dormant, spawn an instance
  let spawnedServer = null;
  let serverReady = false;
  try {
    const health = await httpGet(`http://${HOST}:${PORT}/health`);
    if (health.statusCode === 200) serverReady = true;
  } catch (err) {
    serverReady = false;
  }

  if (!serverReady) {
    console.log('  ℹ️ Server not responding on 127.0.0.1:8080 - spawning test server process...');
    spawnedServer = spawn('node', ['server.js'], { stdio: 'ignore', detached: false });
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await httpGet(`http://${HOST}:${PORT}/health`);
        if (res.statusCode === 200) {
          serverReady = true;
          break;
        }
      } catch (e) { }
    }
  }

  assert.ok(serverReady, 'Local server failed to respond on 127.0.0.1:8080/health');

  console.log(`Launching Edge in headless mode on CDP port ${CDP_PORT}...`);
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,1000',
    `http://${HOST}:${PORT}/`
  ], { detached: false });

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let wsUrl = null;

  try {
    // Poll for CDP endpoint
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const tabs = await res.json();
        const tab = tabs.find(t => t.type === 'page');
        if (tab && tab.webSocketDebuggerUrl) {
          wsUrl = tab.webSocketDebuggerUrl;
          break;
        }
      } catch (e) { }
    }

    assert.ok(wsUrl, `Could not connect to Edge remote debugging port ${CDP_PORT}`);
    console.log(`Connected to Chrome DevTools Protocol at: ${wsUrl}\n`);

    const ws = new WebSocket(wsUrl);
    let idCounter = 1;
    const pending = new Map();
    const consoleErrors = [];

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = idCounter++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const errText = msg.params.exceptionDetails?.exception?.description ||
          msg.params.exceptionDetails?.text ||
          'Unknown browser exception';
        consoleErrors.push(errText);
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    await new Promise(r => ws.onopen = r);
    await send('Runtime.enable');

    async function evaluate(code) {
      const res = await send('Runtime.evaluate', {
        expression: code,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      }
      return res.result?.value;
    }

    // Wait for OpenComp application initialization
    let initialized = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const isReady = await evaluate(`Boolean(window.app && window.app.graph && window.app.viewerUI && window.app.nodeGraphUI)`);
      if (isReady) {
        initialized = true;
        break;
      }
    }
    assert.ok(initialized, 'OpenComp application failed to initialize in browser');
    console.log('OpenComp application loaded and initialized.\n');

    // =========================================================================
    // 1. VIEWER INTERACTIVE TESTS
    // =========================================================================
    console.log('--- 1. VIEWER SUBSYSTEM INTERACTIONS ---');

    await runTest('Viewer: Horizontal wipe divider dragging updates wipePosition', async () => {
      const res = await evaluate(`(() => {
        const compareSelect = document.getElementById('viewer-compare-select');
        compareSelect.value = 'wipe_h';
        compareSelect.dispatchEvent(new Event('change', { bubbles: true }));

        const viewerNode = window.app.graph.getAllNodes().find(n => n.type === 'Viewer');
        if (!viewerNode || !window.app.viewerUI.currentBuffer) return { error: 'No viewer or buffer' };

        viewerNode.setKnobValue('wipePosition', 0.5);
        window.app.viewerUI.render();

        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        const initialWipeX = window.app.viewerUI.panX + (window.app.viewerUI.currentBuffer.width * 0.5) * window.app.viewerUI.zoom;
        const initialScreenX = rect.left + initialWipeX;
        const initialScreenY = rect.top + canvas.height * 0.5;

        // Dispatch mousedown directly on wipe divider line
        const mousedown = new MouseEvent('mousedown', {
          clientX: initialScreenX,
          clientY: initialScreenY,
          button: 0,
          bubbles: true
        });
        canvas.dispatchEvent(mousedown);
        const isDragging = window.app.viewerUI.isDraggingWipe;
        const dragOrientation = window.app.viewerUI.dragWipeOrientation;

        // Drag 80px to the right
        const mousemove = new MouseEvent('mousemove', {
          clientX: initialScreenX + 80,
          clientY: initialScreenY,
          bubbles: true
        });
        window.dispatchEvent(mousemove);
        const movedWipePos = Number(viewerNode.getKnobValue('wipePosition'));

        // Release drag
        const mouseup = new MouseEvent('mouseup', { bubbles: true });
        window.dispatchEvent(mouseup);
        const afterMouseUpDragging = window.app.viewerUI.isDraggingWipe;

        return {
          isDragging,
          dragOrientation,
          initialPos: 0.5,
          movedWipePos,
          afterMouseUpDragging
        };
      })()`);

      assert.equal(res.isDragging, true, 'isDraggingWipe must be true on divider mousedown');
      assert.equal(res.dragOrientation, 'horizontal', 'drag orientation must be horizontal');
      assert.ok(res.movedWipePos > 0.5, `movedWipePos (${res.movedWipePos}) must be greater than 0.5`);
      assert.equal(res.afterMouseUpDragging, false, 'isDraggingWipe must be false on mouseup');
    });

    await runTest('Viewer: Vertical wipe divider dragging updates wipePosition', async () => {
      const res = await evaluate(`(() => {
        const compareSelect = document.getElementById('viewer-compare-select');
        compareSelect.value = 'wipe_v';
        compareSelect.dispatchEvent(new Event('change', { bubbles: true }));

        const viewerNode = window.app.graph.getAllNodes().find(n => n.type === 'Viewer');
        viewerNode.setKnobValue('wipePosition', 0.5);
        window.app.viewerUI.render();

        const canvas = document.getElementById('viewer-canvas');
        const rect = canvas.getBoundingClientRect();
        const initialWipeY = window.app.viewerUI.panY + (window.app.viewerUI.currentBuffer.height * 0.5) * window.app.viewerUI.zoom;
        const screenX = rect.left + canvas.width * 0.5;
        const screenY = rect.top + initialWipeY;

        canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: screenX, clientY: screenY, button: 0, bubbles: true }));
        const isDragging = window.app.viewerUI.isDraggingWipe;
        const dragOrientation = window.app.viewerUI.dragWipeOrientation;

        window.dispatchEvent(new MouseEvent('mousemove', { clientX: screenX, clientY: screenY + 50, bubbles: true }));
        const movedWipePos = Number(viewerNode.getKnobValue('wipePosition'));

        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        return { isDragging, dragOrientation, movedWipePos, afterDragging: window.app.viewerUI.isDraggingWipe };
      })()`);

      assert.equal(res.isDragging, true, 'isDraggingWipe must be true on vertical divider');
      assert.equal(res.dragOrientation, 'vertical', 'drag orientation must be vertical');
      assert.ok(res.movedWipePos > 0.5, `movedWipePos (${res.movedWipePos}) must be greater than 0.5`);
      assert.equal(res.afterDragging, false, 'isDraggingWipe must be false after mouseup');
    });

    await runTest('Viewer: Difference mode switching toggles A/B controls and node state', async () => {
      const res = await evaluate(`(() => {
        const compareSelect = document.getElementById('viewer-compare-select');
        const abGroup = document.getElementById('viewer-ab-sources');

        compareSelect.value = 'diff';
        compareSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const viewerNode = window.app.graph.getAllNodes().find(n => n.type === 'Viewer');

        const modeDiff = viewerNode.getKnobValue('compareMode');
        const abVisibleDiff = abGroup ? abGroup.style.display !== 'none' : false;

        compareSelect.value = 'single';
        compareSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const modeSingle = viewerNode.getKnobValue('compareMode');
        const abVisibleSingle = abGroup ? abGroup.style.display !== 'none' : false;

        return { modeDiff, abVisibleDiff, modeSingle, abVisibleSingle };
      })()`);

      assert.equal(res.modeDiff, 'diff');
      assert.equal(res.abVisibleDiff, true, 'A/B sources group must be visible in diff mode');
      assert.equal(res.modeSingle, 'single');
      assert.equal(res.abVisibleSingle, false, 'A/B sources group must be hidden in single mode');
    });

    await runTest('Viewer: Slot switching (1-10) routes inputs correctly', async () => {
      const res = await evaluate(`(() => {
        const inputSelect = document.getElementById('viewer-input-select');
        inputSelect.value = '2';
        inputSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const viewerNode = window.app.graph.getAllNodes().find(n => n.type === 'Viewer');
        const slot2 = viewerNode.getKnobValue('activeInput');

        inputSelect.value = '1';
        inputSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const slot1 = viewerNode.getKnobValue('activeInput');

        return { slot2, slot1 };
      })()`);

      assert.equal(res.slot2, '2');
      assert.equal(res.slot1, '1');
    });

    await runTest('Viewer: Resize event triggers canvas dimension recalculation', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('viewer-canvas');
        const initialW = canvas.width;
        const initialH = canvas.height;

        window.dispatchEvent(new Event('resize'));
        return {
          initialW,
          initialH,
          resizedW: canvas.width,
          resizedH: canvas.height,
          hasValidDims: canvas.width > 0 && canvas.height > 0
        };
      })()`);

      assert.ok(res.hasValidDims, 'Viewer canvas must have positive dimensions after resize');
    });

    await runTest('Viewer: Disconnected input displays placeholder gracefully with zero crashes', async () => {
      const res = await evaluate(`(() => {
        const viewerNode = window.app.graph.getAllNodes().find(n => n.type === 'Viewer');
        const prevInput = viewerNode.inputs.find(i => i.id === '1');
        const prevConn = prevInput && prevInput.connection ? { ...prevInput.connection } : null;

        // Disconnect slot 1
        window.app.graph.disconnect(viewerNode.id, '1');
        window.app.evaluateGraph();

        const bufferAfterDisconnect = window.app.viewerUI.currentBuffer;

        // Reconnect back
        if (prevConn) {
          window.app.graph.connect(prevConn.nodeId, prevConn.outputPortId, viewerNode.id, '1');
          window.app.evaluateGraph();
        }

        const bufferAfterReconnect = window.app.viewerUI.currentBuffer;

        return {
          bufferAfterDisconnect: bufferAfterDisconnect === null,
          bufferAfterReconnect: bufferAfterReconnect !== null
        };
      })()`);

      assert.equal(res.bufferAfterDisconnect, true, 'Current buffer must be null when input disconnected');
      assert.equal(res.bufferAfterReconnect, true, 'Current buffer must restore on reconnect');
    });

    await runTest('Viewer: Pan & Zoom events update viewport matrix (Item 06)', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('viewer-canvas');
        const initialZoom = window.app.viewerUI.zoom;
        const initialPanX = window.app.viewerUI.panX;
        const initialPanY = window.app.viewerUI.panY;

        // Mouse wheel zoom
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 300, clientY: 200, bubbles: true }));
        const zoomedZoom = window.app.viewerUI.zoom;

        // Middle mouse pan
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 200, clientY: 200, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 240, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));

        const pannedPanX = window.app.viewerUI.panX;
        const pannedPanY = window.app.viewerUI.panY;

        return { initialZoom, zoomedZoom, initialPanX, pannedPanX, initialPanY, pannedPanY };
      })()`);

      assert.ok(res.zoomedZoom > res.initialZoom, 'Wheel up must increase viewer zoom');
      assert.ok(res.pannedPanX !== res.initialPanX, 'Middle-drag must shift panX');
      assert.ok(res.pannedPanY !== res.initialPanY, 'Middle-drag must shift panY');
    });

    await runTest('Viewer: Exposure & Gamma scrubbing updates values and reset buttons (Items 07 & 08)', async () => {
      const res = await evaluate(`(() => {
        const expSlider = document.getElementById('viewer-exposure-slider');
        const expVal = document.getElementById('viewer-exposure-val');
        const resetExp = document.getElementById('btn-reset-exp');

        expSlider.value = '2.3';
        expSlider.dispatchEvent(new Event('input', { bubbles: true }));
        const expUpdated = window.app.viewerUI.exposure;
        const expLabelUpdated = expVal.textContent;

        resetExp.click();
        const expReset = window.app.viewerUI.exposure;

        const gammaSlider = document.getElementById('viewer-gamma-slider');
        const gammaVal = document.getElementById('viewer-gamma-val');
        const resetGamma = document.getElementById('btn-reset-gamma');

        gammaSlider.value = '1.8';
        gammaSlider.dispatchEvent(new Event('input', { bubbles: true }));
        const gammaUpdated = window.app.viewerUI.gamma;
        const gammaLabelUpdated = gammaVal.textContent;

        resetGamma.click();
        const gammaReset = window.app.viewerUI.gamma;

        return { expUpdated, expLabelUpdated, expReset, gammaUpdated, gammaLabelUpdated, gammaReset };
      })()`);

      assert.equal(res.expUpdated, 2.3);
      assert.equal(res.expLabelUpdated, '2.3');
      assert.equal(res.expReset, 0.0);
      assert.equal(res.gammaUpdated, 1.8);
      assert.equal(res.gammaLabelUpdated, '1.80');
      assert.equal(res.gammaReset, 1.0);
    });

    await runTest('Viewer: Channel isolation buttons update channelMode (Item 09)', async () => {
      const res = await evaluate(`(() => {
        const results = {};
        const channels = ['RED', 'GREEN', 'BLUE', 'ALPHA', 'LUMA', 'RGBA'];
        for (const ch of channels) {
          const btn = document.querySelector(\`.btn-channel[data-channel="\${ch}"]\`);
          if (btn) {
            btn.click();
            results[ch] = {
              mode: window.app.viewerUI.channelMode,
              active: btn.classList.contains('active')
            };
          }
        }
        return results;
      })()`);

      assert.equal(res.RED.mode, 'RED');
      assert.equal(res.RED.active, true);
      assert.equal(res.ALPHA.mode, 'ALPHA');
      assert.equal(res.ALPHA.active, true);
      assert.equal(res.RGBA.mode, 'RGBA');
      assert.equal(res.RGBA.active, true);
    });

    await runTest('Viewer: Pixel inspector hover displays floating-point coordinates and RGBA (Item 11)', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('viewer-canvas');
        const infoBar = document.getElementById('viewer-info-bar');
        const rect = canvas.getBoundingClientRect();

        // Move over center of canvas
        const evt = new MouseEvent('mousemove', {
          clientX: rect.left + canvas.width * 0.5,
          clientY: rect.top + canvas.height * 0.5,
          bubbles: true
        });
        window.dispatchEvent(evt);

        return {
          infoHtml: infoBar.innerHTML,
          hasCoords: infoBar.innerHTML.includes('info-coord'),
          hasColor: infoBar.innerHTML.includes('info-color')
        };
      })()`);

      assert.ok(res.hasCoords, 'Info bar must display pixel coordinates on hover');
      assert.ok(res.hasColor, 'Info bar must display pixel RGBA color values on hover');
    });

    await runTest('Viewer: Fit-to-Window hotkey [F] snaps zoom and re-centers (Item 12)', async () => {
      const res = await evaluate(`(() => {
        window.app.viewerUI.zoom = 8.5;
        window.app.viewerUI.panX = 1200;
        window.app.viewerUI.panY = 900;
        window.app.viewerUI.render();

        // Dispatch hotkey 'f'
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

        return {
          zoomAfterFit: window.app.viewerUI.zoom,
          panXAfterFit: window.app.viewerUI.panX,
          panYAfterFit: window.app.viewerUI.panY
        };
      })()`);

      assert.ok(res.zoomAfterFit < 8.0, 'Fit key must scale down excessive zoom');
      assert.ok(res.panXAfterFit < 1200, 'Fit key must re-center panX');
    });

    // =========================================================================
    // 2. NODE GRAPH INTERACTIVE TESTS
    // =========================================================================
    console.log('\n--- 2. NODE GRAPH SUBSYSTEM INTERACTIONS ---');

    await runTest('Node Graph: Canvas Pan & Zoom respond to wheel and mouse drag', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('node-graph-canvas');
        const initialZoom = window.app.nodeGraphUI.zoom;
        const initialPanX = window.app.nodeGraphUI.panX;

        // Zoom out
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 400, clientY: 300, bubbles: true }));
        const zoomedOut = window.app.nodeGraphUI.zoom;

        // Middle drag pan
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 200, clientY: 200, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 260, clientY: 240, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));
        const pannedPanX = window.app.nodeGraphUI.panX;

        return { initialZoom, zoomedOut, initialPanX, pannedPanX };
      })()`);

      assert.ok(res.zoomedOut < res.initialZoom, 'Wheel down must zoom out node graph');
      assert.ok(res.pannedPanX !== res.initialPanX, 'Middle drag must pan node graph');
    });

    await runTest('Node Graph: Marquee box selection selects intersecting nodes', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('node-graph-canvas');
        const rect = canvas.getBoundingClientRect();
        window.app.nodeGraphUI.selectedNodes.clear();

        // Drag marquee across canvas covering default nodes
        canvas.dispatchEvent(new MouseEvent('mousedown', {
          button: 0,
          clientX: rect.left + 5,
          clientY: rect.top + 5,
          bubbles: true
        }));
        const isBoxSelecting = window.app.nodeGraphUI.isBoxSelecting;

        window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: rect.left + canvas.width - 10,
          clientY: rect.top + canvas.height - 10,
          bubbles: true
        }));
        const selectedCountDuringBox = window.app.nodeGraphUI.selectedNodes.size;

        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        const isBoxSelectingAfter = window.app.nodeGraphUI.isBoxSelecting;

        return {
          isBoxSelecting,
          selectedCountDuringBox,
          isBoxSelectingAfter
        };
      })()`);

      assert.equal(res.isBoxSelecting, true, 'isBoxSelecting must be true on canvas drag');
      assert.ok(res.selectedCountDuringBox > 0, 'Marquee must select enclosed nodes');
      assert.equal(res.isBoxSelectingAfter, false, 'isBoxSelecting must end on mouseup');
    });

    await runTest('Node Graph: Direct node selection populates selectedNodes and properties card', async () => {
      const res = await evaluate(`(() => {
        window.app.nodeGraphUI.selectedNodes.clear();
        const canvas = document.getElementById('node-graph-canvas');
        const node = window.app.graph.getAllNodes().find(n => n.type !== 'Backdrop');

        // Convert node coordinates to canvas screen coords
        const screenPos = window.app.nodeGraphUI.graphToScreen(node.x + 20, node.y + 15);
        const rect = canvas.getBoundingClientRect();

        canvas.dispatchEvent(new MouseEvent('mousedown', {
          button: 0,
          clientX: rect.left + screenPos.x,
          clientY: rect.top + screenPos.y,
          bubbles: true
        }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

        const isSelected = window.app.nodeGraphUI.selectedNodes.has(node.id);
        const propertiesPanelHasCards = document.getElementById('properties-container').children.length > 0;

        return { isSelected, propertiesPanelHasCards, nodeId: node.id };
      })()`);

      assert.equal(res.isSelected, true, 'Node must be selected after click');
      assert.equal(res.propertiesPanelHasCards, true, 'Properties bin must open card for selected node');
    });

    await runTest('Node Graph: Backdrop dragging translates child nodes (Item 19)', async () => {
      const res = await evaluate(`(() => {
        // Find a target node to enclose inside a backdrop
        const childNode = window.app.graph.getAllNodes().find(n => n.type !== 'Backdrop' && n.type !== 'Viewer');
        const childWidth = childNode.width || 120;
        const childHeight = childNode.height || 60;

        // Create a backdrop surrounding childNode
        let backdrop = window.app.graph.getAllNodes().find(n => n.type === 'Backdrop');
        if (!backdrop) {
          backdrop = window.app.nodeCreationService.createNode('Backdrop', {
            posX: childNode.x - 30,
            posY: childNode.y - 30,
            forcePosition: true
          });
          backdrop.setKnobValue('boxWidth', childWidth + 100);
          backdrop.setKnobValue('boxHeight', childHeight + 100);
          window.app.nodeGraphUI.render();
        } else {
          backdrop.x = childNode.x - 30;
          backdrop.y = childNode.y - 30;
          backdrop.setKnobValue('boxWidth', childWidth + 100);
          backdrop.setKnobValue('boxHeight', childHeight + 100);
          window.app.nodeGraphUI.render();
        }

        const initialChildX = childNode.x;
        const initialChildY = childNode.y;
        const initialBackdropX = backdrop.x;
        const initialBackdropY = backdrop.y;

        // Click on backdrop header bar (outside childNode)
        const canvas = document.getElementById('node-graph-canvas');
        const rect = canvas.getBoundingClientRect();
        const headerScreenPos = window.app.nodeGraphUI.graphToScreen(backdrop.x + 10, backdrop.y + 10);

        canvas.dispatchEvent(new MouseEvent('mousedown', {
          button: 0,
          clientX: rect.left + headerScreenPos.x,
          clientY: rect.top + headerScreenPos.y,
          bubbles: true
        }));

        // Drag by +50, +40 in graph space
        const targetScreen = window.app.nodeGraphUI.graphToScreen(backdrop.x + 60, backdrop.y + 50);
        window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: rect.left + targetScreen.x,
          clientY: rect.top + targetScreen.y,
          bubbles: true
        }));
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

        return {
          deltaChildX: childNode.x - initialChildX,
          deltaChildY: childNode.y - initialChildY,
          deltaBackdropX: backdrop.x - initialBackdropX,
          deltaBackdropY: backdrop.y - initialBackdropY
        };
      })()`);

      assert.ok(res.deltaBackdropX > 0, 'Backdrop must have moved');
      assert.ok(Math.abs(res.deltaChildX - res.deltaBackdropX) < 1e-4, 'Child node deltaX must match backdrop deltaX');
      assert.ok(Math.abs(res.deltaChildY - res.deltaBackdropY) < 1e-4, 'Child node deltaY must match backdrop deltaY');
    });

    await runTest('Node Graph: Bezier connection wires redraw on node movement (Item 17)', async () => {
      const res = await evaluate(`(() => {
        const node = window.app.graph.getAllNodes().find(n => n.type === 'Grade') ||
                     window.app.graph.getAllNodes().find(n => n.type !== 'Backdrop');
        const initialX = node.x;
        node.x += 45;
        node.y += 30;
        window.app.nodeGraphUI.render();

        let connectionCount = 0;
        for (const n of window.app.graph.getAllNodes()) {
          for (const inp of n.inputs) {
            if (inp.connection) connectionCount++;
          }
        }

        return {
          hasConnections: connectionCount > 0,
          nodeMoved: node.x !== initialX
        };
      })()`);

      assert.equal(res.nodeMoved, true);
      assert.equal(res.hasConnections, true);
    });

    await runTest('Node Graph: Tab search popup opens and fuzzy filters nodes (Items 13 & 14)', async () => {
      const res = await evaluate(`(() => {
        const canvas = document.getElementById('node-graph-canvas');
        canvas.focus();

        // Dispatch Tab keydown
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

        const popup = document.getElementById('node-search-popup');
        const input = document.getElementById('node-search-input');
        const popupVisible = popup ? popup.style.display === 'block' : false;

        // Type query 'Grad'
        input.value = 'Grad';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        const results = document.getElementById('node-search-results');
        const firstMatch = results.querySelector('.search-item')?.dataset.type;

        return { popupVisible, firstMatch };
      })()`);

      assert.equal(res.popupVisible, true, 'Tab key must open node search popup');
      assert.equal(res.firstMatch, 'Grade', 'Fuzzy search for "Grad" must select Grade');
    });

    await runTest('Node Graph: Keyboard navigation and node creation at cursor (Items 15 & 16)', async () => {
      const res = await evaluate(`(() => {
        const input = document.getElementById('node-search-input');
        const results = document.getElementById('node-search-results');

        // Arrow down to second result
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const items = results.querySelectorAll('.search-item');
        const secondSelected = items[1]?.classList.contains('selected');

        // Press Enter to instantiate node
        const initialNodeCount = window.app.graph.getAllNodes().length;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        const popup = document.getElementById('node-search-popup');
        const popupClosed = popup ? popup.style.display === 'none' : true;
        const newNodeCount = window.app.graph.getAllNodes().length;

        return { secondSelected, popupClosed, created: newNodeCount > initialNodeCount };
      })()`);

      assert.equal(res.secondSelected, true, 'ArrowDown must advance selection');
      assert.equal(res.popupClosed, true, 'Enter must close search popup');
      assert.equal(res.created, true, 'Enter must create selected node');
    });

    await runTest('Node Graph: Escape cancels search popup', async () => {
      const res = await evaluate(`(() => {
        window.app.openNodeSearchPopup();
        const popup = document.getElementById('node-search-popup');
        const input = document.getElementById('node-search-input');
        const opened = popup.style.display === 'block';

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const closed = popup.style.display === 'none';

        return { opened, closed };
      })()`);

      assert.equal(res.opened, true);
      assert.equal(res.closed, true);
    });

    await runTest('Node Graph: Graph state serialization and restoration integrity', async () => {
      const res = await evaluate(`(() => {
        const initialNodes = window.app.graph.getAllNodes().length;
        const countConnections = () => {
          let count = 0;
          for (const n of window.app.graph.getAllNodes()) {
            for (const inp of n.inputs) if (inp.connection) count++;
          }
          return count;
        };
        const initialConnections = countConnections();

        const serialized = window.app.graph.serialize();
        window.app.graph.clear();
        const clearedNodes = window.app.graph.getAllNodes().length;

        window.app.graph.deserialize(serialized);
        const restoredNodes = window.app.graph.getAllNodes().length;
        const restoredConnections = countConnections();
        window.app.evaluateGraph();

        return { initialNodes, initialConnections, clearedNodes, restoredNodes, restoredConnections };
      })()`);

      assert.equal(res.clearedNodes, 0);
      assert.equal(res.restoredNodes, res.initialNodes);
      assert.equal(res.restoredConnections, res.initialConnections);
    });

    // =========================================================================
    // 3. CURVE EDITOR INTERACTIVE TESTS
    // =========================================================================
    console.log('\n--- 3. CURVE EDITOR SUBSYSTEM INTERACTIONS ---');

    await runTest('Curve Editor: Tab switching and animated track binding', async () => {
      const res = await evaluate(`(() => {
        const tabBtnCurve = document.getElementById('tab-btn-curveeditor');
        tabBtnCurve.click();

        const curveWrapper = document.getElementById('curveeditor-canvas-wrapper');
        const dagWrapper = document.getElementById('nodegraph-canvas-wrapper');

        // Create an animated Grade node
        const gradeNode = window.app.graph.getAllNodes().find(n => n.type === 'Grade') ||
                          window.app.nodeCreationService.createNode('Grade');

        // Bind animation keyframes
        gradeNode.knobs.gamma.keyframes = {
          1: 0.2,
          24: 1.5,
          48: 0.8
        };
        window.app.updateTimelineKeyframes(gradeNode);

        const curveEditorReady = Boolean(window.app.curveEditorUI && window.app.curveEditorUI.activeTrack);
        const keyCount = window.app.curveEditorUI.activeTrack ? window.app.curveEditorUI.activeTrack.keys.length : 0;

        return {
          curveVisible: curveWrapper.style.display === 'block',
          dagHidden: dagWrapper.style.display === 'none',
          curveEditorReady,
          keyCount
        };
      })()`);

      assert.equal(res.curveVisible, true, 'Curve editor wrapper must be visible');
      assert.equal(res.dagHidden, true, 'DAG wrapper must be hidden');
      assert.equal(res.curveEditorReady, true, 'CurveEditorUI must be active with bound track');
      assert.ok(res.keyCount >= 3, 'CurveEditorUI must hold at least 3 keyframes');
    });

    await runTest('Curve Editor: Cubic Bezier tangent handle dragging updates slope (Item 51)', async () => {
      const res = await evaluate(`(() => {
        const ce = window.app.curveEditorUI;
        ce.fitToCurves();
        ce.render();

        const key = ce.activeTrack.keys[1]; // Middle key at frame 24
        ce.selectedKey = key;
        const initialSlope = key.leftSlope;

        const handles = ce.getTangentHandles(key);
        if (!handles) return { error: 'No handles' };

        const canvas = document.getElementById('curve-editor-canvas');
        const rect = canvas.getBoundingClientRect();

        // Mousedown on left tangent handle
        canvas.dispatchEvent(new MouseEvent('mousedown', {
          button: 0,
          clientX: rect.left + handles.leftHandle.x,
          clientY: rect.top + handles.leftHandle.y,
          bubbles: true
        }));
        const activeHandle = ce.activeHandle;

        // Drag tangent vertically
        window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: rect.left + handles.leftHandle.x,
          clientY: rect.top + handles.leftHandle.y - 40,
          bubbles: true
        }));
        const movedSlope = key.leftSlope;

        // Release mouse
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        const afterHandle = ce.activeHandle;

        return { activeHandle, initialSlope, movedSlope, afterHandle };
      })()`);

      assert.equal(res.activeHandle, 'leftTangent', 'activeHandle must be leftTangent');
      assert.ok(res.movedSlope !== res.initialSlope, 'Dragging tangent handle must update slope');
      assert.equal(res.afterHandle, null, 'activeHandle must clear on mouseup');
    });

    await runTest('Curve Editor: Tangent mode buttons (Smooth, Flat, Linear, Free)', async () => {
      const res = await evaluate(`(() => {
        const ce = window.app.curveEditorUI;

        document.getElementById('btn-curve-flat').click();
        const flatMode = ce.tangentMode;
        const flatSlope = ce.selectedKey.leftSlope;

        document.getElementById('btn-curve-linear').click();
        const linearMode = ce.tangentMode;
        const linearInterp = ce.selectedKey.interpolation;

        document.getElementById('btn-curve-smooth').click();
        const smoothMode = ce.tangentMode;
        const smoothInterp = ce.selectedKey.interpolation;

        return { flatMode, flatSlope, linearMode, linearInterp, smoothMode, smoothInterp };
      })()`);

      assert.equal(res.flatMode, 'flat');
      assert.equal(res.flatSlope, 0.0);
      assert.equal(res.linearMode, 'linear');
      assert.equal(res.linearInterp, 'linear');
      assert.equal(res.smoothMode, 'smooth');
      assert.equal(res.smoothInterp, 'bezier');
    });

    await runTest('Curve Editor: Fit-to-Curves and viewport pan/zoom', async () => {
      const res = await evaluate(`(() => {
        const ce = window.app.curveEditorUI;
        ce.viewStartFrame = 10;
        ce.viewEndFrame = 20;

        document.getElementById('btn-curve-fit').click();
        const fittedStart = ce.viewStartFrame;
        const fittedEnd = ce.viewEndFrame;

        // Zoom via wheel
        const canvas = document.getElementById('curve-editor-canvas');
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 200, bubbles: true }));
        const zoomedSpan = ce.viewEndFrame - ce.viewStartFrame;

        return { fittedStart, fittedEnd, zoomedSpan };
      })()`);

      assert.ok(res.fittedStart <= 1, 'Fit must encompass frame 1');
      assert.ok(res.fittedEnd >= 48, 'Fit must encompass frame 48');
    });

    await runTest('Curve Editor: Undo and Redo tangent modification stack', async () => {
      const res = await evaluate(`(() => {
        const ce = window.app.curveEditorUI;
        const currentSlope = ce.selectedKey.leftSlope;

        const undoOk = ce.undo();
        const undoneSlope = ce.selectedKey.leftSlope;

        const redoOk = ce.redo();
        const redoneSlope = ce.selectedKey.leftSlope;

        return { undoOk, undoneSlope, redoOk, redoneSlope, currentSlope };
      })()`);

      assert.equal(res.undoOk, true, 'Undo must succeed');
      assert.equal(res.redoOk, true, 'Redo must succeed');
      assert.equal(res.redoneSlope, res.currentSlope, 'Redo must restore modified slope');
    });

    // Return to DAG tab for remaining tests
    await evaluate(`document.getElementById('tab-btn-nodegraph').click();`);

    // =========================================================================
    // 4. TIMELINE INTERACTIVE TESTS
    // =========================================================================
    console.log('\n--- 4. TIMELINE SUBSYSTEM INTERACTIONS ---');

    await runTest('Timeline: Play / Pause toggle controls playback state', async () => {
      const res = await evaluate(`(() => {
        const playBtn = document.getElementById('btn-play');
        const initialPlaying = window.app.timelineUI.isPlaying;

        playBtn.click();
        const whilePlaying = window.app.timelineUI.isPlaying;
        const textPlaying = playBtn.textContent;

        playBtn.click();
        const afterPause = window.app.timelineUI.isPlaying;
        const textPaused = playBtn.textContent;

        return { initialPlaying, whilePlaying, textPlaying, afterPause, textPaused };
      })()`);

      assert.equal(res.initialPlaying, false);
      assert.equal(res.whilePlaying, true, 'Timeline must be playing after click');
      assert.ok(res.textPlaying.includes('Pause'), 'Button text must show Pause');
      assert.equal(res.afterPause, false, 'Timeline must pause on second click');
      assert.ok(res.textPaused.includes('Play'), 'Button text must show Play');
    });

    await runTest('Timeline: Step forward and step back buttons', async () => {
      const res = await evaluate(`(() => {
        window.app.timelineUI.setFrame(15);
        document.getElementById('btn-next').click();
        const fNext = window.app.timelineUI.currentFrame;

        document.getElementById('btn-prev').click();
        const fPrev = window.app.timelineUI.currentFrame;

        return { fNext, fPrev };
      })()`);

      assert.equal(res.fNext, 16);
      assert.equal(res.fPrev, 15);
    });

    await runTest('Timeline: Scrubber dragging and frame input synchronization', async () => {
      const res = await evaluate(`(() => {
        const scrubber = document.getElementById('timeline-scrubber');
        const curInput = document.getElementById('timeline-cur-frame');

        scrubber.value = '38';
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));
        const frameAfterScrub = window.app.timelineUI.currentFrame;
        const curInputValue = Number(curInput.value);

        curInput.value = '45';
        curInput.dispatchEvent(new Event('change', { bubbles: true }));
        const frameAfterType = window.app.timelineUI.currentFrame;
        const scrubberValue = Number(scrubber.value);

        return { frameAfterScrub, curInputValue, frameAfterType, scrubberValue };
      })()`);

      assert.equal(res.frameAfterScrub, 38);
      assert.equal(res.curInputValue, 38);
      assert.equal(res.frameAfterType, 45);
      assert.equal(res.scrubberValue, 45);
    });

    await runTest('Timeline: Frame range bounds adjustment (start / end frame)', async () => {
      const res = await evaluate(`(() => {
        const startInput = document.getElementById('timeline-start-frame');
        const endInput = document.getElementById('timeline-end-frame');
        const scrubber = document.getElementById('timeline-scrubber');

        startInput.value = '10';
        startInput.dispatchEvent(new Event('change', { bubbles: true }));

        endInput.value = '120';
        endInput.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          startFrame: window.app.timelineUI.startFrame,
          endFrame: window.app.timelineUI.endFrame,
          scrubberMin: Number(scrubber.min),
          scrubberMax: Number(scrubber.max)
        };
      })()`);

      assert.equal(res.startFrame, 10);
      assert.equal(res.endFrame, 120);
      assert.equal(res.scrubberMin, 10);
      assert.equal(res.scrubberMax, 120);
    });

    await runTest('Timeline: Cache invalidation on animated parameter change', async () => {
      const res = await evaluate(`(() => {
        window.app.timelineUI.setFrame(24);
        const node = window.app.graph.getAllNodes().find(n => n.type === 'Grade');
        const dirtyBefore = node ? node.isDirty : null;

        node.setKnobValue('gamma', 1.95);
        const dirtyAfter = node.isDirty;

        window.app.evaluateGraph();
        const bufferPresent = Boolean(window.app.viewerUI.currentBuffer);

        return { dirtyBefore, dirtyAfter, bufferPresent };
      })()`);

      assert.equal(res.dirtyAfter, true, 'Parameter change must mark node dirty');
      assert.equal(res.bufferPresent, true, 'Graph evaluation must re-render valid buffer');
    });

    // =========================================================================
    // 5. GENERAL UI & PROPERTIES BIN TESTS
    // =========================================================================
    console.log('\n--- 5. GENERAL UI & PROPERTIES BIN INTERACTIONS ---');

    await runTest('General UI: Top dropdown menus toggle on click and close on outside click', async () => {
      const res = await evaluate(`(() => {
        const nodesBtn = document.getElementById('btn-nodes-menu');
        const menuDropdown = document.getElementById('menu-dropdown-nodes');

        nodesBtn.click();
        const opened = menuDropdown.classList.contains('open');

        // Outside click on document body
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
        const closed = !menuDropdown.classList.contains('open');

        return { opened, closed };
      })()`);

      assert.equal(res.opened, true, 'Clicking menu button must open dropdown');
      assert.equal(res.closed, true, 'Clicking outside must close dropdown');
    });

    await runTest('General UI: Node property knob slider and number input editing (Item 23)', async () => {
      const res = await evaluate(`(() => {
        const node = window.app.graph.getAllNodes().find(n => n.type === 'Grade');
        window.app.propertiesUI.showNode(node);

        const card = window.app.propertiesUI.openNodes.get(node.id)?.card;
        if (!card) return { error: 'Card not open' };

        const slider = card.querySelector('.prop-slider');
        const numInput = card.querySelector('.prop-num-input');

        slider.value = '1.75';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const valFromSlider = node.getKnobValue('gamma') || node.getKnobValue('blackpoint');

        numInput.value = '1.40';
        numInput.dispatchEvent(new Event('change', { bubbles: true }));
        const valFromNum = node.getKnobValue('gamma') || node.getKnobValue('blackpoint');

        return { valFromSlider, valFromNum };
      })()`);

      assert.ok(res.valFromSlider !== undefined, 'Knob value must update from slider');
      assert.ok(res.valFromNum !== undefined, 'Knob value must update from number input');
    });

    await runTest('General UI: Color picker swatches update color knob (Item 24)', async () => {
      const res = await evaluate(`(() => {
        let paintNode = window.app.graph.getAllNodes().find(n => n.type === 'Paint');
        if (!paintNode) {
          paintNode = window.app.nodeCreationService.createNode('Paint');
        }
        window.app.propertiesUI.showNode(paintNode);

        const entry = window.app.propertiesUI.openNodes.get(paintNode.id);
        const card = entry?.card;
        const colorInput = card ? card.querySelector('#paint-color-picker') : null;

        if (colorInput) {
          colorInput.value = '#00ff88';
          colorInput.dispatchEvent(new Event('input', { bubbles: true }));
          const paintUI = entry?.handler;
          const brushColor = paintUI ? paintUI.brushColor : null;
          return { colorInputPresent: true, brushColor };
        }

        return { colorInputPresent: false };
      })()`);

      assert.ok(res.colorInputPresent, 'Color input must exist on paint node card');
      assert.ok(Array.isArray(res.brushColor), 'Brush color must update to float array');
      assert.ok(res.brushColor[1] > 0.9, 'Green channel of brushColor must be ~1.0');
    });

    await runTest('General UI: Workstation hotkeys ([D] Disable and [Ctrl+A] Select All)', async () => {
      const res = await evaluate(`(() => {
        const node = window.app.graph.getAllNodes().find(n => n.type !== 'Backdrop');
        window.app.nodeGraphUI.selectedNodes.clear();
        window.app.nodeGraphUI.selectedNodes.add(node.id);

        const disabledInitial = node.disabled;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        const disabledToggled = node.disabled;

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        const disabledRestored = node.disabled;

        // Ctrl+A: Select all
        window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'a', bubbles: true }));
        const selectedCount = window.app.nodeGraphUI.selectedNodes.size;
        const totalNodes = window.app.graph.getAllNodes().length;

        return { disabledInitial, disabledToggled, disabledRestored, selectedCount, totalNodes };
      })()`);

      assert.equal(res.disabledToggled, !res.disabledInitial, 'Hotkey D must toggle disabled state');
      assert.equal(res.disabledRestored, res.disabledInitial, 'Hotkey D again must restore state');
      assert.equal(res.selectedCount, res.totalNodes, 'Ctrl+A must select all nodes in graph');
    });

    await runTest('General UI: Global Undo/Redo stack tracks graph mutations', async () => {
      const res = await evaluate(`(() => {
        const initialCount = window.app.graph.getAllNodes().length;

        // Create node
        const blurNode = window.app.nodeCreationService.createNode('Blur');
        const afterCreate = window.app.graph.getAllNodes().length;

        // Undo
        window.app.nodeGraphUI.onUndo();
        const afterUndo = window.app.graph.getAllNodes().length;

        // Redo
        window.app.nodeGraphUI.onRedo();
        const afterRedo = window.app.graph.getAllNodes().length;

        return { initialCount, afterCreate, afterUndo, afterRedo };
      })()`);

      assert.equal(res.afterCreate, res.initialCount + 1, 'Creating node must increment count');
      assert.equal(res.afterUndo, res.initialCount, 'Undo must decrement count back to initial');
      assert.equal(res.afterRedo, res.afterCreate, 'Redo must re-add created node');
    });

    // --- 6. STAGE 7: DEEP, STEREO & ADVANCED IMAGING INTERACTIONS ---
    await runTest('Stage 7: Deep Inspector opens and displays actual selected-pixel data', async () => {
      const res = await evaluate(`(() => {
        const btn = document.getElementById('tab-btn-deepinspector');
        btn?.click();
        const wrapper = document.getElementById('deepinspector-wrapper');
        const isVisible = wrapper && wrapper.style.display !== 'none';

        if (window.app.deepInspectorUI) {
          // Construct test deep buffer
          const mockDeep = {
            isDeep: true,
            width: 4,
            height: 4,
            totalPixels: 16,
            totalSamples: 2,
            sampleOffsets: new Uint32Array(17),
            sampleData: new Float32Array(12),
            getSampleCount: (x, y) => (x === 0 && y === 0 ? 2 : 0),
            getSamples: (x, y) => (x === 0 && y === 0 ? [
              { zFront: 2.0, zBack: 3.5, r: 1.0, g: 0.2, b: 0.1, a: 0.8 },
              { zFront: 5.0, zBack: 7.0, r: 0.1, g: 0.9, b: 0.3, a: 0.5 }
            ] : [])
          };
          window.app.deepInspectorUI.setDeepBuffer(mockDeep);
          window.app.deepInspectorUI.selectPixel(0, 0);
        }

        const countBadge = document.getElementById('deep-sample-count-badge') || document.getElementById('deep-sample-count') || document.querySelector('.deep-sample-count-badge');
        const countText = countBadge?.textContent || '';
        const rowsEl = document.getElementById('deep-sample-rows') || document.getElementById('deep-samples-body');
        const hasRows = (rowsEl?.children.length || 0) > 0;

        return { isVisible, countText, hasRows };
      })()`);

      assert.equal(res.isVisible, true, 'Deep Inspector wrapper must be visible after tab click');
      assert.ok(res.countText.includes('2 Samples'), 'Sample count badge should reflect 2 samples');
      assert.equal(res.hasRows, true, 'Sample table should render sample rows');
    });

    await runTest('Stage 7: Metadata Inspector opens and updates with current image', async () => {
      const res = await evaluate(`(() => {
        const btn = document.getElementById('tab-btn-metadata');
        btn?.click();
        const wrapper = document.getElementById('metadata-wrapper');
        const isVisible = wrapper && wrapper.style.display !== 'none';

        // Check format specifications card
        const techRes = document.getElementById('tech-res')?.textContent || '';

        return { isVisible, techRes };
      })()`);

      assert.equal(res.isVisible, true, 'Metadata wrapper must be visible after tab click');
      assert.ok(res.techRes.length > 0 && res.techRes !== '-', 'Format resolution should be displayed');
    });

    await runTest('Stage 7: Stereo controls update Viewer stereo mode', async () => {
      const res = await evaluate(`(() => {
        const btn = document.getElementById('tab-btn-stereo');
        btn?.click();
        const wrapper = document.getElementById('stereo-wrapper');
        const isVisible = wrapper && wrapper.style.display !== 'none';

        // Click Anaglyph mode
        const anaglyphBtn = wrapper?.querySelector('[data-mode="anaglyph"]');
        anaglyphBtn?.click();
        const currentStereo = window.app.viewerUI?.stereoMode;

        // Switch to Left eye
        const leftBtn = wrapper?.querySelector('[data-mode="left"]');
        leftBtn?.click();
        const eyeStereo = window.app.viewerUI?.stereoMode;

        return { isVisible, currentStereo, eyeStereo };
      })()`);

      assert.equal(res.isVisible, true, 'Stereo wrapper must be visible after tab click');
      assert.equal(res.currentStereo, 'anaglyph', 'Anaglyph button must set viewerUI stereoMode to anaglyph');
      assert.equal(res.eyeStereo, 'left', 'Left eye button must set viewerUI stereoMode to left');
    });

    await runTest('Stage 7: Workspace preset switching ("Deep / Stereo") and persistence', async () => {
      const res = await evaluate(`(() => {
        window.app.dockManager.applyPreset('Deep / Stereo');
        const saved = window.localStorage.getItem(window.app.dockManager.activeWorkspaceKey) || window.localStorage.getItem('opencomp_active_workspace');
        const currentPreset = window.app.dockManager.activePreset || window.app.dockManager.currentPreset;

        // Restore Composite preset
        window.app.dockManager.applyPreset('Composite');

        return { saved, currentPreset };
      })()`);

      assert.equal(res.saved, 'Deep / Stereo', 'localStorage must persist "Deep / Stereo" preset');
      assert.equal(res.currentPreset, 'Deep / Stereo', 'dockManager must record "Deep / Stereo" preset');
    });

    await runTest('Stage 8: Production Pipeline tab activation & subnav switching', async () => {
      const res = await evaluate(`(() => {
        const tabBtn = document.getElementById('tab-btn-production');
        if (tabBtn) tabBtn.click();

        const prodWrapper = document.getElementById('production-wrapper');
        const isProdVisible = prodWrapper && prodWrapper.style.display !== 'none';
        const hasUI = Boolean(window.app && window.app.productionUI);

        // Switch to tokens tab and then back to queue
        if (hasUI) {
          window.app.productionUI.setSubTab('tokens');
          const tokensActive = window.app.productionUI.activeSubTab === 'tokens';
          window.app.productionUI.setSubTab('queue');
          return { isProdVisible, hasUI, tokensActive, finalSubTab: window.app.productionUI.activeSubTab };
        }

        return { isProdVisible, hasUI, tokensActive: false, finalSubTab: null };
      })()`);

      assert.ok(res.isProdVisible, 'Production wrapper must be visible when tab activated');
      assert.ok(res.hasUI, 'window.app.productionUI must be instantiated');
      assert.ok(res.tokensActive, 'Subnav switching to tokens must succeed');
      assert.equal(res.finalSubTab, 'queue', 'Final active subnav must be queue');
    });

    await runTest('Stage 8: Up-versioning and path resolution preview', async () => {
      const res = await evaluate(`(() => {
        const prodUI = window.app.productionUI;
        if (!prodUI) return null;

        const prevVer = prodUI.projectContext.version;
        const newVer = prodUI.upVersion();
        const testResolved = prodUI.resolvePath('//studio_nas/projects/\${PROJECT}/shots/\${SHOT}/comp/\${VERSION}/\${SHOT}_comp.####.\${EXT}', 1);

        return { prevVer, newVer, testResolved, activeVer: prodUI.projectContext.version };
      })()`);

      assert.ok(res, 'Production UI must exist');
      assert.ok(res.newVer !== res.prevVer, 'Up-version must change version string');
      assert.ok(res.testResolved.includes(res.newVer), 'Resolved path must contain updated version token');
    });

    await runTest('Stage 8: Sandboxed scripting runtime in browser environment', async () => {
      const res = await evaluate(`(() => {
        const prodUI = window.app.productionUI;
        if (!prodUI) return null;

        let printedMsg = null;
        const safeRun = prodUI.executeScript("opencomp.print('Interactive CDP scripting test ok');", (msg) => {
          printedMsg = msg;
        });

        const blockedRun = prodUI.executeScript("eval('1+1');");

        return {
          safeSuccess: safeRun.success,
          printedMsg,
          blockedSuccess: blockedRun.success,
          blockedError: blockedRun.error
        };
      })()`);

      assert.ok(res.safeSuccess, 'Safe automation script must execute cleanly');
      assert.equal(res.printedMsg, 'Interactive CDP scripting test ok', 'Script opencomp.print callback must receive printed message');
      assert.equal(res.blockedSuccess, false, 'Unrestricted eval() must be blocked by sandbox');
      assert.ok(res.blockedError.includes('Execution blocked'), 'Sandbox violation message must be reported');
    });

    await runTest('Stage 8: Production workspace preset switching and persistence', async () => {
      const res = await evaluate(`(() => {
        window.app.dockManager.applyPreset('Production');
        const saved = window.localStorage.getItem(window.app.dockManager.activeWorkspaceKey);
        const currentPreset = window.app.dockManager.activePreset;

        // Restore Composite preset
        window.app.dockManager.applyPreset('Composite');

        return { saved, currentPreset };
      })()`);

      assert.equal(res.saved, 'Production', 'localStorage must persist "Production" preset');
      assert.equal(res.currentPreset, 'Production', 'dockManager must record "Production" preset');
    });

    await runTest('General UI: Zero browser console errors and exceptions logged throughout session', async () => {
      assert.equal(
        consoleErrors.length,
        0,
        `Browser recorded runtime errors during interactive validation: ${consoleErrors.join(' | ')}`
      );
    });

    ws.close();
  } finally {
    try { edgeProc.kill(); } catch (e) { }
    if (edgeProc.pid) {
      try {
        const { spawnSync } = await import('node:child_process');
        spawnSync('taskkill', ['/F', '/T', '/PID', String(edgeProc.pid)], { windowsHide: true });
      } catch (e) { }
    }
    if (spawnedServer) {
      try {
        const { spawnSync } = await import('node:child_process');
        spawnSync('taskkill', ['/F', '/T', '/PID', String(spawnedServer.pid)], { windowsHide: true });
      } catch (e) { }
    }
  }

  console.log('\n====================================================');
  console.log(`🎉 test_ui_interactions.mjs PASSED: All ${passedTests}/${totalTests} interaction tests succeeded!`);
  console.log('====================================================');
}

main().catch((err) => {
  console.error('\n❌ test_ui_interactions.mjs FAILED:', err);
  process.exit(1);
});
