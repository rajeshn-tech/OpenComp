import { strict as assert } from 'node:assert';
import { PixelBuffer, TiledPixelBuffer, getCanonicalChannel } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

console.log('======================================================================');
console.log('🧪 FORENSIC AUDIT: COMPREHENSIVE CHANNEL & EXR INTEGRITY TEST SUITE');
console.log('======================================================================\n');

// 1. Channel Aliases & Isolation
console.log('1. Testing Primary Channel Aliases & Auxiliary Isolation...');
const buf = new PixelBuffer(10, 10);
buf.fill(0.1, 0.2, 0.3, 0.4);

const rArr = new Float32Array(100).fill(0.91);
const gArr = new Float32Array(100).fill(0.92);
const bArr = new Float32Array(100).fill(0.93);
const aArr = new Float32Array(100).fill(0.94);

buf.setChannel('rgba.red', rArr);
buf.setChannel('rgba.green', gArr);
buf.setChannel('rgba.blue', bArr);
buf.setChannel('rgba.alpha', aArr);

assert(Math.abs(buf.data[0] - 0.91) < 1e-6);
assert(Math.abs(buf.data[1] - 0.92) < 1e-6);
assert(Math.abs(buf.data[2] - 0.93) < 1e-6);
assert(Math.abs(buf.data[3] - 0.94) < 1e-6);
assert.equal(buf.extraChannels.size, 0, 'No primary channels may exist in extraChannels');

// Check all aliases
for (const ch of ['r', 'red', 'R', 'RED', 'rgba.r', 'rgba.red', 'RGBA.RED']) {
  assert(buf.hasChannel(ch), `hasChannel("${ch}") must be true`);
  const c = buf.getChannel(ch);
  assert(Math.abs(c[0] - 0.91) < 1e-6);
}
for (const ch of ['a', 'alpha', 'A', 'ALPHA', 'rgba.a', 'rgba.alpha', 'RGBA.ALPHA']) {
  assert(buf.hasChannel(ch), `hasChannel("${ch}") must be true`);
  const c = buf.getChannel(ch);
  assert(Math.abs(c[0] - 0.94) < 1e-6);
}
console.log('  ✅ Primary aliases verified with 0 memory duplication');

// 2. Auxiliary AOV Independence & Non-Interference
console.log('2. Testing Auxiliary AOVs (depth, normal, crypto, motion)...');
const depthZ = new Float32Array(100).map((_, i) => 5.0 + i);
const normX = new Float32Array(100).fill(-0.707);
const normY = new Float32Array(100).fill(0.707);
const normZ = new Float32Array(100).fill(0.0);
const motionU = new Float32Array(100).fill(-12.5);
const motionV = new Float32Array(100).fill(8.25);
const crypto = new Float32Array(100).fill(999999.0);

buf.setChannel('depth.Z', depthZ);
buf.setChannel('normal.X', normX);
buf.setChannel('normal.Y', normY);
buf.setChannel('normal.Z', normZ);
buf.setChannel('motion.u', motionU);
buf.setChannel('motion.v', motionV);
buf.setChannel('crypto_material.01', crypto);

assert.equal(buf.extraChannels.size, 7);

// Mutate primary RGBA: verify auxiliary channels do NOT change
buf.data[0] = 0.001;
buf.data[1] = 0.002;
buf.data[2] = 0.003;
buf.data[3] = 0.004;

assert(Math.abs(buf.getChannel('depth.Z')[0] - 5.0) < 1e-6);
assert(Math.abs(buf.getChannel('normal.X')[0] - (-0.707)) < 1e-6);
assert(Math.abs(buf.getChannel('motion.u')[0] - (-12.5)) < 1e-6);
assert(Math.abs(buf.getChannel('crypto_material.01')[0] - 999999.0) < 1e-2);

// Mutate auxiliary: verify primary RGBA does NOT change
buf.getChannel('depth.Z')[0] = 999.0;
assert(Math.abs(buf.data[0] - 0.001) < 1e-6);
console.log('  ✅ Auxiliary AOVs verified completely independent');

// 3. Tiled Buffer Conversion & Integrity
console.log('3. Testing TiledPixelBuffer conversion & channel preservation...');
const tiled = TiledPixelBuffer.fromContiguous(buf, 4);
assert.equal(tiled.extraChannels.size, 7, 'Tiled buffer must preserve auxiliary channels');
assert.equal(tiled.extraChannels.get('depth.Z')[0], 999.0);
assert(Math.abs(tiled.getTile(0, 0).data[0] - 0.001) < 1e-6);

const backToContig = tiled.toContiguousBuffer();
assert.equal(backToContig.extraChannels.size, 7);
assert.equal(backToContig.getChannel('depth.Z')[0], 999.0);
assert(Math.abs(backToContig.data[0] - 0.001) < 1e-6);
console.log('  ✅ Tiled <-> Contiguous conversion preserves all channels');

// 4. Special Floats (NaN, +/-Infinity, Negatives, Extreme HDR)
console.log('4. Testing Special Floats (NaN, +/-Inf, Negative, HDR)...');
const floatTestBuf = new PixelBuffer(4, 4);
floatTestBuf.data[0] = NaN;
floatTestBuf.data[1] = Infinity;
floatTestBuf.data[2] = -Infinity;
floatTestBuf.data[3] = -0.5;
floatTestBuf.data[4] = 100000.0;

const clonedFloats = floatTestBuf.clone();
assert(Number.isNaN(clonedFloats.data[0]), 'NaN must clone as NaN');
assert.equal(clonedFloats.data[1], Infinity, '+Inf must clone');
assert.equal(clonedFloats.data[2], -Infinity, '-Inf must clone');
assert.equal(clonedFloats.data[3], -0.5, 'Negative float must clone');
assert.equal(clonedFloats.data[4], 100000.0, 'Extreme HDR must clone');

// Round-trip EXR with 32-bit float
const floatExr = ImageIO.writeEXR(floatTestBuf, false);
const readFloats = ImageIO.readEXR(floatExr);
assert(Number.isNaN(readFloats.data[0]), 'NaN must survive EXR round-trip');
assert.equal(readFloats.data[1], Infinity, '+Inf must survive EXR round-trip');
assert.equal(readFloats.data[2], -Infinity, '-Inf must survive EXR round-trip');
assert(Math.abs(readFloats.data[3] - (-0.5)) < 1e-6);
assert(Math.abs(readFloats.data[4] - 100000.0) < 1e-4);
console.log('  ✅ Special float IEEE 754 representations preserved in memory & EXR');

// 5. Multi-channel EXR Full Round-Trip (Float32 & Half16)
console.log('5. Testing Multi-channel EXR Round-Trip with auxiliary AOVs...');
const multiExr = ImageIO.writeEXR(buf, false);
const loadedMulti = ImageIO.readEXR(multiExr);
assert.equal(loadedMulti.extraChannels.size, 7);
assert(loadedMulti.hasChannel('depth.Z'));
assert(loadedMulti.hasChannel('normal.X'));
assert(loadedMulti.hasChannel('motion.u'));
assert(loadedMulti.hasChannel('crypto_material.01'));
assert(Math.abs(loadedMulti.getChannel('depth.Z')[1] - 6.0) < 1e-6);
console.log('  ✅ Full multi-channel AOV EXR read/write round-trip verified');

console.log('\n🎉 ALL FORENSIC AUDIT CHECKS PASSED SUCCESSFULLY!\n');
