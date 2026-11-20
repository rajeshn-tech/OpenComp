/**
 * OpenComp - 2D Feature Tracker Engine
 * Professional subpixel optical pattern tracker.
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

    // Track loss threshold for this point
    this.correlationThreshold = 0.6;
    this.trackLost = false;

    // Tracked history: frame -> { x, y, correlation, manual, trackLost }
    this.keyframes = new Map();
    this.keyframes.set(this.refFrame, { x, y, correlation: 1.0, manual: true, trackLost: false });
  }

  setManualKey(frame, x, y) {
    const f = Math.round(frame);
    this.keyframes.set(f, {
      x,
      y,
      correlation: 1.0,
      manual: true,
      trackLost: false
    });
  }

  getPos(frame) {
    const f = Math.round(frame);
    if (this.keyframes.has(f)) {
      return this.keyframes.get(f);
    }
    // Interpolate or fallback to nearest
    const frames = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    if (frames.length === 0) return { x: this.refX, y: this.refY, correlation: 0, trackLost: true };
    if (f <= frames[0]) return this.keyframes.get(frames[0]);
    if (f >= frames[frames.length - 1]) return this.keyframes.get(frames[frames.length - 1]);

    // Linear interpolation between nearest keyframes
    let prevF = frames[0], nextF = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i] <= f && frames[i + 1] >= f) {
        prevF = frames[i];
        nextF = frames[i + 1];
        break;
      }
    }
    const t = (f - prevF) / (nextF - prevF);
    const p0 = this.keyframes.get(prevF);
    const p1 = this.keyframes.get(nextF);
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      correlation: Math.min(p0.correlation || 0, p1.correlation || 0),
      manual: false,
      trackLost: p0.trackLost || p1.trackLost || false
    };
  }

  serialize() {
    const kfObj = {};
    for (const [k, v] of this.keyframes.entries()) {
      kfObj[k] = { ...v };
    }
    return {
      id: this.id,
      name: this.name,
      enabled: this.enabled,
      useTranslation: this.useTranslation,
      useRotation: this.useRotation,
      useScale: this.useScale,
      patternWidth: this.patternWidth,
      patternHeight: this.patternHeight,
      searchWidth: this.searchWidth,
      searchHeight: this.searchHeight,
      refFrame: this.refFrame,
      refX: this.refX,
      refY: this.refY,
      correlationThreshold: this.correlationThreshold,
      trackLost: this.trackLost,
      keyframes: kfObj
    };
  }

  static deserialize(data) {
    const tp = new TrackPoint(data.id, data.name, data.refX || 0, data.refY || 0);
    tp.enabled = data.enabled !== undefined ? data.enabled : true;
    tp.useTranslation = data.useTranslation !== undefined ? data.useTranslation : true;
    tp.useRotation = data.useRotation !== undefined ? data.useRotation : true;
    tp.useScale = data.useScale !== undefined ? data.useScale : true;
    tp.patternWidth = data.patternWidth || 31;
    tp.patternHeight = data.patternHeight || 31;
    tp.searchWidth = data.searchWidth || 61;
    tp.searchHeight = data.searchHeight || 61;
    tp.refFrame = data.refFrame || 1;
    tp.correlationThreshold = data.correlationThreshold || 0.6;
    tp.trackLost = data.trackLost || false;

    tp.keyframes = new Map();
    if (data.keyframes) {
      for (const [k, v] of Object.entries(data.keyframes)) {
        tp.keyframes.set(Number(k), { ...v });
      }
    }
    return tp;
  }
}

export class TrackerEngine {
  constructor() {
    /** @type {TrackPoint[]} */
    this.tracks = [];
    this.referenceFrame = 1;
    this.correlationThreshold = 0.6;
  }

  addTrack(name = null, x = 0, y = 0) {
    const id = this.tracks.length + 1;
    const track = new TrackPoint(id, name, x, y);
    track.refFrame = this.referenceFrame;
    track.correlationThreshold = this.correlationThreshold;
    this.tracks.push(track);
    return track;
  }

  removeTrack(id) {
    this.tracks = this.tracks.filter(t => t.id !== id);
  }

  getTrack(id) {
    return this.tracks.find(t => t.id === id);
  }

  clear() {
    this.tracks = [];
  }

  /**
   * Extract luminance patch from buffer centered at (cx, cy)
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
    const f = frame !== null ? Math.round(frame) : track.refFrame;
    const pos = track.getPos(f);
    track.refFrame = f;
    track.refX = pos.x;
    track.refY = pos.y;
    track.refPattern = TrackerEngine.extractPatch(buffer, pos.x, pos.y, track.patternWidth, track.patternHeight);
  }

  /**
   * Track one feature point from prevBuffer to currBuffer
   * @param {TrackPoint} track
   * @param {import('./PixelBuffer.js').PixelBuffer} currBuffer
   * @param {number} prevFrame
   * @param {number} targetFrame
   * @returns {{x: number, y: number, correlation: number, trackLost: boolean}}
   */
  trackFeature(track, currBuffer, prevFrame, targetFrame) {
    if (!track.enabled) return null;
    if (!track.refPattern) {
      this.grabReferencePattern(track, currBuffer, prevFrame);
    }

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

    const thresh = track.correlationThreshold || this.correlationThreshold || 0.6;
    const trackLost = bestScore < thresh;

    let finalX = searchStartX + bestX + halfPw + subX;
    let finalY = searchStartY + bestY + halfPh + subY;

    if (trackLost) {
      // Retain previous position if track is lost
      finalX = prevPos.x;
      finalY = prevPos.y;
    }

    track.trackLost = trackLost;
    const result = {
      x: finalX,
      y: finalY,
      correlation: bestScore,
      trackLost,
      manual: false
    };
    track.keyframes.set(Math.round(targetFrame), result);
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

    // 2-Track Solution: Translation + Rotation + Scale
    if (activeTracks.length === 2) {
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

    // 3+ Tracks: Least Squares Affine Estimator
    const N = activeTracks.length;
    let refCenterX = 0, refCenterY = 0;
    let curCenterX = 0, curCenterY = 0;

    const refPts = [];
    const curPts = [];

    for (const t of activeTracks) {
      const pR = t.getPos(rf);
      const pC = t.getPos(targetFrame);
      refPts.push(pR);
      curPts.push(pC);
      refCenterX += pR.x;
      refCenterY += pR.y;
      curCenterX += pC.x;
      curCenterY += pC.y;
    }

    refCenterX /= N;
    refCenterY /= N;
    curCenterX /= N;
    curCenterY /= N;

    const tx = curCenterX - refCenterX;
    const ty = curCenterY - refCenterY;

    if (motionType === 'T') {
      return { tx, ty, rotate: 0, scale: 1.0, center: [refCenterX, refCenterY] };
    }

    // Centered coordinates for rotation & scale estimation
    let sumRefDist = 0;
    let sumCurDist = 0;
    let sumCross = 0;
    let sumDot = 0;

    for (let i = 0; i < N; i++) {
      const rx = refPts[i].x - refCenterX;
      const ry = refPts[i].y - refCenterY;
      const cx = curPts[i].x - curCenterX;
      const cy = curPts[i].y - curCenterY;

      sumRefDist += Math.hypot(rx, ry);
      sumCurDist += Math.hypot(cx, cy);

      sumDot += rx * cx + ry * cy;
      sumCross += rx * cy - ry * cx;
    }

    let rotateDeg = 0;
    if (motionType === 'T+R' || motionType === 'T+R+S') {
      const angle = Math.atan2(sumCross, sumDot);
      rotateDeg = (angle * 180) / Math.PI;
    }

    let scale = 1.0;
    if (motionType === 'T+R+S' && sumRefDist > 1e-4) {
      scale = sumCurDist / sumRefDist;
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

  /**
   * Apply 3x3 affine transformation matrix to pixel buffer with bilinear interpolation
   * @param {import('./PixelBuffer.js').PixelBuffer} srcBuf
   * @param {number[]} matrix - 3x3 forward or inverse matrix
   * @param {import('./PixelBuffer.js').PixelBuffer} dstBuf
   */
  static applyAffineTransform(srcBuf, matrix, dstBuf) {
    const w = srcBuf.width;
    const h = srcBuf.height;
    const src = srcBuf.data;
    const dst = dstBuf.data;

    // Compute inverse matrix to sample backward from destination to source
    const invM = TrackerEngine.invert3x3(matrix);

    const m00 = invM[0], m01 = invM[1], m02 = invM[2];
    const m10 = invM[3], m11 = invM[4], m12 = invM[5];

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      for (let x = 0; x < w; x++) {
        // Source coordinates
        const srcX = m00 * x + m01 * y + m02;
        const srcY = m10 * x + m11 * y + m12;

        const outIdx = rowOffset + x * 4;

        if (srcX >= 0 && srcX < w - 1 && srcY >= 0 && srcY < h - 1) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const fx = srcX - x0;
          const fy = srcY - y0;
          const ifx = 1.0 - fx;
          const ify = 1.0 - fy;

          const idx00 = (y0 * w + x0) * 4;
          const idx10 = (y0 * w + x1) * 4;
          const idx01 = (y1 * w + x0) * 4;
          const idx11 = (y1 * w + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const top = src[idx00 + c] * ifx + src[idx10 + c] * fx;
            const bot = src[idx01 + c] * ifx + src[idx11 + c] * fx;
            dst[outIdx + c] = top * ify + bot * fy;
          }
        } else if (srcX >= -0.5 && srcX < w - 0.5 && srcY >= -0.5 && srcY < h - 0.5) {
          // Boundary clamp for edge pixels
          const cx = Math.max(0, Math.min(w - 1, Math.round(srcX)));
          const cy = Math.max(0, Math.min(h - 1, Math.round(srcY)));
          const inIdx = (cy * w + cx) * 4;
          dst[outIdx] = src[inIdx];
          dst[outIdx + 1] = src[inIdx + 1];
          dst[outIdx + 2] = src[inIdx + 2];
          dst[outIdx + 3] = src[inIdx + 3];
        } else {
          // Outside bounds
          dst[outIdx] = 0;
          dst[outIdx + 1] = 0;
          dst[outIdx + 2] = 0;
          dst[outIdx + 3] = 0;
        }
      }
    }
  }

  serialize() {
    return {
      referenceFrame: this.referenceFrame,
      correlationThreshold: this.correlationThreshold,
      tracks: this.tracks.map(t => t.serialize())
    };
  }

  static deserialize(data) {
    const engine = new TrackerEngine();
    if (!data) return engine;
    engine.referenceFrame = data.referenceFrame || 1;
    engine.correlationThreshold = data.correlationThreshold || 0.6;
    if (Array.isArray(data.tracks)) {
      engine.tracks = data.tracks.map(tData => TrackPoint.deserialize(tData));
    }
    return engine;
  }
}
