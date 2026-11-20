/**
 * OpenComp - Camera3D Node
 * Virtual cinematography camera providing perspective/orthographic projections,
 * physical lens and film back simulation, and transformation matrices.
 * Production VFX node.
 */

import { Node } from '../core/Node.js';
import { Camera3D } from '../core/3d/Camera3D.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { Vector3 } from '../core/3d/Vector3.js';

export class Camera3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Camera3D', '3D', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('axis', 'axis', 'Parent Axis');
    this.addInput('look', 'look', 'Look At Target');

    // Camera Optics Knobs
    this.addKnob('focal', 'Focal Length (mm)', 'number', 50.0, { min: 1.0, max: 1000.0, step: 1.0 });
    this.addKnob('haperture', 'Horiz Aperture (mm)', 'number', 24.89, { min: 0.1, max: 200.0, step: 0.1 });
    this.addKnob('vaperture', 'Vert Aperture (mm)', 'number', 18.67, { min: 0.1, max: 200.0, step: 0.1 });
    this.addKnob('near', 'Near Clip', 'number', 0.1, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('far', 'Far Clip', 'number', 10000.0, { min: 1.0, max: 100000.0, step: 100.0 });
    this.addKnob('winShiftX', 'Window Shift X', 'number', 0.0, { min: -2.0, max: 2.0, step: 0.01 });
    this.addKnob('winShiftY', 'Window Shift Y', 'number', 0.0, { min: -2.0, max: 2.0, step: 0.01 });

    this.addKnob('projectionMode', 'Projection Mode', 'select', 'perspective', {
      options: [
        { label: 'Perspective', value: 'perspective' },
        { label: 'Orthographic', value: 'orthographic' }
      ]
    });

    // 3D Transform Knobs
    this.addKnob('translateX', 'Translate X', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateY', 'Translate Y', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateZ', 'Translate Z', 'number', 5.0, { step: 0.1 });

    this.addKnob('rotateX', 'Rotate X (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateY', 'Rotate Y (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateZ', 'Rotate Z (deg)', 'number', 0.0, { step: 1.0 });

    this.addKnob('uniformScale', 'Scale', 'number', 1.0, { step: 0.05 });
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
    const tz = Number(this.getKnobValue('translateZ', context)) ?? 5.0;

    const rx = Number(this.getKnobValue('rotateX', context)) || 0.0;
    const ry = Number(this.getKnobValue('rotateY', context)) || 0.0;
    const rz = Number(this.getKnobValue('rotateZ', context)) || 0.0;

    const s = Number(this.getKnobValue('uniformScale', context)) || 1.0;
    const order = this.getKnobValue('rotOrder', context) || 'ZXY';

    const m = new Matrix4();
    m.compose({ x: tx, y: ty, z: tz }, { x: rx, y: ry, z: rz }, { x: s, y: s, z: s }, order);
    return m;
  }

  getWorldMatrix(inputs = {}, context = {}) {
    const localMat = this.getLocalMatrix(context);

    // Look-at override
    const lookTarget = inputs['look'];
    if (lookTarget && (lookTarget.x !== undefined || lookTarget.matrix)) {
      const eye = new Vector3(
        Number(this.getKnobValue('translateX', context)) || 0.0,
        Number(this.getKnobValue('translateY', context)) || 0.0,
        Number(this.getKnobValue('translateZ', context)) ?? 5.0
      );
      const targetPos = lookTarget.matrix
        ? new Vector3(0, 0, 0).transformMat4(lookTarget.matrix)
        : new Vector3(lookTarget.x, lookTarget.y, lookTarget.z);
      return new Matrix4().makeLookAt(eye, targetPos, new Vector3(0, 1, 0));
    }

    // Parent Axis chaining
    const parentAxis = inputs['axis'];
    if (parentAxis && parentAxis.matrix instanceof Matrix4) {
      const worldMat = new Matrix4();
      worldMat.multiplyMatrices(parentAxis.matrix, localMat);
      return worldMat;
    }

    return localMat;
  }

  getCamera(inputs = {}, context = {}) {
    const cam = new Camera3D();
    cam.name = this.name || this.id;
    cam.focal = Number(this.getKnobValue('focal', context)) || 50.0;
    cam.haperture = Number(this.getKnobValue('haperture', context)) || 24.89;
    cam.vaperture = Number(this.getKnobValue('vaperture', context)) || 18.67;
    cam.near = Number(this.getKnobValue('near', context)) || 0.1;
    cam.far = Number(this.getKnobValue('far', context)) || 10000.0;
    cam.winShiftX = Number(this.getKnobValue('winShiftX', context)) || 0.0;
    cam.winShiftY = Number(this.getKnobValue('winShiftY', context)) || 0.0;
    cam.projectionMode = this.getKnobValue('projectionMode', context) || 'perspective';

    cam.worldMatrix = this.getWorldMatrix(inputs, context);
    return cam;
  }

  compute(inputs, context = {}) {
    const camera = this.getCamera(inputs, context);
    return {
      isCamera: true,
      id: this.id,
      camera,
      worldMatrix: camera.worldMatrix,
      viewMatrix: camera.getViewMatrix(),
      projectionMatrix: camera.getProjectionMatrix()
    };
  }
}

