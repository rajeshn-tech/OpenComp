import fs from 'fs';
import path from 'path';

const d = JSON.parse(fs.readFileSync('demo/vfx_showcase/cinematic_vfx_shot.opencomp', 'utf8'));
for (const n of d.nodes.filter(x => x.type === 'Read')) {
  console.log(n.id, n.knobs.file?.value);
}

