/**
 * Generates a real standalone OpenComp project file for CLI batch rendering test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Graph } from '../../src/core/Graph.js';
import { createNode } from '../../src/nodes/index.js';

const g = new Graph();

const read = createNode('Read', 'Read1');
read.setKnobValue('sourceType', 'ramp');
read.setKnobValue('format', '1920x1080');

const grade = createNode('Grade', 'Grade1');
grade.setKnobValue('gain', 1.25);
grade.setKnobValue('gamma', 0.9);
grade.setKeyframe('gain', 1, 1.0);
grade.setKeyframe('gain', 5, 1.5);

const blur = createNode('Blur', 'Blur1');
blur.setKnobValue('size', 6);

const xform = createNode('Transform', 'Transform1');
xform.setKeyframe('translateX', 1, 0);
xform.setKeyframe('translateX', 5, 80);

const write = createNode('Write', 'Write_Final');
write.setKnobValue('file', 'tests/final_audit/renders/real_shot.####.exr');
write.setKnobValue('compression', 'dwaa');
write.setKnobValue('compressionQuality', 45.0);
write.setKnobValue('firstFrame', 1);
write.setKnobValue('lastFrame', 5);

g.addNode(read);
g.addNode(grade);
g.addNode(blur);
g.addNode(xform);
g.addNode(write);

g.connect('Read1', 'out', 'Grade1', 'in');
g.connect('Grade1', 'out', 'Blur1', 'in');
g.connect('Blur1', 'out', 'Transform1', 'in');
g.connect('Transform1', 'out', 'Write_Final', 'in');

const serialized = g.serialize();
const projectFile = path.resolve('tests/final_audit/real_shot_project.opencomp');
fs.writeFileSync(projectFile, JSON.stringify(serialized, null, 2), 'utf8');
console.log(`Saved real project to: ${projectFile}`);

