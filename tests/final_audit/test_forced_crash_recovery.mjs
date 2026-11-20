/**
 * OpenComp - Final Acceptance Audit: Forced Application Termination & Crash Recovery Test
 * 1. Spawns an external node process running a project editing session.
 * 2. Simulates edits (adds nodes, triggers autosave).
 * 3. Forcefully terminates (kills) the process via OS taskkill/SIGKILL.
 * 4. Invokes opencomp-render with --recover to verify full recovery.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const testDir = path.resolve('tests/final_audit/recovery_test');
fs.mkdirSync(testDir, { recursive: true });

const primaryProject = path.join(testDir, 'crashed_shot.opencomp');
const autosaveFile = `${primaryProject}.autosave`;
const renderedOutput = path.join(testDir, 'recovered_render.####.exr');

// Initial project: Read -> Write
const baseProject = {
  version: '1.0.0',
  nodes: [
    {
      id: 'Read1',
      type: 'Read',
      knobs: { sourceType: { value: 'ramp' }, format: { value: '1920x1080' } }
    },
    {
      id: 'Write1',
      type: 'Write',
      inputs: [{ name: 'in', connection: { nodeId: 'Read1', outputId: 'out' } }],
      knobs: { fileType: { value: 'image/exr' }, compression: { value: 'none' } }
    }
  ]
};
fs.writeFileSync(primaryProject, JSON.stringify(baseProject, null, 2), 'utf8');

// Worker script that starts an editing session, adds a Grade node, writes autosave, and loops
const workerScript = path.join(testDir, 'editor_session.mjs');
const workerCode = `
import fs from 'node:fs';
import { AutosaveManager } from '../../../src/core/AutosaveManager.js';
import { Graph } from '../../../src/core/Graph.js';
import { createNode } from '../../../src/nodes/index.js';

const projectPath = process.argv[2];
const g = new Graph();
const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
g.deserialize(data, createNode);

const mgr = new AutosaveManager({
  projectPath: projectPath,
  getProjectData: () => g.serialize(),
  intervalMs: 1000
});

// Simulate artist adding a Grade node with 2.5x gain
const grade = createNode('Grade', 'Grade_Recovered');
grade.setKnobValue('gain', 2.5);
g.addNode(grade);

// Reconnect Read1 -> Grade_Recovered -> Write1
g.connect('Read1', 'out', 'Grade_Recovered', 'in');
g.connect('Grade_Recovered', 'out', 'Write1', 'in');

mgr.markDirty();
const saved = mgr.saveSnapshot(true);
if (!saved) {
  console.error('[EDITOR] Failed to write autosave snapshot');
  process.exit(1);
}
console.log('[EDITOR] Autosave snapshot written by worker process PID:', process.pid);

// Spin indefinitely to simulate active GUI workstation waiting for a crash
setInterval(() => {}, 1000);
`;
fs.writeFileSync(workerScript, workerCode, 'utf8');

console.log('[CRASH TEST] 1. Launching active editing workstation session...');
const worker = spawn('node', [workerScript, primaryProject], {
  stdio: ['inherit', 'pipe', 'pipe']
});

let workerPid = worker.pid;
console.log(`[CRASH TEST] Workstation session running as PID: ${workerPid}`);

worker.stdout.on('data', (d) => {
  const line = d.toString();
  process.stdout.write(`  [Worker Out] ${line}`);
  if (line.includes('Autosave snapshot written')) {
    // Process has written autosave. Now forcefully kill it!
    console.log(`\n[CRASH TEST] 2. Simulating sudden power failure / process crash (KILL PID ${workerPid})...`);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(workerPid)]);
    } else {
      process.kill(workerPid, 'SIGKILL');
    }
    
    // Verify process is dead
    setTimeout(verifyRecovery, 1000);
  }
});

worker.stderr.on('data', (d) => {
  process.stderr.write(`  [Worker Err] ${d.toString()}`);
});

function verifyRecovery() {
  console.log('[CRASH TEST] 3. Verifying autosave snapshot exists on disk...');
  assert(fs.existsSync(autosaveFile), `Autosave snapshot "${autosaveFile}" must exist`);
  const stat = fs.statSync(autosaveFile);
  console.log(`[CRASH TEST] Autosave snapshot confirmed: ${stat.size} bytes`);

  // Verify that the original project file does NOT have Grade_Recovered
  const origData = JSON.parse(fs.readFileSync(primaryProject, 'utf8'));
  const origNodeIds = origData.nodes.map(n => n.id);
  assert(!origNodeIds.includes('Grade_Recovered'), 'Original file must NOT have recovered node');

  // Verify that autosave DOES have Grade_Recovered
  const autoData = JSON.parse(fs.readFileSync(autosaveFile, 'utf8'));
  const autoNodeIds = (autoData.data ? autoData.data.nodes : autoData.nodes).map(n => n.id);
  assert(autoNodeIds.includes('Grade_Recovered'), 'Autosave MUST have Grade_Recovered');
  console.log('[CRASH TEST] 4. Autosave snapshot validated with unsaved DAG modifications.');

  // Now render using opencomp-render with --recover flag
  console.log('[CRASH TEST] 5. Invoking opencomp-render --recover from CLI...');
  const renderCmd = spawnSync('node', [
    'bin/opencomp-render.mjs',
    '-p', primaryProject,
    '-o', renderedOutput,
    '-f', '1',
    '--recover',
    '--overwrite'
  ], { encoding: 'utf8' });

  console.log(renderCmd.stdout);
  if (renderCmd.status !== 0) {
    console.error(renderCmd.stderr);
    throw new Error(`Renderer exited with code ${renderCmd.status}`);
  }

  const finalRenderedFrame = path.join(testDir, 'recovered_render.0001.exr');
  assert(fs.existsSync(finalRenderedFrame), `Rendered recovered frame "${finalRenderedFrame}" must exist`);
  console.log(`[CRASH TEST] 6. Rendered recovered output frame: "${finalRenderedFrame}"`);

  // Inspect rendered frame with Python OpenEXR to verify 2.5x gain is present
  console.log('[CRASH TEST] 7. Inspecting pixel values to prove recovered Grade node executed...');
  const pyCheck = spawnSync('.venv\\Scripts\\python.exe', [
    '-c',
    `import OpenEXR, Imath, numpy as np
f = OpenEXR.InputFile(r"${finalRenderedFrame}")
pt = Imath.PixelType(Imath.PixelType.FLOAT)
arr = np.frombuffer(f.channel('R', pt), dtype=np.float32)
print(f"Recovered frame mean R: {np.mean(arr):.4f}, max R: {np.max(arr):.4f}")
assert np.max(arr) > 2.0, "Max pixel value must reflect 2.5x gain from recovered Grade node"
`
  ], { encoding: 'utf8' });

  console.log(pyCheck.stdout);
  if (pyCheck.status !== 0) {
    console.error(pyCheck.stderr);
    throw new Error('Python verification of recovered frame failed');
  }

  console.log('🎉 RECOVERY VERIFICATION SUCCESS: Autosave survived forced process kill and rendered with full fidelity!');
  process.exit(0);
}
