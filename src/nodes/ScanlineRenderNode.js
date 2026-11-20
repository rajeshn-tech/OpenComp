/**
 * OpenComp - ScanlineRender Node
 * Production 3D-to-2D software rasterizer converting 3D scenes and camera perspectives
 * into high-fidelity 32-bit linear floating point PixelBuffers with Z-depth and AOVs.
 * Production VFX 3D node.
 */

import { Node } from '../core/Node.js';
import { SoftwareRasterizer } from '../core/3d/SoftwareRasterizer.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class ScanlineRenderNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ScanlineRender', '3D', x, y);
    this.width = 130;
    this.height = 42;

    this.addInput('obj', 'obj', '3D Scene / Geometry');
    this.addInput('cam', 'cam', 'Camera3D');
    this.addInput('bg', 'bg', 'Optional 2D Background Plate');

    this.addKnob('format', 'Format', 'select', '1920x1080', {
      options: [
        { label: 'HD 1080p (1920x1080)', value: '1920x1080' },
        { label: 'HD 720p (1280x720)', value: '1280x720' },
        { label: 'UHD 4K (3840x2160)', value: '3840x2160' },
        { label: 'Square (1024x1024)', value: '1024x1024' },
        { label: 'Custom', value: 'custom' }
      ]
    });

    this.addKnob('width', 'Width', 'number', 1920);
    this.addKnob('height', 'Height', 'number', 1080);

    this.addKnob('shading', 'Shading Mode', 'select', 'unlit', {
      options: [
        { label: 'Unlit (Texture Only)', value: 'unlit' },
        { label: 'Flat (Diffuse)', value: 'flat' },
        { label: 'Phong / Smooth', value: 'phong' }
      ]
    });

    this.addKnob('cullBackfaces', 'Cull Backfaces', 'boolean', true);

    this.addKnob('antialiasing', 'Antialiasing', 'select', 'none', {
      options: [
        { label: 'None (1x)', value: 'none' },
        { label: '2x SSAA', value: '2x' },
        { label: '4x SSAA', value: '4x' }
      ]
    });
  }

  /**
   * Resolves effective render width
   */
  getRenderWidth(context = {}) {
    const fmt = this.getKnobValue('format', context) || '1920x1080';
    if (fmt === '1920x1080') return 1920;
    if (fmt === '1280x720') return 1280;
    if (fmt === '3840x2160') return 3840;
    if (fmt === '1024x1024') return 1024;
    return Math.max(1, Math.floor(this.getKnobValue('width', context) || 1920));
  }

  /**
   * Resolves effective render height
   */
  getRenderHeight(context = {}) {
    const fmt = this.getKnobValue('format', context) || '1920x1080';
    if (fmt === '1920x1080') return 1080;
    if (fmt === '1280x720') return 720;
    if (fmt === '3840x2160') return 2160;
    if (fmt === '1024x1024') return 1024;
    return Math.max(1, Math.floor(this.getKnobValue('height', context) || 1080));
  }

  /**
   * 2D Bounding Box evaluation
   */
  getBBox(inputBBoxes) {
    const w = this.getRenderWidth();
    const h = this.getRenderHeight();
    return new BBox(0, 0, w, h);
  }

  /**
   * Computes 2D rendering of 3D scene
   */
  compute(inputs, context = {}) {
    const obj = (inputs && inputs['obj'] !== undefined) ? inputs['obj'] : (Array.isArray(inputs) ? inputs[0] : null);
    let cam = (inputs && inputs['cam'] !== undefined) ? inputs['cam'] : (Array.isArray(inputs) ? inputs[1] : null);
    const bg = (inputs && inputs['bg'] !== undefined) ? inputs['bg'] : (Array.isArray(inputs) ? inputs[2] : null);

    // If external camera not provided, check if scene contains an embedded camera (e.g. from USD or Alembic)
    if (!cam && obj && obj.cameras && obj.cameras.length > 0) {
      cam = obj.cameras[0];
    }

    const width = this.getRenderWidth(context);
    const height = this.getRenderHeight(context);

    if (!obj || !cam) {
      if (bg instanceof PixelBuffer) {
        return bg.clone();
      }
      return new PixelBuffer(width, height);
    }

    const shading = this.getKnobValue('shading', context) || 'unlit';
    const cullBackfaces = this.getKnobValue('cullBackfaces', context) !== false;
    const antialiasing = this.getKnobValue('antialiasing', context) || 'none';

    return SoftwareRasterizer.render({
      scene: obj,
      camera: cam,
      width,
      height,
      background: (bg instanceof PixelBuffer) ? bg : null,
      shading,
      culling: cullBackfaces ? 'back' : 'none',
      antialiasing
    });
  }
}
