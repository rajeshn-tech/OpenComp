/**
 * OpenComp - Particle System Interface (Preview & Architecture Layout)
 * Professional Nuke-Style Particle Compositing Panel Layout:
 * - Particle system tree (Emitters, Forces, Spawners, Modifiers, Renderers)
 * - Interactive Particle Preview Viewport with coordinate guides & emitter cone wireframe
 * - Inspector panels: Emission rate, lifetime, velocity, spread, particle size, start/end color
 * - Dynamics parameter groups: Gravity, Wind, Drag, Turbulence, Collision elasticity
 * - Timeline simulation cache indicator and frame stepping controls
 *
 * IMPORTANT NOTICE:
 * OpenComp does not yet have an active particle processing or simulation engine.
 * No particle simulation, emitter algorithms, or physics dynamics are fabricated.
 * All preview controls are explicitly marked as (Preview / Non-Functional).
 */

export class ParticlesUI {
  constructor(containerElement, timelineUI = null) {
    this.container = containerElement;
    this.timelineUI = timelineUI;

    this.activeSystemId = 'pEmitter1';
    this.currentFrame = 1;

    // Interface mockup parameters (Non-functional simulation preview)
    this.particleConfig = {
      emissionRate: 50,
      lifetime: 60,
      velocity: 3.5,
      spread: 25.0,
      size: 2.0,
      startColor: '#ff922b',
      endColor: '#ff6b6b',
      gravity: -9.81,
      windSpeed: 0.0,
      drag: 0.05,
      turbulence: 0.0,
      seed: 1234
    };

    this.initDOM();
  }

  setFrame(frame) {
    this.currentFrame = frame;
    this.updateTimelineDisplay();
  }

  initDOM() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="particles-workspace-wrapper">
        <!-- Mandatory Statutory Disclosure Banner -->
        <div class="particles-disclosure-banner">
          ⚠️ <strong>Particle Workflow Interface Preview</strong>: Particle simulation and dynamics engine not yet implemented. All simulation controls are non-functional mockups.
        </div>

        <div class="particles-body">
          <!-- Left: Particle System Hierarchy -->
          <div class="particles-sidebar">
            <div class="particles-sidebar-header">
              <span>Particle Systems</span>
              <button class="btn-tool-sm" title="Add Particle Operator (Disabled)" disabled>+ Add</button>
            </div>
            <div class="particles-tree">
              <div class="p-tree-category">EMITTERS</div>
              <div class="p-tree-item active" data-system-id="pEmitter1">
                <span class="p-item-icon">✨</span>
                <span class="p-item-name">pEmitter1 (Point)</span>
                <span class="p-badge-preview">Preview</span>
              </div>
              <div class="p-tree-item" data-system-id="pDirectionalEmitter1">
                <span class="p-item-icon">🌟</span>
                <span class="p-item-name">pDirectionalEmitter1</span>
                <span class="p-badge-preview">Preview</span>
              </div>

              <div class="p-tree-category">FORCES & DYNAMICS</div>
              <div class="p-tree-item" data-system-id="pGravity1">
                <span class="p-item-icon">⬇️</span>
                <span class="p-item-name">pGravity1</span>
                <span class="p-badge-preview">Preview</span>
              </div>
              <div class="p-tree-item" data-system-id="pWind1">
                <span class="p-item-icon">💨</span>
                <span class="p-item-name">pWind1</span>
                <span class="p-badge-preview">Preview</span>
              </div>
              <div class="p-tree-item" data-system-id="pDrag1">
                <span class="p-item-icon">🛑</span>
                <span class="p-item-name">pDrag1</span>
                <span class="p-badge-preview">Preview</span>
              </div>
              <div class="p-tree-item" data-system-id="pTurbulence1">
                <span class="p-item-icon">🌀</span>
                <span class="p-item-name">pTurbulence1</span>
                <span class="p-badge-preview">Preview</span>
              </div>

              <div class="p-tree-category">RENDER & OUTPUT</div>
              <div class="p-tree-item" data-system-id="pRender1">
                <span class="p-item-icon">🎨</span>
                <span class="p-item-name">pRender1 (Sprites)</span>
                <span class="p-badge-preview">Preview</span>
              </div>
            </div>
          </div>

