import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

// Original reference implementation
function originalGradeCompute(inputBuf, maskBuf, knobs) {
  const bp = Number(knobs.blackpoint ?? 0.0);
  const wp = Math.max(0.0001, Number(knobs.whitepoint ?? 1.0));
  const lift = Number(knobs.lift ?? 0.0);
  const gain = Number(knobs.gain ?? 1.0);
  const mult = Number(knobs.multiply ?? 1.0);
  const offset = Number(knobs.offset ?? 0.0);
  const gamma = Math.max(0.0001, Number(knobs.gamma ?? 1.0));
  const blackClamp = !!knobs.blackClamp;
  const whiteClamp = !!knobs.whiteClamp;
  const reverse = !!knobs.reverse;

  const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
  const A = mult * (gain - lift) / denom;
  const B = offset + lift - A * bp;
  const invGamma = 1.0 / gamma;
  const isLinearGamma = Math.abs(gamma - 1.0) < 1e-5;

  const out = new PixelBuffer(inputBuf.width, inputBuf.height);
  if (inputBuf.extraChannels && inputBuf.extraChannels.size > 0) {
    out.copyChannelsFrom(inputBuf);
  }
  const src = inputBuf.data;
  const dst = out.data;
  const len = src.length;
  const mask = maskBuf ? maskBuf.data : null;

  if (!mask) {
    if (!reverse) {
      if (isLinearGamma) {
        for (let i = 0; i < len; i += 4) {
          let r = A * src[i] + B;
          let g = A * src[i + 1] + B;
          let b = A * src[i + 2] + B;
          if (blackClamp) {
            if (r < 0) r = 0;
            if (g < 0) g = 0;
            if (b < 0) b = 0;
          }
          if (whiteClamp) {
            if (r > 1) r = 1;
            if (g > 1) g = 1;
            if (b > 1) b = 1;
          }
          dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
        }
      } else {
        for (let i = 0; i < len; i += 4) {
          let r = A * src[i] + B;
          let g = A * src[i + 1] + B;
          let b = A * src[i + 2] + B;
          if (r > 0) r = Math.pow(r, invGamma); else if (blackClamp) r = 0;
          if (g > 0) g = Math.pow(g, invGamma); else if (blackClamp) g = 0;
          if (b > 0) b = Math.pow(b, invGamma); else if (blackClamp) b = 0;
          if (whiteClamp) {
            if (r > 1) r = 1;
            if (g > 1) g = 1;
            if (b > 1) b = 1;
          }
          dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
        }
      }
    } else {
      for (let i = 0; i < len; i += 4) {
        let r = src[i];
        let g = src[i + 1];
        let b = src[i + 2];
        if (!isLinearGamma) {
          if (r > 0) r = Math.pow(r, gamma);
          if (g > 0) g = Math.pow(g, gamma);
          if (b > 0) b = Math.pow(b, gamma);
        }
        if (A !== 0) {
          r = (r - B) / A;
          g = (g - B) / A;
          b = (b - B) / A;
        }
        if (blackClamp) {
          if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
        }
        if (whiteClamp) {
          if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
        }
        dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
      }
    }
    return out;
  }

  for (let i = 0; i < len; i += 4) {
    const maskVal = mask[i + 3];
    const invM = 1.0 - maskVal;

    for (let c = 0; c < 3; c++) {
      const origVal = src[i + c];
      let val = origVal;

      if (!reverse) {
        val = A * val + B;
        if (val > 0) {
          if (!isLinearGamma) val = Math.pow(val, invGamma);
        } else if (blackClamp) {
          val = 0;
        }
      } else {
        if (val > 0 && !isLinearGamma) val = Math.pow(val, gamma);
        if (A !== 0) val = (val - B) / A;
      }

      if (blackClamp && val < 0) val = 0;
      if (whiteClamp && val > 1) val = 1;

      dst[i + c] = origVal * invM + val * maskVal;
    }
    dst[i + 3] = src[i + 3];
  }
  return out;
}

