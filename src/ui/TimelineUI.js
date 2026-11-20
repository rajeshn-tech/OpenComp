/**
 * OpenComp - Professional Timeline & Dope Sheet Playback UI
 * Comprehensive Nuke-style timeline with frame ruler, sub-frame/frame ticks,
 * current-frame playhead, In/Out boundary markers, Loop/Bounce/Once playback modes,
 * variable FPS, ruler zoom/pan, multi-track keyframe indicators, context menus, and shortcuts.
 */

export class TimelineUI {
  /**
   * @param {HTMLElement} containerElement
   * @param {function(number): void} onFrameChange
   */
  constructor(containerElement, onFrameChange) {
    this.container = containerElement;
    this.onFrameChange = onFrameChange;

    this.currentFrame = 1;
    this.startFrame = 1;
    this.endFrame = 100;
    this.inPoint = 1;
    this.outPoint = 100;
    this.fps = 24;
    this.isPlaying = false;
    this.playDirection = 1; // 1 = forward, -1 = reverse (for Bounce)
    this.playTimer = null;
    this.playbackMode = 'loop'; // 'loop' | 'bounce' | 'once'

    /** @type {Set<number>} Keyframe positions */
    this.keyframes = new Set();
    /** @type {Map<string, Set<number>>} Multi-track keyframes: trackName -> Set(frames) */
    this.trackKeyframes = new Map();

    // Ruler Viewport (Zoom and Pan)
    this.zoom = 1.0;
    this.panOffset = 0;
    this.isDraggingPlayhead = false;
    this.isPanningRuler = false;
    this.lastMouseX = 0;

    this.render();
  }

  // --- Frame Navigation API ---

  setFrame(frame) {
    const f = Math.max(this.startFrame, Math.min(this.endFrame, Math.round(frame)));
    if (this.currentFrame === f) return;
    this.currentFrame = f;
    this.updateDisplay();
    this.drawRuler();
    if (this.onFrameChange) this.onFrameChange(this.currentFrame);
  }

  setFrameRange(start, end) {
    this.startFrame = Number(start);
    this.endFrame = Number(end);
    if (this.inPoint < this.startFrame) this.inPoint = this.startFrame;
    if (this.outPoint > this.endFrame) this.outPoint = this.endFrame;

    const scrubber = this.container.querySelector('#timeline-scrubber');
    if (scrubber) {
      scrubber.min = this.startFrame;
      scrubber.max = this.endFrame;
    }
    const startInput = this.container.querySelector('#timeline-start-frame');
    if (startInput) startInput.value = this.startFrame;
    const endInput = this.container.querySelector('#timeline-end-frame');
    if (endInput) endInput.value = this.endFrame;
    const inInput = this.container.querySelector('#timeline-in-frame');
    if (inInput) inInput.value = this.inPoint;
    const outInput = this.container.querySelector('#timeline-out-frame');
    if (outInput) outInput.value = this.outPoint;

    this.renderKeyframeTicks();
    this.updateDisplay();
    this.drawRuler();
  }

  setInPoint(frame) {
    this.inPoint = Math.max(this.startFrame, Math.min(this.outPoint, Math.round(frame)));
    const inInput = this.container.querySelector('#timeline-in-frame');
    if (inInput) inInput.value = this.inPoint;
    this.drawRuler();
    this.renderKeyframeTicks();
  }

  setOutPoint(frame) {
    this.outPoint = Math.min(this.endFrame, Math.max(this.inPoint, Math.round(frame)));
    const outInput = this.container.querySelector('#timeline-out-frame');
    if (outInput) outInput.value = this.outPoint;
    this.drawRuler();
    this.renderKeyframeTicks();
  }

  clearInOut() {
    this.inPoint = this.startFrame;
    this.outPoint = this.endFrame;
    const inInput = this.container.querySelector('#timeline-in-frame');
    if (inInput) inInput.value = this.inPoint;
    const outInput = this.container.querySelector('#timeline-out-frame');
    if (outInput) outInput.value = this.outPoint;
    this.drawRuler();
    this.renderKeyframeTicks();
  }

  jumpToIn() {
    this.setFrame(this.inPoint);
  }

  jumpToOut() {
    this.setFrame(this.outPoint);
  }

