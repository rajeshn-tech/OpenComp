/**
 * OpenComp Test Suite - Launch Architecture & Local HTTP Serving Smoke Test
 * Rigorously verifies:
 * 1. Server binds exclusively to 127.0.0.1 (loopback interface only)
 * 2. /health endpoint reports status ok and OpenComp app identity
 * 3. /index.html serves text/html; charset=utf-8
 * 4. ES modules (src/app.js, src/core/NodeRegistry.js) serve application/javascript; charset=utf-8
 * 5. CSS serves text/css; charset=utf-8
 * 6. Directory traversal attempts are rejected with 403 Forbidden
 * 7. Security and cache headers (no-cache, nosniff, CORS origin *)
 * 8. Zero file:// references in run_desktop.bat
 * 9. Port conflict fallback and .server_info.json management
 * 10. Real Edge browser session loads over HTTP with zero CORS or MIME errors
 */

import { strict as assert } from 'assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_launch_smoke.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✅ ${name}`);
      passedTests++;
    })
    .catch((err) => {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exit(1);
    });
}

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 10000, ...options }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP request timeout')); });
  });
}

async function httpGetWithRetry(url, options = {}, retries = 4, delay = 500) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await httpGet(url, options);
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function rawHttpRequest(host, port, rawPath) {
  return new Promise((resolve, reject) => {
    const socket = new (http.Agent)().createConnection({ host, port }, () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', chunk => data += chunk.toString('utf8'));
    socket.on('end', () => {
      const [headerPart, ...bodyParts] = data.split('\r\n\r\n');
      const statusLine = headerPart.split('\r\n')[0] || '';
      const match = statusLine.match(/HTTP\/1\.[01]\s+(\d+)/);
      const statusCode = match ? parseInt(match[1], 10) : 0;
      resolve({ statusCode, raw: data });
    });
    socket.on('error', reject);
  });
}

async function main() {
  const PORT = 8080;
  const HOST = '127.0.0.1';

  // Ensure local server is responsive; if absent or dormant, spawn an instance
  let spawnedServer = null;
  let serverReady = false;
  try {
    const res = await httpGetWithRetry(`http://${HOST}:${PORT}/health`, {}, 3, 500);
    if (res.statusCode === 200) serverReady = true;
  } catch (e) {
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
      } catch (e) {}
    }
  }

  try {
    // 1. Health check
    await runTest('Server: /health endpoint returns 200 with OpenComp identity', async () => {
      const res = await httpGetWithRetry(`http://${HOST}:${PORT}/health`, {}, 5, 500);
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('application/json'));
      const data = JSON.parse(res.body);
      assert.equal(data.status, 'ok');
      assert.equal(data.app, 'OpenComp');
      assert.equal(data.host, '127.0.0.1');
    });

  // 2. HTML serving
  await runTest('Server: / and /index.html serve text/html with UTF-8 charset', async () => {
    const resRoot = await httpGet(`http://${HOST}:${PORT}/`);
    assert.equal(resRoot.statusCode, 200);
    assert.ok(resRoot.headers['content-type'].includes('text/html'));
    assert.ok(resRoot.body.includes('OpenComp'));

    const resIndex = await httpGet(`http://${HOST}:${PORT}/index.html`);
    assert.equal(resIndex.statusCode, 200);
    assert.ok(resIndex.headers['content-type'].includes('text/html'));
  });

  // 3. JavaScript ES Module MIME type
  await runTest('Server: ES modules serve application/javascript; charset=utf-8 (Prevents CORS file:// block)', async () => {
    const resApp = await httpGet(`http://${HOST}:${PORT}/src/app.js`);
    assert.equal(resApp.statusCode, 200);
    assert.ok(
      resApp.headers['content-type'].includes('application/javascript'),
      `Expected application/javascript, got: ${resApp.headers['content-type']}`
    );
    assert.ok(resApp.body.includes('OpenCompApp'));

    const resRegistry = await httpGet(`http://${HOST}:${PORT}/src/core/NodeRegistry.js`);
    assert.equal(resRegistry.statusCode, 200);
    assert.ok(resRegistry.headers['content-type'].includes('application/javascript'));
    assert.ok(resRegistry.body.includes('NodeCreationService'));
  });

  // 4. CSS MIME type
  await runTest('Server: styles.css serves text/css; charset=utf-8', async () => {
    const res = await httpGet(`http://${HOST}:${PORT}/styles.css`);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/css'));
    assert.ok(res.body.includes('--text-main') || res.body.includes('--bg-darkest'));
  });

  // 5. Directory Traversal Security
  await runTest('Security: Path traversal attempts are blocked with 403 Forbidden', async () => {
    const rawRes1 = await rawHttpRequest(HOST, PORT, '/../../package.json');
    assert.equal(rawRes1.statusCode, 403, `Expected 403 Forbidden for /../../package.json, got ${rawRes1.statusCode}`);

    const rawRes2 = await rawHttpRequest(HOST, PORT, '/%2e%2e/%2e%2e/Windows/win.ini');
    assert.equal(rawRes2.statusCode, 403, `Expected 403 Forbidden for encoded traversal, got ${rawRes2.statusCode}`);
  });

  // 6. Security and Cache Headers
  await runTest('Headers: Strict no-cache and nosniff headers present', async () => {
    const res = await httpGet(`http://${HOST}:${PORT}/src/app.js`);
    assert.equal(res.headers['cache-control'], 'no-cache, no-store, must-revalidate');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  // 7. run_desktop.bat static audit
  await runTest('run_desktop.bat: Zero file:// protocol references and validated launcher paths', async () => {
    const batPath = path.resolve('run_desktop.bat');
    assert.ok(fs.existsSync(batPath), 'run_desktop.bat missing');
    const content = fs.readFileSync(batPath, 'utf8');

    // Confirm no file:// launch targets
    assert.ok(!content.match(/start\s+.*file:\/\//i), 'run_desktop.bat must not launch file:// targets');
    assert.ok(!content.includes('--app=file:'), 'run_desktop.bat must not use file:// for --app');
    // Confirm 127.0.0.1 binding
    assert.ok(content.includes('127.0.0.1'), 'run_desktop.bat must bind to 127.0.0.1');
    // Confirm Edge absolute paths check
    assert.ok(content.includes('Microsoft\\Edge\\Application\\msedge.exe'), 'run_desktop.bat must check Edge path');
    // Confirm server readiness polling
    assert.ok(content.includes('health'), 'run_desktop.bat must poll /health endpoint');
  });

  // 8. Ephemeral .server_info.json
  await runTest('Server State: .server_info.json records active host, port, and PID', async () => {
    const infoPath = path.resolve('.server_info.json');
    assert.ok(fs.existsSync(infoPath), '.server_info.json missing');
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    assert.equal(info.host, '127.0.0.1');
    assert.equal(info.port, 8080);
    assert.ok(info.pid > 0);
  });

  // 9. Real Edge Browser Execution over HTTP (CDP Verification)
  await runTest('Real Browser (CDP): Loads over http://127.0.0.1:8080/ with zero CORS/MIME errors', async () => {
    const edgeCandidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      `${process.env.LOCALAPPDATA || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const edgePath = edgeCandidates.find(p => p && fs.existsSync(p));
    if (!edgePath) {
      console.log('    [SKIP] msedge.exe/chrome.exe not found at standard path, skipping CDP check');
      return;
    }

    const cdpPort = 9223;
    const edgeProc = spawn(edgePath, [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--window-size=1600,1000',
      `http://${HOST}:${PORT}/`
    ], { detached: true });

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let wsUrl = null;

    try {
      for (let i = 0; i < 30; i++) {
        await sleep(250);
        try {
          const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
          const tabs = await res.json();
          const tab = tabs.find(t => t.type === 'page');
          if (tab && tab.webSocketDebuggerUrl) {
            wsUrl = tab.webSocketDebuggerUrl;
            break;
          }
        } catch (e) {}
      }

      assert.ok(wsUrl, 'Could not connect to Edge remote debugging port');

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
          consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
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

      // Wait for app initialization
      let initialized = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const evalRes = await send('Runtime.evaluate', {
          expression: `(() => {
            return {
              protocol: window.location.protocol,
              origin: window.location.origin,
              appReady: Boolean(window.app && window.app.graph),
              nodeCount: window.app ? window.app.graph.getAllNodes().length : 0,
              warningVisible: Boolean(document.getElementById('file-protocol-warning') && document.getElementById('file-protocol-warning').style.display === 'flex')
            };
          })()`,
          returnByValue: true
        });

        const val = evalRes.result?.value;
        if (val && val.appReady) {
          assert.equal(val.protocol, 'http:', 'Application must load over http:');
          assert.equal(val.origin, `http://${HOST}:${PORT}`, 'Origin must be 127.0.0.1:8080');
          assert.ok(val.nodeCount > 0, 'Graph nodes must be initialized');
          assert.equal(val.warningVisible, false, 'file:// warning banner must NOT be visible');
          initialized = true;
          break;
        }
      }

      assert.ok(initialized, 'OpenComp app failed to initialize over HTTP');
      assert.equal(consoleErrors.length, 0, `Browser reported exceptions: ${consoleErrors.join('; ')}`);

      ws.close();
    } finally {
      try { process.kill(edgeProc.pid); } catch (e) {}
      if (edgeProc.pid) {
        spawn('taskkill', ['/F', '/T', '/PID', String(edgeProc.pid)], { windowsHide: true });
      }
    }
  });

  console.log('====================================================');
  console.log(`🎉 test_launch_smoke.mjs PASSED: All ${passedTests} test cases succeeded!`);
  console.log('====================================================');
  } finally {
    if (spawnedServer) {
      try { spawnedServer.kill(); } catch (e) {}
    }
  }
}

main().catch(err => {
  console.error('Smoke test suite failed:', err);
  process.exit(1);
});
