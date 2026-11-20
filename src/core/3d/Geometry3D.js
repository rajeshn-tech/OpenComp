/**
 * OpenComp - 3D Geometric Mesh & Surface Representation
 * Production indexed triangle mesh container for Card3D, Cube3D, primitives, and projected surfaces.
 */

import { Vector3 } from './Vector3.js';
import { Matrix4 } from './Matrix4.js';

export class Geometry3D {
  constructor(name = 'Geometry') {
    this.name = name;
    this.id = name;
    this.vertices = new Float32Array(0);   // [x0, y0, z0, x1, y1, z1, ...]
    this.normals = new Float32Array(0);    // [nx0, ny0, nz0, ...]
    this.uvs = new Float32Array(0);        // [u0, v0, u1, v1, ...]
    this.indices = new Uint32Array(0);     // [i0, i1, i2, ...]
    this.transform = new Matrix4();

    this.material = {
      color: [1.0, 1.0, 1.0, 1.0],
      texture: null, // PixelBuffer
      twoSided: true,
      wireframe: false,
      lit: false
    };

    this.bbox = {
      min: new Vector3(-1, -1, -1),
      max: new Vector3(1, 1, 1)
    };
  }

  get matrix() {
    return this.transform;
  }

  set matrix(m) {
    this.transform = m;
  }

  setBuffers(vertices, indices, normals = null, uvs = null) {
    this.vertices = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    this.indices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
    
    if (uvs) {
      this.uvs = uvs instanceof Float32Array ? uvs : new Float32Array(uvs);
    } else {
      this.uvs = new Float32Array((this.vertices.length / 3) * 2);
    }

    if (normals) {
      this.normals = normals instanceof Float32Array ? normals : new Float32Array(normals);
    } else {
      this.computeNormals();
    }

    this.computeBBox();
    return this;
  }

  computeNormals() {
    const numVerts = this.vertices.length / 3;
    const normals = new Float32Array(numVerts * 3);
    const v = this.vertices;
    const idx = this.indices;

    for (let i = 0; i < idx.length; i += 3) {
      const i0 = idx[i] * 3;
      const i1 = idx[i + 1] * 3;
      const i2 = idx[i + 2] * 3;

      const ax = v[i1] - v[i0], ay = v[i1 + 1] - v[i0 + 1], az = v[i1 + 2] - v[i0 + 2];
      const bx = v[i2] - v[i0], by = v[i2 + 1] - v[i0 + 1], bz = v[i2 + 2] - v[i0 + 2];

      // Cross product (a x b)
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;

      normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
      normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
      normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
    }

    // Normalize all vertex normals
    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-12) {
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
      } else {
        normals[i] = 0;
        normals[i + 1] = 1;
        normals[i + 2] = 0;
      }
    }

    this.normals = normals;
    return this;
  }

  computeBBox() {
    const v = this.vertices;
    if (v.length === 0) {
      this.bbox.min.set(0, 0, 0);
      this.bbox.max.set(0, 0, 0);
      return this.bbox;
    }

    let minX = v[0], minY = v[1], minZ = v[2];
    let maxX = v[0], maxY = v[1], maxZ = v[2];

    for (let i = 3; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    this.bbox.min.set(minX, minY, minZ);
    this.bbox.max.set(maxX, maxY, maxZ);
    return this.bbox;
  }

  clone() {
    const geo = new Geometry3D(this.name);
    geo.vertices = new Float32Array(this.vertices);
    geo.normals = new Float32Array(this.normals);
    geo.uvs = new Float32Array(this.uvs);
    geo.indices = new Uint32Array(this.indices);
    geo.transform.copy(this.transform);
    geo.material = {
      color: [...this.material.color],
      texture: this.material.texture,
      twoSided: this.material.twoSided,
      wireframe: this.material.wireframe,
      lit: this.material.lit
    };
    geo.bbox = {
      min: this.bbox.min.clone(),
      max: this.bbox.max.clone()
    };
    return geo;
  }

  serialize() {
    return {
      name: this.name,
      vertices: Array.from(this.vertices),
      normals: Array.from(this.normals),
      uvs: Array.from(this.uvs),
      indices: Array.from(this.indices),
      transform: this.transform.toArray(),
      material: {
        color: this.material.color,
        twoSided: this.material.twoSided,
        wireframe: this.material.wireframe,
        lit: this.material.lit
      }
    };
  }

  static deserialize(data) {
    const geo = new Geometry3D(data.name || 'Geometry');
    geo.vertices = new Float32Array(data.vertices || []);
    geo.normals = new Float32Array(data.normals || []);
    geo.uvs = new Float32Array(data.uvs || []);
    geo.indices = new Uint32Array(data.indices || []);
    if (data.transform) {
      geo.transform = Matrix4.fromArray(data.transform);
    }
    if (data.material) {
      geo.material = {
        color: data.material.color || [1, 1, 1, 1],
        texture: null,
        twoSided: data.material.twoSided !== undefined ? data.material.twoSided : true,
        wireframe: Boolean(data.material.wireframe),
        lit: Boolean(data.material.lit)
      };
    }
    geo.computeBBox();
    return geo;
  }
}