function compareBuffers(actualBuf, expectedBuf) {
  const a = actualBuf.data;
  const e = expectedBuf.data;
  let maxAbsErr = 0;
  let sumErr = 0;
  let sumSqErr = 0;
  let nanCount = 0;
  let infCount = 0;
  let totalCount = a.length;

  for (let i = 0; i < totalCount; i++) {
    const act = a[i];
    const exp = e[i];
    if (Number.isNaN(act)) nanCount++;
    if (!Number.isFinite(act)) infCount++;

    const diff = Math.abs(act - exp);
    if (diff > maxAbsErr) maxAbsErr = diff;
    sumErr += diff;
    sumSqErr += diff * diff;
  }

  const mae = sumErr / totalCount;
  const rmse = Math.sqrt(sumSqErr / totalCount);
  return { maxAbsErr, mae, rmse, nanCount, infCount };
}

console.log('================================================================');
console.log('🔍 FORENSIC AUDIT: TEST NUMERICAL CORRECTNESS');
console.log('================================================================\n');

// 1. Test Gammas across 0.1, 0.25, 0.5, 0.8, 0.98, 1.0, 1.05, 1.5, 2.2, 4.0, 10.0
const gammas = [0.1, 0.25, 0.5, 0.8, 0.98, 1.0, 1.05, 1.5, 2.2, 4.0, 10.0];

// Test values covering:
// - Near zero: 0.0, 1e-7, 1e-5, 1e-4, 0.001, 0.01
// - Domain 0..4: 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 3.5, 3.99
// - Below and above 4.0: 3.9999, 3.99999, 4.0, 4.00001, 4.0001, 4.01
// - Extreme HDR values: 8.0, 16.0, 64.0, 100.0, 1000.0
// - Negatives: -100.0, -10.0, -1.0, -0.1, -1e-5
const testValues = [
  -100.0, -10.0, -1.0, -0.1, -1e-5,
  0.0, 1e-7, 1e-5, 1e-4, 0.001, 0.01,
  0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 3.9, 3.99,
  3.9999, 3.99999, 4.0, 4.00001, 4.0001, 4.01, 4.5,
  8.0, 16.0, 64.0, 100.0, 1000.0
];

const width = testValues.length;
const height = 1;
const inBuf = new PixelBuffer(width, height);
for (let x = 0; x < width; x++) {
  const v = testValues[x];
  inBuf.setPixel(x, 0, v, v, v, 1.0);
}

console.log('--- 1. GAMMA SWEEP & VALUE DOMAINS (Unmasked, blackClamp=true, whiteClamp=false) ---');
for (const gamma of gammas) {
  const knobs = { gamma, blackClamp: true, whiteClamp: false };
  const node = new GradeNode('test_gamma');
  node.setKnobValue('gamma', gamma);
  node.setKnobValue('blackClamp', true);
  node.setKnobValue('whiteClamp', false);

  const optOut = node.compute({ in: inBuf });
  const refOut = originalGradeCompute(inBuf, null, knobs);
  const metrics = compareBuffers(optOut, refOut);

  console.log(`Gamma: ${gamma.toString().padEnd(5)} | MaxAbsErr: ${metrics.maxAbsErr.toExponential(4).padStart(12)} | MAE: ${metrics.mae.toExponential(4).padStart(12)} | RMSE: ${metrics.rmse.toExponential(4).padStart(12)} | NaNs: ${metrics.nanCount}`);
}

console.log('\n--- 2. CLAMP VARIATIONS (Gamma=2.2, with Negative & HDR Values) ---');
const clampConfigs = [
  { name: 'blackClamp=true,  whiteClamp=false', blackClamp: true, whiteClamp: false },
  { name: 'blackClamp=true,  whiteClamp=true',  blackClamp: true, whiteClamp: true },
  { name: 'blackClamp=false, whiteClamp=false', blackClamp: false, whiteClamp: false },
  { name: 'blackClamp=false, whiteClamp=true',  blackClamp: false, whiteClamp: true },
];

for (const cfg of clampConfigs) {
  const knobs = { gamma: 2.2, blackClamp: cfg.blackClamp, whiteClamp: cfg.whiteClamp };
  const node = new GradeNode('test_clamp');
  node.setKnobValue('gamma', 2.2);
  node.setKnobValue('blackClamp', cfg.blackClamp);
  node.setKnobValue('whiteClamp', cfg.whiteClamp);

  const optOut = node.compute({ in: inBuf });
  const refOut = originalGradeCompute(inBuf, null, knobs);
  const metrics = compareBuffers(optOut, refOut);

  console.log(`${cfg.name.padEnd(36)} | MaxAbsErr: ${metrics.maxAbsErr.toExponential(4).padStart(12)} | MAE: ${metrics.mae.toExponential(4).padStart(12)} | RMSE: ${metrics.rmse.toExponential(4).padStart(12)}`);
}

