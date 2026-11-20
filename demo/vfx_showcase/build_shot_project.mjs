import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Graph } from '../../src/core/Graph.js';
import * as nodeClasses from '../../src/nodes/index.js';
import { RotoShape, RotoControlPoint } from '../../src/core/RotoSpline.js';
import { PaintStroke } from '../../src/core/PaintStroke.js';
import { NukeScriptIO } from '../../src/core/NukeScriptIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

export function createCinematicVfxGraph() {
  const graph = new Graph();

  // Helper to instantiate node
  function makeNode(ClassType, id, name, x, y) {
    const node = new ClassType();
    node.id = id;
    node.name = name;
    node.x = x;
    node.y = y;
    graph.addNode(node);
    return node;
  }

  // ---------------------------------------------------------------------------
  // STAGE 1: ROTO & SUBJECT ISOLATION
  // ---------------------------------------------------------------------------
  const readChar = makeNode(nodeClasses.ReadNode, 'Read_Character', 'Read_Character', 120, 100);
  readChar.knobs.sourceType.value = 'file';
  readChar.knobs.file.value = 'demo/vfx_showcase/source/character_plate.%04d.exr';
  readChar.knobs.format.value = '1920x1080';
  readChar.knobs.first.value = 1;
  readChar.knobs.last.value = 120;
  readChar.knobs.channels.value = 'rgba';

  const rotoSubj = makeNode(nodeClasses.RotoNode, 'Roto_Subject', 'Roto_Subject', 120, 240);
  // Shape 1: Cloak & Torso
  const cloakShape = new RotoShape('Cloak_Torso');
  cloakShape.color = '#ff6b4a';
  cloakShape.feather = 2.0;
  // Keyframe shape points across frame 1, 60, 120
  const ptCloakTop = new RotoControlPoint(960, 480);
  ptCloakTop.setKey(1, 960, 480, -30, -10, 30, 10, 2.0);
  ptCloakTop.setKey(60, 965, 475, -30, -10, 30, 10, 2.0);
  ptCloakTop.setKey(120, 970, 480, -30, -10, 30, 10, 2.0);

  const ptCloakRight = new RotoControlPoint(1030, 720);
  ptCloakRight.setKey(1, 1030, 720, -20, -80, 10, 80, 2.0);
  ptCloakRight.setKey(60, 1035, 715, -20, -80, 10, 80, 2.0);
  ptCloakRight.setKey(120, 1040, 720, -20, -80, 10, 80, 2.0);

  const ptCloakBottom = new RotoControlPoint(920, 880);
  ptCloakBottom.setKey(1, 920, 880, 30, -10, -30, 10, 2.0);
  ptCloakBottom.setKey(60, 925, 875, 30, -10, -30, 10, 2.0);
  ptCloakBottom.setKey(120, 930, 880, 30, -10, -30, 10, 2.0);

  const ptCloakLeft = new RotoControlPoint(890, 700);
  ptCloakLeft.setKey(1, 890, 700, -10, 80, 20, -80, 2.0);
  ptCloakLeft.setKey(60, 895, 695, -10, 80, 20, -80, 2.0);
  ptCloakLeft.setKey(120, 900, 700, -10, 80, 20, -80, 2.0);

  cloakShape.addPoint(ptCloakTop);
  cloakShape.addPoint(ptCloakRight);
  cloakShape.addPoint(ptCloakBottom);
  cloakShape.addPoint(ptCloakLeft);
  rotoSubj.addShape(cloakShape);

  // Shape 2: Hooded Head Silhouette
  const hoodShape = new RotoShape('Head_Hood');
  hoodShape.color = '#38d9a9';
  hoodShape.feather = 1.5;
  const ptHoodTop = new RotoControlPoint(960, 370);
  ptHoodTop.setKey(1, 960, 370, -25, 0, 25, 0, 1.5);
  ptHoodTop.setKey(60, 965, 368, -25, 0, 25, 0, 1.5);
  ptHoodTop.setKey(120, 970, 370, -25, 0, 25, 0, 1.5);

  const ptHoodRight = new RotoControlPoint(985, 410);
  ptHoodRight.setKey(1, 985, 410, 0, -20, -5, 30, 1.5);
  ptHoodRight.setKey(60, 990, 408, 0, -20, -5, 30, 1.5);
  ptHoodRight.setKey(120, 995, 410, 0, -20, -5, 30, 1.5);

  const ptHoodBottom = new RotoControlPoint(960, 460);
  ptHoodBottom.setKey(1, 960, 460, 15, 0, -15, 0, 1.5);
  ptHoodBottom.setKey(60, 965, 458, 15, 0, -15, 0, 1.5);
  ptHoodBottom.setKey(120, 970, 460, 15, 0, -15, 0, 1.5);

  const ptHoodLeft = new RotoControlPoint(935, 410);
  ptHoodLeft.setKey(1, 935, 410, 5, 30, 0, -20, 1.5);
  ptHoodLeft.setKey(60, 940, 408, 5, 30, 0, -20, 1.5);
  ptHoodLeft.setKey(120, 945, 410, 5, 30, 0, -20, 1.5);

  hoodShape.addPoint(ptHoodTop);
  hoodShape.addPoint(ptHoodRight);
  hoodShape.addPoint(ptHoodBottom);
  hoodShape.addPoint(ptHoodLeft);
  rotoSubj.addShape(hoodShape);

  // Shape 3: Staff Prop
  const staffShape = new RotoShape('Staff_Prop');
  staffShape.color = '#ffd43b';
  staffShape.feather = 1.0;
  staffShape.addPoint(new RotoControlPoint(1060, 310, 1058, 300, 1062, 320));
  staffShape.addPoint(new RotoControlPoint(1055, 600, 1055, 500, 1055, 700));
  staffShape.addPoint(new RotoControlPoint(1050, 920, 1052, 900, 1048, 930));
  staffShape.addPoint(new RotoControlPoint(1040, 920, 1038, 930, 1042, 900));
  staffShape.addPoint(new RotoControlPoint(1045, 600, 1045, 700, 1045, 500));
  staffShape.addPoint(new RotoControlPoint(1050, 310, 1048, 320, 1052, 300));
  rotoSubj.addShape(staffShape);

  graph.connect('Read_Character', 'out', 'Roto_Subject', 'in');

  const premultChar = makeNode(nodeClasses.PremultNode, 'Premult_Char', 'Premult_Char', 120, 380);
  graph.connect('Roto_Subject', 'out', 'Premult_Char', 'in');

  const gradeRim = makeNode(nodeClasses.GradeNode, 'Grade_Rim', 'Grade_Rim', 120, 520);
  gradeRim.knobs.gain.value = 1.25;
  gradeRim.knobs.gamma.value = 1.06;
  graph.connect('Premult_Char', 'out', 'Grade_Rim', 'in');

  // ---------------------------------------------------------------------------
  // STAGE 2: PAINT & CLEANUP
  // ---------------------------------------------------------------------------
  const readBG = makeNode(nodeClasses.ReadNode, 'Read_BG', 'Read_BG', 460, 100);
  readBG.knobs.sourceType.value = 'file';
  readBG.knobs.file.value = 'demo/vfx_showcase/source/bg_plate.%04d.exr';
  readBG.knobs.format.value = '1920x1080';
  readBG.knobs.first.value = 1;
  readBG.knobs.last.value = 120;
  readBG.knobs.channels.value = 'rgba';

  const paintCleanup = makeNode(nodeClasses.PaintNode, 'Paint_RigCleanup', 'Paint_RigCleanup', 460, 240);
  // Stroke 1: Wire rig cleanup clone stroke (vertical wire at X=960)
  const wireStroke = new PaintStroke('clone');
  wireStroke.size = 32;
  wireStroke.hardness = 0.25;
  wireStroke.opacity = 1.0;
  wireStroke.cloneOffset = { dx: 140, dy: 0 };
  wireStroke.lifetime = 'all';
  wireStroke.startFrame = 1;
  wireStroke.endFrame = 120;
  for (let y = 40; y <= 620; y += 30) {
    wireStroke.addPoint(960, y, 1.0);
  }
  paintCleanup.strokes.push(wireStroke);

  // Stroke 2: Tracking marker cleanup clone stroke (marker at X=1420, Y=340)
  const markerStroke = new PaintStroke('clone');
  markerStroke.size = 40;
  markerStroke.hardness = 0.2;
  markerStroke.opacity = 1.0;
  markerStroke.cloneOffset = { dx: -70, dy: -45 };
  markerStroke.lifetime = 'all';
  markerStroke.startFrame = 1;
  markerStroke.endFrame = 120;
  markerStroke.addPoint(1420, 340, 1.0);
  paintCleanup.strokes.push(markerStroke);

  graph.connect('Read_BG', 'out', 'Paint_RigCleanup', 'in');

  // ---------------------------------------------------------------------------
  // STAGE 3: DEPTH & ZDEFOCUS
  // ---------------------------------------------------------------------------
  const readDepth = makeNode(nodeClasses.ReadNode, 'Read_Depth', 'Read_Depth', 800, 100);
  readDepth.knobs.sourceType.value = 'file';
  readDepth.knobs.file.value = 'demo/vfx_showcase/depth/depth_pass.%04d.exr';
  readDepth.knobs.format.value = '1920x1080';
  readDepth.knobs.first.value = 1;
  readDepth.knobs.last.value = 120;
  readDepth.knobs.channels.value = 'rgba';

  const zDefocus = makeNode(nodeClasses.ZDefocusNode, 'ZDefocus_BG', 'ZDefocus_BG', 460, 380);
  zDefocus.knobs.focusPlane.value = 0.50;
  zDefocus.knobs.depthOfField.value = 0.12;
  zDefocus.knobs.maxDefocus.value = 14.0;
  zDefocus.knobs.aspectRatio.value = 1.0;
  zDefocus.knobs.bloom.value = 0.25;
  graph.connect('Paint_RigCleanup', 'out', 'ZDefocus_BG', 'in');
  graph.connect('Read_Depth', 'out', 'ZDefocus_BG', 'depth');

  const gradeHaze = makeNode(nodeClasses.GradeNode, 'Grade_Atmosphere', 'Grade_Atmosphere', 460, 520);
  gradeHaze.knobs.lift.value = 0.04;
  gradeHaze.knobs.gain.value = 1.02;
  gradeHaze.knobs.gamma.value = 0.98;
  graph.connect('ZDefocus_BG', 'out', 'Grade_Atmosphere', 'in');

  // ---------------------------------------------------------------------------
  // STAGE 4: FINAL COMPOSITE, MASTER GRADE & OUTPUT
  // ---------------------------------------------------------------------------
  const mergeSubject = makeNode(nodeClasses.MergeNode, 'Merge_Char_Over_BG', 'Merge_Char_Over_BG', 320, 660);
  mergeSubject.knobs.operation.value = 'over';
  graph.connect('Grade_Atmosphere', 'out', 'Merge_Char_Over_BG', 'B');
  graph.connect('Grade_Rim', 'out', 'Merge_Char_Over_BG', 'A');

  const readFG = makeNode(nodeClasses.ReadNode, 'Read_FG', 'Read_FG', 650, 660);
  readFG.knobs.sourceType.value = 'file';
  readFG.knobs.file.value = 'demo/vfx_showcase/source/fg_element.%04d.exr';
  readFG.knobs.format.value = '1920x1080';
  readFG.knobs.first.value = 1;
  readFG.knobs.last.value = 120;
  readFG.knobs.channels.value = 'rgba';

  const mergeFG = makeNode(nodeClasses.MergeNode, 'Merge_FG_Over', 'Merge_FG_Over', 320, 780);
  mergeFG.knobs.operation.value = 'over';
  graph.connect('Merge_Char_Over_BG', 'out', 'Merge_FG_Over', 'B');
  graph.connect('Read_FG', 'out', 'Merge_FG_Over', 'A');

  const gradeMaster = makeNode(nodeClasses.GradeNode, 'Grade_FilmMaster', 'Grade_FilmMaster', 320, 900);
  gradeMaster.knobs.lift.value = 0.015;
  gradeMaster.knobs.gain.value = 1.05;
  gradeMaster.knobs.gamma.value = 1.05;
  gradeMaster.knobs.blackClamp.value = true;
  graph.connect('Merge_FG_Over', 'out', 'Grade_FilmMaster', 'in');

  const writeComp = makeNode(nodeClasses.WriteNode, 'Write_FinalComp', 'Write_FinalComp', 320, 1020);
  writeComp.knobs.filePrefix.value = 'demo/vfx_showcase/render/final_comp.';
  writeComp.knobs.fileType.value = 'exr';
  writeComp.knobs.datatype.value = '16-bit float';
  writeComp.knobs.compression.value = 'zip';
  graph.connect('Grade_FilmMaster', 'out', 'Write_FinalComp', 'in');

  const viewer = makeNode(nodeClasses.ViewerNode, 'Viewer_Master', 'Viewer_Master', 100, 1020);
  viewer.knobs.activeInput.value = '1';
  viewer.knobs.compareMode.value = 'wipe';
  viewer.knobs.sourceA.value = '1';
  viewer.knobs.sourceB.value = '2';
  viewer.knobs.wipePosition.value = 0.50;
  graph.connect('Grade_FilmMaster', 'out', 'Viewer_Master', '1');
  graph.connect('Paint_RigCleanup', 'out', 'Viewer_Master', '2');
  graph.connect('Roto_Subject', 'out', 'Viewer_Master', '3');
  graph.connect('Read_Depth', 'out', 'Viewer_Master', '4');

  return graph;
}

// Build and serialize project
const graph = createCinematicVfxGraph();
const serialized = graph.serialize();

const projectData = {
  version: '1.0',
  name: 'OpenComp Cinematic VFX Production Showcase',
  description: '5.0-Second (120-frame) 1080p Cinematic VFX Shot demonstrating ROTO, DEPTH, PAINT & COMPOSITING',
  format: '1920x1080',
  frameRange: {
    start: 1,
    end: 120,
    current: 60,
    fps: 24
  },
  nodes: serialized.nodes
};

const opencompPath = path.resolve(__dirname, 'cinematic_vfx_shot.opencomp');
fs.writeFileSync(opencompPath, JSON.stringify(projectData, null, 2), 'utf-8');
console.log(`Saved OpenComp project to: ${opencompPath}`);

// Also export to Foundry Nuke .nk script
const nukeScript = NukeScriptIO.exportToNuke(graph);
const nukePath = path.resolve(__dirname, 'cinematic_vfx_shot.nk');
fs.writeFileSync(nukePath, nukeScript, 'utf-8');
console.log(`Saved Nuke cross-compatibility script to: ${nukePath}`);
