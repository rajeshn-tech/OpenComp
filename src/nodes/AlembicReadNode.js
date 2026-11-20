/**
 * OpenComp - AlembicRead Node
 * Ingests Alembic archives (.abc Ogawa / HDF5) containing animated geometry point caches,
 * cameras, and hierarchical transforms into native Scene3D primitives.
 * Supports fractional sub-frame time sampling, coordinate conversion, and point decimation.
 * Production VFX node. / AlembicRead conventions.
 */

import { Node } from '../core/Node.js';
import { AlembicBridgeClient } from '../core/3d/AlembicBridgeClient.js';
import { Scene3D } from '../core/3d/Scene3D.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { PipelineTokens } from '../core/PipelineTokens.js';

export class AlembicReadNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'AlembicRead', '3D', x, y);
    this.width = 120;
    this.height = 42;

    this.addInput('in', 'in', 'Optional Upstream 3D Scene');

    this.addKnob('file', 'File Path', 'filepath', '', {
      filter: 'Alembic Files (*.abc)'
    });

    this.addKnob('objectPath', 'Object Path Mask', 'text', '/', {
      placeholder: '/ (Entire Archive)'
    });

    this.addKnob('frame', 'Frame', 'number', 1.0);
    this.addKnob('useTimelineFrame', 'Use Timeline Frame', 'boolean', true);
    this.addKnob('subFrame', 'Sub-Frame Offset', 'number', 0.0, { min: -1.0, max: 1.0, step: 0.05 });

    this.addKnob('upAxis', 'Up Axis', 'select', 'auto', {
      options: [
        { label: 'Auto (from Archive)', value: 'auto' },
        { label: 'Y-Up (+Y)', value: 'Y' },
        { label: 'Z-Up (+Z -> +Y)', value: 'Z' }
      ]
    });

    this.addKnob('scale', 'Scale Multiplier', 'number', 1.0, { min: 0.0001, max: 10000.0 });
    this.addKnob('stride', 'Point Stride (LOD)', 'number', 1, { min: 1, max: 16, step: 1 });

    this.cachedScene = null;
    this.lastCacheKey = null;
  }

  /**
   * Ingest and evaluate Alembic archive
   * @param {Object} inputs
   * @param {Object} [context={}]
   * @returns {Scene3D}
   */
  compute(inputs, context = {}) {
    const rawPath = this.getKnobValue('file', context);
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      return inputs['in'] instanceof Scene3D ? inputs['in'] : new Scene3D();
    }

    const resolvedPath = PipelineTokens.evaluate(rawPath.trim(), context);

    let targetFrame = 1.0;
    if (this.getKnobValue('useTimelineFrame', context) && context.frame !== undefined) {
      targetFrame = Number(context.frame);
    } else {
      targetFrame = Number(this.getKnobValue('frame', context)) || 1.0;
    }

    const subFrame = Number(this.getKnobValue('subFrame', context)) || 0.0;
    const objectPath = (this.getKnobValue('objectPath', context) || '/').trim();
    const upAxis = this.getKnobValue('upAxis', context) || 'auto';
    const scale = Number(this.getKnobValue('scale', context)) || 1.0;
    const stride = Math.max(1, Math.floor(Number(this.getKnobValue('stride', context)) || 1));

    const cacheKey = `${resolvedPath}|${targetFrame}|${subFrame}|${objectPath}|${upAxis}|${scale}|${stride}`;
    if (this.cachedScene && this.lastCacheKey === cacheKey && !this.isDirty) {
      return this.mergeUpstream(this.cachedScene, inputs['in']);
    }

    try {
      const abcScene = AlembicBridgeClient.read(resolvedPath, {
        objectPath,
        frame: targetFrame,
        subframe: subFrame,
        scale,
        upAxis,
        stride
      });

      this.cachedScene = abcScene;
      this.lastCacheKey = cacheKey;

      return this.mergeUpstream(abcScene, inputs['in']);
    } catch (err) {
      const errorScene = new Scene3D();
      errorScene.error = err.message;
      return errorScene;
    }
  }

  mergeUpstream(abcScene, upstream) {
    if (!upstream) return abcScene;

    const combined = new Scene3D();
    if (upstream instanceof Scene3D) {
      for (const g of upstream.geometries) combined.addGeometry(g.clone ? g.clone() : g);
      for (const c of upstream.cameras) combined.addCamera(c);
      for (const l of upstream.lights) combined.addLight(l);
    } else if (upstream instanceof Geometry3D) {
      combined.addGeometry(upstream.clone ? upstream.clone() : upstream);
    } else {
      return abcScene;
    }

    for (const g of abcScene.geometries) combined.addGeometry(g);
    for (const c of abcScene.cameras) combined.addCamera(c);
    for (const l of abcScene.lights) combined.addLight(l);

    combined.computeBBox();
    return combined;
  }
}
