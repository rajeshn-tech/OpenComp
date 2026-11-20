import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const targetUrl = 'http://localhost:8080/?autotest=1';
const outPath = 'tests/output/forensic_desktop_verified.png';

console.log('🚀 Launching Edge for forensic UI verification...');

const edgeProc = spawn(edgePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--window-size=1600,1000',
  '--hide-scrollbars',
  targetUrl
], { detached: true });

async function run() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let wsUrl = null;

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      const tabs = await res.json();
      const tab = tabs.find(t => t.type === 'page');
      if (tab && tab.webSocketDebuggerUrl) {
        wsUrl = tab.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    console.error('❌ Could not connect to Edge remote debugging port 9222');
    edgeProc.kill();
    process.exit(1);
  }

  console.log('Connected to Edge DevTools WebSocket:', wsUrl);
  const ws = new WebSocket(wsUrl);

  let idCounter = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      console.log(`[BROWSER CONSOLE] ${text}`);
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
  await send('Page.enable');

  console.log('Waiting for FORENSIC_STATUS to be PASSED or FAILED...');
  let status = 'RUNNING';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const evalRes = await send('Runtime.evaluate', {
      expression: 'window.FORENSIC_STATUS'
    });
    status = evalRes.result?.value;
    if (status === 'PASSED' || status === 'FAILED') break;
  }

  console.log(`Final FORENSIC_STATUS: ${status}`);

  // Take screenshot
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  const imgBuffer = Buffer.from(screenshotRes.data, 'base64');
  fs.writeFileSync(outPath, imgBuffer);
  console.log(`✅ Saved screenshot to ${outPath} (${imgBuffer.length} bytes)`);

  ws.close();
  try {
    process.kill(edgeProc.pid);
  } catch (e) {}
  // Also kill any lingering msedge headless processes spawned for this port
  spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { shell: true });

  if (status !== 'PASSED') {
    console.error('❌ Forensic test did not pass!');
    process.exit(1);
  }
  console.log('🎉 Forensic UI test verified and screenshot captured successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error in runner:', err);
  try { process.kill(edgeProc.pid); } catch (e) {}
  process.exit(1);
});

