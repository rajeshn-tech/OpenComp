import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

function evaluateShot(pruneChannels) {
  const graph = new Graph();
  graph.deserialize(projectData, createNode);

  for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
    const pattern = n.getKnobValue('file');
    if (pattern) {
      const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
      const buf = ImageIO.readEXR(fs.readFileSync(f1Path));
      if (pruneChannels) {
        for (const k of ['R', 'G', 'B', 'A', 'r', 'g', 'b', 'a', 'red', 'green', 'blue', 'alpha']) {
          buf.extraChannels.delete(k);
        }
      }
      n.setSequenceFrame(1, buf);
    }
  }

  return graph.evaluate('Viewer_Master', { frame: 1 });
}

console.log('Evaluating Unpruned reference output...');
const refOut = evaluateShot(false);

console.log('Evaluating Pruned optimized output...');
const optOut = evaluateShot(true);

const refData = refOut.data;
const optData = optOut.data;

let maxAbsErr = 0;
let sumAbsErr = 0;
let sumSqErr = 0;
const N = refData.length;

for (let i = 0; i < N; i++) {
  const err = Math.abs(optData[i] - refData[i]);
  if (err > maxAbsErr) maxAbsErr = err;
  sumAbsErr += err;
  sumSqErr += err * err;
}

const mae = sumAbsErr / N;
const rmse = Math.sqrt(sumSqErr / N);

console.log('\n--- Numerical Parity Verification ---');
console.log(`Pixel count evaluated: ${N / 4} (1920x1080)`);
console.log(`Max Absolute Error: ${maxAbsErr.toExponential(6)}`);
console.log(`MAE:                ${mae.toExponential(6)}`);
console.log(`RMSE:               ${rmse.toExponential(6)}`);

if (maxAbsErr === 0) {
  console.log('✅ PERFECT 100% BIT-EXACT PARITY CONFIRMED!');
} else {
  console.log('❌ Parity mismatch found!');
}

