/**
 * OpenComp - Department 2: Paint & Cleanup Core Engine
 * Implements non-destructive vector stroke storage, circular soft-brush stamping,
 * spatial & temporal clone stamping, clean-plate reveal, blur, and eraser.
 */

export class PaintPoint {
  constructor(x, y, pressure = 1.0) {
    this.x = x;
    this.y = y;
    this.pressure = pressure;
  }
}

export class PaintStroke {
  constructor(typeOrOpts = 'brush', size = 25.0, hardness = 0.5, opacity = 1.0, flow = 1.0, color = [1.0, 1.0, 1.0, 1.0]) {
    this.id = 'stroke_' + Math.random().toString(36).substr(2, 9);
    if (typeof typeOrOpts === 'object' && typeOrOpts !== null) {
      this.type = typeOrOpts.type || 'brush';
      this.size = typeOrOpts.size !== undefined ? typeOrOpts.size : 25.0;
      this.hardness = typeOrOpts.hardness !== undefined ? typeOrOpts.hardness : 0.5;
      this.opacity = typeOrOpts.opacity !== undefined ? typeOrOpts.opacity : 1.0;
      this.flow = typeOrOpts.flow !== undefined ? typeOrOpts.flow : 1.0;
      this.color = typeOrOpts.color ? [...typeOrOpts.color] : [1.0, 1.0, 1.0, 1.0];
    } else {
      this.type = typeOrOpts || 'brush';
      this.size = Number(size) || 25.0;
      this.hardness = Number(hardness) !== undefined ? hardness : 0.5;
      this.opacity = Number(opacity) !== undefined ? opacity : 1.0;
      this.flow = Number(flow) !== undefined ? flow : 1.0;
      this.color = color ? [...color] : [1.0, 1.0, 1.0, 1.0];
    }
    this.spacing = 0.15; // Fraction of brush radius

    // Clone & Temporal parameters
    this.cloneOffset = { dx: 0, dy: 0 };
    this.sourceFrame = 1; // For temporal paint / clean plate sampling

    // Frame lifetime
    this.frame = 1;
    this.lifetime = 'single'; // 'single', 'all', 'range'
    this.startFrame = 1;
    this.endFrame = 100;

    /** @type {PaintPoint[]} */
    this.points = [];
    this.visible = true;
  }

  addPoint(x, y, pressure = 1.0) {
    this.points.push(new PaintPoint(x, y, pressure));
  }

  isValidAtFrame(frame) {
    if (!this.visible) return false;
    if (this.lifetime === 'all') return true;
    if (this.lifetime === 'single') return Math.round(frame) === Math.round(this.frame);
    if (this.lifetime === 'range') return frame >= this.startFrame && frame <= this.endFrame;
    return true;
  }

  /**
   * Render this stroke into the target PixelBuffer
   */
  render(targetBuffer, originalBaseBuffer, cleanPlateBuffer) {
    if (this.points.length === 0) return;

    const w = targetBuffer.width;
    const h = targetBuffer.height;
    const isTiled = !!targetBuffer.isTiled;
    const dst = isTiled ? null : targetBuffer.data;
    const base = (originalBaseBuffer && !originalBaseBuffer.isTiled) ? originalBaseBuffer.data : null;
    const clean = (cleanPlateBuffer && !cleanPlateBuffer.isTiled) ? cleanPlateBuffer.data : null;

    const radius = Math.max(1, this.size * 0.5);
    const radiusSq = radius * radius;
    const hardness = Math.max(0.0, Math.min(1.0, this.hardness));
    const innerRadius = radius * hardness;
    const featherSpan = Math.max(0.001, radius - innerRadius);

    const stepDist = Math.max(1.0, radius * this.spacing);

    // Interpolate points along the path
    const stampCenters = [];
    if (this.points.length === 1) {
      stampCenters.push(this.points[0]);
    } else {
      for (let i = 0; i < this.points.length - 1; i++) {
        const p0 = this.points[i];
        const p1 = this.points[i + 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(dist / stepDist));

        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          stampCenters.push({
            x: p0.x + t * dx,
            y: p0.y + t * dy,
            pressure: p0.pressure + t * (p1.pressure - p0.pressure)
          });
        }
      }
      stampCenters.push(this.points[this.points.length - 1]);
    }

