/**
 * OpenComp - StereoMerge Node
 * Combines Left and Right stereoscopic streams for 3D monitoring:
 * Anaglyph Red/Cyan, Side-by-Side 3D, Disparity Difference, and Interactive Wipe.
 */

import { Node } from '../core/Node.js';
import { StereoEngine } from '../core/StereoEngine.js';
import { BBox } from '../core/BBox.js';

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

  /**
   * Determine output dynamic BBox: combines left and right eye bounding boxes based on mode
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const leftBuf = inputs['left'];
    const rightBuf = inputs['right'];

    if (!leftBuf && !rightBuf) return new BBox(0, 0, 0, 0);
    if (leftBuf && !rightBuf) return leftBuf.bbox ? leftBuf.bbox.clone() : BBox.fromFormat(leftBuf.width, leftBuf.height);
    if (!leftBuf && rightBuf) return rightBuf.bbox ? rightBuf.bbox.clone() : BBox.fromFormat(rightBuf.width, rightBuf.height);

    const boxL = leftBuf.bbox ? leftBuf.bbox.clone() : BBox.fromFormat(leftBuf.width, leftBuf.height);
    const boxR = rightBuf.bbox ? rightBuf.bbox.clone() : BBox.fromFormat(rightBuf.width, rightBuf.height);
    const mode = this.getKnobValue('mode', context) || 'anaglyph';

    if (mode === 'left') return boxL;
    if (mode === 'right') return boxR;
    if (mode === 'side_by_side') {
      const transR = boxR.translated(leftBuf.width, 0);
      return boxL.union(transR);
    }

    // Default for anaglyph, difference, wipe: union of both eye bounds
    return boxL.union(boxR);
  }

  compute(inputs, context = {}) {
    const leftBuf = inputs['left'];
    const rightBuf = inputs['right'];

    if (!leftBuf && !rightBuf) return null;
    if (leftBuf && !rightBuf) {
      const res = leftBuf.clone();
      res.bbox = this.getBBox(inputs, context);
      return res;
    }
    if (!leftBuf && rightBuf) {
      const res = rightBuf.clone();
      res.bbox = this.getBBox(inputs, context);
      return res;
    }

    const mode = this.getKnobValue('mode', context) || 'anaglyph';
    const wipePos = Number(this.getKnobValue('wipePos', context)) ?? 0.5;

    let result = null;
    if (mode === 'anaglyph') {
      result = StereoEngine.compositeAnaglyph(leftBuf, rightBuf);
    } else if (mode === 'side_by_side') {
      result = StereoEngine.compositeSideBySide(leftBuf, rightBuf);
    } else if (mode === 'difference') {
      result = StereoEngine.compositeDifference(leftBuf, rightBuf);
    } else if (mode === 'wipe') {
      result = StereoEngine.compositeWipe(leftBuf, rightBuf, wipePos);
    } else if (mode === 'left') {
      result = leftBuf.clone();
    } else if (mode === 'right') {
      result = rightBuf.clone();
    } else {
      result = StereoEngine.compositeAnaglyph(leftBuf, rightBuf);
    }

    if (result) {
      result.bbox = this.getBBox(inputs, context);
      result.copyChannelsFrom(leftBuf || rightBuf);
    }
    return result;
  }
}

