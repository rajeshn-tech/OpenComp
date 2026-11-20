/**
 * OpenComp - Test Suite 31: Autosave & Crash Recovery System
 * Validates periodic background autosave, multi-generational rotation (.autosave, .bak1, .bak2),
 * atomic snapshot writing via .tmp files, corrupt state rejection, mtime recovery detection,
 * full DAG restore, and clean discard.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AutosaveManager } from '../src/core/AutosaveManager.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

const testDir = path.join(os.tmpdir(), `opencomp_test_autosave_${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ Autosave & Recovery: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Autosave & Recovery: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ Autosave & Recovery: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Autosave & Recovery: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_autosave_recovery.mjs');
console.log('----------------------------------------------------');

// Helper to construct a graph
function createSampleGraph(nodeCount = 3) {
  const g = new Graph();
  const r = createNode('Read', 'Read1');
  g.addNode(r);

  let prevNodeId = 'Read1';
  for (let i = 1; i < nodeCount; i++) {
    const id = `Grade${i}`;
    const grade = createNode('Grade', id);
    grade.setKnobValue('gain', 1.0 + i * 0.1);
    g.addNode(grade);
    g.connect(prevNodeId, 'out', id, 'in');
    prevNodeId = id;
  }
  return g;
}

// 1. Basic Autosave Trigger and Atomic Write
runTest('Autosave Snapshot Creation & Atomic Write Verification', () => {
  const projPath = path.join(testDir, 'shot_v01.opencomp');
  const graph = createSampleGraph(3);

  const manager = new AutosaveManager({
    projectPath: projPath,
    getProjectData: () => graph.serialize(),
    intervalMs: 100000
  });

  const saved = manager.saveSnapshot(true);
  assert.equal(saved, true);

  const autoFile = `${projPath}.autosave`;
  assert(fs.existsSync(autoFile), `Autosave file must exist: ${autoFile}`);

  const content = JSON.parse(fs.readFileSync(autoFile, 'utf8'));
  assert.equal(content.version, '1.0');
  assert(content.timestamp > 0);
  assert.equal(content.data.nodes.length, 3);

  // Check no leftover temporary files
  const files = fs.readdirSync(testDir);
  const tmpFiles = files.filter(f => f.includes('.tmp.'));
  assert.equal(tmpFiles.length, 0, 'No .tmp files should remain after atomic write');
});

// 2. Dirty Tracking Optimization (Avoid Redundant Writes)
runTest('Dirty Tracking & Redundant Write Avoidance', () => {
  const projPath = path.join(testDir, 'dirty_test.opencomp');
  const graph = createSampleGraph(2);

  let saveCount = 0;
  const manager = new AutosaveManager({
    projectPath: projPath,
    getProjectData: () => graph.serialize(),
    onAutosaveComplete: () => { saveCount++; }
  });

  // First save (force=true or clean state)
  const first = manager.saveSnapshot(true);
  assert.equal(first, true);
  assert.equal(saveCount, 1);

  // Second immediate save without changes -> should skip!
  const second = manager.saveSnapshot(false);
  assert.equal(second, false, 'Unmodified state should skip disk write');
  assert.equal(saveCount, 1);

  // Modify graph -> should write!
  const blur = createNode('Blur', 'Blur1');
  graph.addNode(blur);
  manager.markDirty();

  const third = manager.saveSnapshot(false);
  assert.equal(third, true, 'Modified state must trigger autosave write');
  assert.equal(saveCount, 2);
});

// 3. Multi-Generational Rotation (.autosave, .autosave.bak1, .autosave.bak2)
runTest('Multi-Generational Snapshot Rotation (.autosave, .bak1, .bak2)', () => {
  const projPath = path.join(testDir, 'rotation_test.opencomp');
  let currentCount = 1;

  const manager = new AutosaveManager({
    projectPath: projPath,
    maxGenerations: 3,
    getProjectData: () => {
      const g = createSampleGraph(currentCount);
      return g.serialize();
    }
  });

  // Gen 0: 1 node
  currentCount = 1;
  manager.saveSnapshot(true);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8')).data.nodes.length, 1);

  // Gen 1: 2 nodes
  currentCount = 2;
  manager.saveSnapshot(true);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8')).data.nodes.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave.bak1`, 'utf8')).data.nodes.length, 1);

  // Gen 2: 3 nodes
  currentCount = 3;
  manager.saveSnapshot(true);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8')).data.nodes.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave.bak1`, 'utf8')).data.nodes.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave.bak2`, 'utf8')).data.nodes.length, 1);

  // Gen 3: 4 nodes (bak2 gets replaced by old bak1)
  currentCount = 4;
  manager.saveSnapshot(true);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8')).data.nodes.length, 4);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave.bak1`, 'utf8')).data.nodes.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave.bak2`, 'utf8')).data.nodes.length, 2);
});

// 4. Corrupted State Rejection (Preserves Existing Good Autosave)
runTest('Corrupt State Rejection & Preservation of Good Autosave', () => {
  const projPath = path.join(testDir, 'corrupt_test.opencomp');
  const validGraph = createSampleGraph(5);

  let returnCorruptData = false;
  const manager = new AutosaveManager({
    projectPath: projPath,
    getProjectData: () => {
      if (returnCorruptData) return '{ bad_json: undefined ';
      return validGraph.serialize();
    }
  });

  // Save valid initial snapshot
  manager.saveSnapshot(true);
  assert.equal(JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8')).data.nodes.length, 5);

  // Attempt to save corrupt state
  returnCorruptData = true;
  const result = manager.saveSnapshot(true);
  assert.equal(result, false, 'Corrupted data must be rejected');

  // Verify file on disk is untouched and still has 5 nodes!
  const intact = JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8'));
  assert.equal(intact.data.nodes.length, 5, 'Previous valid autosave must remain intact');
});

// 5. Crash Recovery Detection Logic
runTest('Crash Recovery Detection via mtime Comparison', () => {
  const projPath = path.join(testDir, 'recovery_detect.opencomp');

  // Primary project saved at T0
  const gOld = createSampleGraph(2);
  fs.writeFileSync(projPath, JSON.stringify(gOld.serialize()));
  const t0 = new Date(Date.now() - 10000);
  fs.utimesSync(projPath, t0, t0);

  // Autosave saved at T1 (newer than project)
  const gNew = createSampleGraph(4);
  const manager = new AutosaveManager({
    projectPath: projPath,
    getProjectData: () => gNew.serialize()
  });
  manager.saveSnapshot(true);

  // Recovery should be detected!
  const recInfo = manager.checkForRecovery(projPath);
  assert(recInfo !== null, 'Should detect newer autosave snapshot');
  assert.equal(recInfo.hasRecovery, true);
  assert.equal(recInfo.nodeCount, 4);

  // Now simulate user saving the project file at T2 (newer than autosave)
  const t2 = new Date(Date.now() + 5000);
  fs.utimesSync(projPath, t2, t2);

  // Recovery should now be ignored!
  const recInfoAfterSave = manager.checkForRecovery(projPath);
  assert.equal(recInfoAfterSave, null, 'Should ignore older autosave when project file is newer');
});

// 6. Restoration & Discard
runTest('Full DAG Restoration and Clean Discard', () => {
  const projPath = path.join(testDir, 'restore_discard.opencomp');
  const sourceGraph = createSampleGraph(3);

  const manager = new AutosaveManager({
    projectPath: projPath,
    getProjectData: () => sourceGraph.serialize()
  });
  manager.saveSnapshot(true);

  // Restore into a fresh empty graph
  const targetGraph = new Graph();
  targetGraph.nodeFactory = createNode;

  const recovery = manager.checkForRecovery(projPath);
  const restored = manager.restore(targetGraph, recovery.data);
  assert.equal(restored, true);
  assert.equal(targetGraph.getAllNodes().length, 3);
  assert.equal(targetGraph.getNode('Grade2')?.getKnobValue('gain'), 1.2);

  // Discard autosave
  manager.discard(projPath);
  assert.equal(fs.existsSync(`${projPath}.autosave`), false, 'Autosave must be deleted');
  assert.equal(fs.existsSync(`${projPath}.autosave.bak1`), false, 'Bak1 must be deleted');
});

// 7. Periodic Timer Operation
await runAsyncTest('Periodic Timer Autosave Trigger', async () => {
  const projPath = path.join(testDir, 'timer_test.opencomp');
  let counter = 1;

  const manager = new AutosaveManager({
    projectPath: projPath,
    intervalMs: 50, // Rapid interval for test
    getProjectData: () => {
      const g = createSampleGraph(counter++);
      return g.serialize();
    }
  });

  manager.start();
  await new Promise(r => setTimeout(r, 160));
  manager.stop();

  assert(fs.existsSync(`${projPath}.autosave`), 'Timer must have triggered autosave write');
  const autoData = JSON.parse(fs.readFileSync(`${projPath}.autosave`, 'utf8'));
  assert(autoData.data.nodes.length >= 2, 'Timer must have executed multiple cycles');
});

// Cleanup
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 test_autosave_recovery.mjs PASSED: All 7 autosave & recovery tests succeeded with 0 errors.');

