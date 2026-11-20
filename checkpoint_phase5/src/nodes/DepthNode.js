/**
 * OpenComp - Depth Node
 * Generates and processes 32-bit floating-point depth maps for 2D-to-3D stereoscopic conversion.
 * Supports perspective ground-plane ramps, roto-mask object depth assignment,
 * edge-preserving bilateral depth smoothing, and false-color heatmap visualization.
 */

import { Node } from '../core/Node.js';
import { DepthMapEngine } from '../core/DepthMap.js';

export class DepthNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Depth', 'Channel', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate (Format)');
    this.addInput('roto', 'roto', 'Roto Mask (Optional)');

    this.addKnob('gradientType', 'Type', 'select', 'ground_plane', {
      options: [
        { label: 'Ground Plane (Perspective Ramp)', value: 'ground_plane' },
        { label: 'Linear Vertical Ramp', value: 'linear' },
        { label: 'Radial Sphere Depth', value: 'radial' },
        { label: 'Flat Uniform Depth', value: 'flat' }
      ]
    });

    this.addKnob('baseDepth', 'Base Depth', 'number', 0.8, { min: 0.0, max: 1.0, step: 0.02 });
    this.addKnob('nearClip', 'Near Clip (Z-Min)', 'number', 0.0, { min: 0.0, max: 1.0, step: 0.02 });
    this.addKnob('farClip', 'Far Clip (Z-Max)', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.02 });
    this.addKnob('contrast', 'Depth Contrast', 'number', 1.0, { min: 0.1, max: 3.0, step: 0.05 });
    this.addKnob('offset', 'Depth Offset', 'number', 0.0, { min: -1.0, max: 1.0, step: 0.02 });

    this.addKnob('objectDepth', 'Roto Object Depth', 'number', 0.35, { min: 0.0, max: 1.0, step: 0.02 });
    this.addKnob('smoothRadius', 'Edge Smoothing', 'number', 0, { min: 0, max: 8, step: 1 });

    this.addKnob('displayMode', 'Display Mode', 'select', 'grayscale', {
      options: [
        { label: 'Grayscale Linear Z', value: 'grayscale' },
        { label: 'False-Color Heatmap (Turbo)', value: 'heatmap' }
      ]
    });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    const rotoBuf = inputs['roto'];
    const w = inputBuf ? inputBuf.width : 1920;
    const h = inputBuf ? inputBuf.height : 1080;

    const gradientType = this.getKnobValue('gradientType') || 'ground_plane';
    const baseDepth = Number(this.getKnobValue('baseDepth')) ?? 0.8;
    const nearClip = Number(this.getKnobValue('nearClip')) ?? 0.0;
    const farClip = Number(this.getKnobValue('farClip')) ?? 1.0;
    const contrast = Number(this.getKnobValue('contrast')) ?? 1.0;
    const offset = Number(this.getKnobValue('offset')) ?? 0.0;
    const objectDepth = Number(this.getKnobValue('objectDepth')) ?? 0.35;
    const smoothRadius = Math.round(Number(this.getKnobValue('smoothRadius')) ?? 0);
    const displayMode = this.getKnobValue('displayMode') || 'grayscale';

    // 1. Generate base depth map
    let depthBuf = DepthMapEngine.generateDepthMap(w, h, {
      gradientType,
      baseDepth,
      nearClip,
      farClip,
      contrast,
      offset
    });

    // 2. Sculpt object depth with Roto mask
    if (rotoBuf) {
      DepthMapEngine.applyRotoObjectDepth(depthBuf, rotoBuf, objectDepth, 'replace');
    }

    // 3. Bilateral smoothing if enabled
    if (smoothRadius > 0) {
      depthBuf = DepthMapEngine.smoothDepth(depthBuf, smoothRadius, smoothRadius * 1.5, 0.15);
    }

    // 4. Heatmap colorization for artist inspection
    if (displayMode === 'heatmap') {
      return DepthMapEngine.colorizeHeatmap(depthBuf);
    }

    return depthBuf;
  }
}