  setPlaybackMode(mode) {
    if (['loop', 'bounce', 'once'].includes(mode)) {
      this.playbackMode = mode;
      const btn = this.container.querySelector('#timeline-playback-mode');
      if (btn) {
        btn.textContent = mode.toUpperCase();
        btn.title = `Playback Mode: ${mode.toUpperCase()} (Click to cycle)`;
      }
    }
  }

  cyclePlaybackMode() {
    const modes = ['loop', 'bounce', 'once'];
    const nextIdx = (modes.indexOf(this.playbackMode) + 1) % modes.length;
    this.setPlaybackMode(modes[nextIdx]);
  }

  setFPS(fps) {
    this.fps = Math.max(1, Number(fps) || 24);
    const fpsInput = this.container.querySelector('#timeline-fps-val');
    if (fpsInput) fpsInput.textContent = String(this.fps);
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  setKeyframes(frames) {
    this.keyframes = new Set(frames);
    this.renderKeyframeTicks();
    this.drawRuler();
  }

  setTrackKeyframes(trackName, frames) {
    this.trackKeyframes.set(trackName, new Set(frames));
    const all = new Set();
    for (const s of this.trackKeyframes.values()) {
      for (const f of s) all.add(f);
    }
    this.keyframes = all;
    this.renderKeyframeTicks();
    this.drawRuler();
  }

  jumpPrevKey() {
    const sorted = Array.from(this.keyframes).sort((a, b) => a - b);
    const prev = sorted.filter(f => f < this.currentFrame).pop();
    if (prev !== undefined) this.setFrame(prev);
    else this.setFrame(this.inPoint);
  }

  jumpNextKey() {
    const sorted = Array.from(this.keyframes).sort((a, b) => a - b);
    const next = sorted.find(f => f > this.currentFrame);
    if (next !== undefined) this.setFrame(next);
    else this.setFrame(this.outPoint);
  }

  step(delta) {
    this.setFrame(this.currentFrame + delta);
  }

  // --- Transport Controls ---

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    const playBtn = this.container.querySelector('#btn-play');
    if (playBtn) playBtn.textContent = '⏸ Pause';

    this.playTimer = setInterval(() => {
      let nextFrame = this.currentFrame + this.playDirection;

      if (this.playbackMode === 'bounce') {
        if (nextFrame >= this.outPoint) {
          nextFrame = this.outPoint;
          this.playDirection = -1;
        } else if (nextFrame <= this.inPoint) {
          nextFrame = this.inPoint;
          this.playDirection = 1;
        }
      } else if (this.playbackMode === 'once') {
        if (nextFrame > this.outPoint) {
          this.pause();
          return;
        }
      } else {
        // 'loop'
        if (nextFrame > this.outPoint) {
          nextFrame = this.inPoint;
        } else if (nextFrame < this.inPoint) {
          nextFrame = this.outPoint;
        }
      }

      this.setFrame(nextFrame);
    }, 1000 / this.fps);
  }

  pause() {
    this.isPlaying = false;
    clearInterval(this.playTimer);
    const playBtn = this.container.querySelector('#btn-play');
    if (playBtn) playBtn.textContent = '▶ Play';
  }

  stop() {
    this.pause();
    this.playDirection = 1;
    this.setFrame(this.inPoint);
  }

  updateDisplay() {
    const curInput = this.container.querySelector('#timeline-cur-frame');
    const scrubber = this.container.querySelector('#timeline-scrubber');
    if (curInput) curInput.value = this.currentFrame;
    if (scrubber) scrubber.value = this.currentFrame;
  }

