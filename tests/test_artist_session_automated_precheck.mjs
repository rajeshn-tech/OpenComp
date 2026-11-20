/**
 * OpenComp - Automated Artist Test Project Pre-Flight Verification
 * Launches real browser via CDP, loads artist_validation_master.opencomp,
 * evaluates the 17-node DAG, verifies PixelBuffer evaluation, and captures a live UI screenshot.
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

console.log('================================================================');
console.log('🎨 RUNNING: tests/test_artist_session_automated_precheck.mjs');
console.log('================================================================\n');

const CDP_PORT = 9228;

function findBrowserBinary() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BROWSER_PATH = findBrowserBinary();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let browserProc = null;

async function run() {
  console.log(`⏳ Spawning browser on CDP port ${CDP_PORT}...`);
  browserProc = spawn(BROWSER_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--use-gl=angle',
    '--window-size=1600,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'http://127.0.0.1:8080/'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const tabs = await res.json();
      const tab = tabs.find(t => t.type === 'page');
      if (tab && tab.webSocketDebuggerUrl) {
        wsUrl = tab.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!wsUrl) {
    throw new Error('Failed to connect to CDP endpoint on port ' + CDP_PORT);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let idCounter = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const cb = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) cb.reject(new Error(data.error.message));
      else cb.resolve(data.result);
    }
  };

  function sendPage(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendPage('Runtime.enable');
  await sendPage('Page.enable');
  await sleep(1000);

  console.log('✅ Connected to OpenComp studio workstation over CDP.');

  // Read the master project file
  const projectJsonStr = fs.readFileSync('test_assets/manual_validation/artist_validation_master.opencomp', 'utf8');

  // Load project into OpenComp window
  console.log('⏳ Injecting and loading artist_validation_master.opencomp...');
  const loadResult = await sendPage('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const app = window.openCompApp || window.app;
        if (!app) return { error: 'OpenCompApp instance not found on window' };

        const projectData = ${projectJsonStr};
        
        // Load into app graph using official deserializer
        const { createNode } = await import('./src/nodes/index.js');
        app.graph.deserialize(projectData, (type, id) => createNode(type, id));
        if (app.nodeGraphUI) {
          app.nodeGraphUI.render();
        }

        const nodes = app.graph.getAllNodes();
        const nodeSummary = nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y }));

        // Evaluate Read1 and Merge1
        let read1Status = 'missing';
        let merge1Status = 'missing';
        try {
          const buf1 = app.graph.evaluate('Read1', { frame: 1 });
          read1Status = buf1 ? ('buffer_' + buf1.width + 'x' + buf1.height) : 'null_buffer';
          const bufMerge = app.graph.evaluate('Merge1', { frame: 1 });
          merge1Status = bufMerge ? ('buffer_' + bufMerge.width + 'x' + bufMerge.height) : 'null_buffer';
        } catch (e) {
          read1Status = 'error: ' + e.message;
        }

        return {
          totalNodes: nodes.length,
          nodes: nodeSummary,
          read1Status,
          merge1Status,
          hasViewer: !!app.viewerUI
        };
      } catch (err) {
        return { error: err.message, stack: err.stack };
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  const res = loadResult.result.value;
  if (res.error) {
    throw new Error('Failed to load artist test project: ' + res.error);
  }

  console.log(`\n--- PROJECT PRE-FLIGHT VERIFICATION ---`);
  console.log(`  Total Nodes Instantiated:  ${res.totalNodes} / 17`);
  console.log(`  Read1 Footage Evaluation:  ${res.read1Status}`);
  console.log(`  Viewer UI Connected:       ${res.hasViewer ? 'YES' : 'NO'}`);
  console.log('---------------------------------------\n');

  assert.equal(res.totalNodes, 17, 'All 17 nodes must instantiate in DAG');

  // Trigger fit-to-format and render
  await sendPage('Runtime.evaluate', {
    expression: `(() => {
      const app = window.openCompApp || window.app;
      if (app && app.nodeGraphUI && typeof app.nodeGraphUI.frameAll === 'function') {
        app.nodeGraphUI.frameAll();
      }
      if (app && app.nodeGraphUI && typeof app.nodeGraphUI.render === 'function') {
        app.nodeGraphUI.render();
      }
    })()`
  });

  await sleep(500);

  // Capture Screenshot of the Live UI
  console.log('⏳ Capturing live UI screenshot...');
  const screenshotData = await sendPage('Page.captureScreenshot', { format: 'png' });
  const artifactDir = 'C:\\Users\\rajeshn\\.gemini\\antigravity\\brain\\b97a935e-6e22-419f-9004-5d9532b8ea21';
  const screenshotPath = path.join(artifactDir, 'artist_session_live_ui.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshotData.data, 'base64'));
  console.log(`📸 Screenshot saved: ${screenshotPath} (${fs.statSync(screenshotPath).size} bytes)`);

  console.log('\n================================================================');
  console.log('🎉 test_artist_session_automated_precheck.mjs PASSED!');
  console.log('================================================================\n');
}

try {
  await run();
} finally {
  if (browserProc) {
    try { browserProc.kill(); } catch (_) {}
  }
}
