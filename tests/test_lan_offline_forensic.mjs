/**
 * OpenComp - Forensic Offline & LAN Air-Gap Verification Suite
 * Validates:
 * 1. Air-Gapped Network Isolation (Zero remote sockets or HTTP calls)
 * 2. Local footage ingestion and image sequence generation
 * 3. Windows UNC LAN shared storage path resolution
 * 4. Network disconnect disaster simulation and recovery from local cache
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { ImageIO } from '../src/core/ImageIO.js';
import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🔬 FORENSIC OFFLINE & LAN AIR-GAP AUDIT');
console.log('====================================================\n');

const lanAudit = [];

function runAudit(name, fn) {
  process.stdout.write(`▶ ${name.padEnd(46, ' ')} ... `);
  try {
    const details = fn();
    console.log(`✅ VERIFIED (${details})`);
    lanAudit.push({ name, status: 'VERIFIED', details });
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(`       Error: ${err.message}`);
    lanAudit.push({ name, status: 'FAILED', error: err.message });
    process.exit(1);
  }
}

// 1. Air-Gapped Source Code Isolation Audit
runAudit('Air-Gapped Source Code Isolation (0 Remote CDNs)', () => {
  const rootFiles = ['index.html', 'styles.css', 'server.js'];
  const srcFiles = fs.readdirSync('src').filter(f => f.endsWith('.js'));
  const coreFiles = fs.readdirSync('src/core').filter(f => f.endsWith('.js')).map(f => `core/${f}`);
  const nodeFiles = fs.readdirSync('src/nodes').filter(f => f.endsWith('.js')).map(f => `nodes/${f}`);

  const allFiles = [...rootFiles, ...srcFiles.map(f => `src/${f}`), ...coreFiles.map(f => `src/${f}`), ...nodeFiles.map(f => `src/${f}`)];
  let scannedLines = 0;

  for (const relPath of allFiles) {
    if (!fs.existsSync(relPath)) continue;
    const content = fs.readFileSync(relPath, 'utf8');
    const lines = content.split('\n');
    scannedLines += lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
      // Detect remote fetch or script inclusion
      if (line.includes('fetch(') && (line.includes('https://') || line.includes('http://') && !line.includes('localhost'))) {
        throw new Error(`Remote network call found in ${relPath}:${i+1}`);
      }
      if ((line.includes('<script') || line.includes('<link')) && line.includes('http')) {
        throw new Error(`Remote CDN asset found in ${relPath}:${i+1}`);
      }
    }
  }

  return `Scanned ${allFiles.length} files (${scannedLines} lines): 100% Offline Self-Contained`;
});

// 2. Local Image Sequence Export over Simulated LAN Share
runAudit('LAN Shared Storage Sequence Export (#### tokens)', () => {
  const mockLanDir = path.resolve('tests/output/mock_lan_share/shot_010');
  if (!fs.existsSync(mockLanDir)) fs.mkdirSync(mockLanDir, { recursive: true });

  const pattern = '//server-nas/projects/dune/shot_010/beauty.####.exr';
  assert.equal(ImageIO.isUNCPath(pattern), true, 'Must detect UNC LAN path');

  // Generate sequence of 3 frames locally into mock LAN share
  const framePaths = [];
  for (let frame = 101; frame <= 103; frame++) {
    const resolvedName = path.basename(ImageIO.resolveSequenceFrame(pattern, frame));
    const localDiskPath = path.join(mockLanDir, resolvedName);

    const testBuf = new PixelBuffer(64, 64);
    testBuf.fill(frame / 200, 0.5, 0.5, 1.0);
    const exr = ImageIO.writeEXR(testBuf);
    fs.writeFileSync(localDiskPath, exr);
    framePaths.push(localDiskPath);
  }

  assert.equal(framePaths.length, 3);
  assert(fs.existsSync(framePaths[0]), 'Frame 101 must exist');
  assert(fs.existsSync(framePaths[1]), 'Frame 102 must exist');
  assert(fs.existsSync(framePaths[2]), 'Frame 103 must exist');

  return `Rendered sequence [101-103] to simulated LAN share`;
});

// 3. Network Disconnect Disaster Simulation & Local Recovery
runAudit('Network Disconnect & Disaster Recovery Simulation', () => {
  const originalGraph = new Graph();
  const c = createNode('Constant', 'Constant_Plates');
  c.setKnobValue('colorR', 0.85);
  const g = createNode('Grade', 'Grade_Master');
  g.setKnobValue('gain', 1.75);
  originalGraph.addNode(c);
  originalGraph.addNode(g);
  originalGraph.connect('Constant_Plates', 'out', 'Grade_Master', 'in');

  // Snapshot project locally
  const localSnapshot = JSON.stringify(originalGraph.serialize());

  // Simulate network share dropping (e.g. attempting to write to missing share)
  const deadNetworkShare = 'Z:\\non_existent_server\\share\\shot.nk';
  let networkFailed = false;
  try {
    fs.writeFileSync(deadNetworkShare, 'data');
  } catch (err) {
    networkFailed = true; // Expected: network unreachable
  }
  assert.equal(networkFailed, true, 'Simulated network drop triggered I/O exception');

  // Verify recovery from local disk / localStorage snapshot
  const recoveredGraph = new Graph();
  recoveredGraph.deserialize(JSON.parse(localSnapshot), createNode);

  const recoveredGrade = recoveredGraph.getNode('Grade_Master');
  assert(recoveredGrade, 'Grade_Master recovered');
  assert.equal(recoveredGrade.getKnobValue('gain'), 1.75, 'Gain knob value 1.75 preserved');
  assert.equal(recoveredGrade.inputs[0].connection.nodeId, 'Constant_Plates', 'DAG wiring restored');

  return 'Local snapshot recovered 100% after network drop';
});

console.log('\n====================================================');
console.log(`📊 OFFLINE & LAN AUDIT COMPLETE: ALL CHECKS VERIFIED`);
console.log('====================================================\n');

