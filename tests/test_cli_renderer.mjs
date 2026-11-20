/**
 * OpenComp - Test Suite 28: Headless CLI Batch Renderer
 * Validates command line interface, argument parsing, frame tokens, pre-flight checks,
 * atomic writing, overwrite safety, recovery flag, and exit codes.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  parseArguments,
  parseFrameRange,
  formatSequencePath,
  loadProject,
  validateGraph,
  renderBatch
} from '../bin/opencomp-render.mjs';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

const testDir = path.join(os.tmpdir(), `opencomp_test_cli_${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ CLI Renderer: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: CLI Renderer: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ CLI Renderer: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: CLI Renderer: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_cli_renderer.mjs');
console.log('----------------------------------------------------');

// 1. Frame Range Parsing
runTest('Frame Range String Parsing', () => {
  assert.deepEqual(parseFrameRange('1-5'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseFrameRange('1001-1004'), [1001, 1002, 1003, 1004]);
  assert.deepEqual(parseFrameRange('1,5,9'), [1, 5, 9]);
  assert.deepEqual(parseFrameRange('1-3,8,10-12'), [1, 2, 3, 8, 10, 11, 12]);
  assert.deepEqual(parseFrameRange('42'), [42]);
  assert.throws(() => parseFrameRange('abc'), /Invalid frame/);
});

// 2. Sequence Token Formatting
runTest('Sequence Token Formatting (####, %04d, @@@)', () => {
  const p1 = formatSequencePath('/path/to/shot.####.exr', 5);
  assert.equal(p1, '/path/to/shot.0005.exr');

  const p2 = formatSequencePath('/path/to/shot.%06d.exr', 123);
  assert.equal(p2, '/path/to/shot.000123.exr');

  const p3 = formatSequencePath('/path/to/shot.@@@.exr', 7);
  assert.equal(p3, '/path/to/shot.007.exr');

  const p4 = formatSequencePath('/path/to/single_image.exr', 10);
  assert.equal(p4, '/path/to/single_image.exr');
});

// 3. Argument Parsing & Defaults
runTest('CLI Argument Parser & Validation Options', () => {
  const args = [
    '-p', 'my_project.nk',
    '-o', 'renders/comp.####.exr',
    '-f', '1-24',
    '-c', 'dwaa',
    '--quality', '60.0',
    '--bitdepth', 'half16',
    '--overwrite',
    '--recover',
    '--verbose'
  ];

  const cfg = parseArguments(args);
  assert.equal(cfg.project, 'my_project.nk');
  assert.equal(cfg.output, 'renders/comp.####.exr');
  assert.equal(cfg.frames, '1-24');
  assert.equal(cfg.compression, 'dwaa');
  assert.equal(cfg.quality, 60.0);
  assert.equal(cfg.bitdepth, 'half16');
  assert.equal(cfg.overwrite, true);
  assert.equal(cfg.recover, true);
  assert.equal(cfg.verbose, true);

  assert.throws(() => parseArguments(['--unknown-flag']), /Unknown command line argument/);
});

// 4. Subprocess Execution (--help, --version)
runTest('CLI Subprocess Help & Version Verification', () => {
  const nodeBin = process.execPath;
  const script = path.resolve('bin/opencomp-render.mjs');

  const helpProc = spawnSync(nodeBin, [script, '--help'], { encoding: 'utf8' });
  assert.equal(helpProc.status, 0);
  assert(helpProc.stdout.includes('OpenComp Headless Batch Renderer'));

  const verProc = spawnSync(nodeBin, [script, '--version'], { encoding: 'utf8' });
  assert.equal(verProc.status, 0);
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert(verProc.stdout.includes(pkg.version));
});

// 5. Pre-Flight Project Validation
runTest('Pre-Flight Validation with Valid and Empty Graphs', () => {
  const emptyProj = path.join(testDir, 'empty.opencomp');
  fs.writeFileSync(emptyProj, JSON.stringify({ nodes: [], connections: [] }));

  assert.throws(() => {
    const graph = loadProject(emptyProj);
    validateGraph(graph);
  }, /contains 0 nodes/);

  // Valid project
  const validProj = path.join(testDir, 'valid.opencomp');
  const gValid = new Graph();
  const rNode = createNode('Read', 'Read1');
  rNode.setKnobValue('sourceType', 'checkerboard');
  const grNode = createNode('Grade', 'Grade1');
  const wrNode = createNode('Write', 'Write1');
  gValid.addNode(rNode);
  gValid.addNode(grNode);
  gValid.addNode(wrNode);
  gValid.connect('Read1', 'out', 'Grade1', 'in');
  gValid.connect('Grade1', 'out', 'Write1', 'in');
  fs.writeFileSync(validProj, JSON.stringify(gValid.serialize()));

  const validGraph = loadProject(validProj);
  const { targetNode } = validateGraph(validGraph);
  assert.equal(targetNode.id, 'Write1');
  assert.equal(targetNode.type, 'Write');
});

// 6. Complete Batch Render Pipeline (Frames 1..3, Atomic temporary files, Output Check)
await runAsyncTest('Complete Batch Execution & Atomic File Verification', async () => {
  const testProj = path.join(testDir, 'batch_test.opencomp');
  const outPattern = path.join(testDir, 'renders', 'frame.####.exr');

  const gBatch = new Graph();
  const r1 = createNode('Read', 'Read1');
  r1.setKnobValue('sourceType', 'ramp');
  r1.setKnobValue('format', '128x128');
  const inv = createNode('Invert', 'Invert1');
  const wr = createNode('Write', 'Write1');
  wr.setKnobValue('fileType', 'image/exr');
  gBatch.addNode(r1);
  gBatch.addNode(inv);
  gBatch.addNode(wr);
  gBatch.connect('Read1', 'out', 'Invert1', 'in');
  gBatch.connect('Invert1', 'out', 'Write1', 'in');
  fs.writeFileSync(testProj, JSON.stringify(gBatch.serialize()));

  const config = {
    project: testProj,
    output: outPattern,
    frames: '1-3',
    format: '128x128',
    compression: 'none',
    bitdepth: 'float32',
    overwrite: true,
    validate: false,
    verbose: false
  };

  const result = await renderBatch(config);
  assert.equal(result.success, true);
  assert.equal(result.framesRendered, 3);
  assert.equal(result.renderedFiles.length, 3);

  // Check all rendered files exist and have non-zero size
  for (let f = 1; f <= 3; f++) {
    const fPath = path.join(testDir, 'renders', `frame.000${f}.exr`);
    assert(fs.existsSync(fPath), `Rendered frame must exist: ${fPath}`);
    const stat = fs.statSync(fPath);
    assert(stat.size > 500, `Rendered frame size (${stat.size} bytes) should be > 500 bytes`);
  }

  // Check no leftover .tmp files
  const renderDir = path.join(testDir, 'renders');
  const files = fs.readdirSync(renderDir);
  const tmpFiles = files.filter(f => f.includes('.tmp.'));
  assert.equal(tmpFiles.length, 0, 'No temporary atomic files should remain after render');
});

// 7. Overwrite Protection
await runAsyncTest('Overwrite Protection Mechanism', async () => {
  const testProj = path.join(testDir, 'batch_test.opencomp');
  const outPattern = path.join(testDir, 'renders', 'frame.####.exr');

  const configNoOverwrite = {
    project: testProj,
    output: outPattern,
    frames: '1',
    overwrite: false,
    validate: false,
    verbose: false
  };

  let threw = false;
  try {
    await renderBatch(configNoOverwrite);
  } catch (err) {
    threw = true;
    assert(err.message.includes('Output file already exists'), 'Must reject existing output without overwrite');
  }
  assert(threw, 'Render must throw when overwriting without --overwrite');
});

// 8. Autosave Crash Recovery Loading (--recover)
runTest('Autosave Crash Recovery File Loading (--recover)', () => {
  const testProj = path.join(testDir, 'crash_project.opencomp');
  fs.writeFileSync(testProj, JSON.stringify({
    nodes: [{ id: 'ReadOld', type: 'Read', knobs: {} }],
    connections: []
  }));

  const autosaveProj = `${testProj}.autosave`;
  fs.writeFileSync(autosaveProj, JSON.stringify({
    version: '1.0',
    timestamp: Date.now(),
    data: {
      nodes: [
        { id: 'ReadNew', type: 'Read', knobs: {} },
        { id: 'BlurNew', type: 'Blur', knobs: { size: 10 } }
      ],
      connections: []
    }
  }));

  // Without recover
  const normalGraph = loadProject(testProj, false);
  assert.equal(normalGraph.getAllNodes().length, 1);
  assert.equal(normalGraph.getNode('ReadOld')?.type, 'Read');

  // With recover
  const recoveredGraph = loadProject(testProj, true);
  assert.equal(recoveredGraph.getAllNodes().length, 2);
  assert.equal(recoveredGraph.getNode('ReadNew')?.type, 'Read');
  assert.equal(recoveredGraph.getNode('BlurNew')?.type, 'Blur');
});

// Cleanup
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 test_cli_renderer.mjs PASSED: All 8 CLI renderer tests succeeded with 0 errors.');
