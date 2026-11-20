/**
 * OpenComp - StereoWarp Node
 * Generates stereoscopic Left and Right eye views from Mono + Depth via
 * Depth-Image-Based Rendering (DIBR) with automated disocclusion hole-filling.
 */

import { Node } from '../core/Node.js';
import { StereoEngine } from '../core/StereoEngine.js';

export class StereoWarpNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'StereoWarp', 'Transform', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Mono Plate');
    this.addInput('depth', 'depth', 'Depth Map');

    this.addKnob('convergence', 'Convergence (Screen Plane)', 'number', 0.5, { min: 0.05, max: 1.0, step: 0.02 });
    this.addKnob('separation', 'Interaxial Separation (Disparity)', 'number', 12.0, { min: 0.0, max: 60.0, step: 1.0 });
    this.addKnob('fillHoles', 'Fill Disocclusion Holes', 'boolean', true);
    this.addKnob('outputEye', 'Output Eye', 'select', 'anaglyph', {
      options: [
        { label: '3D Anaglyph (Red/Cyan Preview)', value: 'anaglyph' },
        { label: 'Left Eye Only', value: 'left' },
        { label: 'Right Eye Only', value: 'right' },
        { label: 'Side-by-Side 3D', value: 'side_by_side' },
        { label: 'Disparity Difference (|L - R|)', value: 'difference' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const monoBuf = inputs['in'];
    const depthBuf = inputs['depth'];
    if (!monoBuf) return null;

    const convergence = Number(this.getKnobValue('convergence')) ?? 0.5;
    const separation = Number(this.getKnobValue('separation')) ?? 12.0;
    const fillHoles = !!this.getKnobValue('fillHoles');
    const outputEye = this.getKnobValue('outputEye') || 'anaglyph';

    const { left, right } = StereoEngine.warpStereoViews(monoBuf, depthBuf, convergence, separation, fillHoles);

    if (outputEye === 'left') return left;
    if (outputEye === 'right') return right;
    if (outputEye === 'side_by_side') return StereoEngine.compositeSideBySide(left, right);
    if (outputEye === 'difference') return StereoEngine.compositeDifference(left, right);

    // Default: 3D Anaglyph preview
    return StereoEngine.compositeAnaglyph(left, right);
  }
}

