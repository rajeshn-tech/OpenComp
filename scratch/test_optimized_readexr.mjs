import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const exrBytes = fs.readFileSync(path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr'));

// Standard read
const bufOrig = ImageIO.readEXR(exrBytes);

// Optimized unpack function
function readEXROptimized(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 16) throw new Error('Invalid EXR');
  let offset = 8;
  const header = {
    channels: [],
    compression: 0,
    dataWindow: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    displayWindow: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    lineOrder: 0
  };

  while (offset < bytes.length) {
    let name = '';
    while (bytes[offset] !== 0 && offset < bytes.length) name += String.fromCharCode(bytes[offset++]);
    offset++;
    if (name.length === 0) break;
    let type = '';
    while (bytes[offset] !== 0 && offset < bytes.length) type += String.fromCharCode(bytes[offset++]);
    offset++;
    const size = view.getUint32(offset, true);
    offset += 4;
    const attrStart = offset;

    if (name === 'channels' && type === 'chlist') {
      let chOffset = attrStart;
      while (bytes[chOffset] !== 0 && chOffset < attrStart + size) {
        let chName = '';
        while (bytes[chOffset] !== 0) chName += String.fromCharCode(bytes[chOffset++]);
        chOffset++;
        const pType = view.getUint32(chOffset, true);
        chOffset += 4;
        chOffset += 4; // pLinear (1) + reserved (3)
        chOffset += 8; // xSampling (4) + ySampling (4)
        header.channels.push({ name: chName, type: pType });
      }
    } else if (name === 'dataWindow' && type === 'box2i') {
      header.dataWindow = {
        xMin: view.getInt32(attrStart, true),
        yMin: view.getInt32(attrStart + 4, true),
        xMax: view.getInt32(attrStart + 8, true),
        yMax: view.getInt32(attrStart + 12, true)
      };
    } else if (name === 'displayWindow' && type === 'box2i') {
      header.displayWindow = {
        xMin: view.getInt32(attrStart, true),
        yMin: view.getInt32(attrStart + 4, true),
        xMax: view.getInt32(attrStart + 8, true),
        yMax: view.getInt32(attrStart + 12, true)
      };
    } else if (name === 'compression' && type === 'compression') {
      header.compression = bytes[attrStart];
    } else if (name === 'lineOrder' && type === 'lineOrder') {
      header.lineOrder = bytes[attrStart];
    }
    offset = attrStart + size;
  }

  const width = header.dataWindow.xMax - header.dataWindow.xMin + 1;
  const height = header.dataWindow.yMax - header.dataWindow.yMin + 1;
  const pixelBuf = new PixelBuffer(width, height);
  const dstData = pixelBuf.data;
  const lineTableOffset = offset;

  if (header.compression === 3 || header.compression === 2) {
    const zlib = process.getBuiltinModule('node:zlib');
    const channelArrays = {};
    for (const ch of header.channels) {
      const lower = ch.name.toLowerCase();
      if (!['r', 'g', 'b', 'a', 'red', 'green', 'blue', 'alpha'].includes(lower)) {
        channelArrays[ch.name] = new Float32Array(width * height);
      }
    }
    ImageIO._unpackZIPScanlines(bytes, view, header, lineTableOffset, width, height, dstData, channelArrays, (compSlice) => zlib.inflateSync(compSlice));
    for (const [name, arr] of Object.entries(channelArrays)) {
      pixelBuf.setChannel(name, arr);
    }
  }
  pixelBuf.metadata = { ...header };
  return pixelBuf;
}

// Parity test
const bufOpt = readEXROptimized(exrBytes);
let maxErr = 0;
for (let i = 0; i < bufOrig.data.length; i++) {
  const err = Math.abs(bufOpt.data[i] - bufOrig.data[i]);
  if (err > maxErr) maxErr = err;
}

console.log(`Parity test maxErr: ${maxErr}`);
console.log(`Original extraChannels size: ${bufOrig.extraChannels.size}`);
console.log(`Optimized extraChannels size: ${bufOpt.extraChannels.size}`);

// Benchmark 10 iterations
const N = 10;
const t0 = performance.now();
for (let i = 0; i < N; i++) readEXROptimized(exrBytes);
const dtOpt = (performance.now() - t0) / N;

console.log(`Optimized readEXR average time: ${dtOpt.toFixed(2)} ms`);

