/**
 * OpenComp - Professional Roto Spline & Rasterization Engine
 * Provides manual rotoscoping tools: Bezier splines, B-splines, control points,
 * tangents, edge feathering, subpixel anti-aliased scanline rasterization, and multi-layer boolean blending.
 */

import { KeyframeTrack } from './Animation.js';

export class RotoControlPoint {
  constructor(x = 0, y = 0) {
    this.id = 'pt_' + Math.random().toString(36).substr(2, 9);
    // Position track: stores [x, y]
    this.posTrack = new KeyframeTrack([x, y]);
    // In-tangent track: [tx, ty] relative to point
    this.inTangentTrack = new KeyframeTrack([0, 0]);
    // Out-tangent track: [tx, ty] relative to point
    this.outTangentTrack = new KeyframeTrack([0, 0]);
    // Feather distance track (scalar)
    this.featherTrack = new KeyframeTrack(0.0);

    this.isSmooth = true;
  }

  setKey(frame, x, y, inTx = 0, inTy = 0, outTx = 0, outTy = 0, feather = 0.0) {
    this.posTrack.addKey(frame, [x, y]);
    this.inTangentTrack.addKey(frame, [inTx, inTy]);
    this.outTangentTrack.addKey(frame, [outTx, outTy]);
    this.featherTrack.addKey(frame, feather);
  }

  getAtFrame(frame) {
    const pos = this.posTrack.evaluate(frame);
    const inT = this.inTangentTrack.evaluate(frame);
    const outT = this.outTangentTrack.evaluate(frame);
    const feather = this.featherTrack.evaluate(frame);
    return {
      x: pos[0],
      y: pos[1],
      inTx: inT[0],
      inTy: inT[1],
      outTx: outT[0],
      outTy: outT[1],
      feather: Number(feather) || 0.0,
      isSmooth: this.isSmooth
    };
  }

  serialize() {
    return {
      id: this.id,
      isSmooth: this.isSmooth,
      posTrack: this.posTrack.serialize(),
      inTangentTrack: this.inTangentTrack.serialize(),
      outTangentTrack: this.outTangentTrack.serialize(),
      featherTrack: this.featherTrack.serialize()
    };
  }

  static deserialize(data) {
    const pt = new RotoControlPoint();
    pt.id = data.id || pt.id;
    pt.isSmooth = data.isSmooth !== undefined ? data.isSmooth : true;
    if (data.posTrack) pt.posTrack = KeyframeTrack.deserialize(data.posTrack);
    if (data.inTangentTrack) pt.inTangentTrack = KeyframeTrack.deserialize(data.inTangentTrack);
    if (data.outTangentTrack) pt.outTangentTrack = KeyframeTrack.deserialize(data.outTangentTrack);
    if (data.featherTrack) pt.featherTrack = KeyframeTrack.deserialize(data.featherTrack);
    return pt;
  }
}

export class RotoShape {
  constructor(name = 'Bezier_1', type = 'bezier') {
    this.id = 'shape_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.type = type; // 'bezier', 'bspline', 'polygon', 'ellipse', 'rectangle'
    /** @type {RotoControlPoint[]} */
    this.points = [];
    this.closed = true;
    this.inverted = false;
    this.feather = 0.0; // Global feather in pixels
    this.opacity = 1.0;
    this.blendMode = 'add'; // 'add', 'subtract', 'intersect', 'replace'
    this.visible = true;
    this.locked = false;
    this.color = '#ff6b4a'; // Vibrant Nuke-style orange/red default outline
  }

  addPoint(x, y, inTx = 0, inTy = 0, outTx = 0, outTy = 0, frame = 1) {
    const pt = new RotoControlPoint(x, y);
    pt.setKey(frame, x, y, inTx, inTy, outTx, outTy, 0.0);
    this.points.push(pt);
    return pt;
  }

  insertPoint(index, x, y, frame = 1) {
    const pt = new RotoControlPoint(x, y);
    pt.setKey(frame, x, y, 0, 0, 0, 0, 0.0);
    this.points.splice(index, 0, pt);
    return pt;
  }

