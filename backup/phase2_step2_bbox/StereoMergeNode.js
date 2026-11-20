/**
 * OpenComp - StereoMerge Node
 * Combines Left and Right stereoscopic streams for 3D monitoring:
 * Anaglyph Red/Cyan, Side-by-Side 3D, Disparity Difference, and Interactive Wipe.
 */

import { Node } from '../core/Node.js';
import { StereoEngine } from '../core/StereoEngine.js';

export class StereoMergeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'StereoMerge', 'Merge', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('left', 'left', 'Left Eye');
    this.addInput('right', 'right', 'Right Eye');

    this.addKnob('mode', 'Stereo View Mode', 'select', 'anaglyph', {
      options: [
        { label: '3D Anaglyph (Red/Cyan)', value: 'anaglyph' },
        { label: 'Side-by-Side (L | R)', value: 'side_by_side' },
        { label: 'Difference (|L - R|)', value: 'difference' },
        { label: 'Wipe Split-Screen', value: 'wipe' },
        { label: 'Left Eye Only', value: 'left' },
        { label: 'Right Eye Only', value: 'right' }
      ]
    });

    this.addKnob('wipePos', 'Wipe Divider Position', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
  }

  compute(inputs, context = {}) {
    const leftBuf = inputs['left'];
    const rightBuf = inputs['right'];

    if (!leftBuf && !rightBuf) return null;
    if (leftBuf && !rightBuf) return leftBuf.clone();
    if (!leftBuf && rightBuf) return rightBuf.clone();

    const mode = this.getKnobValue('mode') || 'anaglyph';
    const wipePos = Number(this.getKnobValue('wipePos')) ?? 0.5;

    if (mode === 'anaglyph') {
      return StereoEngine.compositeAnaglyph(leftBuf, rightBuf);
    } else if (mode === 'side_by_side') {
      return StereoEngine.compositeSideBySide(leftBuf, rightBuf);
    } else if (mode === 'difference') {
      return StereoEngine.compositeDifference(leftBuf, rightBuf);
    } else if (mode === 'wipe') {
      return StereoEngine.compositeWipe(leftBuf, rightBuf, wipePos);
    } else if (mode === 'left') {
      return leftBuf.clone();
    } else if (mode === 'right') {
      return rightBuf.clone();
    }

    return StereoEngine.compositeAnaglyph(leftBuf, rightBuf);
  }
}

