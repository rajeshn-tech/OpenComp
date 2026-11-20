/**
 * OpenComp - Core Dynamic Bounding Box (BBox) Architecture
 * Implements standard 2D data-window bounding boxes [x, y, r, t]
 * supporting sub-canvas crops, oversized elements, negative coordinates, 
 * blur expansion, affine transformations, and zero-overhead empty checks.
 */

export class BBox {
  /**
   * @param {number} x Minimum X (left edge)
   * @param {number} y Minimum Y (top edge)
   * @param {number} r Maximum X (right edge, exclusive)
   * @param {number} t Maximum Y (bottom edge, exclusive)
   */
  constructor(x = 0, y = 0, r = 0, t = 0) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this.r = Number(r) || 0;
    this.t = Number(t) || 0;
  }

  /**
   * Bounding box width (r - x)
   * @returns {number}
   */
  get width() {
    return Math.max(0, this.r - this.x);
  }

  /**
   * Bounding box height (t - y)
   * @returns {number}
   */
  get height() {
    return Math.max(0, this.t - this.y);
  }

  /**
   * Check if the bounding box has zero or negative area
   * @returns {boolean}
   */
  isEmpty() {
    return this.r <= this.x || this.t <= this.y;
  }

  /**
   * Deep clone
   * @returns {BBox}
   */
  clone() {
    return new BBox(this.x, this.y, this.r, this.t);
  }

  /**
   * Check equality within numerical tolerance
   * @param {BBox} other 
   * @param {number} [epsilon=1e-5] 
   * @returns {boolean}
   */
  equals(other, epsilon = 1e-5) {
    if (!other) return false;
    return Math.abs(this.x - other.x) <= epsilon &&
           Math.abs(this.y - other.y) <= epsilon &&
           Math.abs(this.r - other.r) <= epsilon &&
           Math.abs(this.t - other.t) <= epsilon;
  }

  /**
   * Union with another bounding box. Returns a new enclosing BBox.
   * If either box is empty, returns the non-empty box.
   * @param {BBox} other 
   * @returns {BBox}
   */
  union(other) {
    if (!other || other.isEmpty()) return this.clone();
    if (this.isEmpty()) return other.clone();
    return new BBox(
      Math.min(this.x, other.x),
      Math.min(this.y, other.y),
      Math.max(this.r, other.r),
      Math.max(this.t, other.t)
    );
  }

  /**
   * Intersect with another bounding box. Returns a new BBox representing overlap.
   * If there is no overlap, returns an empty BBox (0, 0, 0, 0).
   * @param {BBox} other 
   * @returns {BBox}
   */
  intersect(other) {
    if (!other || this.isEmpty() || other.isEmpty()) {
      return new BBox(0, 0, 0, 0);
    }
    const nx = Math.max(this.x, other.x);
    const ny = Math.max(this.y, other.y);
    const nr = Math.min(this.r, other.r);
    const nt = Math.min(this.t, other.t);

    if (nr <= nx || nt <= ny) {
      return new BBox(0, 0, 0, 0);
    }
    return new BBox(nx, ny, nr, nt);
  }

  /**
   * Check if this BBox intersects with another BBox
   * @param {BBox} other 
   * @returns {boolean}
   */
  intersects(other) {
    if (!other || this.isEmpty() || other.isEmpty()) return false;
    return this.x < other.r && this.r > other.x &&
           this.y < other.t && this.t > other.y;
  }

  /**
   * Expand bounds symmetrically by dx, dy
   * @param {number} dx 
   * @param {number} [dy=dx] 
   * @returns {BBox} Returns this for chaining
   */
  expand(dx, dy = dx) {
    this.x -= dx;
    this.y -= dy;
    this.r += dx;
    this.t += dy;
    return this;
  }

  /**
   * Return a new expanded BBox without mutating this
   * @param {number} dx 
   * @param {number} [dy=dx] 
   * @returns {BBox}
   */
  expanded(dx, dy = dx) {
    return this.clone().expand(dx, dy);
  }

  /**
   * Translate/offset BBox by dx, dy
   * @param {number} dx 
   * @param {number} dy 
   * @returns {BBox} Returns this for chaining
   */
  translate(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.r += dx;
    this.t += dy;
    return this;
  }

  /**
   * Return a new translated BBox
   * @param {number} dx 
   * @param {number} dy 
   * @returns {BBox}
   */
  translated(dx, dy) {
    return this.clone().translate(dx, dy);
  }

  /**
   * Clamp to canvas format boundary (e.g. 0, 0, width, height)
   * @param {number|{width: number, height: number}} widthOrFormat 
   * @param {number} [height] 
   * @returns {BBox}
   */
  clampToFormat(widthOrFormat, height) {
    const fw = typeof widthOrFormat === 'object' ? widthOrFormat.width : widthOrFormat;
    const fh = typeof widthOrFormat === 'object' ? widthOrFormat.height : height;
    const formatBox = new BBox(0, 0, fw, fh);
    return this.intersect(formatBox);
  }

  /**
   * Test if point (px, py) is strictly inside this BBox
   * @param {number} px 
   * @param {number} py 
   * @returns {boolean}
   */
  containsPoint(px, py) {
    return px >= this.x && px < this.r && py >= this.y && py < this.t;
  }

  /**
   * Factory: construct BBox from rectangle (x, y, width, height)
   * @param {number} x 
   * @param {number} y 
   * @param {number} w 
   * @param {number} h 
   * @returns {BBox}
   */
  static fromRect(x, y, w, h) {
    return new BBox(x, y, x + w, y + h);
  }

  /**
   * Factory: construct BBox from canvas format dimensions (0, 0, w, h)
   * @param {number} width 
   * @param {number} height 
   * @returns {BBox}
   */
  static fromFormat(width, height) {
    return new BBox(0, 0, width, height);
  }

  /**
   * Factory: calculate enclosing BBox from arbitrary 2D polygon vertices
   * @param {Array<[number, number]>|Array<{x: number, y: number}>} points 
   * @returns {BBox}
   */
  static fromPoints(points) {
    if (!points || points.length === 0) return new BBox(0, 0, 0, 0);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of points) {
      const px = Array.isArray(pt) ? pt[0] : pt.x;
      const py = Array.isArray(pt) ? pt[1] : pt.y;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }

    if (minX === Infinity) return new BBox(0, 0, 0, 0);
    return new BBox(minX, minY, maxX, maxY);
  }

  toJSON() {
    return { x: this.x, y: this.y, r: this.r, t: this.t };
  }

  toString() {
    return `[BBox x:${this.x.toFixed(1)} y:${this.y.toFixed(1)} r:${this.r.toFixed(1)} t:${this.t.toFixed(1)} (${this.width.toFixed(1)}x${this.height.toFixed(1)})]`;
  }
}