console.log('\n--- 3. REVERSE GRADING (Forward -> Reverse & Comparison to Original Reverse) ---');
for (const gamma of [0.5, 1.0, 1.5, 2.2]) {
  const knobs = { lift: 0.05, gain: 1.2, gamma, blackClamp: false, whiteClamp: false, reverse: true };
  const node = new GradeNode('test_rev');
  node.setKnobValue('lift', 0.05);
  node.setKnobValue('gain', 1.2);
  node.setKnobValue('gamma', gamma);
  node.setKnobValue('blackClamp', false);
  node.setKnobValue('whiteClamp', false);
  node.setKnobValue('reverse', true);

  const optOut = node.compute({ in: inBuf });
  const refOut = originalGradeCompute(inBuf, null, knobs);
  const metrics = compareBuffers(optOut, refOut);

  console.log(`Reverse Gamma ${gamma.toString().padEnd(4)} | MaxAbsErr: ${metrics.maxAbsErr.toExponential(4).padStart(12)} | MAE: ${metrics.mae.toExponential(4).padStart(12)} | RMSE: ${metrics.rmse.toExponential(4).padStart(12)}`);
}

console.log('\n--- 4. LIFT, GAIN, OFFSET & BLACKPOINT/WHITEPOINT COMBINATIONS ---');
const gradeCombos = [
  { name: 'Lift=0.1, Gain=1.5, Gamma=1.2', knobs: { lift: 0.1, gain: 1.5, gamma: 1.2, blackClamp: true, whiteClamp: false } },
  { name: 'Offset=-0.05, Mult=1.1, Gamma=0.8', knobs: { offset: -0.05, multiply: 1.1, gamma: 0.8, blackClamp: true, whiteClamp: false } },
  { name: 'BP=0.1, WP=0.9, Lift=0.02, Gain=1.1', knobs: { blackpoint: 0.1, whitepoint: 0.9, lift: 0.02, gain: 1.1, gamma: 1.05, blackClamp: true, whiteClamp: false } },
  { name: 'Negative Offset without black clamp', knobs: { offset: -0.2, gain: 1.0, gamma: 1.0, blackClamp: false, whiteClamp: false } }
];

for (const c of gradeCombos) {
  const node = new GradeNode('test_combo');
  for (const [k, v] of Object.entries(c.knobs)) node.setKnobValue(k, v);

  const optOut = node.compute({ in: inBuf });
  const refOut = originalGradeCompute(inBuf, null, c.knobs);
  const metrics = compareBuffers(optOut, refOut);

  console.log(`${c.name.padEnd(38)} | MaxAbsErr: ${metrics.maxAbsErr.toExponential(4).padStart(12)} | MAE: ${metrics.mae.toExponential(4).padStart(12)}`);
}

console.log('\n--- 5. MASK VALUES (0, 0.0001, 0.5, 0.9999, 1.0) ---');
const maskValues = [0.0, 0.0001, 0.5, 0.9999, 1.0];
const maskWidth = maskValues.length;
const maskInBuf = new PixelBuffer(maskWidth, 1);
const maskAlphaBuf = new PixelBuffer(maskWidth, 1);
for (let x = 0; x < maskWidth; x++) {
  maskInBuf.setPixel(x, 0, 0.5, 0.5, 0.5, 1.0);
  maskAlphaBuf.setPixel(x, 0, 0, 0, 0, maskValues[x]);
}

const maskKnobs = { gain: 2.0, gamma: 1.2, blackClamp: true, whiteClamp: false };
const maskNode = new GradeNode('test_mask');
maskNode.setKnobValue('gain', 2.0);
maskNode.setKnobValue('gamma', 1.2);
maskNode.setKnobValue('blackClamp', true);
maskNode.setKnobValue('whiteClamp', false);

