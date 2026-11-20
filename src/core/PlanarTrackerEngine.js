/**
 * OpenComp - Planar Tracker Engine
 * Production 4-corner homography tracking with multi-point feature distribution,
 * robust outlier rejection, perspective warping, and CornerPin export.
 */

import { TrackerEngine } from './TrackerEngine.js';

export class PlanarCorner {
  constructor(index, x, y) {
    this.index = index; // 1: BL, 2: BR, 3: TR, 4: TL
    this.keyframes = new Map(); // frame -> { x, y, manual }
    this.setKey(1, x, y, true);
  }

  setKey(frame, x, y, manual = true) {
    const f = Math.round(frame);
    this.keyframes.set(f, { x, y, manual });
  }

  getPos(frame) {
    const f = Math.round(frame);
    if (this.keyframes.has(f)) return this.keyframes.get(f);

    const frames = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    if (frames.length === 0) return { x: 0, y: 0, manual: false };
    if (f <= frames[0]) return this.keyframes.get(frames[0]);
    if (f >= frames[frames.length - 1]) return this.keyframes.get(frames[frames.length - 1]);

    // Interpolate
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
      manual: false
    };
  }

  serialize() {
    const kfs = {};
    for (const [k, v] of this.keyframes.entries()) {
      kfs[k] = { ...v };
    }
    return { index: this.index, keyframes: kfs };
  }

  static deserialize(data) {
    const corner = new PlanarCorner(data.index, 0, 0);
    corner.keyframes = new Map();
    if (data.keyframes) {
      for (const [k, v] of Object.entries(data.keyframes)) {
        corner.keyframes.set(Number(k), { ...v });
      }
    }
    return corner;
  }
}

export class PlanarTrackerEngine {
  constructor() {
    this.referenceFrame = 1;
    this.gridRows = 4;
    this.gridCols = 4;
    this.outlierThresholdPx = 3.5;
    this.minInlierRatio = 0.4;

    // 4 Corners: [BL, BR, TR, TL]
    this.corners = [
      new PlanarCorner(1, 100, 100),
      new PlanarCorner(2, 300, 100),
      new PlanarCorner(3, 300, 300),
      new PlanarCorner(4, 100, 300)
    ];

    // Internal distributed feature tracks
    this.featureTracks = [];
    this.confidenceMap = new Map(); // frame -> confidence score (0.0 to 1.0)
    this.trackLostMap = new Map();   // frame -> boolean
  }

  setCorners(p1, p2, p3, p4, frame = 1) {
    this.corners[0].setKey(frame, p1.x, p1.y, true);
    this.corners[1].setKey(frame, p2.x, p2.y, true);
    this.corners[2].setKey(frame, p3.x, p3.y, true);
    this.corners[3].setKey(frame, p4.x, p4.y, true);
  }

  getCornersAtFrame(frame) {
    return [
      this.corners[0].getPos(frame),
      this.corners[1].getPos(frame),
      this.corners[2].getPos(frame),
      this.corners[3].getPos(frame)
    ];
  }

