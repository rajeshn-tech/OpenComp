/**
 * OpenComp - Card3D Node
 * Generates a 3D planar quadrilateral mesh textured with an incoming 2D composite image or constant color.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { Vector3 } from '../core/3d/Vector3.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class Card3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Card3D', '3D', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('img', 'img', 'Texture Plate');
    this.addInput('axis', 'axis', 'Parent Axis');

    // Geometry Dimensions
    this.addKnob('width', 'Width', 'number', 1.0, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('height', 'Height', 'number', 1.0, { min: 0.001, max: 1000.0, step: 0.1 });
    this.addKnob('rows', 'Rows (Subdivisions)', 'number', 1, { min: 1, max: 64, step: 1 });
    this.addKnob('columns', 'Columns (Subdivisions)', 'number', 1, { min: 1, max: 64, step: 1 });
    this.addKnob('orientation', 'Orientation', 'select', 'XY', {
      options: [
        { label: 'XY (Vertical Facing Z)', value: 'XY' },
        { label: 'XZ (Horizontal Floor)', value: 'XZ' },
        { label: 'YZ (Side Wall)', value: 'YZ' }
      ]
    });
    this.addKnob('twoSided', 'Two-Sided', 'boolean', true);

    // Transform Knobs
    this.addKnob('translateX', 'Translate X', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateY', 'Translate Y', 'number', 0.0, { step: 0.1 });
    this.addKnob('translateZ', 'Translate Z', 'number', 0.0, { step: 0.1 });

    this.addKnob('rotateX', 'Rotate X (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateY', 'Rotate Y (deg)', 'number', 0.0, { step: 1.0 });
    this.addKnob('rotateZ', 'Rotate Z (deg)', 'number', 0.0, { step: 1.0 });

    this.addKnob('scaleX', 'Scale X', 'number', 1.0, { step: 0.05 });
    this.addKnob('scaleY', 'Scale Y', 'number', 1.0, { step: 0.05 });
    this.addKnob('scaleZ', 'Scale Z', 'number', 1.0, { step: 0.05 });
    this.addKnob('uniformScale', 'Scale', 'number', 1.0, { step: 0.05 });
    this.addKnob('rotOrder', 'Rotation Order', 'select', 'ZXY', {
      options: [
        { label: 'ZXY (Standard Default)', value: 'ZXY' },
        { label: 'XYZ', value: 'XYZ' }
      ]
    });

    // Material Color
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

  /**
   * Generates subdivided planar quadrilateral mesh
   * @param {Object} context
   * @returns {Geometry3D}
   */
  generateMesh(context = {}) {
    const w = Number(this.getKnobValue('width', context)) || 1.0;
    const h = Number(this.getKnobValue('height', context)) || 1.0;
    const rows = Math.max(1, Math.min(64, Math.round(Number(this.getKnobValue('rows', context)) || 1)));
    const cols = Math.max(1, Math.min(64, Math.round(Number(this.getKnobValue('columns', context)) || 1)));
    const orient = this.getKnobValue('orientation', context) || 'XY';

    const numVerts = (rows + 1) * (cols + 1);
    const vertices = new Float32Array(numVerts * 3);
    const normals = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const indices = new Uint32Array(rows * cols * 6);

    const halfW = w * 0.5;
    const halfH = h * 0.5;

    let vIdx = 0;
    let uvIdx = 0;

    for (let r = 0; r <= rows; r++) {
      const vRatio = r / rows;
      const posY = -halfH + vRatio * h;

      for (let c = 0; c <= cols; c++) {
        const uRatio = c / cols;
        const posX = -halfW + uRatio * w;

        // Position & Normal based on orientation
        if (orient === 'XZ') {
          // Horizontal floor: normal +Y
          vertices[vIdx] = posX;
          vertices[vIdx + 1] = 0;
          vertices[vIdx + 2] = posY;

          normals[vIdx] = 0;
          normals[vIdx + 1] = 1;
          normals[vIdx + 2] = 0;
        } else if (orient === 'YZ') {
          // Side wall: normal +X
          vertices[vIdx] = 0;
          vertices[vIdx + 1] = posY;
          vertices[vIdx + 2] = posX;

          normals[vIdx] = 1;
          normals[vIdx + 1] = 0;
          normals[vIdx + 2] = 0;
        } else {
          // XY: Vertical facing viewer along +Z
          vertices[vIdx] = posX;
          vertices[vIdx + 1] = posY;
          vertices[vIdx + 2] = 0;

          normals[vIdx] = 0;
          normals[vIdx + 1] = 0;
          normals[vIdx + 2] = 1;
        }

        uvs[uvIdx] = uRatio;
        uvs[uvIdx + 1] = vRatio;

        vIdx += 3;
        uvIdx += 2;
      }
    }

    // Generate triangle face indices
    let iIdx = 0;
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = r * stride + c;
        const i1 = i0 + 1;
        const i2 = (r + 1) * stride + c;
        const i3 = i2 + 1;

        // Triangle 1 (i0, i1, i2)
        indices[iIdx++] = i0;
        indices[iIdx++] = i1;
        indices[iIdx++] = i2;

        // Triangle 2 (i1, i3, i2)
        indices[iIdx++] = i1;
        indices[iIdx++] = i3;
        indices[iIdx++] = i2;
      }
    }

    const geo = new Geometry3D(this.name || this.id);
    geo.setBuffers(vertices, indices, normals, uvs);
    geo.material.twoSided = Boolean(this.getKnobValue('twoSided', context));
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
    geo.transform = this.getWorldMatrix(inputs, context);

    // Bind texture plate if connected
    const imgInput = inputs['img'];
    if (imgInput instanceof PixelBuffer) {
      geo.material.texture = imgInput;
    }

    return geo;
  }
}