const maskOptOut = maskNode.compute({ in: maskInBuf, mask: maskAlphaBuf });
const maskRefOut = originalGradeCompute(maskInBuf, maskAlphaBuf, maskKnobs);

for (let x = 0; x < maskWidth; x++) {
  const mVal = maskValues[x];
  const act = maskOptOut.getPixel(x, 0);
  const exp = maskRefOut.getPixel(x, 0);
  const diff = Math.abs(act[0] - exp[0]);
  console.log(`MaskVal: ${mVal.toString().padEnd(7)} | Opt: ${act[0].toFixed(6)} | Ref: ${exp[0].toFixed(6)} | Diff: ${diff.toExponential(4)}`);
}

console.log('\n--- 6. PARAMETER CHANGES DURING TIMELINE EVALUATION ---');
const dynNode = new GradeNode('test_dyn');
dynNode.setKnobValue('gamma', 1.0);
const outF1 = dynNode.compute({ in: inBuf }, { frame: 1 });
dynNode.setKnobValue('gamma', 2.2);
const outF2 = dynNode.compute({ in: inBuf }, { frame: 2 });
dynNode.setKnobValue('gamma', 0.8);
const outF3 = dynNode.compute({ in: inBuf }, { frame: 3 });
dynNode.setKnobValue('gamma', 2.2); // Returning to frame 2 gamma
const outF4 = dynNode.compute({ in: inBuf }, { frame: 4 });

const refF2 = originalGradeCompute(inBuf, null, { gamma: 2.2, blackClamp: true, whiteClamp: false });
const metricsDyn = compareBuffers(outF4, refF2);
console.log(`Timeline Param Return (Frame 4 vs Ref 2.2) | MaxAbsErr: ${metricsDyn.maxAbsErr.toExponential(4)} | MAE: ${metricsDyn.mae.toExponential(4)}`);

console.log('\n--- 7. FLAT VS TILED PIXELBUFFER PATHS & EXTRA CHANNELS ---');
const flatBuf = new PixelBuffer(64, 64);
const tiledBuf = new TiledPixelBuffer(64, 64, 16);
const extraDataFlat = new Float32Array(64 * 64);
const extraDataTiled = new Float32Array(64 * 64);
for (let i = 0; i < 64 * 64; i++) {
  extraDataFlat[i] = i * 0.123;
  extraDataTiled[i] = i * 0.123;
}
flatBuf.setChannel('depth.Z', extraDataFlat);
tiledBuf.extraChannels.set('depth.Z', extraDataTiled);

for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    const v = (x + y) / 128.0;
    flatBuf.setPixel(x, y, v, v * 0.5, v * 2.0, 0.85);
    tiledBuf.setPixel(x, y, v, v * 0.5, v * 2.0, 0.85);
  }
}

const tileNode = new GradeNode('test_tiled_audit');
tileNode.setKnobValue('gain', 1.3);
tileNode.setKnobValue('gamma', 1.8);

const flatOut = tileNode.compute({ in: flatBuf });
const tiledOut = tileNode.compute({ in: tiledBuf });

let maxTiledErr = 0;
let alphaPreserved = true;
let extraPreserved = true;

for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    const fp = flatOut.getPixel(x, y);
    const tp = tiledOut.getPixel(x, y);
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(fp[c] - tp[c]);
      if (d > maxTiledErr) maxTiledErr = d;
    }
    if (Math.abs(fp[3] - 0.85) > 1e-6 || Math.abs(tp[3] - 0.85) > 1e-6) alphaPreserved = false;
  }
}

const flatExtra = flatOut.getChannel('depth.Z');
const tiledExtra = tiledOut.extraChannels ? tiledOut.extraChannels.get('depth.Z') : null;
if (!flatExtra || !tiledExtra) {
  extraPreserved = false;
} else {
  for (let i = 0; i < 64 * 64; i++) {
    if (flatExtra[i] !== extraDataFlat[i] || tiledExtra[i] !== extraDataTiled[i]) {
      extraPreserved = false;
      break;
    }
  }
}

console.log(`Flat vs Tiled Max Diff:   ${maxTiledErr.toExponential(4)}`);
console.log(`Alpha Channel Preserved:  ${alphaPreserved}`);
console.log(`Extra Channel (depth.Z):  ${extraPreserved}`);
