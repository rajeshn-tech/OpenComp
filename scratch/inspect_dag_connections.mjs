import fs from 'fs';
import path from 'path';

const projectPath = path.join(process.cwd(), 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

console.log('Project Name:', projectData.name);
console.log('Total Nodes:', projectData.nodes.length);
console.log('\nNodes and their inputs:');
for (const n of projectData.nodes) {
  console.log(`- ${n.id.padEnd(20)} (${n.type.padEnd(10)}):`);
  if (n.inputs) {
    for (const inp of n.inputs) {
      if (inp.connection) {
        console.log(`    [${inp.id}] <- ${inp.connection.nodeId}:${inp.connection.outputPortId}`);
      } else {
        console.log(`    [${inp.id}] (disconnected)`);
      }
    }
  }
}
