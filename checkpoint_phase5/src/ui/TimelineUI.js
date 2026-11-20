/**
 * OpenComp - Timeline & Dope Sheet Playback UI
 * Dopesheet timeline with scrubber, keyframe ticks, frame range, playback controls, and FPS counter.
 */

export class TimelineUI {
  constructor(containerElement, onFrameChange) {
    this.container = containerElement;
    this.onFrameChange = onFrameChange;

    this.currentFrame = 1;
    this.startFrame = 1;
    this.endFrame = 100;
    this.fps = 24;
    this.isPlaying = false;
    this.playTimer = null;

    /** @type {Set<number>} Keyframe positions */
    this.keyframes = new Set();

    this.render();
  }

  setFrame(frame) {
    this.currentFrame = Math.max(this.startFrame, Math.min(this.endFrame, Math.round(frame)));
    this.updateDisplay();
    if (this.onFrameChange) this.onFrameChange(this.currentFrame);
  }

  setKeyframes(frames) {
    this.keyframes = new Set(frames);
    this.renderKeyframeTicks();
  }

  jumpPrevKey() {
    const sorted = Array.from(this.keyframes).sort((a, b) => a - b);
    const prev = sorted.filter(f => f < this.currentFrame).pop();
    if (prev !== undefined) this.setFrame(prev);
    else this.setFrame(this.startFrame);
  }

  jumpNextKey() {
    const sorted = Array.from(this.keyframes).sort((a, b) => a - b);
    const next = sorted.find(f => f > this.currentFrame);
    if (next !== undefined) this.setFrame(next);
    else this.setFrame(this.endFrame);
  }

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
      let nextFrame = this.currentFrame + 1;
      if (nextFrame > this.endFrame) nextFrame = this.startFrame;
      this.setFrame(nextFrame);
    }, 1000 / this.fps);
  }

  pause() {
    this.isPlaying = false;
    clearInterval(this.playTimer);
    const playBtn = this.container.querySelector('#btn-play');
    if (playBtn) playBtn.textContent = '▶ Play';
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

  render() {
    this.container.innerHTML = `
      <div class="timeline-controls">
        <button id="btn-first" class="btn-tool" title="First Frame (|◀)">|◀</button>
        <button id="btn-prev-key" class="btn-tool" title="Previous Keyframe (Alt+◀)">◆◀</button>
        <button id="btn-prev" class="btn-tool" title="Step Back (,)">◀</button>
        <button id="btn-play" class="btn-tool btn-play" title="Play / Pause (Space)">▶ Play</button>
        <button id="btn-next" class="btn-tool" title="Step Forward (.)">▶</button>
        <button id="btn-next-key" class="btn-tool" title="Next Keyframe (Alt+▶)">▶◆</button>
        <button id="btn-last" class="btn-tool" title="Last Frame (▶|)">▶|</button>

        <div class="timeline-frame-boxes">
          <input type="number" id="timeline-start-frame" value="${this.startFrame}" class="timeline-num" />
          <input type="number" id="timeline-cur-frame" value="${this.currentFrame}" class="timeline-num cur-frame" />
          <input type="number" id="timeline-end-frame" value="${this.endFrame}" class="timeline-num" />
        </div>

        <div class="timeline-scrubber-wrapper">
          <input type="range" id="timeline-scrubber" min="${this.startFrame}" max="${this.endFrame}" value="${this.currentFrame}" class="timeline-scrubber" />
          <div id="timeline-keyframe-track" class="timeline-keyframe-track"></div>
        </div>

        <div class="timeline-fps">
          <span>FPS: <b>${this.fps}</b></span>
        </div>
      </div>
    `;

    // Event listeners
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
      this.startFrame = Number(e.target.value);
      scrubber.min = this.startFrame;
      this.renderKeyframeTicks();
    });

    const endInput = this.container.querySelector('#timeline-end-frame');
    endInput.addEventListener('change', (e) => {
      this.endFrame = Number(e.target.value);
      scrubber.max = this.endFrame;
      this.renderKeyframeTicks();
    });

    this.container.querySelector('#btn-play').addEventListener('click', () => this.togglePlay());
    this.container.querySelector('#btn-first').addEventListener('click', () => this.setFrame(this.startFrame));
    this.container.querySelector('#btn-last').addEventListener('click', () => this.setFrame(this.endFrame));
    this.container.querySelector('#btn-prev').addEventListener('click', () => this.setFrame(this.currentFrame - 1));
    this.container.querySelector('#btn-next').addEventListener('click', () => this.setFrame(this.currentFrame + 1));
    this.container.querySelector('#btn-prev-key').addEventListener('click', () => this.jumpPrevKey());
    this.container.querySelector('#btn-next-key').addEventListener('click', () => this.jumpNextKey());

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === ',') {
        this.setFrame(this.currentFrame - 1);
      } else if (e.key === '.') {
        this.setFrame(this.currentFrame + 1);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        this.jumpPrevKey();
      } else if (e.altKey && e.key === 'ArrowRight') {
        this.jumpNextKey();
      }
    });

    this.renderKeyframeTicks();
  }
}
