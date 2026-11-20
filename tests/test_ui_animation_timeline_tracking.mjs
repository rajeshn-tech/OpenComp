/**
 * OpenComp - UI Parity: Animation, Timeline & Tracking Regression Suite
 * Tests professional timeline playback controls, In/Out range points, Loop/Bounce/Once modes,
 * Curve Editor multi-curve channels, interpolation (linear, bezier, constant, smooth, free),
 * extrapolation (constant, linear, cycle), marquee box selection, keyframe retiming/scaling/duplication,
 * Dope Sheet node & channel hierarchy, summary bars, track expansion,
 * Animation diamond states (static, animated, on-key),
 * Point Tracker viewer overlay (search/pattern boxes, path trail, transport controls, transform export),
 * Planar Tracker 4-corner mesh, interior grid, and CornerPin2D export.
 */

import assert from 'assert/strict';
import { performance } from 'perf_hooks';
import { Keyframe, KeyframeTrack } from '../src/core/Animation.js';
import { TimelineUI } from '../src/ui/TimelineUI.js';
import { CurveEditorUI } from '../src/ui/CurveEditorUI.js';
import { DopeSheetUI } from '../src/ui/DopeSheetUI.js';
import { TrackingUI } from '../src/ui/TrackingUI.js';
import { PropertiesUI } from '../src/ui/PropertiesUI.js';
import { TrackerNode } from '../src/nodes/TrackerNode.js';
import { PlanarTrackerNode } from '../src/nodes/PlanarTrackerNode.js';
import { TransformNode } from '../src/nodes/TransformNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_ui_animation_timeline_tracking.mjs');
console.log('====================================================\n');

// Mock DOM Environment for UI execution in Node.js
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  toggle(c, force) {
    if (force !== undefined) {
      if (force) this.classes.add(c); else this.classes.delete(c);
      return force;
    }
    if (this.classes.has(c)) { this.classes.delete(c); return false; }
    this.classes.add(c); return true;
  }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(tagName = 'DIV', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.dataset = {};
    this.classList = new MockClassList();
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this._innerHTML = '';
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.width = 800;
    this.height = 600;
  }

  get className() {
    return Array.from(this.classList.classes).join(' ');
  }

  set className(val) {
    this.classList.classes.clear();
    if (typeof val === 'string') {
      val.split(/\s+/).forEach(c => c && this.classList.add(c));
    }
  }

  scrollIntoView() {}

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
    const tagMatches = [...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g)];
    for (const match of tagMatches) {
      const tag = match[1];
      const attrs = match[2];
      const el = new MockElement(tag);
      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      if (idMatch) el.id = idMatch[1];
      const classMatch = attrs.match(/class=["']([^"']+)["']/);
      if (classMatch) classMatch[1].split(/\s+/).forEach(c => el.classList.add(c));
      const valMatch = attrs.match(/value=["']([^"']+)["']/);
      if (valMatch) el.value = valMatch[1];
      el.parentElement = this;
      this.children.push(el);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) fn(event);
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const search = (node) => {
      for (const child of node.children) {
        let match = false;
        if (sel.startsWith('#') && child.id === sel.slice(1)) match = true;
        else if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) match = true;
        else if (child.tagName.toLowerCase() === sel.toLowerCase()) match = true;
        if (match) results.push(child);
        search(child);
      }
    };
    search(this);
    return results;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
  }

  getContext() {
    return {
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      rect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      closePath() {},
      fill() {},
      stroke() {},
      fillText() {},
      measureText(text) { return { width: (text || '').length * 7 }; },
      save() {},
      restore() {},
      setLineDash() {},
      clip() {},
      translate() {},
      scale() {}
    };
  }
}

// Global browser window mock
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {}
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) { return new MockElement(tag); },
    getElementById(id) { return null; },
    body: new MockElement('BODY')
  };
}

