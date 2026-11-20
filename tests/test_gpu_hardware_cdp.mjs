/**
 * OpenComp - Lightweight WebGL 2.0 Hardware GPU Feasibility & Parity Test
 * Executes in real browser via Chrome DevTools Protocol (CDP) on physical host hardware.
 * Queries GL renderer, extensions, and evaluates lightweight shader operations (64x64)
 * with zero heavy stress tests.
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import assert from 'node:assert/strict';

console.log('====================================================');
console.log('🎮 RUNNING: tests/test_gpu_hardware_cdp.mjs');
console.log('====================================================\n');

const CDP_PORT = 9226;

function findBrowserBinary() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BROWSER_PATH = findBrowserBinary();

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let browserProc = null;

async function run() {
  console.log(`⏳ Launching headless browser on port ${CDP_PORT}...`);
  browserProc = spawn(BROWSER_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--use-gl=angle',
    '--disable-background-networking',
    '--disable-gpu-watchdog',
    '--no-first-run',
    '--no-default-browser-check',
    'http://127.0.0.1:8080/'
  ], { stdio: 'ignore' });

  // Wait for CDP to be ready
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
    throw new Error('Failed to connect to browser CDP endpoint.');
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
  await sleep(500);

  console.log('✅ Connected to live page over CDP. Querying WebGL2 hardware...');

  // 1. Query Hardware Telemetry
  const hwTelemetry = await sendPage('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return { error: 'WebGL2 not supported' };
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const version = gl.getParameter(gl.VERSION);
      const slVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
      const extFloat = !!gl.getExtension('EXT_color_buffer_float');
      const extLinear = !!gl.getExtension('OES_texture_float_linear');
      return {
        vendor,
        renderer,
        version,
        slVersion,
        extFloat,
        extLinear
      };
    })()`,
    returnByValue: true
  });

  const hw = hwTelemetry.result.value;
  console.log('\n--- HARDWARE & WEBGL2 TELEMETRY ---');
  console.log(`  GPU Vendor:          ${hw.vendor}`);
  console.log(`  GPU Renderer:        ${hw.renderer}`);
  console.log(`  WebGL Version:       ${hw.version}`);
  console.log(`  GLSL Version:        ${hw.slVersion}`);
  console.log(`  Float32 Color FBO:   ${hw.extFloat ? 'Supported (EXT_color_buffer_float)' : 'Missing'}`);
  console.log(`  Float32 Linear:      ${hw.extLinear ? 'Supported (OES_texture_float_linear)' : 'Missing'}`);
  console.log('-----------------------------------\n');

  assert.ok(hw.renderer, 'GPU Renderer must be reported');
  assert.ok(hw.extFloat, 'EXT_color_buffer_float is required for 32-bit float rendering');

  // 2. Execute Lightweight GPU Compute Parity Test (64x64 texture)
  console.log('⏳ Running lightweight GPU shader execution (64x64 texture)...');
  const gpuTestResult = await sendPage('Runtime.evaluate', {
    expression: `(async () => {
      const { GPUCompositor } = await import('./src/core/GPUCompositor.js');
      const { PixelBuffer } = await import('./src/core/PixelBuffer.js');

      const W = 64, H = 64;
      const comp = new GPUCompositor(W, H);
      if (!comp.isSupported) {
        return { error: 'GPUCompositor reported not supported' };
      }

      // Create a test gradient pattern
      const srcBuf = new PixelBuffer(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          srcBuf.data[idx]     = x / (W - 1);       // R: horizontal ramp 0..1
          srcBuf.data[idx + 1] = y / (H - 1);       // G: vertical ramp 0..1
          srcBuf.data[idx + 2] = 0.5;               // B: constant 0.5
          srcBuf.data[idx + 3] = 0.8;               // A: constant 0.8
        }
      }

      const results = {};

      // Test 1: Invert Shader
      try {
        const progInvert = comp.getProgram('invert', comp.getInvertShader());
        const texSrc = comp.uploadTexture(srcBuf);
        const fboObj = comp.fboPool[0];

        comp.gl.bindFramebuffer(comp.gl.FRAMEBUFFER, fboObj.fbo);
        comp.gl.viewport(0, 0, W, H);
        comp.gl.useProgram(progInvert);

        comp.gl.activeTexture(comp.gl.TEXTURE0);
        comp.gl.bindTexture(comp.gl.TEXTURE_2D, texSrc);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progInvert, 'u_tex'), 0);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progInvert, 'u_channels'), 0); // RGB invert

        comp.renderQuad(progInvert);
        const gpuInvertData = comp.readback(fboObj.fbo, W, H);

        // CPU reference
        const cpuInvertData = GPUCompositor.evaluateInvertCPU(srcBuf.data, 'rgb');

        let maxDeltaInvert = 0;
        for (let i = 0; i < srcBuf.data.length; i++) {
          const d = Math.abs(gpuInvertData[i] - cpuInvertData[i]);
          if (d > maxDeltaInvert) maxDeltaInvert = d;
        }
        results.invert = { pass: maxDeltaInvert < 1e-4, maxDelta: maxDeltaInvert };
      } catch (e) {
        results.invert = { pass: false, error: e.message };
      }

      // Test 2: Premult Shader
      try {
        const progPremult = comp.getProgram('premult', comp.getPremultShader());
        const texSrc = comp.uploadTexture(srcBuf);
        const fboObj = comp.fboPool[1];

        comp.gl.bindFramebuffer(comp.gl.FRAMEBUFFER, fboObj.fbo);
        comp.gl.viewport(0, 0, W, H);
        comp.gl.useProgram(progPremult);

        comp.gl.activeTexture(comp.gl.TEXTURE0);
        comp.gl.bindTexture(comp.gl.TEXTURE_2D, texSrc);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progPremult, 'u_tex'), 0);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progPremult, 'u_invertAlpha'), 0);

        comp.renderQuad(progPremult);
        const gpuPremultData = comp.readback(fboObj.fbo, W, H);

        const cpuPremultData = GPUCompositor.evaluatePremultCPU(srcBuf.data, false);
        let maxDeltaPremult = 0;
        for (let i = 0; i < srcBuf.data.length; i++) {
          const d = Math.abs(gpuPremultData[i] - cpuPremultData[i]);
          if (d > maxDeltaPremult) maxDeltaPremult = d;
        }
        results.premult = { pass: maxDeltaPremult < 1e-4, maxDelta: maxDeltaPremult };
      } catch (e) {
        results.premult = { pass: false, error: e.message };
      }

      // Test 3: Grade Shader (gain 1.5, offset 0.1, gamma 1.2)
      try {
        const progGrade = comp.getProgram('grade', comp.getGradeShader());
        const texSrc = comp.uploadTexture(srcBuf);
        const fboObj = comp.fboPool[2];

        comp.gl.bindFramebuffer(comp.gl.FRAMEBUFFER, fboObj.fbo);
        comp.gl.viewport(0, 0, W, H);
        comp.gl.useProgram(progGrade);

        const A = 1.5;
        const B = 0.1;
        const gamma = 1.2;
        const invGamma = 1.0 / gamma;

        comp.gl.activeTexture(comp.gl.TEXTURE0);
        comp.gl.bindTexture(comp.gl.TEXTURE_2D, texSrc);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progGrade, 'u_tex'), 0);
        comp.gl.uniform1f(comp.gl.getUniformLocation(progGrade, 'u_A'), A);
        comp.gl.uniform1f(comp.gl.getUniformLocation(progGrade, 'u_B'), B);
        comp.gl.uniform1f(comp.gl.getUniformLocation(progGrade, 'u_invGamma'), invGamma);
        comp.gl.uniform1f(comp.gl.getUniformLocation(progGrade, 'u_gamma'), gamma);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progGrade, 'u_isLinearGamma'), 0);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progGrade, 'u_blackClamp'), 1);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progGrade, 'u_whiteClamp'), 1);
        comp.gl.uniform1i(comp.gl.getUniformLocation(progGrade, 'u_reverse'), 0);

        comp.renderQuad(progGrade);
        const gpuGradeData = comp.readback(fboObj.fbo, W, H);

        const cpuGradeData = GPUCompositor.evaluateGradeCPU(srcBuf.data, A, B, invGamma, gamma, false, true, true, false);
        let maxDeltaGrade = 0;
        for (let i = 0; i < srcBuf.data.length; i++) {
          const d = Math.abs(gpuGradeData[i] - cpuGradeData[i]);
          if (d > maxDeltaGrade) maxDeltaGrade = d;
        }
        results.grade = { pass: maxDeltaGrade < 1e-4, maxDelta: maxDeltaGrade };
      } catch (e) {
        results.grade = { pass: false, error: e.message };
      }

      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  const res = gpuTestResult.result.value;
  console.log('Shader Parity Results:');
  console.log(`  ✅ Invert Shader:   ${res.invert.pass ? 'PASS' : 'FAIL'} (Max Delta: ${res.invert.maxDelta.toExponential(3)})`);
  console.log(`  ✅ Premult Shader:  ${res.premult.pass ? 'PASS' : 'FAIL'} (Max Delta: ${res.premult.maxDelta.toExponential(3)})`);
  console.log(`  ✅ Grade Shader:    ${res.grade.pass ? 'PASS' : 'FAIL'} (Max Delta: ${res.grade.maxDelta.toExponential(3)})`);

  assert.ok(res.invert.pass, `Invert shader failed with delta ${res.invert.maxDelta}`);
  assert.ok(res.premult.pass, `Premult shader failed with delta ${res.premult.maxDelta}`);
  assert.ok(res.grade.pass, `Grade shader failed with delta ${res.grade.maxDelta}`);

  console.log('\n====================================================');
  console.log('🎉 test_gpu_hardware_cdp.mjs PASSED: Real WebGL2 hardware execution verified!');
  console.log('====================================================\n');
}

try {
  await run();
} finally {
  if (browserProc) {
    try { browserProc.kill(); } catch (_) {}
  }
}
