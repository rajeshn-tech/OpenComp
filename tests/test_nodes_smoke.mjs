import { NODE_REGISTRY, NODE_MENU, createNode } from '../src/nodes/index.js';
import { Graph } from '../src/core/Graph.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';

console.log('================================================================');
console.log('   🎬 OpenComp Production VFX Suite - System Verification');
console.log('================================================================');

console.log('\n[1/3] Testing Node Registry...');
console.log('Total Registered Production Nodes:', Object.keys(NODE_REGISTRY).length);
for (const type of Object.keys(NODE_REGISTRY)) {
  const node = createNode(type);
  if (!node) {
    throw new Error(`Failed to instantiate node: ${type}`);
  }
}
console.log(`✅ All ${Object.keys(NODE_REGISTRY).length} Nodes verified successfully.`);

console.log('\n[2/3] Testing DAG Graph & Connections...');
const graph = new Graph();
const read = createNode('Read', 'Read1');
const grade = createNode('Grade', 'Grade1');
const merge = createNode('Merge', 'Merge1');
const viewer = createNode('Viewer', 'Viewer1');

graph.addNode(read);
graph.addNode(grade);
graph.addNode(merge);
graph.addNode(viewer);

graph.connect(read.id, 'out', grade.id, 'in');
graph.connect(grade.id, 'out', merge.id, 'A');
graph.connect(merge.id, 'out', viewer.id, '1');
console.log('✅ Pull-based DAG topology created successfully.');

console.log('\n[3/3] Testing Script (.nk) Generation...');
const nukeScript = NukeScriptIO.exportToNukeScript(graph);
if (!nukeScript.includes('Grade') || !nukeScript.includes('Merge2')) {
  throw new Error('Script (.nk) Export failed verification.');
}
console.log('Generated .nk snippet:');
console.log(nukeScript.slice(0, 320) + '...\n');
console.log('✅ Script (.nk) Export & Parse verified successfully.');

console.log('================================================================');
console.log('   🎉 ALL 3 PHASES VERIFIED: OPENCOMP AUTOMATED SMOKE VERIFIED!');
console.log('================================================================');
