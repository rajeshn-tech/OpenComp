/**
 * OpenComp - 2D Feature Tracker Engine
 * Professional subpixel optical pattern tracker (matching Foundry Nuke Tracker4).
 * Supports Normalized Cross-Correlation (NCC), subpixel parabolic peak fitting,
 * multi-track affine transformation (Translate, Rotate, Scale), stabilization,
 * and matchmove matrix generation.
 */

export class TrackPoint {
  constructor(id, name, x = 0, y = 0) {
    this.id = id;
    this.name = name || `track${id}`;
    this.enabled = true;
    this.useTranslation = true;
    this.useRotation = true;
    this.useScale = true;

    // Pattern box (feature patch)
    this.patternWidth = 31;
    this.patternHeight = 31;

    // Search window
    this.searchWidth = 61;
    this.searchHeight = 61;

    // Reference frame data
    this.refFrame = 1;
    this.refX = x;
    this.refY = y;
    this.refPattern = null; // Float32Array of luminance

    // Tracked history: frame -> { x, y, correlation }
    this.keyframes = new Map();
    this.keyframes.set(this.refFrame, { x, y, correlation: 1.0 });
  }

  getPos(frame) {
    if (this.keyframes.has(frame)) {
      return this.keyframes.get(frame);
    }
    // Interpolate or fallback to nearest
    const frames = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    if (frames.length === 0) return { x: this.refX, y: this.refY, correlation: 0 };
    if (frame <= frames[0]) return this.keyframes.get(frames[0]);
    if (frame >= frames[frames.length - 1]) return this.keyframes.get(frames[frames.length - 1]);

    // Linear interpolation between nearest keyframes
    let prevF = frames[0], nextF = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i] <= frame && frames[i + 1] >= frame) {
        prevF = frames[i];
        nextF = frames[i + 1];
        break;
      }
    }
    const t = (frame - prevF) / (nextF - prevF);
    const p0 = this.keyframes.get(prevF);
    const p1 = this.keyframes.get(nextF);
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      correlation: Math.min(p0.correlation, p1.correlation)
    };
  }
}

export class TrackerEngine {
  constructor() {
    this.tracks = [];
    this.referenceFrame = 1;
    this.correlationThreshold = 0.6;
  }

  addTrack(name = null, x = 0, y = 0) {
    const id = this.tracks.length + 1;
    const track = new TrackPoint(id, name, x, y);
    track.refFrame = this.referenceFrame;
    this.tracks.push(track);
    return track;
  }

  removeTrack(id) {
    this.tracks = this.tracks.filter(t => t.id !== id);
  }

  getTrack(id) {
    return this.tracks.find(t => t.id === id);
  }

  /**
   * Extract luminance patch from buffer
   */
  static extractPatch(buffer, cx, cy, w, h) {
    const patch = new Float32Array(w * h);
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    const bufW = buffer.width;
    const bufH = buffer.height;
    const data = buffer.data;

    let idx = 0;
    for (let j = 0; j < h; j++) {
      const py = Math.min(Math.max(0, Math.floor(cy - halfH + j)), bufH - 1);
      const rowOffset = py * bufW * 4;
      for (let i = 0; i < w; i++) {
        const px = Math.min(Math.max(0, Math.floor(cx - halfW + i)), bufW - 1);
        const pOffset = rowOffset + px * 4;
        // Rec.709 Luminance: 0.2126R + 0.7152G + 0.0722B
        const luma = 0.2126 * data[pOffset] + 0.7152 * data[pOffset + 1] + 0.0722 * data[pOffset + 2];
        patch[idx++] = luma;
      }
    }
    return patch;
  }

  /**
   * Capture reference pattern for a track at its reference frame
   */
  grabReferencePattern(track, buffer, frame = null) {
    const f = frame !== null ? frame : track.refFrame;
    const pos = track.getPos(f);
    track.refFrame = f;
    track.refX = pos.x;
    track.refY = pos.y;
    track.refPattern = TrackerEngine.extractPatch(buffer, pos.x, pos.y, track.patternWidth, track.patternHeight);
  }