  /**
   * Initializes internal grid feature tracks distributed inside the planar quad at refFrame
   */
  initPlanarFeatures(refBuffer, refFrame = null) {
    const rf = refFrame !== null ? Math.round(refFrame) : this.referenceFrame;
    this.referenceFrame = rf;
    const [p1, p2, p3, p4] = this.getCornersAtFrame(rf);

    this.featureTracks = [];
    const rows = this.gridRows;
    const cols = this.gridCols;

    let id = 1;
    for (let r = 0; r < rows; r++) {
      const v = (r + 0.5) / rows;
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) / cols;

        // Bilinear interpolation across quad with integer pixel centering
        const x = Math.round((1 - u) * (1 - v) * p1.x + u * (1 - v) * p2.x + u * v * p3.x + (1 - u) * v * p4.x);
        const y = Math.round((1 - u) * (1 - v) * p1.y + u * (1 - v) * p2.y + u * v * p3.y + (1 - u) * v * p4.y);

        const trackEngine = new TrackerEngine();
        const tPoint = trackEngine.addTrack(`grid_${id++}`, x, y);
        tPoint.patternWidth = 21;
        tPoint.patternHeight = 21;
        tPoint.searchWidth = 51;
        tPoint.searchHeight = 51;
        trackEngine.grabReferencePattern(tPoint, refBuffer, rf);

        this.featureTracks.push({
          u,
          v,
          refX: x,
          refY: y,
          trackPoint: tPoint,
          engine: trackEngine
        });
      }
    }
  }

  /**
   * Track planar region from prevFrame to targetFrame
   * @param {import('./PixelBuffer.js').PixelBuffer} currBuffer
   * @param {number} prevFrame
   * @param {number} targetFrame
   * @returns {{homography: number[], confidence: number, trackLost: boolean}}
   */
  trackStep(currBuffer, prevFrame, targetFrame) {
    if (this.featureTracks.length === 0) {
      this.initPlanarFeatures(currBuffer, prevFrame);
    }

    const trackedSrc = [];
    const trackedDst = [];
    let validCount = 0;
    let sumCorrelation = 0;

    // 1. Track each internal feature point
    for (const feat of this.featureTracks) {
      const res = feat.engine.trackFeature(feat.trackPoint, currBuffer, prevFrame, targetFrame);
      if (res && !res.trackLost && res.correlation > 0.5) {
        trackedSrc.push({ x: feat.refX, y: feat.refY });
        trackedDst.push({ x: res.x, y: res.y });
        validCount++;
        sumCorrelation += res.correlation;
      }
    }

    const totalFeatures = this.featureTracks.length;
    if (validCount < 4 || (validCount / totalFeatures) < this.minInlierRatio) {
      // Track lost
      this.confidenceMap.set(Math.round(targetFrame), 0.0);
      this.trackLostMap.set(Math.round(targetFrame), true);
      const prevCorners = this.getCornersAtFrame(prevFrame);
      this.setCorners(prevCorners[0], prevCorners[1], prevCorners[2], prevCorners[3], targetFrame);
      return { homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], confidence: 0.0, trackLost: true };
    }

    // 2. Solve Homography via robust RANSAC / Outlier Rejection
    const H = PlanarTrackerEngine.solveRobustHomography(trackedSrc, trackedDst, this.outlierThresholdPx);
    if (!H) {
      this.confidenceMap.set(Math.round(targetFrame), 0.0);
      this.trackLostMap.set(Math.round(targetFrame), true);
      const prevCorners = this.getCornersAtFrame(prevFrame);
      this.setCorners(prevCorners[0], prevCorners[1], prevCorners[2], prevCorners[3], targetFrame);
      return { homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], confidence: 0.0, trackLost: true };
    }

    // 3. Project 4 corners from reference frame through H
    const refCorners = this.getCornersAtFrame(this.referenceFrame);
    const newCorners = [];

    for (let i = 0; i < 4; i++) {
      const rc = refCorners[i];
      const Z = H[6] * rc.x + H[7] * rc.y + H[8];
      if (Math.abs(Z) < 1e-6) {
        newCorners.push({ x: rc.x, y: rc.y });
      } else {
        newCorners.push({
          x: (H[0] * rc.x + H[1] * rc.y + H[2]) / Z,
          y: (H[3] * rc.x + H[4] * rc.y + H[5]) / Z
        });
      }
    }

    this.setCorners(newCorners[0], newCorners[1], newCorners[2], newCorners[3], targetFrame);
    const confidence = (sumCorrelation / validCount) * (validCount / totalFeatures);
    this.confidenceMap.set(Math.round(targetFrame), confidence);
    this.trackLostMap.set(Math.round(targetFrame), false);

    return { homography: H, confidence, trackLost: false };
  }

  /**
   * Robust Homography with RANSAC Outlier Rejection
   */
  static solveRobustHomography(srcPts, dstPts, thresholdPx = 3.5, maxIterations = 35) {
    const N = Math.min(srcPts.length, dstPts.length);
    if (N < 4) return null;

    // If exactly 4 points, solve DLT directly
    if (N === 4) {
      return PlanarTrackerEngine.solveHomographyDLT(srcPts, dstPts);
    }

    let bestInliers = [];
    let bestH = null;

    // Deterministic pseudo-random sequence for reproducible RANSAC
    let seed = 42;
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let iter = 0; iter < maxIterations; iter++) {
      // Pick 4 distinct indices
      const sampleIndices = [];
      while (sampleIndices.length < 4) {
        const idx = Math.floor(pseudoRandom() * N);
        if (!sampleIndices.includes(idx)) sampleIndices.push(idx);
      }

      const sampleSrc = sampleIndices.map(i => srcPts[i]);
      const sampleDst = sampleIndices.map(i => dstPts[i]);

      const H_cand = PlanarTrackerEngine.solveHomographyDLT(sampleSrc, sampleDst);
      if (!H_cand) continue;

      // Count inliers
      const inliers = [];
      for (let i = 0; i < N; i++) {
        const sp = srcPts[i];
        const dp = dstPts[i];
        const Z = H_cand[6] * sp.x + H_cand[7] * sp.y + H_cand[8];
        if (Math.abs(Z) > 1e-6) {
          const px = (H_cand[0] * sp.x + H_cand[1] * sp.y + H_cand[2]) / Z;
          const py = (H_cand[3] * sp.x + H_cand[4] * sp.y + H_cand[5]) / Z;
          const err = Math.hypot(px - dp.x, py - dp.y);
          if (err <= thresholdPx) {
            inliers.push(i);
          }
        }
      }

      if (inliers.length > bestInliers.length) {
        bestInliers = inliers;
        bestH = H_cand;
        // Early exit if >= 90% inliers found
        if (inliers.length >= N * 0.9) break;
      }
    }

    if (bestInliers.length >= 4) {
      // Re-estimate final homography using all identified inliers
      const inlierSrc = bestInliers.map(i => srcPts[i]);
      const inlierDst = bestInliers.map(i => dstPts[i]);
      return PlanarTrackerEngine.solveHomographyDLT(inlierSrc, inlierDst) || bestH;
    }

    return bestH;
  }

  /**
   * Direct Linear Transformation (DLT) with Normal Equations Least-Squares for N >= 4 points
   */
  static solveHomographyDLT(srcPts, dstPts) {
    const N = Math.min(srcPts.length, dstPts.length);
    if (N < 4) return null;

    // BtB is 8x8 symmetric matrix, Btb is 8x1 vector
    const BtB = Array.from({ length: 8 }, () => new Float64Array(8));
    const Btb = new Float64Array(8);

    for (let i = 0; i < N; i++) {
      const sx = srcPts[i].x, sy = srcPts[i].y;
      const dx = dstPts[i].x, dy = dstPts[i].y;

      // Row 1: [-sx, -sy, -1, 0, 0, 0, sx * dx, sy * dx], rhs = -dx
      const r1 = [-sx, -sy, -1, 0, 0, 0, sx * dx, sy * dx];
      const b1 = -dx;

      // Row 2: [0, 0, 0, -sx, -sy, -1, sx * dy, sy * dy], rhs = -dy
      const r2 = [0, 0, 0, -sx, -sy, -1, sx * dy, sy * dy];
      const b2 = -dy;

      // Accumulate normal equations: BtB += r * r^T, Btb += r * b
      for (let j = 0; j < 8; j++) {
        Btb[j] += r1[j] * b1 + r2[j] * b2;
        for (let k = 0; k < 8; k++) {
          BtB[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
        }
      }
    }

    // Solve 8x8 linear system: BtB * h = Btb via Gaussian elimination with partial pivoting
    for (let i = 0; i < 8; i++) {
      let maxRow = i;
      for (let j = i + 1; j < 8; j++) {
        if (Math.abs(BtB[j][i]) > Math.abs(BtB[maxRow][i])) maxRow = j;
      }

      const tempRow = BtB[i];
      BtB[i] = BtB[maxRow];
      BtB[maxRow] = tempRow;
      const tempB = Btb[i];
      Btb[i] = Btb[maxRow];
      Btb[maxRow] = tempB;

      const pivot = BtB[i][i];
      if (Math.abs(pivot) < 1e-12) return null;

      for (let k = i; k < 8; k++) BtB[i][k] /= pivot;
      Btb[i] /= pivot;

      for (let j = 0; j < 8; j++) {
        if (j !== i) {
          const factor = BtB[j][i];
          for (let k = i; k < 8; k++) {
            BtB[j][k] -= factor * BtB[i][k];
          }
          Btb[j] -= factor * Btb[i];
        }
      }
    }

    const H = [
      Btb[0], Btb[1], Btb[2],
      Btb[3], Btb[4], Btb[5],
      Btb[6], Btb[7], 1.0
    ];

    if (!isFinite(H[0]) || !isFinite(H[4])) return null;
    return H;
  }

  serialize() {
    return {
      referenceFrame: this.referenceFrame,
      gridRows: this.gridRows,
      gridCols: this.gridCols,
      corners: this.corners.map(c => c.serialize())
    };
  }

  static deserialize(data) {
    const engine = new PlanarTrackerEngine();
    if (!data) return engine;
    engine.referenceFrame = data.referenceFrame || 1;
    engine.gridRows = data.gridRows || 4;
    engine.gridCols = data.gridCols || 4;
    if (Array.isArray(data.corners)) {
      engine.corners = data.corners.map(cData => PlanarCorner.deserialize(cData));
    }
    return engine;
  }
}
