/**
 * OpenComp - Professional 3D Compositing Viewer & Manipulators Subsystem
 * Production Nuke-Style 3D Viewport:
 * - Dedicated 3D Viewer mode with perspective, orthographic (Top, Front, Right, Bottom, Back, Left), and scene camera viewing
 * - Orbit (Alt+LMB), Pan (Alt+MMB), Dolly/Zoom (Wheel / Alt+RMB), Frame Selected (F), Frame All (A), Reset (Home)
 * - Ground plane grid with dynamic distance fade, world origin coordinate tripod, and corner orientation gizmo
 * - Wireframe, shaded (diffuse lighting), and textured rendering of 3D primitives (Card3D, Cube3D, Axis3D, Camera3D, Project3D)
 * - Interactive 3D Transformation Manipulators: Translate (W), Rotate (E), Scale (R) with World and Local coordinate spaces
 * - Real-time knob updates directly on scene object transforms with live HUD coordinate readouts
 * - Object selection and hit testing via camera ray casting
 * - "Lock Camera to View" workflow: viewport navigation writes updated transforms directly back to Camera3DNode knobs
 */

import { Vector3 } from '../core/3d/Vector3.js';
import { Matrix4 } from '../core/3d/Matrix4.js';
import { Camera3D } from '../core/3d/Camera3D.js';
import { Geometry3D } from '../core/3d/Geometry3D.js';
import { Scene3D } from '../core/3d/Scene3D.js';

export class Viewer3DUI {
  constructor(canvasElement, graph = null, onParamChange = null, onNodeSelect = null) {
    this.canvas = canvasElement;
    this.ctx = canvasElement && typeof canvasElement.getContext === 'function' ? canvasElement.getContext('2d') : null;
    this.graph = graph;
    this.onParamChange = onParamChange;
    this.onNodeSelect = onNodeSelect;

    // Virtual Viewport Camera
    this.camera = new Camera3D();
    this.target = new Vector3(0, 0, 0);
    this.azimuth = 0.6;   // ~34 degrees
    this.elevation = 0.4; // ~23 degrees
    this.distance = 15.0; // Distance to target
    this.orthoSize = 8.0; // Half-height for orthographic projection

    // View Modes: 'perspective', 'top', 'front', 'right', 'bottom', 'back', 'left', or 'camera:<nodeId>'
    this.viewType = 'perspective';
    this.lockCameraToView = false;
    this.activeCameraNodeId = null;

    // Display Options
    this.displayMode = 'shaded'; // 'wireframe', 'shaded', 'textured'
    this.showGrid = true;
    this.showAxes = true;
    this.showOrientationGizmo = true;
    this.showCameraFrustums = true;
    this.showBounds = true;

    // Manipulator / Gizmo State
    this.gizmoMode = 'translate'; // 'translate', 'rotate', 'scale', 'none'
    this.coordSpace = 'world';    // 'world', 'local'
    this.activeHandle = null;     // Hovered/dragged handle id
    this.isDraggingGizmo = false;
    this.dragStartMouse = { x: 0, y: 0 };
    this.dragInitialTransform = null;
    this.liveDeltaText = '';

    // Selection
    this.selectedNode = null;
    this.selectedNodeIds = new Set();

    // Navigation State
    this.isNavigating = false;
    this.navMode = null; // 'orbit', 'pan', 'dolly'
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Timeline frame for animated properties
    this.currentFrame = 1;

    // Context menu element reference
    this.contextMenuEl = null;

    // Preferences
    this.loadPreferences();
  }

  setGraph(graph) {
    this.graph = graph;
  }

  setFrame(frame) {
    this.currentFrame = frame;
  }

  setSelectedNode(node) {
    this.selectedNode = node;
    this.selectedNodeIds.clear();
    if (node) {
      this.selectedNodeIds.add(node.id);
    }
  }

  // --- View & Navigation Controls ---

  setViewType(type) {
    this.viewType = type;
    if (type.startsWith('camera:')) {
      this.activeCameraNodeId = type.split(':')[1];
    } else {
      this.activeCameraNodeId = null;
    }
    this.updateCamera();
    this.savePreferences();
  }

  setDisplayMode(mode) {
    if (['wireframe', 'shaded', 'textured'].includes(mode)) {
      this.displayMode = mode;
      this.savePreferences();
    }
  }

  setGizmoMode(mode) {
    if (['translate', 'rotate', 'scale', 'none'].includes(mode)) {
      this.gizmoMode = mode;
      this.savePreferences();
    }
  }

  setCoordSpace(space) {
    if (['world', 'local'].includes(space)) {
      this.coordSpace = space;
      this.savePreferences();
    }
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.savePreferences();
    return this.showGrid;
  }

  setLockCameraToView(locked) {
    this.lockCameraToView = !!locked;
  }

  // Reset to default perspective
  resetView() {
    this.target.set(0, 0, 0);
    this.azimuth = 0.6;
    this.elevation = 0.4;
    this.distance = 15.0;
    this.orthoSize = 8.0;
    this.viewType = 'perspective';
    this.activeCameraNodeId = null;
    this.updateCamera();
  }

