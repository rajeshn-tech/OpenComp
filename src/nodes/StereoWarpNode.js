/**
 * OpenComp - StereoWarp Node
 * Generates stereoscopic Left and Right eye views from Mono + Depth via
 * Depth-Image-Based Rendering (DIBR) with automated disocclusion hole-filling.
 */

import { Node } from '../core/Node.js';
import { StereoEngine } from '../core/StereoEngine.js';
import { BBox } from '../core/BBox.js';

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

  /**
   * Determine output dynamic BBox: accounts for maximum horizontal disparity displacement
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const monoBuf = inputs['in'] || inputs['input'];
    if (!monoBuf) return new BBox(0, 0, 0, 0);

    const box = monoBuf.bbox ? monoBuf.bbox.clone() : BBox.fromFormat(monoBuf.width, monoBuf.height);
    const outputEye = this.getKnobValue('outputEye', context) || 'anaglyph';
    const separation = Math.abs(Number(this.getKnobValue('separation', context)) ?? 12.0);
    const convergence = Math.max(0.01, Number(this.getKnobValue('convergence', context)) ?? 0.5);

    if (outputEye === 'side_by_side') {
      return new BBox(0, 0, monoBuf.width * 2, monoBuf.height);
    }

    // Maximum horizontal disparity displacement in DIBR
    const maxDisparity = Math.ceil(separation * Math.max(1.0, Math.abs(1.0 - 1.0 / convergence)));
    return box.expanded(maxDisparity, 0);
  }

  compute(inputs, context = {}) {
    const monoBuf = inputs['in'];
    const depthBuf = inputs['depth'];
    if (!monoBuf) return null;

    const convergence = Number(this.getKnobValue('convergence', context)) ?? 0.5;
    const separation = Number(this.getKnobValue('separation', context)) ?? 12.0;
    const fillHoles = !!this.getKnobValue('fillHoles', context);
    const outputEye = this.getKnobValue('outputEye', context) || 'anaglyph';

    const { left, right } = StereoEngine.warpStereoViews(monoBuf, depthBuf, convergence, separation, fillHoles);

    let result = null;
    if (outputEye === 'left') result = left;
    else if (outputEye === 'right') result = right;
    else if (outputEye === 'side_by_side') result = StereoEngine.compositeSideBySide(left, right);
    else if (outputEye === 'difference') result = StereoEngine.compositeDifference(left, right);
    else result = StereoEngine.compositeAnaglyph(left, right);

    if (result) {
      result.bbox = this.getBBox(inputs, context);
      result.copyChannelsFrom(monoBuf);
    }
    return result;
  }
}