    // Paint each stamp
    for (const pt of stampCenters) {
      const stampRadius = radius * (pt.pressure || 1.0);
      const stampRadiusSq = stampRadius * stampRadius;
      const stampInnerRadius = stampRadius * hardness;
      const stampFeather = Math.max(0.001, stampRadius - stampInnerRadius);

      const minX = Math.max(0, Math.floor(pt.x - stampRadius));
      const maxX = Math.min(w - 1, Math.ceil(pt.x + stampRadius));
      const minY = Math.max(0, Math.floor(pt.y - stampRadius));
      const maxY = Math.min(h - 1, Math.ceil(pt.y + stampRadius));

      for (let py = minY; py <= maxY; py++) {
        const dy = py - pt.y;
        const rowOffset = py * w;

        for (let px = minX; px <= maxX; px++) {
          const dx = px - pt.x;
          const d2 = dx * dx + dy * dy;

          if (d2 <= stampRadiusSq) {
            const d = Math.sqrt(d2);
            let stampAlpha = 1.0;
            if (d > stampInnerRadius) {
              const u = (d - stampInnerRadius) / stampFeather;
              stampAlpha = 1.0 - (u * u * (3.0 - 2.0 * u)); // Smooth Hermite falloff
            }

            const alpha = stampAlpha * this.opacity * this.flow * (pt.pressure || 1.0);
            if (alpha <= 0.001) continue;

            const idx = (rowOffset + px) * 4;

            let curR, curG, curB, curA;
            if (isTiled) {
              const p = targetBuffer.getPixel(px, py);
              curR = p[0]; curG = p[1]; curB = p[2]; curA = p[3];
            } else {
              curR = dst[idx]; curG = dst[idx + 1]; curB = dst[idx + 2]; curA = dst[idx + 3];
            }

            let outR = curR, outG = curG, outB = curB, outA = curA;

            // 1. Solid Color Brush
            if (this.type === 'brush') {
              outR = curR * (1.0 - alpha) + this.color[0] * alpha;
              outG = curG * (1.0 - alpha) + this.color[1] * alpha;
              outB = curB * (1.0 - alpha) + this.color[2] * alpha;
              outA = Math.max(curA, alpha);
            }
            // 2. Clone Stamp (Spatial / Temporal)
            else if (this.type === 'clone') {
              const srcX = Math.round(px - this.cloneOffset.dx);
              const srcY = Math.round(py - this.cloneOffset.dy);

              if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
                let sR, sG, sB, sA;
                if (originalBaseBuffer) {
                  if (originalBaseBuffer.isTiled) {
                    const sp = originalBaseBuffer.getPixel(srcX, srcY);
                    sR = sp[0]; sG = sp[1]; sB = sp[2]; sA = sp[3];
                  } else {
                    const srcIdx = (srcY * w + srcX) * 4;
                    sR = base[srcIdx]; sG = base[srcIdx + 1]; sB = base[srcIdx + 2]; sA = base[srcIdx + 3];
                  }
                } else if (isTiled) {
                  const sp = targetBuffer.getPixel(srcX, srcY);
                  sR = sp[0]; sG = sp[1]; sB = sp[2]; sA = sp[3];
                } else {
                  const srcIdx = (srcY * w + srcX) * 4;
                  sR = dst[srcIdx]; sG = dst[srcIdx + 1]; sB = dst[srcIdx + 2]; sA = dst[srcIdx + 3];
                }

                outR = curR * (1.0 - alpha) + sR * alpha;
                outG = curG * (1.0 - alpha) + sG * alpha;
                outB = curB * (1.0 - alpha) + sB * alpha;
                outA = curA * (1.0 - alpha) + sA * alpha;
              }
            }
            // 3. Reveal Brush (Reveals Clean Plate)
            else if (this.type === 'reveal' && cleanPlateBuffer) {
              let cR, cG, cB, cA;
              if (cleanPlateBuffer.isTiled) {
                const cp = cleanPlateBuffer.getPixel(px, py);
                cR = cp[0]; cG = cp[1]; cB = cp[2]; cA = cp[3];
              } else {
                cR = clean[idx]; cG = clean[idx + 1]; cB = clean[idx + 2]; cA = clean[idx + 3];
              }
              outR = curR * (1.0 - alpha) + cR * alpha;
              outG = curG * (1.0 - alpha) + cG * alpha;
              outB = curB * (1.0 - alpha) + cB * alpha;
              outA = curA * (1.0 - alpha) + cA * alpha;
            }
            // 4. Eraser (Restores Original Base Plate)
            else if (this.type === 'eraser' && originalBaseBuffer) {
              let bR, bG, bB, bA;
              if (originalBaseBuffer.isTiled) {
                const bp = originalBaseBuffer.getPixel(px, py);
                bR = bp[0]; bG = bp[1]; bB = bp[2]; bA = bp[3];
              } else {
                bR = base[idx]; bG = base[idx + 1]; bB = base[idx + 2]; bA = base[idx + 3];
              }
              outR = curR * (1.0 - alpha) + bR * alpha;
              outG = curG * (1.0 - alpha) + bG * alpha;
              outB = curB * (1.0 - alpha) + bB * alpha;
              outA = curA * (1.0 - alpha) + bA * alpha;
            }
            // 5. Blur Brush (Local Softening)
            else if (this.type === 'blur') {
              let r = 0, g = 0, b = 0, count = 0;
              for (let oy = -1; oy <= 1; oy++) {
                const ny = Math.max(0, Math.min(h - 1, py + oy));
                for (let ox = -1; ox <= 1; ox++) {
                  const nx = Math.max(0, Math.min(w - 1, px + ox));
                  if (isTiled) {
                    const np = targetBuffer.getPixel(nx, ny);
                    r += np[0]; g += np[1]; b += np[2];
                  } else {
                    const nidx = (ny * w + nx) * 4;
                    r += dst[nidx]; g += dst[nidx + 1]; b += dst[nidx + 2];
                  }
                  count++;
                }
              }
              const avgR = r / count;
              const avgG = g / count;
              const avgB = b / count;
              outR = curR * (1.0 - alpha) + avgR * alpha;
              outG = curG * (1.0 - alpha) + avgG * alpha;
              outB = curB * (1.0 - alpha) + avgB * alpha;
            }

            if (isTiled) {
              targetBuffer.setPixel(px, py, outR, outG, outB, outA);
            } else {
              dst[idx] = outR;
              dst[idx + 1] = outG;
              dst[idx + 2] = outB;
              dst[idx + 3] = outA;
            }
          }
        }
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      color: [...this.color],
      size: this.size,
      hardness: this.hardness,
      opacity: this.opacity,
      flow: this.flow,
      spacing: this.spacing,
      cloneOffset: { ...this.cloneOffset },
      sourceFrame: this.sourceFrame,
      frame: this.frame,
      lifetime: this.lifetime,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      visible: this.visible,
      points: this.points.map(p => ({ x: p.x, y: p.y, pressure: p.pressure }))
    };
  }

  static deserialize(data) {
    const stroke = new PaintStroke(data.type);
    stroke.id = data.id || stroke.id;
    if (data.color) stroke.color = [...data.color];
    stroke.size = Number(data.size) || 25.0;
    stroke.hardness = Number(data.hardness) !== undefined ? data.hardness : 0.5;
    stroke.opacity = Number(data.opacity) !== undefined ? data.opacity : 1.0;
    stroke.flow = Number(data.flow) !== undefined ? data.flow : 1.0;
    stroke.spacing = Number(data.spacing) || 0.15;
    if (data.cloneOffset) stroke.cloneOffset = { ...data.cloneOffset };
    stroke.sourceFrame = Number(data.sourceFrame) || 1;
    stroke.frame = Number(data.frame) || 1;
    stroke.lifetime = data.lifetime || 'single';
    stroke.startFrame = Number(data.startFrame) || 1;
    stroke.endFrame = Number(data.endFrame) || 100;
    stroke.visible = data.visible !== undefined ? data.visible : true;
    if (data.points && Array.isArray(data.points)) {
      stroke.points = data.points.map(p => new PaintPoint(p.x, p.y, p.pressure));
    }
    return stroke;
  }
}