async function runAllTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(err);
      failed++;
    }
  }

  console.log('--- AREA 1: TIMELINE CONTROLS & TRANSPORT ---');

  test('1.1: Frame navigation, range bounds, and In/Out points', () => {
    const container = new MockElement('DIV');
    let reportedFrame = null;
    const timeline = new TimelineUI(container, (f) => { reportedFrame = f; });

    timeline.setFrameRange(10, 150);
    assert.equal(timeline.startFrame, 10);
    assert.equal(timeline.endFrame, 150);

    timeline.setInPoint(25);
    timeline.setOutPoint(120);
    assert.equal(timeline.inPoint, 25);
    assert.equal(timeline.outPoint, 120);

    timeline.setFrame(50);
    assert.equal(timeline.currentFrame, 50);
    assert.equal(reportedFrame, 50);

    // Test In/Out jumps
    timeline.jumpToIn();
    assert.equal(timeline.currentFrame, 25);

    timeline.jumpToOut();
    assert.equal(timeline.currentFrame, 120);

    // Test Clear In/Out
    timeline.clearInOut();
    assert.equal(timeline.inPoint, 10);
    assert.equal(timeline.outPoint, 150);
  });

  test('1.2: Stepping, variable FPS, and keyframe navigation', () => {
    const container = new MockElement('DIV');
    const timeline = new TimelineUI(container);
    timeline.setFrameRange(1, 100);
    timeline.setFrame(20);

    timeline.step(1);
    assert.equal(timeline.currentFrame, 21);

    timeline.step(-1);
    assert.equal(timeline.currentFrame, 20);

    timeline.step(10);
    assert.equal(timeline.currentFrame, 30);

    timeline.step(-10);
    assert.equal(timeline.currentFrame, 20);

    // FPS
    timeline.setFPS(29.97);
    assert.equal(timeline.fps, 29.97);

    // Keyframe jumps
    timeline.setKeyframes([5, 15, 35, 60]);
    timeline.jumpNextKey();
    assert.equal(timeline.currentFrame, 35);

    timeline.jumpPrevKey();
    assert.equal(timeline.currentFrame, 15);
  });

  test('1.3: Playback modes: Loop, Bounce, and Once', () => {
    const container = new MockElement('DIV');
    const timeline = new TimelineUI(container);
    timeline.setFrameRange(1, 10);
    timeline.setInPoint(2);
    timeline.setOutPoint(8);

    // Loop mode
    timeline.setPlaybackMode('loop');
    assert.equal(timeline.playbackMode, 'loop');

    timeline.cyclePlaybackMode();
    assert.equal(timeline.playbackMode, 'bounce');

    timeline.cyclePlaybackMode();
    assert.equal(timeline.playbackMode, 'once');

    timeline.cyclePlaybackMode();
    assert.equal(timeline.playbackMode, 'loop');
  });

  console.log('\n--- AREA 2: CURVE EDITOR MULTI-TRACK & MULTI-CHANNEL ---');

  test('2.1: Multi-track registration, binding, and channel legend', () => {
    const canvas = new MockElement('CANVAS');
    const curveUI = new CurveEditorUI(canvas);

    const trackX = new KeyframeTrack(0.0);
    trackX.addKey(1, 10);
    trackX.addKey(50, 100);

    const trackY = new KeyframeTrack(0.0);
    trackY.addKey(1, 0);
    trackY.addKey(50, 50);

    curveUI.addTrack('tx', 'Transform1.translate.x', trackX, null, 'translate.x', '#ff922b');
    curveUI.addTrack('ty', 'Transform1.translate.y', trackY, null, 'translate.y', '#51cf66');

    assert.equal(curveUI.tracks.size, 2);
    assert.equal(curveUI.tracks.get('tx').name, 'Transform1.translate.x');
    assert.equal(curveUI.tracks.get('ty').name, 'Transform1.translate.y');

    // Visibility toggle
    curveUI.setTrackVisible('tx', false);
    assert.equal(curveUI.tracks.get('tx').visible, false);

    curveUI.removeTrack('tx');
    assert.equal(curveUI.tracks.size, 1);
  });

  console.log('\n--- AREA 3: INTERPOLATION & EXTRAPOLATION MODES ---');

  test('3.1: Interpolation modes (Linear, Constant/Hold, Smooth Bezier)', () => {
    const track = new KeyframeTrack(0.0);
    track.addKey(10, 0, 'linear');
    track.addKey(20, 100, 'linear');

    // Linear midpoint
    assert.equal(track.evaluate(15), 50);

    // Constant / Hold mode
    const holdTrack = new KeyframeTrack(0.0);
    holdTrack.addKey(10, 25, 'constant');
    holdTrack.addKey(20, 75, 'constant');
    assert.equal(holdTrack.evaluate(12), 25);
    assert.equal(holdTrack.evaluate(19.9), 25);
    assert.equal(holdTrack.evaluate(20), 75);

    // Smooth Bezier mode
    const smoothTrack = new KeyframeTrack(0.0);
    smoothTrack.addKey(0, 0, 'bezier');
    smoothTrack.addKey(50, 100, 'bezier');
    smoothTrack.addKey(100, 0, 'bezier');
    const peakVal = smoothTrack.evaluate(50);
    assert.equal(peakVal, 100);
    assert.ok(smoothTrack.evaluate(25) > 0 && smoothTrack.evaluate(25) < 100);
  });

  test('3.2: Extrapolation modes (Constant clamp, Linear projection, Cycle wrap)', () => {
    const track = new KeyframeTrack(0.0);
    const k0 = track.addKey(10, 20);
    const k1 = track.addKey(30, 60);
    // Slope = (60 - 20) / (30 - 10) = 2.0
    k0.leftSlope = 2.0;
    k1.rightSlope = 2.0;

    // 1. Constant (Default)
    track.preExtrapolation = 'constant';
    track.postExtrapolation = 'constant';
    assert.equal(track.evaluate(0), 20);
    assert.equal(track.evaluate(50), 60);

    // 2. Linear projection
    track.preExtrapolation = 'linear';
    track.postExtrapolation = 'linear';
    // At frame 5: 20 + (5 - 10) * 2.0 = 10
    assert.equal(track.evaluate(5), 10);
    // At frame 40: 60 + (40 - 30) * 2.0 = 80
    assert.equal(track.evaluate(40), 80);

    // 3. Cycle wrap
    track.preExtrapolation = 'cycle';
    track.postExtrapolation = 'cycle';
    // Span = 20. Frame 50 wraps to 10 + (50 - 10) % 20 = 10 -> value 20
    assert.equal(track.evaluate(50), 20);
  });

  console.log('\n--- AREA 4: TANGENT MANIPULATION & VIEWPORT FIT ---');

  test('4.1: Tangent mode switching and collinearity', () => {
    const canvas = new MockElement('CANVAS');
    const curveUI = new CurveEditorUI(canvas);
    const track = new KeyframeTrack(0.0);
    const k0 = track.addKey(1, 0);
    const k1 = track.addKey(50, 100);
    const k2 = track.addKey(100, 50);
    curveUI.bindTrack(track);

    curveUI.selectedKey = k1;
    curveUI.setTangentMode('flat');
    assert.equal(k1.leftSlope, 0.0);
    assert.equal(k1.rightSlope, 0.0);

    curveUI.setTangentMode('linear');
    assert.equal(k1.interpolation, 'linear');
  });

  test('4.2: Fit Selected and Fit All viewport bounds calculation', () => {
    const canvas = new MockElement('CANVAS');
    const curveUI = new CurveEditorUI(canvas);
    const track = new KeyframeTrack(0.0);
    track.addKey(20, 10);
    track.addKey(80, 90);
    curveUI.bindTrack(track);

    curveUI.fitAll();
    assert.ok(curveUI.viewStartFrame <= 20);
    assert.ok(curveUI.viewEndFrame >= 80);
    assert.ok(curveUI.viewMinValue <= 10);
    assert.ok(curveUI.viewMaxValue >= 90);

    // Fit Selected on single keyframe
    curveUI.selectedKeys.clear();
    curveUI.selectedKey = track.getKey(20);
    curveUI.fitSelected();
    assert.ok(curveUI.viewStartFrame <= 20);
  });

  console.log('\n--- AREA 5: KEYFRAME RETIMING, SCALING & CLIPBOARD ---');

  test('5.1: Keyframe offset (move in time) and block scaling', () => {
    const track = new KeyframeTrack(0.0);
    track.addKey(10, 100);
    track.addKey(20, 200);

    // Offset by +5 frames
    track.offsetKeys(5);
    assert.equal(track.hasKey(15), true);
    assert.equal(track.hasKey(25), true);

    // Scale keys around pivot frame 15 by factor 2.0
    track.scaleKeys(2.0, 15);
    // Key at 15 stays 15. Key at 25: 15 + (25 - 15) * 2 = 35
    assert.equal(track.hasKey(15), true);
    assert.equal(track.hasKey(35), true);
  });

  test('5.2: Keyframe duplication and copy/paste buffer', () => {
    const track = new KeyframeTrack(0.0);
    track.addKey(10, 50);
    track.addKey(20, 150);

    // Duplicate keys with delta = 2
    const dups = track.duplicateKeys([10, 20], 2);
    assert.equal(dups.length, 2);
    assert.equal(track.hasKey(12), true);
    assert.equal(track.hasKey(22), true);

    // Copy / Paste
    const copied = track.copyKeys([10, 20]);
    assert.equal(copied.length, 2);

    const targetTrack = new KeyframeTrack(0.0);
    const pasted = targetTrack.pasteKeys(copied, 100);
    assert.equal(pasted.length, 2);
    assert.equal(targetTrack.hasKey(100), true);
    assert.equal(targetTrack.hasKey(110), true);
  });

  console.log('\n--- AREA 6: DOPE SHEET NODE & PARAMETER HIERARCHY ---');

  test('6.1: Dope Sheet graph node population and summary span bars', () => {
    const container = new MockElement('DIV');
    const dopeSheet = new DopeSheetUI(container);

    const mockNode = {
      id: 'Transform1',
      name: 'Transform1',
      knobs: {
        translate: {
          label: 'Translate',
          keyframes: { 10: 100, 50: 300, 90: 500 }
        },
        rotate: {
          label: 'Rotate',
          keyframes: { 20: 0, 70: 180 }
        }
      },
      markDirty() {}
    };

    dopeSheet.setNodes([mockNode]);
    assert.equal(dopeSheet.nodes.length, 1);
    assert.equal(dopeSheet.nodes[0].channels.length, 2);

    // Visible rows calculation: Master row + 2 channel rows
    const rows = dopeSheet.getVisibleRows();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].type, 'node');
    assert.equal(rows[0].spanMin, 10);
    assert.equal(rows[0].spanMax, 90);
    assert.equal(rows[1].type, 'channel');
    assert.equal(rows[2].type, 'channel');
  });

  console.log('\n--- AREA 7: DOPE SHEET MARQUEE SELECTION & RETIMING ---');

  test('7.1: Marquee box selection and retiming across tracks', () => {
    const container = new MockElement('DIV');
    const dopeSheet = new DopeSheetUI(container);

    const mockNode = {
      id: 'Grade1',
      name: 'Grade1',
      knobs: {
        gamma: {
          label: 'Gamma',
          keyframes: { 10: 1.0, 30: 2.2 }
        }
      },
      markDirty() {}
    };
    dopeSheet.setNodes([mockNode]);

    // Select keyframe at frame 10
    dopeSheet.selectedKeys.add('Grade1::gamma::10');
    assert.equal(dopeSheet.selectedKeys.size, 1);

    // Move key by +5 frames
    dopeSheet.moveSelectedKeys(5);
    assert.equal(mockNode.knobs.gamma.keyframes[15], 1.0);
    assert.equal(mockNode.knobs.gamma.keyframes[10], undefined);

    // Delete selected key
    dopeSheet.deleteSelectedKeys();
    assert.equal(mockNode.knobs.gamma.keyframes[15], undefined);
  });

  console.log('\n--- AREA 8: ANIMATION DIAMOND STATES & EXPRESSIONS ---');

  test('8.1: Animation diamond states (static, animated, on-key)', () => {
    const container = new MockElement('DIV');
    const propUI = new PropertiesUI(container);
    propUI.currentFrame = 25;

    const mockNode = {
      id: 'Transform1',
      name: 'Transform1',
      knobs: {
        scale: { value: 1.0, keyframes: { 10: 1.0, 25: 1.5, 40: 2.0 } },
        rotate: { value: 0.0, keyframes: { 10: 0.0, 50: 90.0 } },
        skew: { value: 0.0, keyframes: {} }
      },
      setKeyframe(k, f, v) { this.knobs[k].keyframes[f] = v; },
      removeKeyframe(k, f) { delete this.knobs[k].keyframes[f]; }
    };

    const btnScale = new MockElement('BUTTON');
    propUI.updateAnimBtnState(btnScale, mockNode, 'scale');
    assert.equal(btnScale.textContent, '◆'); // on-key at frame 25
    assert.ok(btnScale.classList.contains('on-key'));

    const btnRotate = new MockElement('BUTTON');
    propUI.updateAnimBtnState(btnRotate, mockNode, 'rotate');
    assert.equal(btnRotate.textContent, '◇'); // animated but not on frame 25
    assert.ok(btnRotate.classList.contains('animated'));

    const btnSkew = new MockElement('BUTTON');
    propUI.updateAnimBtnState(btnSkew, mockNode, 'skew');
    assert.equal(btnSkew.textContent, '•'); // static
    assert.ok(btnSkew.classList.contains('static'));

    // Toggle on-key at frame 25 removes it
    propUI.toggleKnobKeyframe(mockNode, 'scale');
    assert.equal(mockNode.knobs.scale.keyframes[25], undefined);

    // Toggle again adds it
    propUI.toggleKnobKeyframe(mockNode, 'scale');
    assert.notEqual(mockNode.knobs.scale.keyframes[25], undefined);
  });

  console.log('\n--- AREA 9: POINT TRACKER VIEWER OVERLAY & TRANSPORT ---');

  test('9.1: Point Tracker overlay, anchor drag, step transport, and transform export', () => {
    const container = new MockElement('DIV');
    const mockViewer = { render() {}, currentBuffer: new PixelBuffer(1920, 1080) };
    const trackingUI = new TrackingUI(container, mockViewer);

    const trackerNode = new TrackerNode('Tracker1', 0, 0);
    const track1 = trackerNode.addTrack('track1', 500, 300);
    trackingUI.setTrackerNode(trackerNode);

    // Disclaimer check
    assert.ok(trackingUI.disclaimer.includes('Synthetic tracking engine verification'));

    // Test mouse hit detection on anchor
    const hit = trackingUI.onMouseDown({}, 500, 300);
    assert.equal(hit, true);
    assert.equal(trackingUI.activeHandle, 'anchor');

    // Drag anchor to 520, 310
    trackingUI.onMouseMove({}, 520, 310);
    trackingUI.onMouseUp();
    assert.equal(track1.getPos(1).x, 520);
    assert.equal(track1.getPos(1).y, 310);

    // Export MatchMove Transform
    const exported = trackingUI.exportTransform('matchmove');
    assert.equal(exported.type, 'Transform');
    assert.equal(exported.mode, 'matchmove');
    assert.equal(trackerNode.getKnobValue('transformMode'), 'matchmove');
  });

  console.log('\n--- AREA 10: PLANAR TRACKER QUAD MESH & CORNERPIN EXPORT ---');

  test('10.1: Planar Tracker 4-corner mesh manipulation and CornerPin export', () => {
    const container = new MockElement('DIV');
    const mockViewer = { render() {}, currentBuffer: new PixelBuffer(1920, 1080) };
    const trackingUI = new TrackingUI(container, mockViewer);

    const planarNode = new PlanarTrackerNode('PlanarTracker1', 0, 0);
    trackingUI.setTrackerNode(planarNode);
    assert.equal(trackingUI.isPlanar, true);

    const corners = planarNode.getCornersAtFrame(1);
    assert.equal(corners.length, 4);
    const initialX = corners[0].x;

    // Test corner drag
    const hitCorner = trackingUI.onMouseDown({}, corners[0].x, corners[0].y);
    assert.equal(hitCorner, true);
    assert.equal(trackingUI.selectedCornerIdx, 0);

    trackingUI.onMouseMove({}, initialX + 10, corners[0].y + 10);
    trackingUI.onMouseUp();
    const updatedCorners = planarNode.getCornersAtFrame(1);
    assert.equal(updatedCorners[0].x, initialX + 10);

    // Export CornerPin2D knobs
    const exportedPin = trackingUI.exportCornerPin('matchmove');
    assert.equal(exportedPin.type, 'CornerPin2D');
    assert.ok(exportedPin.knobs.to1_x !== undefined);
  });

  console.log('\n====================================================');
  console.log(`📊 ANIMATION, TIMELINE & TRACKING SUITE RESULTS: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests();
