import fs from 'fs';
const proj = JSON.parse(fs.readFileSync('demo/vfx_showcase/cinematic_vfx_shot.opencomp', 'utf8'));
const zd = proj.nodes.find(n => n.id === 'ZDefocus_BG' || n.type === 'ZDefocus');
console.log(JSON.stringify(zd, null, 2));