  /**
   * Track one feature point from prevBuffer to currBuffer
   * @param {TrackPoint} track
   * @param {PixelBuffer} currBuffer
   * @param {number} prevFrame
   * @param {number} targetFrame
   * @returns {{x: number, y: number, correlation: number}}
   */
  trackFeature(track, currBuffer, prevFrame, targetFrame) {
    if (!track.enabled) return null;
    if (!track.refPattern) return null;

    const prevPos = track.getPos(prevFrame);
    const pw = track.patternWidth;
    const ph = track.patternHeight;
    const sw = track.searchWidth;
    const sh = track.searchHeight;

    const halfSw = Math.floor(sw / 2);
    const halfSh = Math.floor(sh / 2);
    const halfPw = Math.floor(pw / 2);
    const halfPh = Math.floor(ph / 2);

    const ref = track.refPattern;
    const numRefPixels = pw * ph;

    // Compute mean of reference pattern
    let refMean = 0;
    for (let i = 0; i < numRefPixels; i++) refMean += ref[i];
    refMean /= numRefPixels;

    // Compute ref variance
    let refVar = 0;
    for (let i = 0; i < numRefPixels; i++) {
      const diff = ref[i] - refMean;
      refVar += diff * diff;
    }
    const refStd = Math.sqrt(refVar);

    // Grid of correlation scores
    const scoreGridW = sw - pw + 1;
    const scoreGridH = sh - ph + 1;
    const scores = new Float32Array(scoreGridW * scoreGridH);

    let bestScore = -1.0;
    let bestX = 0;
    let bestY = 0;

    const searchStartX = Math.floor(prevPos.x - halfSw);
    const searchStartY = Math.floor(prevPos.y - halfSh);

    for (let sy = 0; sy < scoreGridH; sy++) {
      const curY = searchStartY + sy + halfPh;
      for (let sx = 0; sx < scoreGridW; sx++) {
        const curX = searchStartX + sx + halfPw;

        // Extract candidate patch
        const cand = TrackerEngine.extractPatch(currBuffer, curX, curY, pw, ph);

        // Compute candidate mean
        let candMean = 0;
        for (let i = 0; i < numRefPixels; i++) candMean += cand[i];
        candMean /= numRefPixels;

        // Compute covariance and cand variance
        let cov = 0;
        let candVar = 0;
        for (let i = 0; i < numRefPixels; i++) {
          const rDiff = ref[i] - refMean;
          const cDiff = cand[i] - candMean;
          cov += rDiff * cDiff;
          candVar += cDiff * cDiff;
        }

        const denom = refStd * Math.sqrt(candVar);
        const ncc = denom > 1e-7 ? cov / denom : 0.0;
        scores[sy * scoreGridW + sx] = ncc;

        if (ncc > bestScore) {
          bestScore = ncc;
          bestX = sx;
          bestY = sy;
        }
      }
    }

    // Subpixel quadratic peak interpolation
    let subX = 0;
    let subY = 0;
    if (bestX > 0 && bestX < scoreGridW - 1 && bestY > 0 && bestY < scoreGridH - 1) {
      const s0 = scores[bestY * scoreGridW + bestX];
      const sL = scores[bestY * scoreGridW + (bestX - 1)];
      const sR = scores[bestY * scoreGridW + (bestX + 1)];
      const denomX = sL - 2 * s0 + sR;
      if (Math.abs(denomX) > 1e-6) {
        subX = 0.5 * (sL - sR) / denomX;
      }

      const sT = scores[(bestY - 1) * scoreGridW + bestX];
      const sB = scores[(bestY + 1) * scoreGridW + bestX];
      const denomY = sT - 2 * s0 + sB;
      if (Math.abs(denomY) > 1e-6) {
        subY = 0.5 * (sT - sB) / denomY;
      }
      // Clamp subpixel offset to [-0.5, 0.5]
      subX = Math.max(-0.5, Math.min(0.5, subX));
      subY = Math.max(-0.5, Math.min(0.5, subY));
    }

    const finalX = searchStartX + bestX + halfPw + subX;
    const finalY = searchStartY + bestY + halfPh + subY;

    const result = { x: finalX, y: finalY, correlation: bestScore };
    track.keyframes.set(targetFrame, result);
    return result;
  }

