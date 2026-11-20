/**
 * OpenComp - Complete Node Registry & Factory
 * Production VFX Node set matching Foundry Nuke.
 */

import { ReadNode } from './ReadNode.js';
import { WriteNode } from './WriteNode.js';
import { ConstantNode } from './ConstantNode.js';
import { RampNode } from './RampNode.js';
import { MergeNode } from './MergeNode.js';
import { PremultNode } from './PremultNode.js';
import { UnpremultNode } from './UnpremultNode.js';
import { GradeNode } from './GradeNode.js';
import { ColorCorrectNode } from './ColorCorrectNode.js';
import { ColorLookupNode } from './ColorLookupNode.js';
import { ColorspaceNode } from './ColorspaceNode.js';
import { InvertNode } from './InvertNode.js';
import { BlurNode } from './BlurNode.js';
import { EdgeBlurNode } from './EdgeBlurNode.js';
import { ErodeNode } from './ErodeNode.js';
import { GlowNode } from './GlowNode.js';
import { TransformNode } from './TransformNode.js';
import { CornerPinNode } from './CornerPinNode.js';
import { CropNode } from './CropNode.js';
import { ReformatNode } from './ReformatNode.js';
import { KeyerNode } from './KeyerNode.js';
import { ShuffleNode } from './ShuffleNode.js';
import { RotoNode } from './RotoNode.js';
import { PaintNode } from './PaintNode.js';
import { DepthNode } from './DepthNode.js';
import { StereoWarpNode } from './StereoWarpNode.js';
import { StereoMergeNode } from './StereoMergeNode.js';
import { DotNode } from './DotNode.js';
import { BackdropNode } from './BackdropNode.js';
import { ViewerNode } from './ViewerNode.js';
import { FrameHoldNode } from './FrameHoldNode.js';
import { SwitchNode } from './SwitchNode.js';
import { ZDefocusNode } from './ZDefocusNode.js';
import { ContactSheetNode } from './ContactSheetNode.js';

export const NODE_REGISTRY = {
  Read: ReadNode,
  Write: WriteNode,
  Constant: ConstantNode,
  Ramp: RampNode,
  ContactSheet: ContactSheetNode,
  Merge: MergeNode,
  Switch: SwitchNode,
  Premult: PremultNode,
  Unpremult: UnpremultNode,
  Grade: GradeNode,
  ColorCorrect: ColorCorrectNode,
  ColorLookup: ColorLookupNode,
  Colorspace: ColorspaceNode,
  Invert: InvertNode,
  Blur: BlurNode,
  EdgeBlur: EdgeBlurNode,
  Erode: ErodeNode,
  Glow: GlowNode,
  ZDefocus: ZDefocusNode,
  Transform: TransformNode,
  CornerPin: CornerPinNode,
  Crop: CropNode,
  Reformat: ReformatNode,
  Keyer: KeyerNode,
  Shuffle: ShuffleNode,
  Roto: RotoNode,
  Paint: PaintNode,
  Depth: DepthNode,
  StereoWarp: StereoWarpNode,
  StereoMerge: StereoMergeNode,
  FrameHold: FrameHoldNode,
  Dot: DotNode,
  Backdrop: BackdropNode,
  Viewer: ViewerNode
};

export const NODE_MENU = [
  {
    category: 'Image',
    items: [
      { type: 'Read', label: 'Read (Load / Footage)', shortcut: 'R' },
      { type: 'Constant', label: 'Constant (Solid Color)' },
      { type: 'Ramp', label: 'Ramp (Gradient Generator)' },
      { type: 'ContactSheet', label: 'ContactSheet (Grid Matrix)' },
      { type: 'Write', label: 'Write (Export Frame)', shortcut: 'W' }
    ]
  },
  {
    category: 'Time',
    items: [
      { type: 'FrameHold', label: 'FrameHold (Freeze Frame)' }
    ]
  },
  {
    category: 'Merge',
    items: [
      { type: 'Merge', label: 'Merge (A/B Composite)', shortcut: 'M' },
      { type: 'Switch', label: 'Switch (Multi-Branch Selector)' },
      { type: 'Premult', label: 'Premult (Multiply by Alpha)', shortcut: 'P' },
      { type: 'Unpremult', label: 'Unpremult (Divide by Alpha)' }
    ]
  },
  {
    category: 'Color',
    items: [
      { type: 'Grade', label: 'Grade (Nuke Math)', shortcut: 'G' },
      { type: 'ColorCorrect', label: 'ColorCorrect', shortcut: 'C' },
      { type: 'ColorLookup', label: 'ColorLookup (Curves / Tonal)' },
      { type: 'Colorspace', label: 'Colorspace (OCIO / ACES / Log)' },
      { type: 'Invert', label: 'Invert' }
    ]
  },
  {
    category: 'Filter',
    items: [
      { type: 'Blur', label: 'Blur (Gaussian 2-Pass)', shortcut: 'B' },
      { type: 'EdgeBlur', label: 'EdgeBlur (Matte Edge Blur)' },
      { type: 'Erode', label: 'Erode / Dilate (Morphology)', shortcut: 'E' },
      { type: 'Glow', label: 'Glow (Optical Bloom)' },
      { type: 'ZDefocus', label: 'ZDefocus (Depth of Field Bokeh)' }
    ]
  },
  {
    category: 'Transform',
    items: [
      { type: 'Transform', label: 'Transform (2D / Rotate / Scale)', shortcut: 'T' },
      { type: 'CornerPin', label: 'CornerPin 2D (Perspective Quad)' },
      { type: 'Crop', label: 'Crop (Bounding Box & Softness)' },
      { type: 'Reformat', label: 'Reformat (Resolution / Scale)' }
    ]
  },
  {
    category: 'Keyer',
    items: [
      { type: 'Keyer', label: 'Keyer (Chroma / Despill / Luma)', shortcut: 'K' }
    ]
  },
  {
    category: 'Channel / Draw',
    items: [
      { type: 'Shuffle', label: 'Shuffle (Channel Routing)', shortcut: 'S' },
      { type: 'Roto', label: 'Roto (Vector Shape / Matte)', shortcut: 'O' },
      { type: 'Paint', label: 'Paint (Clone / Cleanup / Rig Removal)' },
      { type: 'Depth', label: 'Depth (2D to 3D Stereo Depth Map)' },
      { type: 'StereoWarp', label: 'StereoWarp (DIBR Depth to 3D Stereo)' },
      { type: 'StereoMerge', label: 'StereoMerge (3D Anaglyph / Side-by-Side)' },
      { type: 'Dot', label: 'Dot (Routing)', shortcut: '.' },
      { type: 'Backdrop', label: 'Backdrop (Organize Nodes)' }
    ]
  },
  {
    category: 'Viewer',
    items: [
      { type: 'Viewer', label: 'Viewer', shortcut: '1-9' }
    ]
  }
];

let nodeCounter = {};

export function createNode(type, customId = null, x = 0, y = 0) {
  const NodeClass = NODE_REGISTRY[type];
  if (!NodeClass) {
    console.error(`Unknown node type: ${type}`);
    return null;
  }

  if (!customId) {
    if (!nodeCounter[type]) nodeCounter[type] = 1;
    customId = `${type}${nodeCounter[type]++}`;
  }

  return new NodeClass(customId, x, y);
}
