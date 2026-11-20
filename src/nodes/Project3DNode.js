/**
 * OpenComp - Project3D Node
 * Projects 2D image plates or clean plates onto 3D geometry using a virtual camera frustum.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { Scene3D } from '../core/3d/Scene3D.js';
import { Camera3D } from '../core/3d/Camera3D.js';
import { Vector3 } from '../core/3d/Vector3.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class Project3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Project3D', '3D', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', '2D Texture / Plate');
    this.addInput('cam', 'cam', 'Projection Camera');
    this.addInput('geo', 'geo', 'Target Geometry / Scene');

    this.addKnob('projectOn', 'Project On', 'select', 'both', {
      options: [
        { label: 'Both Sides', value: 'both' },
        { label: 'Front Only', value: 'front' },
        { label: 'Back Only', value: 'back' }
      ]
    });

    this.addKnob('crop', 'Crop to Frustum', 'boolean', true);
  }

  /**
   * Projects camera frustum UV coordinates onto a single Geometry3D instance
   * @param {Geometry3D} geo
   * @param {Camera3D} camera
   * @param {PixelBuffer} texture
   * @param {Object} context
   * @returns {Geometry3D}
   */
  projectOnGeometry(geo, camera, texture, context = {}) {
    const projectedGeo = geo.clone();
    if (texture instanceof PixelBuffer) {
      projectedGeo.material.texture = texture;
    }

    const vp = camera.getViewProjectionMatrix();
    const e = vp.elements;
    const model = geo.transform;
    const me = model.elements;

    const v = geo.vertices;
    const normals = geo.normals;
    const numVerts = v.length / 3;
    const projectedUVs = new Float32Array(numVerts * 2);

    const projectOn = this.getKnobValue('projectOn', context) || 'both';
    const camPos = new Vector3(0, 0, 0).transformMat4(camera.worldMatrix);

    for (let i = 0; i < numVerts; i++) {
      const vx = v[i * 3];
      const vy = v[i * 3 + 1];
      const vz = v[i * 3 + 2];

      // 1. Transform local vertex to world space
      const wx = me[0] * vx + me[4] * vy + me[8] * vz + me[12];
      const wy = me[1] * vx + me[5] * vy + me[9] * vz + me[13];
      const wz = me[2] * vx + me[6] * vy + me[10] * vz + me[14];

      // 2. Project into camera clip space
      const cx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const cy = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const cw = e[3] * wx + e[7] * wy + e[11] * wz + e[15];

      // 3. Normal / Backface check
      let culled = false;
      if (projectOn !== 'both' && normals.length > i * 3 + 2) {
        // World-space normal
        const nx = me[0] * normals[i * 3] + me[4] * normals[i * 3 + 1] + me[8] * normals[i * 3 + 2];
        const ny = me[1] * normals[i * 3] + me[5] * normals[i * 3 + 1] + me[9] * normals[i * 3 + 2];
        const nz = me[2] * normals[i * 3] + me[6] * normals[i * 3 + 1] + me[10] * normals[i * 3 + 2];

        // Ray from surface to camera
        const rayX = camPos.x - wx;
        const rayY = camPos.y - wy;
        const rayZ = camPos.z - wz;
        const dot = nx * rayX + ny * rayY + nz * rayZ;

        if (projectOn === 'front' && dot < 0) culled = true;
        if (projectOn === 'back' && dot > 0) culled = true;
      }

      if (cw > 1e-6 && !culled) {
        const invW = 1.0 / cw;
        const ndcX = cx * invW;
        const ndcY = cy * invW;

        // Map NDC [-1, 1] to UV [0, 1]
        projectedUVs[i * 2] = (ndcX + 1.0) * 0.5;
        projectedUVs[i * 2 + 1] = (ndcY + 1.0) * 0.5;
      } else {
        // Outside or behind camera
        projectedUVs[i * 2] = -100.0;
        projectedUVs[i * 2 + 1] = -100.0;
      }
    }

    projectedGeo.uvs = projectedUVs;
    return projectedGeo;
  }

  compute(inputs, context = {}) {
    const rawTex = inputs[0] !== undefined ? inputs[0] : inputs['in'];
    const texture = rawTex instanceof PixelBuffer ? rawTex : null;

    const rawCam = inputs[1] !== undefined ? inputs[1] : inputs['cam'];
    let camera = null;
    if (rawCam instanceof Camera3D) {
      camera = rawCam;
    } else if (rawCam && rawCam.camera instanceof Camera3D) {
      camera = rawCam.camera;
    }

    const geoInput = inputs[2] !== undefined ? inputs[2] : inputs['geo'];

    // If both camera and geometry are provided, project directly
    if (camera && geoInput) {
      if (geoInput instanceof Geometry3D) {
        return this.projectOnGeometry(geoInput, camera, texture, context);
      } else if (geoInput instanceof Scene3D) {
        const outScene = new Scene3D();
        for (const g of geoInput.geometries) {
          outScene.addGeometry(this.projectOnGeometry(g, camera, texture, context));
        }
        outScene.cameras = [...geoInput.cameras];
        outScene.lights = [...geoInput.lights];
        return outScene;
      }
    }

    // Material generator pass-through
    return {
      isProjectedMaterial: true,
      texture,
      camera,
      projectOn: this.getKnobValue('projectOn', context)
    };
  }
}
