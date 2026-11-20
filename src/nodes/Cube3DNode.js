/**
 * OpenComp - Cube3D Node
 * Canonical 3D box primitive with 6 textured faces and independent normal vectors.
 */

import { Node } from '../core/Node.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class Cube3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Cube3D', '3D', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('img', 'img', 'Texture Plate');
    this.addInput('axis', 'axis', 'Parent Axis');

    this.addKnob('sizeX', 'Size X', 'number', 1.0, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('sizeY', 'Size Y', 'number', 1.0, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('sizeZ', 'Size Z', 'number', 1.0, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('uniformScale', 'Scale', 'number', 1.0, { step: 0.05 });

    // Transform Knobs
    this.addKnob('translateX', 'Translate X', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateY', 'Translate Y', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateZ', 'Translate Z', 'number', 0.0, { step: 0.1 });

    this.addKnob('rotateX', 'Rotate X (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateY', 'Rotate Y (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateZ', 'Rotate Z (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotOrder', 'Rotation Order', 'select', 'ZXY', {
      options: [{ label: 'ZXY', value: 'ZXY' }, { label: 'XYZ', value: 'XYZ' }]
    });

    this.addKnob('colorR', 'Color R', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('colorG', 'Color G', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('colorB', 'Color B', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('colorA', 'Color A', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.01 });
  }

  getLocalMatrix(context = {}) {
    const tx = Number(this.getKnobValue('translateX', context)) || 0.0;
    const ty = Number(this.getKnobValue('translateY', context)) || 0.0;
    const tz = Number(this.getKnobValue('translateZ', context)) || 0.0;

    const rx = Number(this.getKnobValue('rotateX', context)) || 0.0;
    const ry = Number(this.getKnobValue('rotateY', context)) || 0.0;
    const rz = Number(this.getKnobValue('rotateZ', context)) || 0.0;

    const uScale = Number(this.getKnobValue('uniformScale', context)) || 1.0;
    const sx = (Number(this.getKnobValue('sizeX', context)) || 1.0) * uScale;
    const sy = (Number(this.getKnobValue('sizeY', context)) || 1.0) * uScale;
    const sz = (Number(this.getKnobValue('sizeZ', context)) || 1.0) * uScale;

    const order = this.getKnobValue('rotOrder', context) || 'ZXY';

    const m = new Matrix4();
    m.compose({ x: tx, y: ty, z: tz }, { x: rx, y: ry, z: rz }, { x: sx, y: sy, z: sz }, order);
    return m;
  }

  generateMesh(context = {}) {
    // 24 vertices (4 per face for distinct face normals)
    // Front (+Z), Back (-Z), Top (+Y), Bottom (-Y), Right (+X), Left (-X)
    const vertices = new Float32Array([
      // Front (+Z)
      -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
      // Back (-Z)
       0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,
      // Top (+Y)
      -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
      // Bottom (-Y)
      -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
      // Right (+X)
       0.5, -0.5,  0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,
      // Left (-X)
      -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5
    ]);

    const normals = new Float32Array([
      // Front
       0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,
      // Back
       0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,
      // Top
       0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
      // Bottom
       0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
      // Right
       1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,
      // Left
      -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0
    ]);

    const uvs = new Float32Array([
      0,0, 1,0, 1,1, 0,1,
      0,0, 1,0, 1,1, 0,1,
      0,0, 1,0, 1,1, 0,1,
      0,0, 1,0, 1,1, 0,1,
      0,0, 1,0, 1,1, 0,1,
      0,0, 1,0, 1,1, 0,1
    ]);

    const indices = new Uint32Array([
       0,  1,  2,   0,  2,  3,  // Front
       4,  5,  6,   4,  6,  7,  // Back
       8,  9, 10,   8, 10, 11,  // Top
      12, 13, 14,  12, 14, 15,  // Bottom
      16, 17, 18,  16, 18, 19,  // Right
      20, 21, 22,  20, 22, 23   // Left
    ]);

    const geo = new Geometry3D(this.name || this.id);
    geo.setBuffers(vertices, indices, normals, uvs);
    geo.material.color = [
      Number(this.getKnobValue('colorR', context)) || 1.0,
      Number(this.getKnobValue('colorG', context)) || 1.0,
      Number(this.getKnobValue('colorB', context)) || 1.0,
      Number(this.getKnobValue('colorA', context)) || 1.0
    ];
    return geo;
  }

  compute(inputs, context = {}) {
    const geo = this.generateMesh(context);
    const localMat = this.getLocalMatrix(context);
    const parentAxis = inputs['axis'];
    if (parentAxis && parentAxis.matrix instanceof Matrix4) {
      geo.transform = new Matrix4().multiplyMatrices(parentAxis.matrix, localMat);
    } else {
      geo.transform = localMat;
    }

    const imgInput = inputs['img'];
    if (imgInput instanceof PixelBuffer) {
      geo.material.texture = imgInput;
    }
    return geo;
  }
}