  /**
   * Compute 2D Affine Transformation between referenceFrame and targetFrame
   * @param {number} targetFrame
   * @param {number} [refFrame]
   * @param {'T'|'T+R'|'T+R+S'} [motionType='T+R+S']
   * @returns {{tx: number, ty: number, rotate: number, scale: number, center: [number, number]}}
   */
  computeTransform(targetFrame, refFrame = null, motionType = 'T+R+S') {
    const rf = refFrame !== null ? refFrame : this.referenceFrame;
    const activeTracks = this.tracks.filter(t => t.enabled);

    if (activeTracks.length === 0) {
      return { tx: 0, ty: 0, rotate: 0, scale: 1.0, center: [0, 0] };
    }

    // 1-Track Solution: Pure Translation
    if (activeTracks.length === 1 || motionType === 'T') {
      const t = activeTracks[0];
      const pRef = t.getPos(rf);
      const pCur = t.getPos(targetFrame);
      return {
        tx: pCur.x - pRef.x,
        ty: pCur.y - pRef.y,
        rotate: 0,
        scale: 1.0,
        center: [pRef.x, pRef.y]
      };
    }

    // 2+ Track Solution: Translation + Rotation + Scale
    const t1 = activeTracks[0];
    const t2 = activeTracks[1];

    const p1Ref = t1.getPos(rf);
    const p2Ref = t2.getPos(rf);
    const p1Cur = t1.getPos(targetFrame);
    const p2Cur = t2.getPos(targetFrame);

    // Reference center & vector
    const refCenterX = 0.5 * (p1Ref.x + p2Ref.x);
    const refCenterY = 0.5 * (p1Ref.y + p2Ref.y);
    const refDx = p2Ref.x - p1Ref.x;
    const refDy = p2Ref.y - p1Ref.y;
    const refDist = Math.hypot(refDx, refDy);
    const refAngle = Math.atan2(refDy, refDx);

    // Current center & vector
    const curCenterX = 0.5 * (p1Cur.x + p2Cur.x);
    const curCenterY = 0.5 * (p1Cur.y + p2Cur.y);
    const curDx = p2Cur.x - p1Cur.x;
    const curDy = p2Cur.y - p1Cur.y;
    const curDist = Math.hypot(curDx, curDy);
    const curAngle = Math.atan2(curDy, curDx);

    // Delta translation
    const tx = curCenterX - refCenterX;
    const ty = curCenterY - refCenterY;

    // Delta rotation in degrees
    let rotateDeg = 0;
    if (motionType === 'T+R' || motionType === 'T+R+S') {
      let deltaAngle = curAngle - refAngle;
      // Normalize to [-pi, pi]
      while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
      while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
      rotateDeg = (deltaAngle * 180) / Math.PI;
    }

    // Delta scale
    let scale = 1.0;
    if (motionType === 'T+R+S' && refDist > 1e-4) {
      scale = curDist / refDist;
    }

    return {
      tx,
      ty,
      rotate: rotateDeg,
      scale,
      center: [refCenterX, refCenterY]
    };
  }

  /**
   * Generate 3x3 Forward Affine Matrix: M = T(c + t) * R(rot) * S(scale) * T(-c)
   */
  static getAffineMatrix(tx, ty, rotateDeg, scale, cx, cy) {
    const rad = (rotateDeg * Math.PI) / 180.0;
    const cos = Math.cos(rad) * scale;
    const sin = Math.sin(rad) * scale;

    // M = [ cos  -sin   tx + cx - (cx*cos - cy*sin) ]
    //     [ sin   cos   ty + cy - (cx*sin + cy*cos) ]
    //     [  0     0     1                          ]
    const m00 = cos;
    const m01 = -sin;
    const m02 = tx + cx - (cx * cos - cy * sin);

    const m10 = sin;
    const m11 = cos;
    const m12 = ty + cy - (cx * sin + cy * cos);

    return [
      m00, m01, m02,
      m10, m11, m12,
      0, 0, 1
    ];
  }

  /**
   * Invert 3x3 Affine Matrix for Stabilization
   */
  static invert3x3(m) {
    const a = m[0], b = m[1], c = m[2];
    const d = m[3], e = m[4], f = m[5];
    const det = a * e - b * d;
    if (Math.abs(det) < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const invDet = 1.0 / det;

    return [
      e * invDet, -b * invDet, (b * f - c * e) * invDet,
      -d * invDet, a * invDet, (c * d - a * f) * invDet,
      0, 0, 1
    ];
  }
}
