import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'assert';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ZDefocusNode } = await import('file:///' + path.join(workspace, 'src/nodes/ZDefocusNode.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

console.log('Testing current ZDefocus against existing Suite 62 test cases...');

// Test 1: Zero defocus
{
  const node = new ZDefocusNode('ZD_zero');
  node.setKnobValue('maxDefocus', 0.0);
  const img = new PixelBuffer(128, 128);
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.random();
  const depth = new PixelBuffer(128, 128);
  depth.data.fill(0.8);
  const out = node.compute({ in: img, depth });
  assert.equal(out.width, img.width);
  assert.equal(out.height, img.height);
  for (let i = 0; i < img.data.length; i++) {
    assert.equal(out.data[i], img.data[i]);
  }
  console.log('✅ Test 1: Zero Defocus passed');
}

// Test 2: HDR Specular
{
  const node = new ZDefocusNode('ZD_hdr');
  node.setKnobValue('focusPlane', 0.0);
  node.setKnobValue('depthOfField', 0.0);
  node.setKnobValue('maxDefocus', 8.0);
  node.setKnobValue('bloom', 0.5);

  const img = new PixelBuffer(64, 64);
  img.data.fill(0.1);
  const centerIdx = (32 * 64 + 32) * 4;
  img.data[centerIdx] = 25.0;
  img.data[centerIdx + 1] = 18.0;
  img.data[centerIdx + 2] = 12.0;
  img.data[centerIdx + 3] = 1.0;

  const depth = new PixelBuffer(64, 64);
  depth.data.fill(1.0);

  const out = node.compute({ in: img, depth });
  let maxR = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] > maxR) maxR = out.data[i];
    if (out.data[i] > 0.15) nonZeroCount++;
  }
  assert(nonZeroCount > 10);
  assert(maxR > 0.1);
  assert(!Number.isNaN(maxR));
  assert(Number.isFinite(maxR));
  console.log('✅ Test 2: HDR Specular passed');
}

// Test 3: Full 1080p
{
  const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
  const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');
  const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
  const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

  const node = new ZDefocusNode('ZD_1080p');
  node.setKnobValue('focusPlane', 0.5);
  node.setKnobValue('depthOfField', 0.12);
  node.setKnobValue('maxDefocus', 14.0);
  node.setKnobValue('aspectRatio', 1.0);
  node.setKnobValue('bloom', 0.25);

  const t0 = performance.now();
  const out = node.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
  const dt = performance.now() - t0;
  console.log(`✅ Test 3: 1080p computed in ${dt.toFixed(2)} ms`);
}

