/**
 * OpenComp - Scene3D Node
 * Consolidates multiple 3D geometries, cameras, lights, and sub-scenes into a unified 3D stream.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { Scene3D } from '../core/3d/Scene3D.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';

export class Scene3DNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Scene3D', '3D', x, y);
    this.width = 110;
    this.height = 42;

    // Standard Scene multi-input connection points (0 to 9)
    for (let i = 0; i <= 9; i++) {
      this.addInput(String(i), String(i), `Input ${i}`);
    }
  }

  compute(inputs, context = {}) {
    const scene = new Scene3D();

    for (const [key, val] of Object.entries(inputs)) {
      if (!val) continue;

      if (val instanceof Geometry3D) {
        scene.addGeometry(val.clone());
      } else if (val instanceof Scene3D) {
        for (const geo of val.geometries) {
          scene.addGeometry(geo.clone());
        }
        for (const cam of val.cameras) {
          scene.addCamera(cam);
        }
        for (const light of val.lights) {
          scene.addLight(light);
        }
      } else if (val.isGeometry && val.geometry instanceof Geometry3D) {
        scene.addGeometry(val.geometry.clone());
      } else if (val.isCamera) {
        scene.addCamera(val);
      }
    }

    return scene;
  }
}

