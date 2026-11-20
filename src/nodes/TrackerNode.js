/**
 * OpenComp - 2D Feature Tracker Node
 * Professional multi-point optical pattern tracking standard VFX implementation.
 * Features Normalized Cross-Correlation (NCC), subpixel peak interpolation,
 * 1-point (T), 2-point (T+R+S), and multi-point affine motion estimation,
 * stabilization, matchmove, track loss detection, manual correction,
 * and direct export to Transform / CornerPin.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';
import { TrackerEngine, TrackPoint } from '../core/TrackerEngine.js';

export class TrackerNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Tracker', 'Transform', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Plate');

    // Controls
    this.addKnob('transformMode', 'Transform Mode', 'select', 'none', {
      options: [
        { label: 'None (Pass-through)', value: 'none' },
        { label: 'Stabilize (Invert Motion)', value: 'stabilize' },
        { label: 'Matchmove (Apply Motion)', value: 'matchmove' }
      ]
    });

    this.addKnob('motionType', 'Motion Type', 'select', 'T+R+S', {
      options: [
        { label: 'Translation Only (T)', value: 'T' },
        { label: 'Translation + Rotation (T+R)', value: 'T+R' },
        { label: 'Translation + Rotation + Scale (T+R+S)', value: 'T+R+S' }
      ]
    });

    this.addKnob('referenceFrame', 'Reference Frame', 'number', 1, { min: 1, max: 10000, step: 1 });
    this.addKnob('correlationThreshold', 'Correlation Threshold', 'number', 0.65, { min: 0.1, max: 1.0, step: 0.05 });
    this.addKnob('rangeStart', 'Range Start', 'number', 1, { min: 1, max: 10000, step: 1 });
    this.addKnob('rangeEnd', 'Range End', 'number', 100, { min: 1, max: 10000, step: 1 });

    // Under-the-hood tracking engine
    this.engine = new TrackerEngine();
    this.engine.referenceFrame = 1;
    this.engine.correlationThreshold = 0.65;
  }

  get tracks() {
    return this.engine.tracks;
  }

  set tracks(val) {
    if (Array.isArray(val)) {
      this.engine.tracks = val.map(t => {
        if (typeof t.getPos === 'function') return t;
        return TrackPoint.deserialize(t);
      });
    } else {
      this.engine.tracks = val;
    }
  }

  get referenceFrame() {
    return Math.round(Number(this.getKnobValue('referenceFrame')) || 1);
  }

  set referenceFrame(val) {
    this.setKnobValue('referenceFrame', val);
    this.engine.referenceFrame = val;
  }

  // --- Track Management API ---

  addTrack(name = null, x = 0, y = 0) {
    const rf = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);
    this.engine.referenceFrame = rf;
    const thresh = Number(this.getKnobValue('correlationThreshold')) || 0.65;
    this.engine.correlationThreshold = thresh;

    const track = this.engine.addTrack(name, x, y);
    this.markDirty();
    return track;
  }

  removeTrack(id) {
    this.engine.removeTrack(id);
    this.markDirty();
  }

  getTrack(id) {
    return this.engine.getTrack(id);
  }

  getAllTracks() {
    return this.engine.tracks;
  }

  setManualKey(trackId, frame, x, y) {
    const track = this.engine.getTrack(trackId);
    if (track) {
      track.setManualKey(frame, x, y);
      this.markDirty();
    }
  }

  /**
   * Tracks active features from prevFrame to targetFrame using current buffer
   * @param {PixelBuffer} currBuffer
   * @param {number} prevFrame
   * @param {number} targetFrame
   */
  trackStep(currBuffer, prevFrame, targetFrame) {
    for (const track of this.engine.tracks) {
      if (track.enabled) {
        this.engine.trackFeature(track, currBuffer, prevFrame, targetFrame);
      }
    }
    this.markDirty();
  }

  /**
   * Track an entire frame sequence forward or backward
   * @param {function(number): Promise<PixelBuffer>|function(number): PixelBuffer} getBufferAtFrame
   * @param {number} startFrame
   * @param {number} endFrame
   * @param {function(number, number): void} [progressCallback]
   */
  async trackSequence(getBufferAtFrame, startFrame, endFrame, progressCallback = null) {
    const direction = startFrame <= endFrame ? 1 : -1;
    const refFrame = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);

    // Ensure reference patterns are grabbed at refFrame
    const refBuffer = await getBufferAtFrame(refFrame);
    if (refBuffer) {
      for (const track of this.engine.tracks) {
        if (!track.refPattern) {
          this.engine.grabReferencePattern(track, refBuffer, refFrame);
        }
      }
    }

    let prevF = startFrame;
    for (let f = startFrame + direction; direction > 0 ? f <= endFrame : f >= endFrame; f += direction) {
      const curBuffer = await getBufferAtFrame(f);
      if (!curBuffer) break;

      this.trackStep(curBuffer, prevF, f);
      prevF = f;

      if (progressCallback) {
        progressCallback(f, endFrame);
      }
    }
  }

  /**
   * Compute Affine Transform at current frame
   * @param {number} frame
   * @returns {{tx: number, ty: number, rotate: number, scale: number, center: [number, number]}}
   */
  getTransformAtFrame(frame) {
    const rf = Math.round(Number(this.getKnobValue('referenceFrame')) || 1);
    const motionType = this.getKnobValue('motionType') || 'T+R+S';
    return this.engine.computeTransform(frame, rf, motionType);
  }

  /**
   * Compute dynamic BBox
   */
  getBBox(inputs, context = {}) {
    let inBBox = null;
    if (inputs instanceof BBox) inBBox = inputs.clone();
    else if (Array.isArray(inputs)) {
      const f = inputs[0];
      inBBox = f instanceof BBox ? f.clone() : (f && f.bbox ? f.bbox.clone() : (f && f.width ? BBox.fromFormat(f.width, f.height) : new BBox(0, 0, 0, 0)));
    } else if (inputs && typeof inputs === 'object') {
      const b = inputs['in'] || inputs['input'] || Object.values(inputs)[0];
      inBBox = b instanceof BBox ? b.clone() : (b && b.bbox ? b.bbox.clone() : (b && b.width ? BBox.fromFormat(b.width, b.height) : new BBox(0, 0, 0, 0)));
    }
    if (!inBBox) inBBox = new BBox(0, 0, 0, 0);

    const mode = this.getKnobValue('transformMode', typeof context === 'object' ? context : { frame: context });
    if (mode === 'none') return inBBox;

    const frame = typeof context === 'number' ? context : (context && context.frame !== undefined ? context.frame : 1);
    const t = this.getTransformAtFrame(frame);

    const tx = mode === 'stabilize' ? -t.tx : t.tx;
    const ty = mode === 'stabilize' ? -t.ty : t.ty;
    const rot = mode === 'stabilize' ? -t.rotate : t.rotate;
    const s = mode === 'stabilize' ? (t.scale > 1e-4 ? 1.0 / t.scale : 1.0) : t.scale;

    const rad = (rot * Math.PI) / 180.0;
    const cosA = Math.cos(rad) * s;
    const sinA = Math.sin(rad) * s;
    const [cx, cy] = t.center;

    const corners = [
      [inBBox.x, inBBox.y],
      [inBBox.r, inBBox.y],
      [inBBox.r, inBBox.t],
      [inBBox.x, inBBox.t]
    ];

    const transformedPoints = corners.map(([px, py]) => {
      const rx = px - cx;
      const ry = py - cy;
      const xRot = rx * cosA - ry * sinA;
      const yRot = rx * sinA + ry * cosA;
      return [xRot + cx + tx, yRot + cy + ty];
    });

    return BBox.fromPoints(transformedPoints);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return null;

    const mode = this.getKnobValue('transformMode', context) || 'none';
    if (mode === 'none') {
      const out = inputBuf.clone();
      out.bbox = this.getBBox(inputs, context);
      return out;
    }

    const frame = context.frame !== undefined ? context.frame : 1;
    const t = this.getTransformAtFrame(frame);
    const [cx, cy] = t.center;

    // Build Forward Matrix M
    const fwdM = TrackerEngine.getAffineMatrix(t.tx, t.ty, t.rotate, t.scale, cx, cy);

    const w = inputBuf.width;
    const h = inputBuf.height;
    const outBuf = new PixelBuffer(w, h);

    if (mode === 'stabilize') {
      // Invert forward matrix to cancel motion
      const invM = TrackerEngine.invert3x3(fwdM);
      TrackerEngine.applyAffineTransform(inputBuf, invM, outBuf);
    } else if (mode === 'matchmove') {
      // Apply forward motion to plate
      TrackerEngine.applyAffineTransform(inputBuf, fwdM, outBuf);
    }

    outBuf.bbox = this.getBBox(inputs, context);
    outBuf.copyChannelsFrom(inputBuf);
    return outBuf;
  }

  /**
   * Draw tracking overlays in Viewer (Pattern box, search window, trajectory, track label)
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} zoom
   * @param {number} panX
   * @param {number} panY
   * @param {Object} [context={}]
   */
  drawOverlay(ctx, zoom, panX, panY, context = {}) {
    const frame = context.frame !== undefined ? context.frame : 1;

    for (const track of this.engine.tracks) {
      if (!track.enabled) continue;

      const pos = track.getPos(frame);
      const scrX = pos.x * zoom + panX;
      const scrY = pos.y * zoom + panY;

      const pw = track.patternWidth * zoom;
      const ph = track.patternHeight * zoom;
      const sw = track.searchWidth * zoom;
      const sh = track.searchHeight * zoom;

      ctx.save();

      // 1. Search Window (Cyan dashed box)
      ctx.strokeStyle = track.trackLost ? '#ff3b30' : 'rgba(0, 240, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(scrX - sw * 0.5, scrY - sh * 0.5, sw, sh);

      // 2. Pattern Window (Yellow solid box)
      ctx.strokeStyle = track.trackLost ? '#ff3b30' : 'rgba(255, 220, 0, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(scrX - pw * 0.5, scrY - ph * 0.5, pw, ph);

      // 3. Center Crosshair
      ctx.strokeStyle = track.trackLost ? '#ff3b30' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(scrX - 8, scrY);
      ctx.lineTo(scrX + 8, scrY);
      ctx.moveTo(scrX, scrY - 8);
      ctx.lineTo(scrX, scrY + 8);
      ctx.stroke();

      // 4. Trajectory Path connecting keyframes
      const sortedFrames = Array.from(track.keyframes.keys()).sort((a, b) => a - b);
      if (sortedFrames.length > 1) {
        ctx.strokeStyle = 'rgba(76, 217, 100, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < sortedFrames.length; i++) {
          const kf = track.keyframes.get(sortedFrames[i]);
          const kx = kf.x * zoom + panX;
          const ky = kf.y * zoom + panY;
          if (i === 0) ctx.moveTo(kx, ky);
          else ctx.lineTo(kx, ky);
        }
        ctx.stroke();
      }

      // 5. Track label & status
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.fillText(
        `${track.name} [${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}] ${track.trackLost ? 'LOST' : (pos.correlation ? pos.correlation.toFixed(2) : '')}`,
        scrX + pw * 0.5 + 4,
        scrY - ph * 0.5 + 10
      );

      ctx.restore();
    }
  }

  // --- Serialization ---

  serialize() {
    const base = super.serialize();
    base.engine = this.engine.serialize();
    return base;
  }

  deserialize(data) {
    super.deserialize(data);
    if (data.engine) {
      this.engine = TrackerEngine.deserialize(data.engine);
    }
  }
}
