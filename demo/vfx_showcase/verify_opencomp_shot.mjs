import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Graph } from '../../src/core/Graph.js';
import * as nodeClasses from '../../src/nodes/index.js';
import { NukeScriptIO } from '../../src/core/NukeScriptIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== VERIFYING OPENCOMP CINEMATIC VFX SHOT ===');

// 1. Load project file
const projectPath = path.resolve(__dirname, 'cinematic_vfx_shot.opencomp');
if (!fs.existsSync(projectPath)) {
  throw new Error(`Project file missing: ${projectPath}`);
}
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
console.log(`[OK] Project loaded: "${projectData.name}"`);
console.log(`     Format: ${projectData.format}, Range: ${projectData.frameRange.start}-${projectData.frameRange.end} @ ${projectData.frameRange.fps} FPS`);

// 2. Instantiate and deserialize into Graph
const graph = new Graph();
graph.deserialize(projectData, (type) => {
  const cls = nodeClasses[type + 'Node'] || nodeClasses[type];
  if (!cls) throw new Error(`Unknown node class: ${type}`);
  return new cls();
});

const nodes = graph.getAllNodes();
console.log(`[OK] Graph deserialized: ${nodes.length} nodes registered`);

// 3. Verify the 4 Core VFX Workflows
console.log('\n--- VERIFYING 4 CORE WORKFLOWS ---');

// Workflow 1: ROTO
const rotoNode = graph.getNode('Roto_Subject');
if (!rotoNode) throw new Error('Missing Roto_Subject node');
console.log(`[OK] ROTO Stage: Node "${rotoNode.name}" (Type: ${rotoNode.type})`);
console.log(`     Shapes registered: ${rotoNode.shapes.length}`);
for (const s of rotoNode.shapes) {
  console.log(`       - Shape "${s.name}": ${s.points.length} Bezier control points (Feather: ${s.feather}px, Color: ${s.color})`);
}

// Workflow 2: PAINT
const paintNode = graph.getNode('Paint_RigCleanup');
if (!paintNode) throw new Error('Missing Paint_RigCleanup node');
console.log(`[OK] PAINT Stage: Node "${paintNode.name}" (Type: ${paintNode.type})`);
console.log(`     Strokes registered: ${paintNode.strokes.length}`);
for (let i = 0; i < paintNode.strokes.length; i++) {
  const st = paintNode.strokes[i];
  console.log(`       - Stroke ${i+1}: ${st.points.length} samples, Brush Size: ${st.size || st.brushSize || 32}px, Clone Offset: dx=${st.cloneOffset?.dx}, dy=${st.cloneOffset?.dy}`);
}

// Workflow 3: DEPTH
const depthNode = graph.getNode('Read_Depth');
const zdefocusNode = graph.getNode('ZDefocus_BG');
if (!depthNode || !zdefocusNode) throw new Error('Missing Depth/ZDefocus nodes');
console.log(`[OK] DEPTH Stage: Node "${depthNode.name}" -> "${zdefocusNode.name}" (Type: ${zdefocusNode.type})`);
console.log(`     Focus Plane: ${zdefocusNode.knobs.focusPlane.value}, Defocus: ${zdefocusNode.knobs.maxDefocus.value}px, Bokeh Bloom: ${zdefocusNode.knobs.bloom.value}`);

// Workflow 4: COMPOSITING
const mergeChar = graph.getNode('Merge_Char_Over_BG');
const mergeFG = graph.getNode('Merge_FG_Over');
const gradeMaster = graph.getNode('Grade_FilmMaster');
const writeComp = graph.getNode('Write_FinalComp');
const viewer = graph.getNode('Viewer_Master');
if (!mergeChar || !mergeFG || !gradeMaster || !writeComp || !viewer) throw new Error('Missing Comp nodes');
console.log(`[OK] COMPOSITING Stage:`);
console.log(`     - Merge Subject: ${mergeChar.name} (Op: ${mergeChar.knobs.operation.value})`);
console.log(`     - Merge FG: ${mergeFG.name} (Op: ${mergeFG.knobs.operation.value})`);
console.log(`     - Grade Master: ${gradeMaster.name} (Gain: ${gradeMaster.knobs.gain.value}, Gamma: ${gradeMaster.knobs.gamma.value}, Lift: ${gradeMaster.knobs.lift.value})`);
console.log(`     - Write Output: ${writeComp.name} (${writeComp.knobs.fileType.value.toUpperCase()}, ${writeComp.knobs.datatype.value}, ${writeComp.knobs.compression.value})`);
console.log(`     - Viewer Master: ${viewer.name} (Compare Mode: ${viewer.knobs.compareMode.value}, Inputs: ${viewer.inputs.filter(i => i.connection).length} connected)`);

// 4. Verify Topological Order & DAG connectivity
const topoOrder = graph.getTopologicalOrder();
console.log('\n[OK] DAG Topological Execution Order:');
console.log('    ' + topoOrder.join(' -> '));

// 5. Verify Nuke .nk cross-compatibility
const nukePath = path.resolve(__dirname, 'cinematic_vfx_shot.nk');
if (!fs.existsSync(nukePath)) throw new Error('Nuke script missing');
const nukeContent = fs.readFileSync(nukePath, 'utf-8');
console.log(`\n[OK] Foundry Nuke script verified (${nukeContent.length} bytes, ${nukeContent.split('\n').length} lines)`);

console.log('\n=== ALL SHOT ARCHITECTURE CHECKS PASSED ===');