          <!-- Center: Interactive Preview Canvas -->
          <div class="particles-preview-area">
            <div class="particles-preview-toolbar">
              <span class="p-view-title">Particle Preview (2D/3D Wireframe Guide)</span>
              <div class="particles-transport">
                <button class="btn-tool-sm" id="btn-p-sim-step" title="Simulation Step (Preview)" disabled>Step ⏭</button>
                <button class="btn-tool-sm" id="btn-p-sim-clear" title="Clear Simulation Cache (Preview)" disabled>Clear ✕</button>
              </div>
            </div>
            <div class="particles-canvas-wrap">
              <canvas id="particles-preview-canvas" width="480" height="320"></canvas>
            </div>
            <div class="particles-status-bar">
              <span>Status: <b style="color:#adb5bd;">Engine Offline (UI Shell)</b></span>
              <span>Active Particles: <b style="color:#adb5bd;">0</b></span>
              <span>Frame: <b id="particles-frame-display">${this.currentFrame}</b></span>
            </div>
          </div>

          <!-- Right: Particle Parameter Inspector -->
          <div class="particles-inspector">
            <div class="particles-inspector-header">
              <span id="particles-inspector-title">Properties: pEmitter1</span>
              <span class="badge-mockup">Preview Only</span>
            </div>

            <div class="particles-inspector-content">
              <div class="p-group-title">EMISSION CONTROLS (NON-FUNCTIONAL)</div>
              
              <div class="p-prop-row">
                <label>Emission Rate (/s)</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.emissionRate}" disabled />
                <span class="p-unit">pts</span>
              </div>

              <div class="p-prop-row">
                <label>Lifetime (Frames)</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.lifetime}" disabled />
                <span class="p-unit">fr</span>
              </div>

              <div class="p-prop-row">
                <label>Velocity (m/s)</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.velocity}" step="0.1" disabled />
                <span class="p-unit">m/s</span>
              </div>

              <div class="p-prop-row">
                <label>Spread Angle</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.spread}" step="1" disabled />
                <span class="p-unit">deg</span>
              </div>

              <div class="p-prop-row">
                <label>Particle Size</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.size}" step="0.1" disabled />
                <span class="p-unit">px</span>
              </div>

              <div class="p-group-title">FORCES & DYNAMICS (NON-FUNCTIONAL)</div>

              <div class="p-prop-row">
                <label>Gravity Vector Y</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.gravity}" step="0.1" disabled />
                <span class="p-unit">m/s²</span>
              </div>

              <div class="p-prop-row">
                <label>Wind Speed X</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.windSpeed}" step="0.1" disabled />
                <span class="p-unit">m/s</span>
              </div>

              <div class="p-prop-row">
                <label>Air Drag</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.drag}" step="0.01" disabled />
              </div>

              <div class="p-prop-row">
                <label>Turbulence</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.turbulence}" step="0.1" disabled />
              </div>

              <div class="p-group-title">COLOR & SHADING (NON-FUNCTIONAL)</div>

              <div class="p-prop-row">
                <label>Start Color</label>
                <input type="color" value="${this.particleConfig.startColor}" disabled />
              </div>

              <div class="p-prop-row">
                <label>End Color</label>
                <input type="color" value="${this.particleConfig.endColor}" disabled />
              </div>

              <div class="p-prop-row">
                <label>Random Seed</label>
                <input type="number" class="p-input-num" value="${this.particleConfig.seed}" disabled />
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initCanvasPreview();
  }

  initCanvasPreview() {
    const canvas = this.container ? this.container.querySelector('#particles-preview-canvas') : null;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#18191c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw emitter wireframe guide cone
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.75;

    ctx.save();
    // Grid floor lines
    ctx.strokeStyle = '#2d3038';
    ctx.lineWidth = 1;
    for (let x = -150; x <= 150; x += 30) {
      ctx.beginPath();
      ctx.moveTo(cx + x * 1.5, cy + 40);
      ctx.lineTo(cx + x * 0.5, cy - 20);
      ctx.stroke();
    }

    // Emitter origin point
    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Direction vector & spread cone
    const coneLen = 100;
    const spreadRad = (this.particleConfig.spread * Math.PI) / 180.0;
    const leftX = cx - Math.sin(spreadRad) * coneLen;
    const leftY = cy - Math.cos(spreadRad) * coneLen;
    const rightX = cx + Math.sin(spreadRad) * coneLen;
    const rightY = cy - Math.cos(spreadRad) * coneLen;

    ctx.strokeStyle = '#ff922b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(leftX, leftY);
    ctx.moveTo(cx, cy);
    ctx.lineTo(rightX, rightY);
    ctx.stroke();

    // Arc between spread rays
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, coneLen, -Math.PI / 2 - spreadRad, -Math.PI / 2 + spreadRad);
    ctx.stroke();

    // Guide watermark
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EMITTER SPREAD CONE (GUIDE ONLY)', cx, cy + 30);

    ctx.restore();
  }

  updateTimelineDisplay() {
    const frameDisp = this.container ? this.container.querySelector('#particles-frame-display') : null;
    if (frameDisp) {
      frameDisp.textContent = this.currentFrame;
    }
  }
}

