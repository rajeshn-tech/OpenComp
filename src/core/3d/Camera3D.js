/**
 * OpenComp - Physical Camera3D Mathematical Model
 * Models pinhole cinematography cameras with physical film gates, apertures,
 * lens shifts, perspective and orthographic projections, and ray generation.
 * Models physical cinematography camera optics standard.
 */

import { Vector3 } from './Vector3.js';
import { Matrix4 } from './Matrix4.js';

export class Camera3D {
  constructor() {
    this.name = 'Camera3D';
    this.focal = 50.0;          // Focal length in mm
    this.haperture = 24.89;     // Horizontal aperture in mm (Super 35 standard)
    this.vaperture = 18.67;     // Vertical aperture in mm
    this.near = 0.1;            // Near clipping plane
    this.far = 10000.0;         // Far clipping plane
    this.winShiftX = 0.0;       // Horizontal lens shift
    this.winShiftY = 0.0;       // Vertical lens shift
    this.winRoll = 0.0;         // Film roll in degrees
    this.projectionMode = 'perspective'; // 'perspective' | 'orthographic'

    this.worldMatrix = new Matrix4();
  }

  get transform() {
    return this.worldMatrix;
  }

  set transform(m) {
    this.worldMatrix = m;
  }

  get viewMatrix() {
    return this.getViewMatrix();
  }

  getHorizontalFov(inDegrees = true) {
    const rad = 2.0 * Math.atan(this.haperture / (2.0 * this.focal));
    return inDegrees ? (rad * 180.0) / Math.PI : rad;
  }

  getVerticalFov(inDegrees = true) {
    const rad = 2.0 * Math.atan(this.vaperture / (2.0 * this.focal));
    return inDegrees ? (rad * 180.0) / Math.PI : rad;
  }

  getViewMatrix() {
    return this.worldMatrix.clone().invert();
  }

  getProjectionMatrix(filmAspect = null) {
    const p = new Matrix4();
    if (this.projectionMode === 'orthographic') {
      const halfW = (this.haperture * 0.5) || 12.0;
      const halfH = (this.vaperture * 0.5) || 9.0;
      p.makeOrthographic(-halfW, halfW, halfH, -halfH, this.near, this.far);
    } else {
      let ha = this.haperture;
      let va = this.vaperture;
      if (filmAspect && filmAspect > 0) {
        va = ha / filmAspect;
      }
      p.makePerspective(this.focal, ha, va, this.near, this.far, this.winShiftX, this.winShiftY);
    }
    return p;
  }

  getViewProjectionMatrix(filmAspect = null) {
    const v = this.getViewMatrix();
    const p = this.getProjectionMatrix(filmAspect);
    return new Matrix4().multiplyMatrices(p, v);
  }

  /**
   * Projects a 3D world point to 2D screen coordinates
   * @param {Vector3} pointWorld
   * @param {number} screenWidth
   * @param {number} screenHeight
   * @returns {{x: number, y: number, zNdc: number, inFront: boolean, clipW: number}}
   */
  project(pointWorld, screenWidth, screenHeight) {
    const vp = this.getViewProjectionMatrix(screenWidth / screenHeight);
    const e = vp.elements;

    const x = pointWorld.x, y = pointWorld.y, z = pointWorld.z;
    const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
    const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
    const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];
    const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];

    const inFront = clipW > 0;
    const invW = Math.abs(clipW) > 1e-12 ? 1.0 / clipW : 1.0;

    const ndcX = clipX * invW;
    const ndcY = clipY * invW;
    const ndcZ = clipZ * invW;

    // Map NDC [-1, 1] to screen [0, screenWidth] x [0, screenHeight]
    const screenX = ((ndcX + 1.0) * 0.5) * screenWidth;
    const screenY = ((1.0 - ndcY) * 0.5) * screenHeight;

    return {
      x: screenX,
      y: screenY,
      zNdc: ndcZ,
      inFront,
      clipW
    };
  }

  /**
   * Generates a 3D world-space ray passing through screen coordinates (screenX, screenY)
   * @param {number} screenX
   * @param {number} screenY
   * @param {number} screenWidth
   * @param {number} screenHeight
   * @returns {{origin: Vector3, direction: Vector3}}
   */
  getRay(screenX, screenY, screenWidth, screenHeight) {
    const ndcX = (screenX / screenWidth) * 2.0 - 1.0;
    const ndcY = 1.0 - (screenY / screenHeight) * 2.0;

    const vpInv = this.getViewProjectionMatrix(screenWidth / screenHeight).invert();

    // Near point in NDC
    const pNear = new Vector3(ndcX, ndcY, -1.0).transformMat4(vpInv);
    // Far point in NDC
    const pFar = new Vector3(ndcX, ndcY, 1.0).transformMat4(vpInv);

    const direction = new Vector3(pFar.x - pNear.x, pFar.y - pNear.y, pFar.z - pNear.z).normalize();

    return {
      origin: pNear,
      direction
    };
  }

  /**
   * Returns the 8 corner vertices of the camera viewing frustum in world space
   */
  getFrustumCorners(nearDist = null, farDist = null) {
    const n = nearDist !== null ? nearDist : this.near;
    const f = farDist !== null ? farDist : Math.min(100.0, this.far);

    const vpInv = this.getViewProjectionMatrix(this.haperture / this.vaperture).invert();

    const ndcCorners = [
      // Near plane (z = -1)
      [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1],
      // Far plane (z = 1)
      [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1]
    ];

    return ndcCorners.map(([x, y, z]) => new Vector3(x, y, z).transformMat4(vpInv));
  }

  clone() {
    const c = new Camera3D();
    c.name = this.name;
    c.focal = this.focal;
    c.haperture = this.haperture;
    c.vaperture = this.vaperture;
    c.near = this.near;
    c.far = this.far;
    c.winShiftX = this.winShiftX;
    c.winShiftY = this.winShiftY;
    c.winRoll = this.winRoll;
    c.projectionMode = this.projectionMode;
    c.worldMatrix.copy(this.worldMatrix);
    return c;
  }

  serialize() {
    return {
      name: this.name,
      focal: this.focal,
      haperture: this.haperture,
      vaperture: this.vaperture,
      near: this.near,
      far: this.far,
      winShiftX: this.winShiftX,
      winShiftY: this.winShiftY,
      winRoll: this.winRoll,
      projectionMode: this.projectionMode,
      worldMatrix: this.worldMatrix.toArray()
    };
  }

  static deserialize(data) {
    const c = new Camera3D();
    if (!data) return c;
    c.name = data.name || 'Camera3D';
    c.focal = data.focal !== undefined ? data.focal : 50.0;
    c.haperture = data.haperture !== undefined ? data.haperture : 24.89;
    c.vaperture = data.vaperture !== undefined ? data.vaperture : 18.67;
    c.near = data.near !== undefined ? data.near : 0.1;
    c.far = data.far !== undefined ? data.far : 10000.0;
    c.winShiftX = data.winShiftX || 0.0;
    c.winShiftY = data.winShiftY || 0.0;
    c.winRoll = data.winRoll || 0.0;
    c.projectionMode = data.projectionMode || 'perspective';
    if (data.worldMatrix) {
      c.worldMatrix = Matrix4.fromArray(data.worldMatrix);
    }
    return c;
  }
}
