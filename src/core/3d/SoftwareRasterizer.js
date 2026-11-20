/**
 * OpenComp - Production Software Rasterizer
 * Multi-threaded capable, 32-bit float scanline rasterizer for 3D triangle meshes.
 * Produces production RGBA pixel buffers with Z-buffering and multi-channel AOVs.
 */

import { Vector3 } from './Vector3.js';
import { Matrix4 } from './Matrix4.js';
import { Geometry3D } from './Geometry3D.js';
import { Scene3D } from './Scene3D.js';
import { Camera3D } from './Camera3D.js';
import { PixelBuffer } from '../PixelBuffer.js';
import { BBox } from '../BBox.js';

export class SoftwareRasterizer {
  /**
   * Renders 3D geometry/scene into a 2D PixelBuffer
   * @param {Object} options
   * @param {Geometry3D|Scene3D} options.scene 3D scene or geometry
   * @param {Camera3D} options.camera View camera
   * @param {number} [options.width=1920] Target render width
   * @param {number} [options.height=1080] Target render height
   * @param {PixelBuffer} [options.background=null] Optional background plate
   * @param {string} [options.shading='unlit'] 'unlit', 'flat', 'phong'
   * @param {string|boolean} [options.culling='back'] 'none', 'back', 'front' or boolean
   * @param {string} [options.antialiasing='none'] 'none', '2x', '4x'
   * @returns {PixelBuffer}
   */
  static render({
    scene,
    camera,
    width = 1920,
    height = 1080,
    background = null,
    shading = 'unlit',
    culling = 'back',
    antialiasing = 'none'
  }) {
    const targetW = Math.max(1, Math.floor(width));
    const targetH = Math.max(1, Math.floor(height));

    if (!scene || !camera) {
      if (background instanceof PixelBuffer) {
        return background.clone();
      }
      return new PixelBuffer(targetW, targetH);
    }

    // Unwrap camera if wrapped in node output packet
    const cam = (camera && camera.camera) ? camera.camera : camera;

    // Determine super-sampling factor
    let ssaaFactor = 1;
    if (antialiasing === '2x') ssaaFactor = 2;
    else if (antialiasing === '4x') ssaaFactor = 4;

    const renderW = targetW * ssaaFactor;
    const renderH = targetH * ssaaFactor;
    const totalPixels = renderW * renderH;

    // Collect all geometries
    let geometries = [];
    if (scene instanceof Scene3D || Array.isArray(scene.geometries)) {
      geometries = scene.geometries;
    } else if (scene instanceof Geometry3D) {
      geometries = [scene];
    } else if (scene.geometry instanceof Geometry3D) {
      geometries = [scene.geometry];
    }

    // Allocate render buffers
    const colorBuf = new Float32Array(totalPixels * 4);
    const depthBuf = new Float32Array(totalPixels);
    depthBuf.fill(Infinity);

    const normalBuf = new Float32Array(totalPixels * 3);
    const uvBuf = new Float32Array(totalPixels * 2);

    // Camera view & projection matrices
    const aspect = renderW / renderH;
    const viewMatrix = cam.getViewMatrix ? cam.getViewMatrix() : (cam.viewMatrix || new Matrix4());
    const projMatrix = cam.getProjectionMatrix(aspect);
    const nearPlane = cam.near || 0.1;

    // Normalize culling mode
    let cullMode = 'back';
    if (culling === false || culling === 'none') cullMode = 'none';
    else if (culling === 'front') cullMode = 'front';
    else if (culling === true || culling === 'back') cullMode = 'back';

    // Rasterize each geometry
    for (const geom of geometries) {
      if (!geom.vertices || geom.vertices.length === 0 || !geom.indices || geom.indices.length === 0) {
        continue;
      }

      // Compute Model-View matrix for this geometry
      const modelMatrix = geom.transform || geom.matrix || new Matrix4();
      const mvMatrix = viewMatrix.clone().multiply(modelMatrix);
      
      // Calculate 3x3 normal matrix (cofactor transpose of MV)
      const normalMat = this._getNormalMatrix(mvMatrix);

      const vertices = geom.vertices;
      const normals = geom.normals;
      const uvs = geom.uvs;
      const indices = geom.indices;
      const numTriangles = Math.floor(indices.length / 3);

      const material = geom.material || {};
      const matColor = material.color || [1.0, 1.0, 1.0, 1.0];
      const texture = (material.texture instanceof PixelBuffer) ? material.texture : null;

      for (let t = 0; t < numTriangles; t++) {
        const i0 = indices[t * 3];
        const i1 = indices[t * 3 + 1];
        const i2 = indices[t * 3 + 2];

        // Object-space vertex coordinates
        const v0 = {
          x: vertices[i0 * 3],
          y: vertices[i0 * 3 + 1],
          z: vertices[i0 * 3 + 2],
          nx: normals && normals.length > i0 * 3 ? normals[i0 * 3] : 0,
          ny: normals && normals.length > i0 * 3 + 1 ? normals[i0 * 3 + 1] : 0,
          nz: normals && normals.length > i0 * 3 + 2 ? normals[i0 * 3 + 2] : 1,
          u: uvs && uvs.length > i0 * 2 ? uvs[i0 * 2] : 0,
          v: uvs && uvs.length > i0 * 2 + 1 ? uvs[i0 * 2 + 1] : 0
        };

        const v1 = {
          x: vertices[i1 * 3],
          y: vertices[i1 * 3 + 1],
          z: vertices[i1 * 3 + 2],
          nx: normals && normals.length > i1 * 3 ? normals[i1 * 3] : 0,
          ny: normals && normals.length > i1 * 3 + 1 ? normals[i1 * 3 + 1] : 0,
          nz: normals && normals.length > i1 * 3 + 2 ? normals[i1 * 3 + 2] : 1,
          u: uvs && uvs.length > i1 * 2 ? uvs[i1 * 2] : 0,
          v: uvs && uvs.length > i1 * 2 + 1 ? uvs[i1 * 2 + 1] : 0
        };

        const v2 = {
          x: vertices[i2 * 3],
          y: vertices[i2 * 3 + 1],
          z: vertices[i2 * 3 + 2],
          nx: normals && normals.length > i2 * 3 ? normals[i2 * 3] : 0,
          ny: normals && normals.length > i2 * 3 + 1 ? normals[i2 * 3 + 1] : 0,
          nz: normals && normals.length > i2 * 3 + 2 ? normals[i2 * 3 + 2] : 1,
          u: uvs && uvs.length > i2 * 2 ? uvs[i2 * 2] : 0,
          v: uvs && uvs.length > i2 * 2 + 1 ? uvs[i2 * 2 + 1] : 0
        };

        // Transform vertices to camera space
        const c0 = this._transformPoint(mvMatrix, v0);
        const c1 = this._transformPoint(mvMatrix, v1);
        const c2 = this._transformPoint(mvMatrix, v2);

        // Transform normals to camera space
        c0.n = this._transformNormal(normalMat, v0.nx, v0.ny, v0.nz);
        c1.n = this._transformNormal(normalMat, v1.nx, v1.ny, v1.nz);
        c2.n = this._transformNormal(normalMat, v2.nx, v2.ny, v2.nz);

        c0.u = v0.u; c0.v = v0.v;
        c1.u = v1.u; c1.v = v1.v;
        c2.u = v2.u; c2.v = v2.v;

        // Clip triangle against near plane (z_cam <= -nearPlane)
        const clippedTriangles = this._clipTriangleNearPlane(c0, c1, c2, nearPlane);

        for (const tri of clippedTriangles) {
          this._rasterizeTriangle({
            tri,
            projMatrix,
            renderW,
            renderH,
            colorBuf,
            depthBuf,
            normalBuf,
            uvBuf,
            matColor,
            texture,
            shading,
            cullMode
          });
        }
      }
    }

    // Prepare final output PixelBuffer
    const outBuffer = new PixelBuffer(targetW, targetH);
    const finalDepth = new Float32Array(targetW * targetH);
    const finalNormX = new Float32Array(targetW * targetH);
    const finalNormY = new Float32Array(targetW * targetH);
    const finalNormZ = new Float32Array(targetW * targetH);
    const finalU = new Float32Array(targetW * targetH);
    const finalV = new Float32Array(targetW * targetH);

    const hasBg = background instanceof PixelBuffer;
    const bgData = hasBg ? background.data : null;
    const bgW = hasBg ? background.width : 0;
    const bgH = hasBg ? background.height : 0;

    let minX = targetW, maxX = -1, minY = targetH, maxY = -1;

    if (ssaaFactor === 1) {
      // Direct 1:1 copy
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const idx = y * targetW + x;
          const cIdx = idx * 4;

          let r = colorBuf[cIdx];
          let g = colorBuf[cIdx + 1];
          let b = colorBuf[cIdx + 2];
          let a = colorBuf[cIdx + 3];

          const d = depthBuf[idx];
          if (d < Infinity) {
            finalDepth[idx] = d;
            finalNormX[idx] = normalBuf[idx * 3];
            finalNormY[idx] = normalBuf[idx * 3 + 1];
            finalNormZ[idx] = normalBuf[idx * 3 + 2];
            finalU[idx] = uvBuf[idx * 2];
            finalV[idx] = uvBuf[idx * 2 + 1];

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          } else {
            finalDepth[idx] = 0.0;
          }

          // Composite over background if needed
          if (hasBg) {
            const bgX = Math.min(bgW - 1, x);
            const bgY = Math.min(bgH - 1, y);
            const bgIdx = (bgY * bgW + bgX) * 4;
            const bgR = bgData[bgIdx];
            const bgG = bgData[bgIdx + 1];
            const bgB = bgData[bgIdx + 2];
            const bgA = bgData[bgIdx + 3];

            if (a < 1.0) {
              r = r + bgR * (1.0 - a);
              g = g + bgG * (1.0 - a);
              b = b + bgB * (1.0 - a);
              a = a + bgA * (1.0 - a);
            }
          }

          outBuffer.data[cIdx] = r;
          outBuffer.data[cIdx + 1] = g;
          outBuffer.data[cIdx + 2] = b;
          outBuffer.data[cIdx + 3] = a;
        }
      }
    } else {
      // Box filter downsampling from super-sampled resolution
      const samplesPerPixel = ssaaFactor * ssaaFactor;
      const invSamples = 1.0 / samplesPerPixel;

      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const outIdx = y * targetW + x;
          const outCIdx = outIdx * 4;

          let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
          let minD = Infinity;
          let sumNx = 0, sumNy = 0, sumNz = 0;
          let sumU = 0, sumV = 0;
          let validCount = 0;

          for (let sy = 0; sy < ssaaFactor; sy++) {
            const ry = y * ssaaFactor + sy;
            for (let sx = 0; sx < ssaaFactor; sx++) {
              const rx = x * ssaaFactor + sx;
              const rIdx = ry * renderW + rx;
              const rCIdx = rIdx * 4;

              sumR += colorBuf[rCIdx];
              sumG += colorBuf[rCIdx + 1];
              sumB += colorBuf[rCIdx + 2];
              sumA += colorBuf[rCIdx + 3];

              const d = depthBuf[rIdx];
              if (d < Infinity) {
                if (d < minD) minD = d;
                sumNx += normalBuf[rIdx * 3];
                sumNy += normalBuf[rIdx * 3 + 1];
                sumNz += normalBuf[rIdx * 3 + 2];
                sumU += uvBuf[rIdx * 2];
                sumV += uvBuf[rIdx * 2 + 1];
                validCount++;
              }
            }
          }

          let r = sumR * invSamples;
          let g = sumG * invSamples;
          let b = sumB * invSamples;
          let a = sumA * invSamples;

          if (validCount > 0) {
            finalDepth[outIdx] = minD;
            finalNormX[outIdx] = sumNx / validCount;
            finalNormY[outIdx] = sumNy / validCount;
            finalNormZ[outIdx] = sumNz / validCount;
            finalU[outIdx] = sumU / validCount;
            finalV[outIdx] = sumV / validCount;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          } else {
            finalDepth[outIdx] = 0.0;
          }

          // Composite over background if needed
          if (hasBg) {
            const bgX = Math.min(bgW - 1, x);
            const bgY = Math.min(bgH - 1, y);
            const bgIdx = (bgY * bgW + bgX) * 4;
            const bgR = bgData[bgIdx];
            const bgG = bgData[bgIdx + 1];
            const bgB = bgData[bgIdx + 2];
            const bgA = bgData[bgIdx + 3];

            if (a < 1.0) {
              r = r + bgR * (1.0 - a);
              g = g + bgG * (1.0 - a);
              b = b + bgB * (1.0 - a);
              a = a + bgA * (1.0 - a);
            }
          }

          outBuffer.data[outCIdx] = r;
          outBuffer.data[outCIdx + 1] = g;
          outBuffer.data[outCIdx + 2] = b;
          outBuffer.data[outCIdx + 3] = a;
        }
      }
    }

    // Attach production AOVs
    outBuffer.setChannel('depth.Z', finalDepth);
    outBuffer.setChannel('normal.X', finalNormX);
    outBuffer.setChannel('normal.Y', finalNormY);
    outBuffer.setChannel('normal.Z', finalNormZ);
    outBuffer.setChannel('u', finalU);
    outBuffer.setChannel('v', finalV);

    // Set BBox
    if (minX <= maxX && minY <= maxY) {
      outBuffer.bbox = new BBox(minX, minY, (maxX - minX + 1), (maxY - minY + 1));
    } else {
      outBuffer.bbox = new BBox(0, 0, targetW, targetH);
    }

    return outBuffer;
  }

  /**
   * Internal triangle rasterizer
   * @private
   */
  static _rasterizeTriangle({
    tri,
    projMatrix,
    renderW,
    renderH,
    colorBuf,
    depthBuf,
    normalBuf,
    uvBuf,
    matColor,
    texture,
    shading,
    cullMode
  }) {
    const [c0, c1, c2] = tri;

    // Project each vertex to clip space
    const p0 = this._projectToClip(projMatrix, c0);
    const p1 = this._projectToClip(projMatrix, c1);
    const p2 = this._projectToClip(projMatrix, c2);

    if (p0.w <= 0 || p1.w <= 0 || p2.w <= 0) return;

    // Map NDC to screen coordinates
    const sx0 = ((p0.ndcX + 1.0) * 0.5) * renderW;
    const sy0 = ((1.0 - p0.ndcY) * 0.5) * renderH;

    const sx1 = ((p1.ndcX + 1.0) * 0.5) * renderW;
    const sy1 = ((1.0 - p1.ndcY) * 0.5) * renderH;

    const sx2 = ((p2.ndcX + 1.0) * 0.5) * renderW;
    const sy2 = ((1.0 - p2.ndcY) * 0.5) * renderH;

    // Signed 2D area (winding) in screen space
    const area2 = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
    if (Math.abs(area2) < 1e-6) return;

    // Cull test
    if (cullMode === 'back') {
      // With screen Y down, standard counter-clockwise front-facing triangles have area2 < 0
      if (area2 >= 0) return;
    } else if (cullMode === 'front') {
      if (area2 <= 0) return;
    }

    // Screen-space 2D Bounding Box
    const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
    const maxX = Math.min(renderW - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
    const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
    const maxY = Math.min(renderH - 1, Math.ceil(Math.max(sy0, sy1, sy2)));

    if (minX > maxX || minY > maxY) return;

    // Inverted W for perspective-correct attribute interpolation
    const invW0 = 1.0 / p0.w;
    const invW1 = 1.0 / p1.w;
    const invW2 = 1.0 / p2.w;

    // Attribute products over W
    const uOverW0 = c0.u * invW0, vOverW0 = c0.v * invW0;
    const uOverW1 = c1.u * invW1, vOverW1 = c1.v * invW1;
    const uOverW2 = c2.u * invW2, vOverW2 = c2.v * invW2;

    const nxOverW0 = c0.n.x * invW0, nyOverW0 = c0.n.y * invW0, nzOverW0 = c0.n.z * invW0;
    const nxOverW1 = c1.n.x * invW1, nyOverW1 = c1.n.y * invW1, nzOverW1 = c1.n.z * invW1;
    const nxOverW2 = c2.n.x * invW2, nyOverW2 = c2.n.y * invW2, nzOverW2 = c2.n.z * invW2;

    const texData = texture ? texture.data : null;
    const texW = texture ? texture.width : 0;
    const texH = texture ? texture.height : 0;

    // Rasterization scanline loop
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5;

        // Subpixel edge function evaluation
        const w0 = (sx2 - sx1) * (cy - sy1) - (sy2 - sy1) * (cx - sx1);
        const w1 = (sx0 - sx2) * (cy - sy2) - (sy0 - sy2) * (cx - sx2);
        const w2 = (sx1 - sx0) * (cy - sy0) - (sy1 - sy0) * (cx - sx0);

        const sumW = w0 + w1 + w2;
        if (Math.abs(sumW) < 1e-12) continue;

        const l0 = w0 / sumW;
        const l1 = w1 / sumW;
        const l2 = w2 / sumW;

        if (l0 < -1e-5 || l1 < -1e-5 || l2 < -1e-5) continue;

        // Perspective-correct depth
        const invW = l0 * invW0 + l1 * invW1 + l2 * invW2;
        if (invW <= 0) continue;
        const zLinear = 1.0 / invW; // Linear distance along optical axis

        const pIdx = py * renderW + px;
        if (zLinear >= depthBuf[pIdx]) continue; // Depth test failed

        // Passed depth test
        depthBuf[pIdx] = zLinear;

        // Perspective-correct UV interpolation
        const u = (l0 * uOverW0 + l1 * uOverW1 + l2 * uOverW2) * zLinear;
        const v = (l0 * vOverW0 + l1 * vOverW1 + l2 * vOverW2) * zLinear;

        // Perspective-correct normal interpolation
        let nx = (l0 * nxOverW0 + l1 * nxOverW1 + l2 * nxOverW2) * zLinear;
        let ny = (l0 * nyOverW0 + l1 * nyOverW1 + l2 * nyOverW2) * zLinear;
        let nz = (l0 * nzOverW0 + l1 * nzOverW1 + l2 * nzOverW2) * zLinear;
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen > 1e-6) {
          nx /= nLen; ny /= nLen; nz /= nLen;
        }

        // Store AOVs
        normalBuf[pIdx * 3] = nx;
        normalBuf[pIdx * 3 + 1] = ny;
        normalBuf[pIdx * 3 + 2] = nz;

        uvBuf[pIdx * 2] = u;
        uvBuf[pIdx * 2 + 1] = v;

        // Base color
        let r = matColor[0];
        let g = matColor[1];
        let b = matColor[2];
        let a = matColor.length > 3 ? matColor[3] : 1.0;

        // Texture sampling (bilinear filtering)
        if (texData) {
          const uc = Math.max(0.0, Math.min(1.0, u));
          const vc = Math.max(0.0, Math.min(1.0, v));

          const tx = uc * (texW - 1);
          // In OpenComp image coordinates, v=1 is top, v=0 is bottom
          const ty = (1.0 - vc) * (texH - 1);

          const x0 = Math.floor(tx), y0 = Math.floor(ty);
          const x1 = Math.min(texW - 1, x0 + 1), y1 = Math.min(texH - 1, y0 + 1);
          const fx = tx - x0, fy = ty - y0;

          const i00 = (y0 * texW + x0) * 4;
          const i10 = (y0 * texW + x1) * 4;
          const i01 = (y1 * texW + x0) * 4;
          const i11 = (y1 * texW + x1) * 4;

          const tr = (1 - fx) * (1 - fy) * texData[i00]     + fx * (1 - fy) * texData[i10]     + (1 - fx) * fy * texData[i01]     + fx * fy * texData[i11];
          const tg = (1 - fx) * (1 - fy) * texData[i00 + 1] + fx * (1 - fy) * texData[i10 + 1] + (1 - fx) * fy * texData[i01 + 1] + fx * fy * texData[i11 + 1];
          const tb = (1 - fx) * (1 - fy) * texData[i00 + 2] + fx * (1 - fy) * texData[i10 + 2] + (1 - fx) * fy * texData[i01 + 2] + fx * fy * texData[i11 + 2];
          const ta = (1 - fx) * (1 - fy) * texData[i00 + 3] + fx * (1 - fy) * texData[i10 + 3] + (1 - fx) * fy * texData[i01 + 3] + fx * fy * texData[i11 + 3];

          r *= tr;
          g *= tg;
          b *= tb;
          a *= ta;
        }

        // Shading computation
        if (shading === 'flat' || shading === 'phong') {
          // Camera space headlight: light direction is along +Z (towards viewer)
          const dot = Math.max(0.0, nz);
          const intensity = 0.25 + 0.75 * dot;
          r *= intensity;
          g *= intensity;
          b *= intensity;
        }

        const cIdx = pIdx * 4;
        colorBuf[cIdx] = r;
        colorBuf[cIdx + 1] = g;
        colorBuf[cIdx + 2] = b;
        colorBuf[cIdx + 3] = a;
      }
    }
  }

  /**
   * Clips a triangle against camera near plane (z <= -nearDist)
   * @private
   */
  static _clipTriangleNearPlane(v0, v1, v2, nearDist) {
    const nearZ = -nearDist;

    const in0 = v0.z <= nearZ;
    const in1 = v1.z <= nearZ;
    const in2 = v2.z <= nearZ;

    const inCount = (in0 ? 1 : 0) + (in1 ? 1 : 0) + (in2 ? 1 : 0);

    if (inCount === 3) {
      return [[v0, v1, v2]];
    }

    if (inCount === 0) {
      return [];
    }

    const interpolate = (va, vb) => {
      const denom = vb.z - va.z;
      const t = Math.abs(denom) > 1e-8 ? (nearZ - va.z) / denom : 0.0;
      return {
        x: va.x + (vb.x - va.x) * t,
        y: va.y + (vb.y - va.y) * t,
        z: nearZ,
        n: {
          x: va.n.x + (vb.n.x - va.n.x) * t,
          y: va.n.y + (vb.n.y - va.n.y) * t,
          z: va.n.z + (vb.n.z - va.n.z) * t
        },
        u: va.u + (vb.u - va.u) * t,
        v: va.v + (vb.v - va.v) * t
      };
    };

    if (inCount === 1) {
      // 1 vertex inside, 2 outside -> 1 triangle
      let vIn, vOut1, vOut2;
      if (in0) { vIn = v0; vOut1 = v1; vOut2 = v2; }
      else if (in1) { vIn = v1; vOut1 = v2; vOut2 = v0; }
      else { vIn = v2; vOut1 = v0; vOut2 = v1; }

      const i1 = interpolate(vIn, vOut1);
      const i2 = interpolate(vIn, vOut2);

      return [[vIn, i1, i2]];
    }

    if (inCount === 2) {
      // 2 vertices inside, 1 outside -> 2 triangles
      let vIn1, vIn2, vOut;
      if (!in0) { vOut = v0; vIn1 = v1; vIn2 = v2; }
      else if (!in1) { vOut = v1; vIn1 = v2; vIn2 = v0; }
      else { vOut = v2; vIn1 = v0; vIn2 = v1; }

      const i1 = interpolate(vIn1, vOut);
      const i2 = interpolate(vIn2, vOut);

      return [
        [vIn1, vIn2, i1],
        [vIn2, i2, i1]
      ];
    }

    return [];
  }

  /**
   * Projects camera-space vertex into clip space and NDC
   * @private
   */
  static _projectToClip(projMatrix, v) {
    const e = projMatrix.elements;
    const x = v.x, y = v.y, z = v.z;

    const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
    const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
    const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];
    const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];

    const invW = Math.abs(clipW) > 1e-12 ? 1.0 / clipW : 1.0;

    return {
      clipX, clipY, clipZ,
      w: clipW,
      ndcX: clipX * invW,
      ndcY: clipY * invW,
      ndcZ: clipZ * invW
    };
  }

  /**
   * Transforms a 3D point by 4x4 matrix
   * @private
   */
  static _transformPoint(mat, pt) {
    const e = mat.elements;
    const x = pt.x, y = pt.y, z = pt.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1.0;
    const invW = 1.0 / w;

    return {
      x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * invW,
      y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * invW,
      z: (e[2] * x + e[6] * y + e[10] * z + e[14]) * invW
    };
  }

  /**
   * Normal matrix (cofactor transpose of 3x3 linear submatrix)
   * @private
   */
  static _getNormalMatrix(mat) {
    const e = mat.elements;
    const a00 = e[0], a01 = e[4], a02 = e[8];
    const a10 = e[1], a11 = e[5], a12 = e[9];
    const a20 = e[2], a21 = e[6], a22 = e[10];

    // Transpose of cofactor matrix
    return [
       (a11 * a22 - a12 * a21), -(a01 * a22 - a02 * a21),  (a01 * a12 - a02 * a11),
      -(a10 * a22 - a12 * a20),  (a00 * a22 - a02 * a20), -(a00 * a12 - a02 * a10),
       (a10 * a21 - a11 * a20), -(a00 * a21 - a01 * a20),  (a00 * a11 - a01 * a10)
    ];
  }

  /**
   * Transforms normal vector by normal matrix and normalizes
   * @private
   */
  static _transformNormal(normMat, nx, ny, nz) {
    const rx = normMat[0] * nx + normMat[1] * ny + normMat[2] * nz;
    const ry = normMat[3] * nx + normMat[4] * ny + normMat[5] * nz;
    const rz = normMat[6] * nx + normMat[7] * ny + normMat[8] * nz;

    const len = Math.hypot(rx, ry, rz);
    if (len > 1e-6) {
      return { x: rx / len, y: ry / len, z: rz / len };
    }
    return { x: 0, y: 0, z: 1 };
  }
}
