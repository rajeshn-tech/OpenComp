/**
 * OpenComp - USDRead Node
 * Ingests Universal Scene Description (OpenUSD) stages (.usd, .usda, .usdc, .usdz)
 * into native Scene3D, Geometry3D, and Camera3D primitives.
 * Supports prim hierarchy filtering, coordinate/unit conversion, animated transforms,
 * and point decimation.
 * Production VFX node. / USDRead conventions.
 */

import { Node } from '../core/Node.js';
import { USDBridgeClient } from '../core/3d/USDBridgeClient.js';
import { Scene3D } from '../core/3d/Scene3D.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { PipelineTokens } from '../core/PipelineTokens.js';

export class USDReadNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'USDRead', '3D', x, y);
    this.width = 120;
    this.height = 42;

    // Optional pass-through input
    this.addInput('in', 'in', 'Optional Upstream 3D Scene');

    this.addKnob('file', 'File Path', 'filepath', '', {
      filter: 'USD Files (*.usd;*.usda;*.usdc;*.usdz)'
    });

    this.addKnob('primPath', 'Prim Path Mask', 'text', '/', {
      placeholder: '/ (Entire Stage)'
    });

    this.addKnob('frame', 'Frame', 'number', 1.0);
    this.addKnob('useTimelineFrame', 'Use Timeline Frame', 'boolean', true);

    this.addKnob('upAxis', 'Up Axis', 'select', 'auto', {
      options: [
        { label: 'Auto (from Stage)', value: 'auto' },
        { label: 'Y-Up (+Y)', value: 'Y' },
        { label: 'Z-Up (+Z -> +Y)', value: 'Z' }
      ]
    });

    this.addKnob('scale', 'Unit Scale', 'select', 'auto', {
      options: [
        { label: 'Auto (from metersPerUnit)', value: 'auto' },
        { label: 'Meters (1.0)', value: 'meters' },
        { label: 'Centimeters (0.01)', value: 'centimeters' },
        { label: 'Inches (0.0254)', value: 'inches' },
        { label: 'Custom', value: 'custom' }
      ]
    });

    this.addKnob('customScale', 'Custom Scale Multiplier', 'number', 1.0, { min: 0.0001, max: 10000.0 });
    this.addKnob('stride', 'Point Stride (LOD)', 'number', 1, { min: 1, max: 16, step: 1 });
    this.addKnob('readCameras', 'Read Cameras', 'boolean', true);
    this.addKnob('readMeshes', 'Read Meshes', 'boolean', true);

    this.cachedScene = null;
    this.lastCacheKey = null;
  }

  /**
   * Resolve effective scale multiplier
   */
  getEffectiveScale(context = {}) {
    const scaleMode = this.getKnobValue('scale', context) || 'auto';
    if (scaleMode === 'meters') return 1.0;
    if (scaleMode === 'centimeters') return 0.01;
    if (scaleMode === 'inches') return 0.0254;
    if (scaleMode === 'custom') {
      return Number(this.getKnobValue('customScale', context)) || 1.0;
    }
    return null; // auto
  }

  /**
   * Ingest and evaluate USD stage
   * @param {Object} inputs
   * @param {Object} [context={}]
   * @returns {Scene3D}
   */
  compute(inputs, context = {}) {
    const rawPath = this.getKnobValue('file', context);
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      return inputs['in'] instanceof Scene3D ? inputs['in'] : new Scene3D();
    }

    // PipelineTokens expansion
    const resolvedPath = PipelineTokens.evaluate(rawPath.trim(), context);

    // Frame resolution
    let targetFrame = 1.0;
    if (this.getKnobValue('useTimelineFrame', context) && context.frame !== undefined) {
      targetFrame = Number(context.frame);
    } else {
      targetFrame = Number(this.getKnobValue('frame', context)) || 1.0;
    }

    const primPath = (this.getKnobValue('primPath', context) || '/').trim();
    const upAxis = this.getKnobValue('upAxis', context) || 'auto';
    const scale = this.getEffectiveScale(context);
    const stride = Math.max(1, Math.floor(Number(this.getKnobValue('stride', context)) || 1));
    const readCameras = Boolean(this.getKnobValue('readCameras', context));
    const readMeshes = Boolean(this.getKnobValue('readMeshes', context));

    // Cache check
    const cacheKey = `${resolvedPath}|${targetFrame}|${primPath}|${upAxis}|${scale}|${stride}|${readCameras}|${readMeshes}`;
    if (this.cachedScene && this.lastCacheKey === cacheKey && !this.isDirty) {
      const resultScene = this.mergeUpstream(this.cachedScene, inputs['in']);
      return resultScene;
    }

    // Ingest via bridge
    try {
      const stageScene = USDBridgeClient.read(resolvedPath, {
        primPath,
        frame: targetFrame,
        scale,
        upAxis,
        stride,
        readCameras,
        readMeshes
      });

      this.cachedScene = stageScene;
      this.lastCacheKey = cacheKey;

      return this.mergeUpstream(stageScene, inputs['in']);
    } catch (err) {
      // Non-fatal error reporting: attach error metadata to scene container
      const errorScene = new Scene3D();
      errorScene.error = err.message;
      return errorScene;
    }
  }

  mergeUpstream(stageScene, upstream) {
    if (!upstream) return stageScene;

    const combined = new Scene3D();
    if (upstream instanceof Scene3D) {
      for (const g of upstream.geometries) combined.addGeometry(g.clone ? g.clone() : g);
      for (const c of upstream.cameras) combined.addCamera(c);
      for (const l of upstream.lights) combined.addLight(l);
    } else if (upstream instanceof Geometry3D) {
      combined.addGeometry(upstream.clone ? upstream.clone() : upstream);
    } else {
      return stageScene;
    }

    for (const g of stageScene.geometries) combined.addGeometry(g);
    for (const c of stageScene.cameras) combined.addCamera(c);
    for (const l of stageScene.lights) combined.addLight(l);

    combined.computeBBox();
    return combined;
  }
}