  removePoint(index) {
    if (index >= 0 && index < this.points.length) {
      this.points.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Sample 2D curve points along the spline boundary for a given frame
   */
  sampleCurve(frame, samplesPerSegment = 16) {
    if (this.points.length < 2) return [];

    const evaluatedPoints = this.points.map(p => p.getAtFrame(frame));
    const densePoly = [];

    const numSpans = this.closed ? evaluatedPoints.length : evaluatedPoints.length - 1;

    for (let i = 0; i < numSpans; i++) {
      const p0 = evaluatedPoints[i];
      const p1 = evaluatedPoints[(i + 1) % evaluatedPoints.length];

      if (this.type === 'polygon') {
        densePoly.push({ x: p0.x, y: p0.y, feather: p0.feather });
        continue;
      }

      // Cubic Bezier interpolation:
      // Control points: p0, p0 + outTangent, p1 + inTangent, p1
      const cp1x = p0.x + p0.outTx;
      const cp1y = p0.y + p0.outTy;
      const cp2x = p1.x + p1.inTx;
      const cp2y = p1.y + p1.inTy;

      for (let s = 0; s < samplesPerSegment; s++) {
        const u = s / samplesPerSegment;
        const u2 = u * u;
        const u3 = u2 * u;
        const oneMinusU = 1.0 - u;
        const oneMinusU2 = oneMinusU * oneMinusU;
        const oneMinusU3 = oneMinusU2 * oneMinusU;

        const bx = oneMinusU3 * p0.x + 3 * oneMinusU2 * u * cp1x + 3 * oneMinusU * u2 * cp2x + u3 * p1.x;
        const by = oneMinusU3 * p0.y + 3 * oneMinusU2 * u * cp1y + 3 * oneMinusU * u2 * cp2y + u3 * p1.y;
        const bf = (1.0 - u) * p0.feather + u * p1.feather;

        densePoly.push({ x: bx, y: by, feather: bf });
      }
    }

    if (!this.closed && evaluatedPoints.length > 0) {
      const last = evaluatedPoints[evaluatedPoints.length - 1];
      densePoly.push({ x: last.x, y: last.y, feather: last.feather });
    }

    return densePoly;
  }

  /**
   * Fast scanline polygon rasterizer with edge distance feathering
   */
  rasterize(alphaBuffer, width, height, frame) {
    if (!this.visible || this.points.length < 3) return;

    const poly = this.sampleCurve(frame, 12);
    if (poly.length < 3) return;

    // Find bounding box to avoid looping over the entire 4K canvas
    let minX = width - 1, maxX = 0;
    let minY = height - 1, maxY = 0;

    const totalFeather = Math.max(0, this.feather);

    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const startX = Math.max(0, Math.floor(minX - totalFeather - 2));
    const endX = Math.min(width - 1, Math.ceil(maxX + totalFeather + 2));
    const startY = Math.max(0, Math.floor(minY - totalFeather - 2));
    const endY = Math.min(height - 1, Math.ceil(maxY + totalFeather + 2));

    const nPoints = poly.length;

    // Point in polygon and distance-to-edge calculation
    for (let y = startY; y <= endY; y++) {
      const rowOffset = y * width;
      const py = y + 0.5;

      for (let x = startX; x <= endX; x++) {
        const px = x + 0.5;

        // Even-Odd Winding Rule
        let inside = false;
        let minDistSq = 1e9;

        for (let i = 0, j = nPoints - 1; i < nPoints; j = i++) {
          const xi = poly[i].x, yi = poly[i].y;
          const xj = poly[j].x, yj = poly[j].y;

          // Ray-casting for inside check
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }

          // Distance to line segment (j -> i)
          const l2 = (xi - xj) * (xi - xj) + (yi - yj) * (yi - yj);
          if (l2 > 0.0001) {
            let t = ((px - xj) * (xi - xj) + (py - yj) * (yi - yj)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = xj + t * (xi - xj);
            const projY = yj + t * (yi - yj);
            const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
            if (distSq < minDistSq) minDistSq = distSq;
          }
        }

        const dist = Math.sqrt(minDistSq);

        let shapeAlpha = 0.0;
        if (totalFeather <= 0.5) {
          // Hard edge with 1-pixel subpixel anti-aliasing
          if (inside) {
            shapeAlpha = (dist < 0.5) ? (0.5 + dist) : 1.0;
          } else {
            shapeAlpha = (dist < 0.5) ? (0.5 - dist) : 0.0;
          }
        } else {
          // Feathered falloff
          if (inside) {
            shapeAlpha = 1.0;
            // Inner feather
            const t = dist / totalFeather;
            if (t < 1.0) {
              shapeAlpha = 0.5 + 0.5 * (1.0 - Math.pow(1.0 - t, 2.0));
            }
          } else {
            // Outer feather
            if (dist <= totalFeather) {
              const t = 1.0 - (dist / totalFeather);
              shapeAlpha = 0.5 * (t * t * (3.0 - 2.0 * t)); // Smoothstep
            } else {
              shapeAlpha = 0.0;
            }
          }
        }

        shapeAlpha = Math.max(0.0, Math.min(1.0, shapeAlpha));
        if (this.inverted) shapeAlpha = 1.0 - shapeAlpha;
        shapeAlpha *= this.opacity;

        const idx = rowOffset + x;
        const curAlpha = alphaBuffer[idx];

        // Multi-Shape Blend Modes
        if (this.blendMode === 'add') {
          alphaBuffer[idx] = Math.min(1.0, curAlpha + shapeAlpha);
        } else if (this.blendMode === 'subtract') {
          alphaBuffer[idx] = Math.max(0.0, curAlpha - shapeAlpha);
        } else if (this.blendMode === 'intersect') {
          alphaBuffer[idx] = curAlpha * shapeAlpha;
        } else { // 'replace'
          alphaBuffer[idx] = shapeAlpha;
        }
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      closed: this.closed,
      inverted: this.inverted,
      feather: this.feather,
      opacity: this.opacity,
      blendMode: this.blendMode,
      visible: this.visible,
      locked: this.locked,
      color: this.color,
      points: this.points.map(p => p.serialize())
    };
  }

  static deserialize(data) {
    const shape = new RotoShape(data.name, data.type);
    shape.id = data.id || shape.id;
    shape.closed = data.closed !== undefined ? data.closed : true;
    shape.inverted = !!data.inverted;
    shape.feather = Number(data.feather) || 0.0;
    shape.opacity = Number(data.opacity) !== undefined ? data.opacity : 1.0;
    shape.blendMode = data.blendMode || 'add';
    shape.visible = data.visible !== undefined ? data.visible : true;
    shape.locked = !!data.locked;
    shape.color = data.color || '#ff6b4a';
    if (data.points && Array.isArray(data.points)) {
      shape.points = data.points.map(pd => RotoControlPoint.deserialize(pd));
    }
    return shape;
  }
}

