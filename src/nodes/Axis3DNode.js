/**
 * OpenComp - Axis3D Node
 * Hierarchical 3D transformation pivot for positioning, rotating, and scaling 3D scene elements.
 * Production VFX 3D node. behavior.
 */

import { Node } from '../core/Node.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { Vector3 } from '../core/3d/Vector3.js';

export class Axis3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Axis3D', '3D', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('axis', 'axis', 'Parent Axis');

    // Translation knobs
    this.addKnob('translateX', 'Translate X', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateY', 'Translate Y', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateZ', 'Translate Z', 'number', 0.0, { step: 0.1 });

    // Rotation knobs (degrees)
    this.addKnob('rotateX', 'Rotate X (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateY', 'Rotate Y (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateZ', 'Rotate Z (deg)', 'number', 0.0, { step: 1.0 });

    // Scale knobs
    this.addKnob('scaleX', 'Scale X', 'number', 1.0, { step: 0.05 });
    this.addKnob('scaleY', 'Scale Y', 'number', 1.0, { step: 0.05 });
    this.addKnob('scaleZ', 'Scale Z', 'number', 1.0, { step: 0.05 });
    this.addKnob('uniformScale', 'Uniform Scale', 'number', 1.0, { step: 0.05 });

    this.addKnob('rotOrder', 'Rotation Order', 'select', 'ZXY', {
      options: [
        { label: 'ZXY (Standard Default)', value: 'ZXY' },
        { label: 'XYZ', value: 'XYZ' }
      ]
    });
  }

  getLocalMatrix(context = {}) {
    const tx = Number(this.getKnobValue('translateX', context)) || 0.0;
    const ty = Number(this.getKnobValue('translateY', context)) || 0.0;
    const tz = Number(this.getKnobValue('translateZ', context)) || 0.0;

    const rx = Number(this.getKnobValue('rotateX', context)) || 0.0;
    const ry = Number(this.getKnobValue('rotateY', context)) || 0.0;
    const rz = Number(this.getKnobValue('rotateZ', context)) || 0.0;

    const uScale = Number(this.getKnobValue('uniformScale', context)) || 1.0;
    const sx = (Number(this.getKnobValue('scaleX', context)) || 1.0) * uScale;
    const sy = (Number(this.getKnobValue('scaleY', context)) || 1.0) * uScale;
    const sz = (Number(this.getKnobValue('scaleZ', context)) || 1.0) * uScale;

    const order = this.getKnobValue('rotOrder', context) || 'ZXY';

    const m = new Matrix4();
    m.compose({ x: tx, y: ty, z: tz }, { x: rx, y: ry, z: rz }, { x: sx, y: sy, z: sz }, order);
    return m;
  }

  getWorldMatrix(inputs = {}, context = {}) {
    const localMat = this.getLocalMatrix(context);
    const parentAxis = inputs['axis'];
    if (parentAxis && parentAxis.matrix instanceof Matrix4) {
      const worldMat = new Matrix4();
      worldMat.multiplyMatrices(parentAxis.matrix, localMat);
      return worldMat;
    }
    return localMat;
  }

  compute(inputs, context = {}) {
    const worldMatrix = this.getWorldMatrix(inputs, context);
    return {
      isAxis: true,
      id: this.id,
      matrix: worldMatrix,
      localMatrix: this.getLocalMatrix(context)
    };
  }
}

