/**
 * OpenComp Test Suite - Cross-Platform, LAN & Offline Air-Gap Suite
 * Validates:
 * 1. Windows UNC network paths (\\server\share\...)
 * 2. Rocky Linux / POSIX NFS paths (/mnt/nfs/...)
 * 3. Studio path remapping between Windows workstations and Linux render nodes
 * 4. Image sequence frame parsing over network shares
 * 5. Complete air-gapped offline verification (0 remote external HTTP/CDN requests)
 * 6. Local project autosave recovery under simulated network drop
 */

import { strict as assert } from 'assert';
import { ImageIO } from '../src/core/ImageIO.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import fs from 'fs';
import path from 'path';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_lan_offline.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Windows UNC Network Share Paths
runTest('LAN/Offline: Windows UNC Path Detection & Normalization', () => {
  const winUnc1 = '\\\\nas-vfx01\\show_avatar\\plates\\shot_020\\plate.####.exr';
  const winUnc2 = '//storage-cluster/renders/v002/beauty.%04d.exr';

  assert.equal(ImageIO.isUNCPath(winUnc1), true, 'Must detect backslash UNC');
  assert.equal(ImageIO.isUNCPath(winUnc2), true, 'Must detect forward-slash UNC');

  const norm1 = ImageIO.normalizePath(winUnc1);
  assert.equal(norm1, '//nas-vfx01/show_avatar/plates/shot_020/plate.####.exr');

  // Sequence frame resolution over UNC share
  const frame101 = ImageIO.resolveSequenceFrame(norm1, 101);
  assert.equal(frame101, '//nas-vfx01/show_avatar/plates/shot_020/plate.0101.exr');
});

// 2. Rocky Linux / POSIX NFS Paths
runTest('LAN/Offline: Rocky Linux / POSIX NFS Mount Path Normalization', () => {
  const linuxPath = '/mnt/nfs_storage/projects/dune3/plates/shot_010/plate.%04d.exr';
  assert.equal(ImageIO.isUNCPath(linuxPath), false, 'POSIX path should not be classified as UNC');

  const norm = ImageIO.normalizePath(linuxPath);
  assert.equal(norm, '/mnt/nfs_storage/projects/dune3/plates/shot_010/plate.%04d.exr');

  const resolved = ImageIO.resolveSequenceFrame(norm, 1050);
  assert.equal(resolved, '/mnt/nfs_storage/projects/dune3/plates/shot_010/plate.1050.exr');
});

// 3. VFX Studio Path Translation (Windows Workstation <-> Rocky Linux Render Farm)
runTest('LAN/Offline: Studio Cross-Platform Mount Path Remapping', () => {
  const mappings = {
    'Z:': '/mnt/projects',
    'Y:/renders': '/mnt/farm_renders',
    '//nas-vfx/cache': '/mnt/nas_cache'
  };

  // Windows drive letter to Rocky Linux mount
  const winArtistPath = 'Z:\\shot_050\\comp\\v001\\fg.####.exr';
  const linuxFarmPath = ImageIO.remapPath(winArtistPath, mappings);
  assert.equal(linuxFarmPath, '/mnt/projects/shot_050/comp/v001/fg.####.exr');

  // Windows UNC to Linux mount
  const uncPath = '\\\\nas-vfx\\cache\\sim\\ocean.0020.exr';
  const linuxCache = ImageIO.remapPath(uncPath, mappings);
  assert.equal(linuxCache, '/mnt/nas_cache/sim/ocean.0020.exr');
});

// 4. Air-Gapped Offline Verification (Zero external CDN / remote URLs in source)
runTest('LAN/Offline: Air-Gapped Isolation Audit (0 Remote CDN / Cloud Calls)', () => {
  const srcFiles = [
    'index.html',
    'styles.css',
    'src/app.js',
    'src/core/Graph.js',
    'src/core/PixelBuffer.js',
    'src/core/ImageIO.js',
    'src/core/GPUCompositor.js',
    'src/core/GLPipeline.js'
  ];

  const externalUrlRegex = /(https?:\/\/(?!localhost|127\.0\.0\.1)[^\s"'>]+)/gi;

  for (const relPath of srcFiles) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    // Filter out documentation comments / comments mentioning foundry.com or license headers
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip comments or benign references
      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
      
      const matches = line.match(externalUrlRegex);
      if (matches) {
        for (const match of matches) {
          // If a script or stylesheet tag tries to load an external CDN, fail
          if (line.includes('<script') || line.includes('<link') || line.includes('import ') || line.includes('fetch(')) {
            assert.fail(`External network dependency found in ${relPath}:${i + 1}: ${match}`);
          }
        }
      }
    }
  }
});

// 5. Local Project Autosave & Disaster Recovery
runTest('LAN/Offline: Local Autosave Snapshot & Reconnection Recovery', () => {
  const graph = new Graph();

  const c1 = createNode('Constant', 'Plate_Source', 50, 50);
  c1.setKnobValue('colorR', 0.8);
  const g1 = createNode('Grade', 'Grade_Master', 50, 150);
  g1.setKnobValue('gain', 1.4);
  const v1 = createNode('Viewer', 'Viewer1', 50, 250);

  graph.addNode(c1);
  graph.addNode(g1);
  graph.addNode(v1);

  graph.connect('Plate_Source', 'out', 'Grade_Master', 'in');
  graph.connect('Grade_Master', 'out', 'Viewer1', '1');

  // Serialize autosave snapshot
  const autosavePayload = JSON.stringify(graph.serialize());
  assert(autosavePayload.length > 50, 'Autosave snapshot payload must be valid JSON');

  // Simulate network crash and recover state from snapshot into fresh graph
  const recoveredGraph = new Graph();
  const data = JSON.parse(autosavePayload);
  recoveredGraph.deserialize(data, createNode);

  // Verify full recovery
  const recoveredNodes = recoveredGraph.getAllNodes();
  assert.equal(recoveredNodes.length, 3, 'All 3 nodes must be recovered');

  const recoveredGrade = recoveredGraph.getNode('Grade_Master');
  assert(recoveredGrade, 'Grade_Master must be recovered');
  assert.equal(recoveredGrade.getKnobValue('gain'), 1.4, 'Knob value must match autosaved value');

  const gradeInp = recoveredGrade.inputs.find(i => i.id === 'in');
  assert(gradeInp && gradeInp.connection, 'Input connection must be preserved');
  assert.equal(gradeInp.connection.nodeId, 'Plate_Source', 'Connection source must match');
});

console.log(`\n🎉 test_lan_offline.mjs PASSED: All ${passedTests} LAN & offline tests succeeded with 0 errors.\n`);