  renderKeyframeTicks() {
    const tickTrack = this.container.querySelector('#timeline-keyframe-track');
    if (!tickTrack) return;
    tickTrack.innerHTML = '';

    const range = Math.max(1, this.endFrame - this.startFrame);
    for (const kf of this.keyframes) {
      if (kf >= this.startFrame && kf <= this.endFrame) {
        const pct = ((kf - this.startFrame) / range) * 100;
        const tick = document.createElement('div');
        tick.className = 'timeline-key-tick';
        tick.style.left = `${pct}%`;
        tick.title = `Keyframe at frame ${kf}`;
        tick.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFrame(kf);
        });
        tickTrack.appendChild(tick);
      }
    }
  }

  // --- Canvas Frame Ruler ---

  drawRuler() {
    const canvas = this.container.querySelector('#timeline-ruler-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, w, h);

    const totalSpan = Math.max(1, this.endFrame - this.startFrame);
    const frameToX = (f) => {
      const u = (f - this.startFrame) / totalSpan;
      return u * w;
    };

    // Draw In/Out active range highlight
    const inX = frameToX(this.inPoint);
    const outX = frameToX(this.outPoint);

    ctx.fillStyle = 'rgba(74, 144, 226, 0.15)';
    ctx.fillRect(inX, 0, Math.max(1, outX - inX), h);

    // In point boundary flag
    ctx.fillStyle = '#4a90e2';
    ctx.beginPath();
    ctx.moveTo(inX, 0);
    ctx.lineTo(inX + 5, 0);
    ctx.lineTo(inX + 5, 10);
    ctx.lineTo(inX, 15);
    ctx.fill();

    // Out point boundary flag
    ctx.beginPath();
    ctx.moveTo(outX, 0);
    ctx.lineTo(outX - 5, 0);
    ctx.lineTo(outX - 5, 10);
    ctx.lineTo(outX, 15);
    ctx.fill();

    // Ticks & labels
    let step = 10;
    if (totalSpan > 500) step = 50;
    else if (totalSpan > 200) step = 25;
    else if (totalSpan < 30) step = 5;
    else if (totalSpan < 15) step = 1;

    ctx.strokeStyle = '#444';
    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    const firstTick = Math.ceil(this.startFrame / step) * step;
    for (let f = firstTick; f <= this.endFrame; f += step) {
      const x = frameToX(f);
      ctx.beginPath();
      ctx.moveTo(x, h - 10);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillText(String(f), x, h - 12);
    }

    // Minor ticks
    if (step > 1) {
      ctx.strokeStyle = '#2d2d2d';
      for (let f = this.startFrame; f <= this.endFrame; f++) {
        if (f % step !== 0) {
          const x = frameToX(f);
          ctx.beginPath();
          ctx.moveTo(x, h - 5);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    }

    // Keyframe tick dots on ruler
    ctx.fillStyle = '#ff922b';
    for (const kf of this.keyframes) {
      if (kf >= this.startFrame && kf <= this.endFrame) {
        const kx = frameToX(kf);
        ctx.beginPath();
        ctx.arc(kx, 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playhead line
    const curX = frameToX(this.currentFrame);
    ctx.strokeStyle = '#ff922b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(curX, 0);
    ctx.lineTo(curX, h);
    ctx.stroke();

    // Playhead head marker
    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.moveTo(curX - 4, 0);
    ctx.lineTo(curX + 4, 0);
    ctx.lineTo(curX + 4, 6);
    ctx.lineTo(curX, 10);
    ctx.lineTo(curX - 4, 6);
    ctx.fill();
  }

  // --- Context Menu ---

  showContextMenu(e) {
    e.preventDefault();
    const existing = document.getElementById('timeline-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'timeline-context-menu';
    menu.className = 'custom-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY - 120}px`;

    const addItem = (label, shortcut, action) => {
      const item = document.createElement('div');
      item.className = 'context-menu-item';
      item.innerHTML = `<span>${label}</span><span class="context-menu-shortcut">${shortcut}</span>`;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        action();
        menu.remove();
      });
      menu.appendChild(item);
    };

    addItem(`Set In Point [${this.currentFrame}]`, 'I', () => this.setInPoint(this.currentFrame));
    addItem(`Set Out Point [${this.currentFrame}]`, 'O', () => this.setOutPoint(this.currentFrame));
    addItem('Clear In/Out Points', 'Alt+I', () => this.clearInOut());

    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);

    addItem('Mode: Loop', '', () => this.setPlaybackMode('loop'));
    addItem('Mode: Bounce (Ping-Pong)', '', () => this.setPlaybackMode('bounce'));
    addItem('Mode: Once (Stop at End)', '', () => this.setPlaybackMode('once'));

    document.body.appendChild(menu);

    const onDismiss = () => {
      menu.remove();
      window.removeEventListener('click', onDismiss);
    };
    window.addEventListener('click', onDismiss);
  }

  // --- Layout Render ---

  render() {
    this.container.innerHTML = `
      <div class="timeline-controls">
        <!-- Transport Buttons -->
        <button id="btn-first" class="btn-tool" title="First Frame (|◀)">|◀</button>
        <button id="btn-jump-in" class="btn-tool" title="Jump to In Point (Alt+Home)">|◄</button>
        <button id="btn-prev-10" class="btn-tool" title="Step Back 10 Frames (Shift+,)">◀◀</button>
        <button id="btn-prev-key" class="btn-tool" title="Previous Keyframe (Alt+◀)">◆◀</button>
        <button id="btn-prev" class="btn-tool" title="Step Back (,)">◀</button>
        <button id="btn-play" class="btn-tool btn-play" title="Play / Pause (Space)">▶ Play</button>
        <button id="btn-stop" class="btn-tool" title="Stop (K)">⏹ Stop</button>
        <button id="btn-next" class="btn-tool" title="Step Forward (.)">▶</button>
        <button id="btn-next-key" class="btn-tool" title="Next Keyframe (Alt+▶)">▶◆</button>
        <button id="btn-next-10" class="btn-tool" title="Step Forward 10 Frames (Shift+.)">▶▶</button>
        <button id="btn-jump-out" class="btn-tool" title="Jump to Out Point (Alt+End)">►|</button>
        <button id="btn-last" class="btn-tool" title="Last Frame (▶|)">▶|</button>

        <!-- Frame Range & Navigation Inputs -->
        <div class="timeline-frame-boxes">
          <label title="Sequence Global Start Frame">S: <input type="number" id="timeline-start-frame" value="${this.startFrame}" class="timeline-num" /></label>
          <label title="In Point">In: <input type="number" id="timeline-in-frame" value="${this.inPoint}" class="timeline-num in-point" /></label>
          <label title="Current Frame">F: <input type="number" id="timeline-cur-frame" value="${this.currentFrame}" class="timeline-num cur-frame" /></label>
          <label title="Out Point">Out: <input type="number" id="timeline-out-frame" value="${this.outPoint}" class="timeline-num out-point" /></label>
          <label title="Sequence Global End Frame">E: <input type="number" id="timeline-end-frame" value="${this.endFrame}" class="timeline-num" /></label>
        </div>

        <!-- Scrubber and Canvas Ruler -->
        <div class="timeline-scrubber-wrapper">
          <canvas id="timeline-ruler-canvas" width="600" height="24" class="timeline-ruler-canvas"></canvas>
          <input type="range" id="timeline-scrubber" min="${this.startFrame}" max="${this.endFrame}" value="${this.currentFrame}" class="timeline-scrubber" />
          <div id="timeline-keyframe-track" class="timeline-keyframe-track"></div>
        </div>

        <!-- In/Out Range Controls & Playback Mode -->
        <div class="timeline-mode-group">
          <button id="btn-set-in" class="btn-tool btn-inout" title="Set In Point at Current Frame (I)">[ In</button>
          <button id="btn-set-out" class="btn-tool btn-inout" title="Set Out Point at Current Frame (O)">Out ]</button>
          <button id="timeline-playback-mode" class="btn-tool btn-mode" title="Playback Mode: LOOP (Click to cycle)">LOOP</button>
        </div>

        <!-- FPS Counter -->
        <div class="timeline-fps">
          <span>FPS: <b id="timeline-fps-val">${this.fps}</b></span>
        </div>
      </div>
    `;

    // Event listeners for inputs & controls
    const scrubber = this.container.querySelector('#timeline-scrubber');
    scrubber.addEventListener('input', (e) => {
      this.setFrame(Number(e.target.value));
    });

    const curInput = this.container.querySelector('#timeline-cur-frame');
    curInput.addEventListener('change', (e) => {
      this.setFrame(Number(e.target.value));
    });

    const startInput = this.container.querySelector('#timeline-start-frame');
    startInput.addEventListener('change', (e) => {
      this.setFrameRange(Number(e.target.value), this.endFrame);
    });

    const endInput = this.container.querySelector('#timeline-end-frame');
    endInput.addEventListener('change', (e) => {
      this.setFrameRange(this.startFrame, Number(e.target.value));
    });

    const inInput = this.container.querySelector('#timeline-in-frame');
    inInput.addEventListener('change', (e) => {
      this.setInPoint(Number(e.target.value));
    });

    const outInput = this.container.querySelector('#timeline-out-frame');
    outInput.addEventListener('change', (e) => {
      this.setOutPoint(Number(e.target.value));
    });

    // Transport buttons
    this.container.querySelector('#btn-play').addEventListener('click', () => this.togglePlay());
    this.container.querySelector('#btn-stop').addEventListener('click', () => this.stop());
    this.container.querySelector('#btn-first').addEventListener('click', () => this.setFrame(this.startFrame));
    this.container.querySelector('#btn-last').addEventListener('click', () => this.setFrame(this.endFrame));
    this.container.querySelector('#btn-jump-in').addEventListener('click', () => this.jumpToIn());
    this.container.querySelector('#btn-jump-out').addEventListener('click', () => this.jumpToOut());
    this.container.querySelector('#btn-prev').addEventListener('click', () => this.step(-1));
    this.container.querySelector('#btn-next').addEventListener('click', () => this.step(1));
    this.container.querySelector('#btn-prev-10').addEventListener('click', () => this.step(-10));
    this.container.querySelector('#btn-next-10').addEventListener('click', () => this.step(10));
    this.container.querySelector('#btn-prev-key').addEventListener('click', () => this.jumpPrevKey());
    this.container.querySelector('#btn-next-key').addEventListener('click', () => this.jumpNextKey());
    this.container.querySelector('#btn-set-in').addEventListener('click', () => this.setInPoint(this.currentFrame));
    this.container.querySelector('#btn-set-out').addEventListener('click', () => this.setOutPoint(this.currentFrame));
    this.container.querySelector('#timeline-playback-mode').addEventListener('click', () => this.cyclePlaybackMode());

    // Ruler Canvas Interaction
    const rulerCanvas = this.container.querySelector('#timeline-ruler-canvas');
    if (rulerCanvas) {
      const resizeRuler = () => {
        const rect = rulerCanvas.parentElement.getBoundingClientRect();
        if (rect.width > 0) {
          rulerCanvas.width = rect.width;
          this.drawRuler();
        }
      };
      setTimeout(resizeRuler, 50);
      window.addEventListener('resize', resizeRuler);

      rulerCanvas.addEventListener('mousedown', (e) => {
        const rect = rulerCanvas.getBoundingClientRect();
        const u = (e.clientX - rect.left) / rect.width;
        const total = this.endFrame - this.startFrame;
        const targetFrame = Math.round(this.startFrame + u * total);
        this.setFrame(targetFrame);
        this.isDraggingPlayhead = true;
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isDraggingPlayhead && rulerCanvas) {
          const rect = rulerCanvas.getBoundingClientRect();
          const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const total = this.endFrame - this.startFrame;
          const targetFrame = Math.round(this.startFrame + u * total);
          this.setFrame(targetFrame);
        }
      });

      window.addEventListener('mouseup', () => {
        this.isDraggingPlayhead = false;
      });

      rulerCanvas.addEventListener('contextmenu', (e) => this.showContextMenu(e));
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'k' || e.key === 'K') {
        this.pause();
      } else if (e.key === 'l' || e.key === 'L') {
        this.playDirection = 1;
        this.play();
      } else if (e.key === 'j' || e.key === 'J') {
        this.playDirection = -1;
        this.play();
      } else if (e.key === ',') {
        if (e.shiftKey) this.step(-10);
        else this.step(-1);
      } else if (e.key === '.') {
        if (e.shiftKey) this.step(10);
        else this.step(1);
      } else if (e.key === 'i' || e.key === 'I') {
        if (e.altKey) this.clearInOut();
        else this.setInPoint(this.currentFrame);
      } else if (e.key === 'o' || e.key === 'O') {
        if (e.altKey) this.clearInOut();
        else this.setOutPoint(this.currentFrame);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        this.jumpPrevKey();
      } else if (e.altKey && e.key === 'ArrowRight') {
        this.jumpNextKey();
      } else if (e.key === 'Home') {
        if (e.altKey) this.jumpToIn();
        else this.setFrame(this.startFrame);
      } else if (e.key === 'End') {
        if (e.altKey) this.jumpToOut();
        else this.setFrame(this.endFrame);
      }
    });

    this.renderKeyframeTicks();
    this.drawRuler();
  }
}
