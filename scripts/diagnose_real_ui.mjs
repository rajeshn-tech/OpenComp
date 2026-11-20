import { spawn } from 'child_process';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const targetUrl = 'http://localhost:8080/';

console.log('🚀 Launching Edge for interactive diagnostic...');

const edgeProc = spawn(edgePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--window-size=1600,1000',
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
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails);
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

  await sleep(1000);

  console.log('\n--- DIAGNOSTIC 1: Inspecting DOM elements and Initial State ---');
  let res = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('node-graph-canvas');
      const popup = document.getElementById('node-search-popup');
      const input = document.getElementById('node-search-input');
      const list = document.getElementById('node-search-results');
      const nodesBtn = Array.from(document.querySelectorAll('.menu-btn')).find(b => b.textContent.trim() === 'Nodes');
      const nodesDropdown = nodesBtn ? nodesBtn.nextElementSibling : null;
      const nodesLinks = nodesDropdown ? Array.from(nodesDropdown.querySelectorAll('a')).map(a => ({ text: a.textContent.trim(), node: a.getAttribute('data-create-node') })) : [];

      return {
        canvasExists: !!canvas,
        canvasRect: canvas ? canvas.getBoundingClientRect() : null,
        canvasTabIndex: canvas ? canvas.getAttribute('tabindex') : null,
        popupExists: !!popup,
        popupDisplay: popup ? getComputedStyle(popup).display : null,
        popupZIndex: popup ? getComputedStyle(popup).zIndex : null,
        inputExists: !!input,
        listExists: !!list,
        nodesBtnExists: !!nodesBtn,
        nodesLinksCount: nodesLinks.length,
        nodesLinksSample: nodesLinks.slice(0, 5),
        activeElement: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : null,
        appExists: !!window.app,
        graphNodeCount: window.app ? window.app.graph.getAllNodes().length : 0
      };
    })()`,
    returnByValue: true
  });
  console.log('Initial state:', JSON.stringify(res.result?.value, null, 2));

  console.log('\n--- DIAGNOSTIC 2: Click on Canvas and Press Tab via CDP ---');
  // Dispatch click on canvas at (600, 700)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 600,
    y: 700,
    button: 'left',
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 600,
    y: 700,
    button: 'left',
    clickCount: 1
  });

  await sleep(200);

  // Check state after click
  res = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        activeElement: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : null,
        isMouseOverGraph: window.app && window.app.nodeGraphUI ? window.app.nodeGraphUI.isMouseOverGraph : null,
        isFocused: window.app && window.app.nodeGraphUI ? window.app.nodeGraphUI.isFocused : null,
        lastMouseClientPos: window.app && window.app.nodeGraphUI ? window.app.nodeGraphUI.lastMouseClientPos : null
      };
    })()`,
    returnByValue: true
  });
  console.log('After canvas click:', JSON.stringify(res.result?.value, null, 2));

  // Now dispatch Tab key via CDP Input.dispatchKeyEvent
  console.log('Dispatching CDP rawKeyDown / keyUp for Tab...');
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });

  await sleep(300);

  // Check if popup opened
  res = await send('Runtime.evaluate', {
    expression: `(() => {
      const popup = document.getElementById('node-search-popup');
      const input = document.getElementById('node-search-input');
      const list = document.getElementById('node-search-results');
      return {
        activeElement: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : null,
        popupDisplay: popup ? popup.style.display : null,
        popupComputedDisplay: popup ? getComputedStyle(popup).display : null,
        popupRect: popup ? popup.getBoundingClientRect() : null,
        popupStyleLeft: popup ? popup.style.left : null,
        popupStyleTop: popup ? popup.style.top : null,
        itemsCount: list ? list.children.length : 0
      };
    })()`,
    returnByValue: true
  });
  console.log('After Tab key press:', JSON.stringify(res.result?.value, null, 2));

  console.log('\n--- DIAGNOSTIC 3: Click "Nodes" dropdown and click a node link ---');
  res = await send('Runtime.evaluate', {
    expression: `(() => {
      const nodesBtn = Array.from(document.querySelectorAll('.menu-btn')).find(b => b.textContent.trim() === 'Nodes');
      const gradeLink = document.querySelector('.dropdown-content a[data-create-node="Grade"]');
      const nodeCountBefore = window.app.graph.getAllNodes().length;
      
      // Let's test clicking gradeLink directly
      let clicked = false;
      if (gradeLink) {
        gradeLink.click();
        clicked = true;
      }
      const nodeCountAfter = window.app.graph.getAllNodes().length;
      return {
        clicked,
        nodeCountBefore,
        nodeCountAfter,
        createdGrade: nodeCountAfter > nodeCountBefore
      };
    })()`,
    returnByValue: true
  });
  console.log('Nodes menu click result:', JSON.stringify(res.result?.value, null, 2));

  ws.close();
  try {
    process.kill(edgeProc.pid);
  } catch (e) {}
  spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { shell: true });
}

run();