  // Frame Selected 3D Object
  frameSelected() {
    if (!this.selectedNode) {
      this.frameAll();
      return;
    }

    const pos = this.getNodeWorldPosition(this.selectedNode);
    this.target.copy(pos);
    const bounds = this.getNodeBounds(this.selectedNode);
    if (bounds) {
      const size = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z
      );
      this.distance = Math.max(4.0, size * 2.5);
      this.orthoSize = Math.max(2.0, size * 1.5);
    }
    this.updateCamera();
  }

  // Frame All 3D Objects in Scene
  frameAll() {
    const nodes = this.get3DNodes();
    if (nodes.length === 0) {
      this.resetView();
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const node of nodes) {
      const b = this.getNodeBounds(node);
      if (b) {
        if (b.min.x < minX) minX = b.min.x;
        if (b.min.y < minY) minY = b.min.y;
        if (b.min.z < minZ) minZ = b.min.z;
        if (b.max.x > maxX) maxX = b.max.x;
        if (b.max.y > maxY) maxY = b.max.y;
        if (b.max.z > maxZ) maxZ = b.max.z;
      }
    }

    if (minX === Infinity) {
      this.resetView();
      return;
    }

    this.target.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 4.0);
    this.distance = Math.max(8.0, size * 2.2);
    this.orthoSize = Math.max(4.0, size * 1.5);
    this.updateCamera();
  }

  // --- Transform Reset Methods ---

  resetTranslate() {
    if (!this.selectedNode) return;
    this.selectedNode.setKnobValue('translateX', 0.0);
    this.selectedNode.setKnobValue('translateY', 0.0);
    this.selectedNode.setKnobValue('translateZ', 0.0);
    this.selectedNode.markDirty();
    if (this.onParamChange) this.onParamChange(this.selectedNode);
  }

  resetRotate() {
    if (!this.selectedNode) return;
    this.selectedNode.setKnobValue('rotateX', 0.0);
    this.selectedNode.setKnobValue('rotateY', 0.0);
    this.selectedNode.setKnobValue('rotateZ', 0.0);
    this.selectedNode.markDirty();
    if (this.onParamChange) this.onParamChange(this.selectedNode);
  }

  resetScale() {
    if (!this.selectedNode) return;
    this.selectedNode.setKnobValue('uniformScale', 1.0);
    if (this.selectedNode.hasKnob && this.selectedNode.hasKnob('scaleX')) {
      this.selectedNode.setKnobValue('scaleX', 1.0);
      this.selectedNode.setKnobValue('scaleY', 1.0);
      this.selectedNode.setKnobValue('scaleZ', 1.0);
    }
    this.selectedNode.markDirty();
    if (this.onParamChange) this.onParamChange(this.selectedNode);
  }

  resetAllTransforms() {
    this.resetTranslate();
    this.resetRotate();
    this.resetScale();
  }

  // --- Camera Mathematics Update ---

  updateCamera() {
    const W = this.canvas ? this.canvas.width : 1920;
    const H = this.canvas ? this.canvas.height : 1080;
    const aspect = W / Math.max(1, H);

    if (this.activeCameraNodeId && this.graph) {
      const camNode = this.graph.getNode(this.activeCameraNodeId);
      if (camNode) {
        const worldMat = typeof camNode.getWorldMatrix === 'function'
          ? camNode.getWorldMatrix({}, { frame: this.currentFrame })
          : new Matrix4();
        this.camera.worldMatrix.copy(worldMat);
        this.camera.focal = Number(camNode.getKnobValue('focal', { frame: this.currentFrame })) || 50.0;
        this.camera.haperture = Number(camNode.getKnobValue('haperture', { frame: this.currentFrame })) || 24.89;
        this.camera.vaperture = Number(camNode.getKnobValue('vaperture', { frame: this.currentFrame })) || 18.67;
        this.camera.near = Number(camNode.getKnobValue('near')) || 0.1;
        this.camera.far = Number(camNode.getKnobValue('far')) || 10000.0;
        this.camera.projectionMode = camNode.getKnobValue('projectionMode') || 'perspective';
        return;
      }
    }

    // Free Viewport Navigation Camera
    if (this.viewType === 'perspective') {
      this.camera.projectionMode = 'perspective';
      this.camera.focal = 35.0;
      this.camera.haperture = 24.89;
      this.camera.vaperture = 24.89 / aspect;
      this.camera.near = 0.1;
      this.camera.far = 10000.0;

      const eyeX = this.target.x + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
      const eyeY = this.target.y + this.distance * Math.sin(this.elevation);
      const eyeZ = this.target.z + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);
      const eye = new Vector3(eyeX, eyeY, eyeZ);

      this.camera.worldMatrix.makeLookAt(eye, this.target, new Vector3(0, 1, 0));
    } else {
      // Orthographic Views
      this.camera.projectionMode = 'orthographic';
      this.camera.haperture = this.orthoSize * 2.0 * aspect;
      this.camera.vaperture = this.orthoSize * 2.0;
      this.camera.near = 0.1;
      this.camera.far = 10000.0;

      let eye = new Vector3();
      let up = new Vector3(0, 1, 0);

      switch (this.viewType) {
        case 'top':
          eye.set(this.target.x, this.target.y + this.distance, this.target.z);
          up.set(0, 0, -1);
          break;
        case 'bottom':
          eye.set(this.target.x, this.target.y - this.distance, this.target.z);
          up.set(0, 0, 1);
          break;
        case 'front':
          eye.set(this.target.x, this.target.y, this.target.z + this.distance);
          up.set(0, 1, 0);
          break;
        case 'back':
          eye.set(this.target.x, this.target.y, this.target.z - this.distance);
          up.set(0, 1, 0);
          break;
        case 'right':
          eye.set(this.target.x + this.distance, this.target.y, this.target.z);
          up.set(0, 1, 0);
          break;
        case 'left':
          eye.set(this.target.x - this.distance, this.target.y, this.target.z);
          up.set(0, 1, 0);
          break;
      }

      this.camera.worldMatrix.makeLookAt(eye, this.target, up);
    }
  }

  // --- Node Query Helpers ---

  get3DNodes() {
    if (!this.graph) return [];
    return this.graph.getAllNodes().filter(n =>
      ['Axis3D', 'Camera3D', 'Card3D', 'Cube3D', 'Scene3D', 'Project3D', 'ScanlineRender'].includes(n.type)
    );
  }

  getCameraNodes() {
    if (!this.graph) return [];
    return this.graph.getAllNodes().filter(n => n.type === 'Camera3D');
  }

  getNodeWorldMatrix(node) {
    if (!node) return new Matrix4();
    if (typeof node.getWorldMatrix === 'function') {
      return node.getWorldMatrix({}, { frame: this.currentFrame });
    }
    if (typeof node.getLocalMatrix === 'function') {
      return node.getLocalMatrix({ frame: this.currentFrame });
    }
    const tx = Number(node.getKnobValue('translateX', { frame: this.currentFrame })) || 0;
    const ty = Number(node.getKnobValue('translateY', { frame: this.currentFrame })) || 0;
    const tz = Number(node.getKnobValue('translateZ', { frame: this.currentFrame })) || 0;
    return new Matrix4().makeTranslation(tx, ty, tz);
  }

  getNodeWorldPosition(node) {
    const m = this.getNodeWorldMatrix(node);
    return new Vector3(m.elements[12], m.elements[13], m.elements[14]);
  }

  getNodeBounds(node) {
    if (!node) return null;
    const m = this.getNodeWorldMatrix(node);
    let min = new Vector3(-0.5, -0.5, -0.5);
    let max = new Vector3(0.5, 0.5, 0.5);

    if (node.type === 'Card3D') {
      const w = Number(node.getKnobValue('width')) || 1.0;
      const h = Number(node.getKnobValue('height')) || 1.0;
      min.set(-w * 0.5, -h * 0.5, 0);
      max.set(w * 0.5, h * 0.5, 0);
    } else if (node.type === 'Cube3D') {
      const w = Number(node.getKnobValue('width')) || 1.0;
      const h = Number(node.getKnobValue('height')) || 1.0;
      const d = Number(node.getKnobValue('depth')) || 1.0;
      min.set(-w * 0.5, -h * 0.5, -d * 0.5);
      max.set(w * 0.5, h * 0.5, d * 0.5);
    } else if (node.type === 'Camera3D') {
      min.set(-0.5, -0.5, -1.0);
      max.set(0.5, 0.5, 1.0);
    } else if (node.type === 'Axis3D') {
      min.set(-0.3, -0.3, -0.3);
      max.set(0.3, 0.3, 0.3);
    }

    // Transform 8 bbox corners by matrix
    const corners = [
      new Vector3(min.x, min.y, min.z).transformMat4(m),
      new Vector3(max.x, min.y, min.z).transformMat4(m),
      new Vector3(min.x, max.y, min.z).transformMat4(m),
      new Vector3(max.x, max.y, min.z).transformMat4(m),
      new Vector3(min.x, min.y, max.z).transformMat4(m),
      new Vector3(max.x, min.y, max.z).transformMat4(m),
      new Vector3(min.x, max.y, max.z).transformMat4(m),
      new Vector3(max.x, max.y, max.z).transformMat4(m)
    ];

    let bMin = new Vector3(Infinity, Infinity, Infinity);
    let bMax = new Vector3(-Infinity, -Infinity, -Infinity);

    for (const c of corners) {
      if (c.x < bMin.x) bMin.x = c.x;
      if (c.y < bMin.y) bMin.y = c.y;
      if (c.z < bMin.z) bMin.z = c.z;
      if (c.x > bMax.x) bMax.x = c.x;
      if (c.y > bMax.y) bMax.y = c.y;
      if (c.z > bMax.z) bMax.z = c.z;
    }

    return { min: bMin, max: bMax, corners };
  }

  // --- Rendering Pipeline ---

  render() {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;

    this.updateCamera();

    const W = c.width;
    const H = c.height;

    // Viewport background
    ctx.save();
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(0, 0, W, H);

    // Subtle radial gradient vignette
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, W * 0.7);
    grad.addColorStop(0, '#22242b');
    grad.addColorStop(1, '#151619');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 1. Ground Plane Grid
    if (this.showGrid) {
      this.renderGrid(ctx, W, H);
    }

    // 2. World Origin Axes Tripod
    if (this.showAxes) {
      this.renderWorldAxes(ctx, W, H);
    }

    // 3. Render 3D Objects in the scene
    const nodes = this.get3DNodes();
    for (const node of nodes) {
      if (node._viewer3dVisible === false) continue;
      this.renderNodeObject(ctx, node, W, H);
    }

    // 4. Selected Object Highlight & Bounding Box
    if (this.selectedNode && this.showBounds) {
      this.renderSelectedHighlight(ctx, this.selectedNode, W, H);
    }

    // 5. 3D Transformation Manipulator (Gizmo)
    if (this.selectedNode && this.gizmoMode !== 'none') {
      this.renderManipulator(ctx, this.selectedNode, W, H);
    }

    // 6. Viewport HUD Info
    this.renderHUD(ctx, W, H);

    // 7. Corner Orientation Gizmo (Compass Tripod)
    if (this.showOrientationGizmo) {
      this.renderOrientationGizmo(ctx, W, H);
    }

    ctx.restore();
  }

  // --- Grid & Axes Rendering ---

  renderGrid(ctx, W, H) {
    const size = 10;
    const step = 1;

    ctx.save();
    ctx.lineWidth = 1;

    // Grid lines along X and Z
    for (let i = -size; i <= size; i += step) {
      const isMajor = (i % 5 === 0);
      const isCenter = (i === 0);

      // Line parallel to X (constant Z = i)
      const p1 = this.camera.project(new Vector3(-size, 0, i), W, H);
      const p2 = this.camera.project(new Vector3(size, 0, i), W, H);

      if (p1.inFront || p2.inFront) {
        ctx.strokeStyle = isCenter ? 'rgba(235, 60, 60, 0.7)' : (isMajor ? 'rgba(90, 95, 105, 0.45)' : 'rgba(50, 55, 62, 0.35)');
        ctx.lineWidth = isCenter ? 1.5 : (isMajor ? 1.0 : 0.8);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Line parallel to Z (constant X = i)
      const q1 = this.camera.project(new Vector3(i, 0, -size), W, H);
      const q2 = this.camera.project(new Vector3(i, 0, size), W, H);

      if (q1.inFront || q2.inFront) {
        ctx.strokeStyle = isCenter ? 'rgba(60, 130, 245, 0.7)' : (isMajor ? 'rgba(90, 95, 105, 0.45)' : 'rgba(50, 55, 62, 0.35)');
        ctx.lineWidth = isCenter ? 1.5 : (isMajor ? 1.0 : 0.8);
        ctx.beginPath();
        ctx.moveTo(q1.x, q1.y);
        ctx.lineTo(q2.x, q2.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  renderWorldAxes(ctx, W, H) {
    const origin = this.camera.project(new Vector3(0, 0, 0), W, H);
    if (!origin.inFront) return;

    const len = 1.8;
    const pX = this.camera.project(new Vector3(len, 0, 0), W, H);
    const pY = this.camera.project(new Vector3(0, len, 0), W, H);
    const pZ = this.camera.project(new Vector3(0, 0, len), W, H);

    ctx.save();
    ctx.lineWidth = 2.0;

    // X Axis (Red)
    if (pX.inFront) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pX.x, pX.y);
      ctx.stroke();
      ctx.font = 'bold 10px monospace';
      ctx.fillText('X', pX.x + 4, pX.y - 2);
    }

    // Y Axis (Green)
    if (pY.inFront) {
      ctx.strokeStyle = '#51cf66';
      ctx.fillStyle = '#51cf66';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pY.x, pY.y);
      ctx.stroke();
      ctx.font = 'bold 10px monospace';
      ctx.fillText('Y', pY.x + 4, pY.y - 2);
    }

    // Z Axis (Blue)
    if (pZ.inFront) {
      ctx.strokeStyle = '#339af0';
      ctx.fillStyle = '#339af0';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pZ.x, pZ.y);
      ctx.stroke();
      ctx.font = 'bold 10px monospace';
      ctx.fillText('Z', pZ.x + 4, pZ.y - 2);
    }

    ctx.restore();
  }

  // --- 3D Object Rendering ---

  renderNodeObject(ctx, node, W, H) {
    const mat = this.getNodeWorldMatrix(node);

    switch (node.type) {
      case 'Card3D':
        this.renderCardObject(ctx, node, mat, W, H);
        break;
      case 'Cube3D':
        this.renderCubeObject(ctx, node, mat, W, H);
        break;
      case 'Camera3D':
        if (node.id !== this.activeCameraNodeId) {
          this.renderCameraObject(ctx, node, mat, W, H);
        }
        break;
      case 'Axis3D':
        this.renderAxisObject(ctx, node, mat, W, H);
        break;
      case 'Project3D':
        this.renderProject3DObject(ctx, node, mat, W, H);
        break;
      case 'Scene3D':
      case 'ScanlineRender':
        this.renderGeneric3DIndicator(ctx, node, mat, W, H);
        break;
    }
  }

  renderCardObject(ctx, node, mat, W, H) {
    const w = (Number(node.getKnobValue('width')) || 1.0) * 0.5;
    const h = (Number(node.getKnobValue('height')) || 1.0) * 0.5;

    const cornersLocal = [
      new Vector3(-w, -h, 0),
      new Vector3(w, -h, 0),
      new Vector3(w, h, 0),
      new Vector3(-w, h, 0)
    ];

    const cornersProj = cornersLocal.map(c => this.camera.project(c.transformMat4(mat), W, H));
    const allInFront = cornersProj.every(p => p.inFront);
    if (!allInFront) return;

    ctx.save();

    // Shaded face fill
    if (this.displayMode === 'shaded' || this.displayMode === 'textured') {
      const cr = Number(node.getKnobValue('colorR')) ?? 0.8;
      const cg = Number(node.getKnobValue('colorG')) ?? 0.8;
      const cb = Number(node.getKnobValue('colorB')) ?? 0.8;
      ctx.fillStyle = `rgba(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)}, 0.45)`;
      ctx.beginPath();
      ctx.moveTo(cornersProj[0].x, cornersProj[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(cornersProj[i].x, cornersProj[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Wireframe edges
    ctx.strokeStyle = this.selectedNodeIds.has(node.id) ? '#fcc419' : '#4dabf7';
    ctx.lineWidth = this.selectedNodeIds.has(node.id) ? 2.0 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cornersProj[0].x, cornersProj[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cornersProj[i].x, cornersProj[i].y);
    ctx.closePath();
    ctx.stroke();

    // Diagonals in wireframe mode
    if (this.displayMode === 'wireframe') {
      ctx.strokeStyle = 'rgba(77, 171, 247, 0.4)';
      ctx.beginPath();
      ctx.moveTo(cornersProj[0].x, cornersProj[0].y);
      ctx.lineTo(cornersProj[2].x, cornersProj[2].y);
      ctx.stroke();
    }

    // Node label
    const centerProj = this.camera.project(new Vector3(0, 0, 0).transformMat4(mat), W, H);
    if (centerProj.inFront) {
      ctx.fillStyle = '#ced4da';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.name, centerProj.x, centerProj.y - 8);
    }

    ctx.restore();
  }

  renderCubeObject(ctx, node, mat, W, H) {
    const w = (Number(node.getKnobValue('width')) || 1.0) * 0.5;
    const h = (Number(node.getKnobValue('height')) || 1.0) * 0.5;
    const d = (Number(node.getKnobValue('depth')) || 1.0) * 0.5;

    const cornersLocal = [
      new Vector3(-w, -h, -d), new Vector3(w, -h, -d), new Vector3(w, h, -d), new Vector3(-w, h, -d),
      new Vector3(-w, -h, d),  new Vector3(w, -h, d),  new Vector3(w, h, d),  new Vector3(-w, h, d)
    ];

    const cornersProj = cornersLocal.map(c => this.camera.project(c.transformMat4(mat), W, H));
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], // Back
      [4, 5], [5, 6], [6, 7], [7, 4], // Front
      [0, 4], [1, 5], [2, 6], [3, 7]  // Sides
    ];

    ctx.save();
    ctx.strokeStyle = this.selectedNodeIds.has(node.id) ? '#fcc419' : '#a9e34b';
    ctx.lineWidth = this.selectedNodeIds.has(node.id) ? 2.0 : 1.2;

    for (const [i0, i1] of edges) {
      const p0 = cornersProj[i0];
      const p1 = cornersProj[i1];
      if (p0.inFront || p1.inFront) {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    const centerProj = this.camera.project(new Vector3(0, 0, 0).transformMat4(mat), W, H);
    if (centerProj.inFront) {
      ctx.fillStyle = '#ced4da';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.name, centerProj.x, centerProj.y - 8);
    }

    ctx.restore();
  }

  renderCameraObject(ctx, node, mat, W, H) {
    const pos = new Vector3(0, 0, 0).transformMat4(mat);
    const pCenter = this.camera.project(pos, W, H);
    if (!pCenter.inFront) return;

    ctx.save();

    // Camera body box
    const bodySize = 0.4;
    const frustumLen = 1.5;
    const fov = Number(node.getKnobValue('focal')) || 50;
    const frustumW = Math.max(0.4, 40 / fov);

    const fTL = new Vector3(-frustumW, frustumW * 0.75, -frustumLen).transformMat4(mat);
    const fTR = new Vector3(frustumW, frustumW * 0.75, -frustumLen).transformMat4(mat);
    const fBR = new Vector3(frustumW, -frustumW * 0.75, -frustumLen).transformMat4(mat);
    const fBL = new Vector3(-frustumW, -frustumW * 0.75, -frustumLen).transformMat4(mat);

    const pTL = this.camera.project(fTL, W, H);
    const pTR = this.camera.project(fTR, W, H);
    const pBR = this.camera.project(fBR, W, H);
    const pBL = this.camera.project(fBL, W, H);

    ctx.strokeStyle = this.selectedNodeIds.has(node.id) ? '#fcc419' : '#ff922b';
    ctx.lineWidth = 1.5;

    // Frustum pyramid edges from eye to 4 corners
    const pts = [pTL, pTR, pBR, pBL];
    for (const p of pts) {
      if (p.inFront) {
        ctx.beginPath();
        ctx.moveTo(pCenter.x, pCenter.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Frustum rectangle
    if (pts.every(p => p.inFront)) {
      ctx.beginPath();
      ctx.moveTo(pTL.x, pTL.y);
      ctx.lineTo(pTR.x, pTR.y);
      ctx.lineTo(pBR.x, pBR.y);
      ctx.lineTo(pBL.x, pBL.y);
      ctx.closePath();
      ctx.stroke();
    }

    // Camera Icon & Badge
    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.arc(pCenter.x, pCenter.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ffd8a8';
    ctx.textAlign = 'center';
    ctx.fillText(`🎥 ${node.name}`, pCenter.x, pCenter.y - 10);

    ctx.restore();
  }

  renderAxisObject(ctx, node, mat, W, H) {
    const origin = this.camera.project(new Vector3(0, 0, 0).transformMat4(mat), W, H);
    if (!origin.inFront) return;

    const len = 1.0;
    const pX = this.camera.project(new Vector3(len, 0, 0).transformMat4(mat), W, H);
    const pY = this.camera.project(new Vector3(0, len, 0).transformMat4(mat), W, H);
    const pZ = this.camera.project(new Vector3(0, 0, len).transformMat4(mat), W, H);

    ctx.save();
    ctx.lineWidth = 1.8;

    if (pX.inFront) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pX.x, pX.y);
      ctx.stroke();
    }
    if (pY.inFront) {
      ctx.strokeStyle = '#51cf66';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pY.x, pY.y);
      ctx.stroke();
    }
    if (pZ.inFront) {
      ctx.strokeStyle = '#339af0';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pZ.x, pZ.y);
      ctx.stroke();
    }

    ctx.fillStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, origin.x, origin.y - 8);

    ctx.restore();
  }

  renderProject3DObject(ctx, node, mat, W, H) {
    const origin = this.camera.project(new Vector3(0, 0, 0).transformMat4(mat), W, H);
    if (!origin.inFront) return;

    ctx.save();
    ctx.fillStyle = '#9775fa';
    ctx.strokeStyle = '#b197fc';
    ctx.lineWidth = 1.2;

    // Small projector glyph
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`📽️ ${node.name}`, origin.x, origin.y - 8);
    ctx.restore();
  }

  renderGeneric3DIndicator(ctx, node, mat, W, H) {
    const origin = this.camera.project(new Vector3(0, 0, 0).transformMat4(mat), W, H);
    if (!origin.inFront) return;

    ctx.save();
    ctx.fillStyle = '#adb5bd';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, origin.x, origin.y - 6);
    ctx.restore();
  }

  // --- Selected Object Highlight & Bounds ---

  renderSelectedHighlight(ctx, node, W, H) {
    const b = this.getNodeBounds(node);
    if (!b || !b.corners) return;

    const cornersProj = b.corners.map(c => this.camera.project(c, W, H));
    const edges = [
      [0, 1], [1, 3], [3, 2], [2, 0], // Min Z face
      [4, 5], [5, 7], [7, 6], [6, 4], // Max Z face
      [0, 4], [1, 5], [2, 6], [3, 7]  // Connecting edges
    ];

    ctx.save();
    ctx.strokeStyle = '#fcc419';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 4]);

    for (const [i0, i1] of edges) {
      const p0 = cornersProj[i0];
      const p1 = cornersProj[i1];
      if (p0.inFront || p1.inFront) {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  // --- 3D Transformation Manipulator (Gizmo) ---

  renderManipulator(ctx, node, W, H) {
    const pos = this.getNodeWorldPosition(node);
    const pCenter = this.camera.project(pos, W, H);
    if (!pCenter.inFront) return;

    const mat = this.getNodeWorldMatrix(node);

    // Coordinate space axes
    let axX = new Vector3(1, 0, 0);
    let axY = new Vector3(0, 1, 0);
    let axZ = new Vector3(0, 0, 1);

    if (this.coordSpace === 'local') {
      axX.transformDirection(mat);
      axY.transformDirection(mat);
      axZ.transformDirection(mat);
    }

    const gizmoRadius = 75; // screen pixels
    const gizmoLen3D = (this.distance * 0.12) || 1.8;

    const pX = this.camera.project(pos.clone().add(axX.clone().multiplyScalar(gizmoLen3D)), W, H);
    const pY = this.camera.project(pos.clone().add(axY.clone().multiplyScalar(gizmoLen3D)), W, H);
    const pZ = this.camera.project(pos.clone().add(axZ.clone().multiplyScalar(gizmoLen3D)), W, H);

    ctx.save();

    if (this.gizmoMode === 'translate') {
      this.renderTranslateGizmo(ctx, pCenter, pX, pY, pZ);
    } else if (this.gizmoMode === 'rotate') {
      this.renderRotateGizmo(ctx, pCenter, axX, axY, axZ, pos, W, H);
    } else if (this.gizmoMode === 'scale') {
      this.renderScaleGizmo(ctx, pCenter, pX, pY, pZ);
    }

    ctx.restore();
  }

  renderTranslateGizmo(ctx, pCenter, pX, pY, pZ) {
    const h = this.activeHandle;

    // X Arrow (Red)
    ctx.strokeStyle = h === 'tx' ? '#ffe066' : '#ff6b6b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'tx' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pX.x, pX.y);
    ctx.stroke();
    this.drawArrowHead(ctx, pCenter, pX);

    // Y Arrow (Green)
    ctx.strokeStyle = h === 'ty' ? '#ffe066' : '#51cf66';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'ty' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pY.x, pY.y);
    ctx.stroke();
    this.drawArrowHead(ctx, pCenter, pY);

    // Z Arrow (Blue)
    ctx.strokeStyle = h === 'tz' ? '#ffe066' : '#339af0';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'tz' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pZ.x, pZ.y);
    ctx.stroke();
    this.drawArrowHead(ctx, pCenter, pZ);

    // Center handle (Yellow / White)
    ctx.fillStyle = h === 'tc' ? '#ffe066' : '#ffffff';
    ctx.beginPath();
    ctx.arc(pCenter.x, pCenter.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawArrowHead(ctx, from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = 9;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  renderRotateGizmo(ctx, pCenter, axX, axY, axZ, pos, W, H) {
    const h = this.activeHandle;
    const r = 55; // Screen pixel radius
    const segments = 32;

    // X Rotation Ring (Pitch - Red)
    ctx.strokeStyle = h === 'rx' ? '#ffe066' : 'rgba(255, 107, 107, 0.85)';
    ctx.lineWidth = h === 'rx' ? 3.0 : 2.0;
    this.draw3DCircle(ctx, pos, axX, this.distance * 0.12, W, H);

    // Y Rotation Ring (Yaw - Green)
    ctx.strokeStyle = h === 'ry' ? '#ffe066' : 'rgba(81, 207, 102, 0.85)';
    ctx.lineWidth = h === 'ry' ? 3.0 : 2.0;
    this.draw3DCircle(ctx, pos, axY, this.distance * 0.12, W, H);

    // Z Rotation Ring (Roll - Blue)
    ctx.strokeStyle = h === 'rz' ? '#ffe066' : 'rgba(51, 154, 240, 0.85)';
    ctx.lineWidth = h === 'rz' ? 3.0 : 2.0;
    this.draw3DCircle(ctx, pos, axZ, this.distance * 0.12, W, H);

    // Screen-aligned outer ring
    ctx.strokeStyle = h === 'rscreen' ? '#ffe066' : 'rgba(230, 230, 230, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pCenter.x, pCenter.y, r + 15, 0, Math.PI * 2);
    ctx.stroke();
  }

  draw3DCircle(ctx, center, normal, radius, W, H) {
    // Generate perpendicular basis for the circle plane
    let u = new Vector3(1, 0, 0);
    if (Math.abs(normal.dot(u)) > 0.9) u.set(0, 1, 0);
    const v = Vector3.cross(normal, u).normalize();
    u = Vector3.cross(v, normal).normalize();

    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const pt3D = center.clone()
        .add(u.clone().multiplyScalar(Math.cos(angle) * radius))
        .add(v.clone().multiplyScalar(Math.sin(angle) * radius));
      const ptProj = this.camera.project(pt3D, W, H);
      if (ptProj.inFront) {
        if (first) {
          ctx.moveTo(ptProj.x, ptProj.y);
          first = false;
        } else {
          ctx.lineTo(ptProj.x, ptProj.y);
        }
      }
    }
    ctx.stroke();
  }

  renderScaleGizmo(ctx, pCenter, pX, pY, pZ) {
    const h = this.activeHandle;
    const boxSize = 8;

    // X Scale (Red)
    ctx.strokeStyle = h === 'sx' ? '#ffe066' : '#ff6b6b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'sx' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pX.x, pX.y);
    ctx.stroke();
    ctx.fillRect(pX.x - boxSize * 0.5, pX.y - boxSize * 0.5, boxSize, boxSize);

    // Y Scale (Green)
    ctx.strokeStyle = h === 'sy' ? '#ffe066' : '#51cf66';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'sy' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pY.x, pY.y);
    ctx.stroke();
    ctx.fillRect(pY.x - boxSize * 0.5, pY.y - boxSize * 0.5, boxSize, boxSize);

    // Z Scale (Blue)
    ctx.strokeStyle = h === 'sz' ? '#ffe066' : '#339af0';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = h === 'sz' ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(pCenter.x, pCenter.y);
    ctx.lineTo(pZ.x, pZ.y);
    ctx.stroke();
    ctx.fillRect(pZ.x - boxSize * 0.5, pZ.y - boxSize * 0.5, boxSize, boxSize);

    // Uniform Center Scale (Yellow / White Box)
    ctx.fillStyle = h === 'suniform' ? '#ffe066' : '#ffffff';
    ctx.fillRect(pCenter.x - 5, pCenter.y - 5, 10, 10);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.strokeRect(pCenter.x - 5, pCenter.y - 5, 10, 10);
  }

  // --- Viewport HUD Overlay ---

  renderHUD(ctx, W, H) {
    ctx.save();

    // Top-left 3D Mode Tag
    ctx.fillStyle = 'rgba(20, 22, 26, 0.75)';
    ctx.fillRect(10, 10, 240, 26);
    ctx.strokeStyle = '#ff922b';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 240, 26);

    ctx.fillStyle = '#ff922b';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    const viewLabel = this.activeCameraNodeId ? `CAMERA: ${this.activeCameraNodeId}` : this.viewType.toUpperCase();
    ctx.fillText(`3D VIEW: ${viewLabel} [${this.displayMode.toUpperCase()}]`, 18, 27);

    // Live Delta Coordinates during drag
    if (this.isDraggingGizmo && this.liveDeltaText) {
      ctx.fillStyle = 'rgba(255, 146, 43, 0.9)';
      ctx.fillRect(W * 0.5 - 120, H - 42, 240, 24);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.liveDeltaText, W * 0.5, H - 26);
    }

    ctx.restore();
  }

  // --- Corner Orientation Gizmo (Compass Tripod) ---

  renderOrientationGizmo(ctx, W, H) {
    const cx = W - 45;
    const cy = H - 45;
    const r = 26;

    ctx.save();
    ctx.fillStyle = 'rgba(24, 25, 28, 0.65)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#383b42';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Invert world matrix to get camera orientation
    const vMat = this.camera.getViewMatrix();
    const vX = new Vector3(1, 0, 0).transformDirection(vMat);
    const vY = new Vector3(0, 1, 0).transformDirection(vMat);
    const vZ = new Vector3(0, 0, 1).transformDirection(vMat);

    const axes = [
      { vec: vX, color: '#ff6b6b', label: 'X' },
      { vec: vY, color: '#51cf66', label: 'Y' },
      { vec: vZ, color: '#339af0', label: 'Z' }
    ];

    // Sort by depth (draw back to front)
    axes.sort((a, b) => a.vec.z - b.vec.z);

    ctx.lineWidth = 2.0;
    for (const ax of axes) {
      const px = cx + ax.vec.x * r;
      const py = cy - ax.vec.y * r; // Invert Y for screen coords

      ctx.strokeStyle = ax.color;
      ctx.fillStyle = ax.color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 9px monospace';
      ctx.fillText(ax.label, px + (ax.vec.x >= 0 ? 3 : -8), py + (ax.vec.y >= 0 ? -3 : 8));
    }

    ctx.restore();
  }

  // --- Hit Testing & Manipulation Logic ---

  hitTestGizmo(mouseX, mouseY) {
    if (!this.selectedNode || this.gizmoMode === 'none') return null;

    const W = this.canvas.width;
    const H = this.canvas.height;
    const pos = this.getNodeWorldPosition(this.selectedNode);
    const pCenter = this.camera.project(pos, W, H);
    if (!pCenter.inFront) return null;

    const mat = this.getNodeWorldMatrix(this.selectedNode);
    let axX = new Vector3(1, 0, 0);
    let axY = new Vector3(0, 1, 0);
    let axZ = new Vector3(0, 0, 1);

    if (this.coordSpace === 'local') {
      axX.transformDirection(mat);
      axY.transformDirection(mat);
      axZ.transformDirection(mat);
    }

    const gizmoLen3D = (this.distance * 0.12) || 1.8;
    const pX = this.camera.project(pos.clone().add(axX.clone().multiplyScalar(gizmoLen3D)), W, H);
    const pY = this.camera.project(pos.clone().add(axY.clone().multiplyScalar(gizmoLen3D)), W, H);
    const pZ = this.camera.project(pos.clone().add(axZ.clone().multiplyScalar(gizmoLen3D)), W, H);

    const hitThreshold = 10;

    // Center handle
    const distCenter = Math.hypot(mouseX - pCenter.x, mouseY - pCenter.y);
    if (distCenter <= hitThreshold) {
      return this.gizmoMode === 'scale' ? 'suniform' : 'tc';
    }

    // Translate arrows
    if (this.gizmoMode === 'translate') {
      if (this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pX.x, pX.y) <= hitThreshold) return 'tx';
      if (this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pY.x, pY.y) <= hitThreshold) return 'ty';
      if (this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pZ.x, pZ.y) <= hitThreshold) return 'tz';
    }

    // Scale axes
    if (this.gizmoMode === 'scale') {
      if (Math.hypot(mouseX - pX.x, mouseY - pX.y) <= hitThreshold || this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pX.x, pX.y) <= hitThreshold) return 'sx';
      if (Math.hypot(mouseX - pY.x, mouseY - pY.y) <= hitThreshold || this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pY.x, pY.y) <= hitThreshold) return 'sy';
      if (Math.hypot(mouseX - pZ.x, mouseY - pZ.y) <= hitThreshold || this.distanceToSegment(mouseX, mouseY, pCenter.x, pCenter.y, pZ.x, pZ.y) <= hitThreshold) return 'sz';
    }

    // Rotate rings
    if (this.gizmoMode === 'rotate') {
      const distFromCenter = Math.hypot(mouseX - pCenter.x, mouseY - pCenter.y);
      if (Math.abs(distFromCenter - 70) <= hitThreshold) return 'rscreen';
      if (Math.abs(distFromCenter - 55) <= hitThreshold) {
        // Approximate ring quadrant
        const angle = Math.atan2(mouseY - pCenter.y, mouseX - pCenter.x);
        if (Math.abs(Math.sin(angle)) > 0.7) return 'rx';
        if (Math.abs(Math.cos(angle)) > 0.7) return 'ry';
        return 'rz';
      }
    }

    return null;
  }

  distanceToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  hitTestObject(mouseX, mouseY) {
    const nodes = this.get3DNodes();
    const W = this.canvas.width;
    const H = this.canvas.height;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node._viewer3dVisible === false) continue;
      const pos = this.getNodeWorldPosition(node);
      const proj = this.camera.project(pos, W, H);
      if (proj.inFront && Math.hypot(mouseX - proj.x, mouseY - proj.y) <= 20) {
        return node;
      }
    }
    return null;
  }

  // --- Mouse & Keyboard Event Handlers ---

  onMouseDown(e) {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 1. Check Gizmo manipulation
    const handle = this.hitTestGizmo(mouseX, mouseY);
    if (handle && e.button === 0 && !e.altKey && !e.spaceKey) {
      this.isDraggingGizmo = true;
      this.activeHandle = handle;
      this.dragStartMouse = { x: mouseX, y: mouseY };

      const node = this.selectedNode;
      this.dragInitialTransform = {
        tx: Number(node.getKnobValue('translateX', { frame: this.currentFrame })) || 0.0,
        ty: Number(node.getKnobValue('translateY', { frame: this.currentFrame })) || 0.0,
        tz: Number(node.getKnobValue('translateZ', { frame: this.currentFrame })) || 0.0,
        rx: Number(node.getKnobValue('rotateX', { frame: this.currentFrame })) || 0.0,
        ry: Number(node.getKnobValue('rotateY', { frame: this.currentFrame })) || 0.0,
        rz: Number(node.getKnobValue('rotateZ', { frame: this.currentFrame })) || 0.0,
        uniformScale: Number(node.getKnobValue('uniformScale', { frame: this.currentFrame })) || 1.0,
        sx: Number(node.getKnobValue('scaleX', { frame: this.currentFrame })) || 1.0,
        sy: Number(node.getKnobValue('scaleY', { frame: this.currentFrame })) || 1.0,
        sz: Number(node.getKnobValue('scaleZ', { frame: this.currentFrame })) || 1.0
      };
      return true;
    }

    // 2. Navigation (Alt + Mouse buttons or Middle mouse)
    if (e.altKey || e.button === 1 || e.button === 2) {
      this.isNavigating = true;
      this.lastMouseX = mouseX;
      this.lastMouseY = mouseY;

      if (e.button === 1 || (e.altKey && e.button === 0 && e.shiftKey)) {
        this.navMode = 'pan';
      } else if (e.button === 2 || (e.altKey && e.button === 2)) {
        this.navMode = 'dolly';
      } else {
        this.navMode = 'orbit';
      }
      return true;
    }

    // 3. Object Selection
    if (e.button === 0) {
      const hit = this.hitTestObject(mouseX, mouseY);
      if (hit) {
        this.setSelectedNode(hit);
        if (this.onNodeSelect) this.onNodeSelect(hit);
        return true;
      }
    }

    return false;
  }

  onMouseMove(e) {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // A. Dragging Gizmo
    if (this.isDraggingGizmo && this.selectedNode && this.dragInitialTransform) {
      const dx = mouseX - this.dragStartMouse.x;
      const dy = mouseY - this.dragStartMouse.y;
      const scaleSens = 0.04;
      const transSens = (this.distance * 0.003) || 0.05;
      const rotSens = 0.8;

      const node = this.selectedNode;
      const init = this.dragInitialTransform;

      if (this.activeHandle === 'tx') {
        const delta = dx * transSens;
        node.setKnobValue('translateX', Number((init.tx + delta).toFixed(3)));
        this.liveDeltaText = `ΔX: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} | Pos: (${(init.tx + delta).toFixed(2)}, ${init.ty.toFixed(2)}, ${init.tz.toFixed(2)})`;
      } else if (this.activeHandle === 'ty') {
        const delta = -dy * transSens;
        node.setKnobValue('translateY', Number((init.ty + delta).toFixed(3)));
        this.liveDeltaText = `ΔY: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} | Pos: (${init.tx.toFixed(2)}, ${(init.ty + delta).toFixed(2)}, ${init.tz.toFixed(2)})`;
      } else if (this.activeHandle === 'tz') {
        const delta = (dx + dy) * 0.7 * transSens;
        node.setKnobValue('translateZ', Number((init.tz + delta).toFixed(3)));
        this.liveDeltaText = `ΔZ: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} | Pos: (${init.tx.toFixed(2)}, ${init.ty.toFixed(2)}, ${(init.tz + delta).toFixed(2)})`;
      } else if (this.activeHandle === 'tc') {
        const dX = dx * transSens;
        const dY = -dy * transSens;
        node.setKnobValue('translateX', Number((init.tx + dX).toFixed(3)));
        node.setKnobValue('translateY', Number((init.ty + dY).toFixed(3)));
        this.liveDeltaText = `ΔScreen: (${dX.toFixed(2)}, ${dY.toFixed(2)})`;
      } else if (this.activeHandle === 'rx') {
        const delta = dy * rotSens;
        node.setKnobValue('rotateX', Number((init.rx + delta).toFixed(2)));
        this.liveDeltaText = `Rotate X: ${(init.rx + delta).toFixed(1)}°`;
      } else if (this.activeHandle === 'ry') {
        const delta = dx * rotSens;
        node.setKnobValue('rotateY', Number((init.ry + delta).toFixed(2)));
        this.liveDeltaText = `Rotate Y: ${(init.ry + delta).toFixed(1)}°`;
      } else if (this.activeHandle === 'rz' || this.activeHandle === 'rscreen') {
        const delta = dx * rotSens;
        node.setKnobValue('rotateZ', Number((init.rz + delta).toFixed(2)));
        this.liveDeltaText = `Rotate Z: ${(init.rz + delta).toFixed(1)}°`;
      } else if (this.activeHandle === 'suniform') {
        const factor = Math.max(0.01, 1.0 + (dx - dy) * 0.01);
        node.setKnobValue('uniformScale', Number((init.uniformScale * factor).toFixed(3)));
        this.liveDeltaText = `Scale: ${(init.uniformScale * factor).toFixed(2)}x`;
      } else if (this.activeHandle === 'sx') {
        const factor = Math.max(0.01, 1.0 + dx * 0.01);
        if (node.hasKnob && node.hasKnob('scaleX')) node.setKnobValue('scaleX', Number((init.sx * factor).toFixed(3)));
        else node.setKnobValue('uniformScale', Number((init.uniformScale * factor).toFixed(3)));
        this.liveDeltaText = `Scale X: ${(init.sx * factor).toFixed(2)}x`;
      } else if (this.activeHandle === 'sy') {
        const factor = Math.max(0.01, 1.0 - dy * 0.01);
        if (node.hasKnob && node.hasKnob('scaleY')) node.setKnobValue('scaleY', Number((init.sy * factor).toFixed(3)));
        this.liveDeltaText = `Scale Y: ${(init.sy * factor).toFixed(2)}x`;
      } else if (this.activeHandle === 'sz') {
        const factor = Math.max(0.01, 1.0 + (dx + dy) * 0.007);
        if (node.hasKnob && node.hasKnob('scaleZ')) node.setKnobValue('scaleZ', Number((init.sz * factor).toFixed(3)));
        this.liveDeltaText = `Scale Z: ${(init.sz * factor).toFixed(2)}x`;
      }

      node.markDirty();
      if (this.onParamChange) this.onParamChange(node);
      return true;
    }

    // B. Navigation Drag
    if (this.isNavigating) {
      const deltaX = mouseX - this.lastMouseX;
      const deltaY = mouseY - this.lastMouseY;
      this.lastMouseX = mouseX;
      this.lastMouseY = mouseY;

      if (this.navMode === 'orbit') {
        if (this.viewType === 'perspective') {
          this.azimuth -= deltaX * 0.008;
          this.elevation = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, this.elevation + deltaY * 0.008));
        }
      } else if (this.navMode === 'pan') {
        const panSpeed = (this.distance * 0.002) || 0.03;
        // Pan perpendicular to look vector
        const lookDir = new Vector3(
          Math.cos(this.elevation) * Math.sin(this.azimuth),
          Math.sin(this.elevation),
          Math.cos(this.elevation) * Math.cos(this.azimuth)
        ).normalize();
        const up = new Vector3(0, 1, 0);
        const right = Vector3.cross(lookDir, up).normalize();
        const panUp = Vector3.cross(right, lookDir).normalize();

        this.target.add(right.multiplyScalar(-deltaX * panSpeed));
        this.target.add(panUp.multiplyScalar(deltaY * panSpeed));
      } else if (this.navMode === 'dolly') {
        this.distance = Math.max(0.1, this.distance * (1.0 + deltaY * 0.01));
        this.orthoSize = Math.max(0.1, this.orthoSize * (1.0 + deltaY * 0.01));
      }

      // If Lock Camera to View is active, write updated transform to Camera3DNode
      if (this.lockCameraToView && this.activeCameraNodeId && this.graph) {
        const camNode = this.graph.getNode(this.activeCameraNodeId);
        if (camNode) {
          const eyeX = this.target.x + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
          const eyeY = this.target.y + this.distance * Math.sin(this.elevation);
          const eyeZ = this.target.z + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);
          camNode.setKnobValue('translateX', Number(eyeX.toFixed(3)));
          camNode.setKnobValue('translateY', Number(eyeY.toFixed(3)));
          camNode.setKnobValue('translateZ', Number(eyeZ.toFixed(3)));
          camNode.markDirty();
          if (this.onParamChange) this.onParamChange(camNode);
        }
      }

      return true;
    }

    // C. Hover highlight
    const handle = this.hitTestGizmo(mouseX, mouseY);
    if (handle !== this.activeHandle) {
      this.activeHandle = handle;
      return true;
    }

    return false;
  }

  onMouseUp(e) {
    let changed = false;
    if (this.isDraggingGizmo) {
      this.isDraggingGizmo = false;
      this.activeHandle = null;
      this.dragInitialTransform = null;
      this.liveDeltaText = '';
      changed = true;
    }
    if (this.isNavigating) {
      this.isNavigating = false;
      this.navMode = null;
      changed = true;
    }
    return changed;
  }

  onWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.88 : 1.14;
    this.distance = Math.max(0.2, Math.min(500.0, this.distance * zoomFactor));
    this.orthoSize = Math.max(0.2, Math.min(500.0, this.orthoSize * zoomFactor));
    return true;
  }

  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      return false;
    }

    if (e.key === 'w' || e.key === 'W') {
      this.setGizmoMode('translate');
      return true;
    }
    if (e.key === 'e' || e.key === 'E') {
      this.setGizmoMode('rotate');
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.setGizmoMode('scale');
      return true;
    }
    if (e.key === 'f' || e.key === 'F') {
      this.frameSelected();
      return true;
    }
    if (e.key === 'a' || e.key === 'A') {
      this.frameAll();
      return true;
    }
    if (e.key === 'Home') {
      this.resetView();
      return true;
    }
    return false;
  }

  // --- Persistence ---

  savePreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const prefs = {
        viewType: this.viewType,
        displayMode: this.displayMode,
        gizmoMode: this.gizmoMode,
        coordSpace: this.coordSpace,
        showGrid: this.showGrid
      };
      localStorage.setItem('opencomp_viewer_3d_prefs_v1', JSON.stringify(prefs));
    } catch (e) { }
  }

  loadPreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem('opencomp_viewer_3d_prefs_v1');
      if (!saved) return;
      const prefs = JSON.parse(saved);
      if (prefs.viewType) this.viewType = prefs.viewType;
      if (prefs.displayMode) this.displayMode = prefs.displayMode;
      if (prefs.gizmoMode) this.gizmoMode = prefs.gizmoMode;
      if (prefs.coordSpace) this.coordSpace = prefs.coordSpace;
      if (prefs.showGrid !== undefined) this.showGrid = prefs.showGrid;
    } catch (e) { }
  }
}

