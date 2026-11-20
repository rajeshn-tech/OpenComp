/**
 * OpenComp - 3D Scene Graph Container
 * Aggregates 3D geometries, lights, and cameras into a single unified 3D stream.
 */

import { Geometry3D } from './Geometry3D.js';
import { Vector3 } from './Vector3.js';

export class Scene3D {
  constructor() {
    /** @type {Geometry3D[]} */
    this.geometries = [];
    /** @type {any[]} */
    this.cameras = [];
    /** @type {any[]} */
    this.lights = [];

    this.bbox = {
      min: new Vector3(0, 0, 0),
      max: new Vector3(0, 0, 0)
    };
  }

  addGeometry(geo) {
    if (geo instanceof Geometry3D) {
      this.geometries.push(geo);
      this.computeBBox();
    }
    return this;
  }

  add(item) {
    if (item instanceof Geometry3D) {
      return this.addGeometry(item);
    } else if (item && item.focal !== undefined) {
      return this.addCamera(item);
    } else if (item && item.type === 'light') {
      return this.addLight(item);
    }
    return this;
  }

  removeGeometry(name) {
    this.geometries = this.geometries.filter(g => g.name !== name && g.id !== name);
    this.computeBBox();
    return this;
  }

  addCamera(cam) {
    if (cam) this.cameras.push(cam);
    return this;
  }

  addLight(light) {
    if (light) this.lights.push(light);
    return this;
  }

  clear() {
    this.geometries = [];
    this.cameras = [];
    this.lights = [];
    this.computeBBox();
  }

  computeBBox() {
    if (this.geometries.length === 0) {
      this.bbox.min.set(0, 0, 0);
      this.bbox.max.set(0, 0, 0);
      return this.bbox;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const g of this.geometries) {
      const b = g.computeBBox();
      if (b.min.x < minX) minX = b.min.x;
      if (b.min.y < minY) minY = b.min.y;
      if (b.min.z < minZ) minZ = b.min.z;
      if (b.max.x > maxX) maxX = b.max.x;
      if (b.max.y > maxY) maxY = b.max.y;
      if (b.max.z > maxZ) maxZ = b.max.z;
    }

    this.bbox.min.set(minX, minY, minZ);
    this.bbox.max.set(maxX, maxY, maxZ);
    return this.bbox;
  }

  clone() {
    const s = new Scene3D();
    s.geometries = this.geometries.map(g => g.clone());
    s.cameras = [...this.cameras];
    s.lights = [...this.lights];
    s.computeBBox();
    return s;
  }

  serialize() {
    return {
      geometries: this.geometries.map(g => g.serialize()),
      lights: this.lights
    };
  }

  static deserialize(data) {
    const s = new Scene3D();
    if (data && Array.isArray(data.geometries)) {
      s.geometries = data.geometries.map(gData => Geometry3D.deserialize(gData));
    }
    s.computeBBox();
    return s;
  }
}
