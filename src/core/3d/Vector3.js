/**
 * OpenComp - 3D Vector Math Library
 * Standard 3-component Euclidean vector for 3D compositing, normals, vertices, and rays.
 */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this.z = Number(z) || 0;
  }

  set(x, y, z) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this.z = Number(z) || 0;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    const x = this.x, y = this.y, z = this.z;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const len = this.length();
    if (len > 1e-12) {
      const inv = 1.0 / len;
      this.x *= inv;
      this.y *= inv;
      this.z *= inv;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }
    return this;
  }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Transforms vector as 3D point [x, y, z, 1]^T by 4x4 matrix and performs perspective divide
   * @param {import('./Matrix4.js').Matrix4} m
   */
  transformMat4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const invW = Math.abs(w) > 1e-12 ? 1.0 / w : 1.0;

    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * invW;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * invW;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * invW;
    return this;
  }

  /**
   * Transforms vector as 3D direction [x, y, z, 0]^T ignoring translation
   * @param {import('./Matrix4.js').Matrix4} m
   */
  transformDirection(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }

  equals(v, epsilon = 1e-6) {
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon
    );
  }

  toArray() {
    return [this.x, this.y, this.z];
  }

  static fromArray(arr, offset = 0) {
    return new Vector3(arr[offset], arr[offset + 1], arr[offset + 2]);
  }

  static dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static cross(a, b) {
    return new Vector3(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }
}

