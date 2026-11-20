import fs from 'fs';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

const w = 4, h = 4;
function makeGrayscaleYEXR() {
  const allChannelNames = ['Y'];
  const channels = ['Y'];
  const bytesPerPixelPerChannel = 4;
  const scanlineDataSize = w * channels.length * bytesPerPixelPerChannel;
  const headerParts = [];

  const addAttr = (name, type, valBytes) => {
    const nBytes = new TextEncoder().encode(name + '\0');
    const tBytes = new TextEncoder().encode(type + '\0');
    const sizeBuf = new Uint8Array(4);
    new DataView(sizeBuf.buffer).setUint32(0, valBytes.length, true);
    headerParts.push(nBytes, tBytes, sizeBuf, valBytes);
  };

  const chBuf = [];
  for (const chName of channels) {
    const nameBytes = new TextEncoder().encode(chName + '\0');
    chBuf.push(...nameBytes);
    const typeBytes = new Uint8Array(4);
    new DataView(typeBytes.buffer).setUint32(0, 2, true); // FLOAT
    chBuf.push(...typeBytes);
    chBuf.push(0); // pLinear
    chBuf.push(0, 0, 0); // reserved
    const samp = new Uint8Array(8);
    const sv = new DataView(samp.buffer);
    sv.setInt32(0, 1, true);
    sv.setInt32(4, 1, true);
    chBuf.push(...samp);
  }
  chBuf.push(0);
  addAttr('channels', 'chlist', new Uint8Array(chBuf));

  const compBuf = new Uint8Array([0]);
  addAttr('compression', 'compression', compBuf);

  const boxBuf = new Uint8Array(16);
  const bv = new DataView(boxBuf.buffer);
  bv.setInt32(0, 0, true);
  bv.setInt32(4, 0, true);
  bv.setInt32(8, w - 1, true);
  bv.setInt32(12, h - 1, true);
  addAttr('dataWindow', 'box2i', boxBuf);
  addAttr('displayWindow', 'box2i', boxBuf);

  const lineOrderBuf = new Uint8Array([0]);
  addAttr('lineOrder', 'lineOrder', lineOrderBuf);

  let totalHeaderLen = 8 + 1;
  for (const p of headerParts) totalHeaderLen += p.length;
  const headerBytes = new Uint8Array(totalHeaderLen);
  const hv = new DataView(headerBytes.buffer);
  hv.setUint32(0, ImageIO.EXR_MAGIC, true);
  hv.setUint32(4, ImageIO.EXR_VERSION, true);
  let hPos = 8;
  for (const p of headerParts) {
    headerBytes.set(p, hPos);
    hPos += p.length;
  }
  headerBytes[hPos++] = 0;

  const lineTableSize = h * 8;
  const lineTableOffset = totalHeaderLen;
  const firstScanlineOffset = lineTableOffset + lineTableSize;
  const scanlineChunkSize = 8 + scanlineDataSize;
  const totalFileSize = firstScanlineOffset + h * scanlineChunkSize;

  const fileBytes = new Uint8Array(totalFileSize);
  fileBytes.set(headerBytes, 0);
  const fv = new DataView(fileBytes.buffer);

  for (let y = 0; y < h; y++) {
    const offset = firstScanlineOffset + y * scanlineChunkSize;
    fv.setBigUint64(lineTableOffset + y * 8, BigInt(offset), true);
  }

  for (let y = 0; y < h; y++) {
    const chunkStart = firstScanlineOffset + y * scanlineChunkSize;
    fv.setInt32(chunkStart, y, true);
    fv.setInt32(chunkStart + 4, scanlineDataSize, true);
    let curDataPos = chunkStart + 8;

    for (let x = 0; x < w; x++) {
      fv.setFloat32(curDataPos, 0.75, true);
      curDataPos += 4;
    }
  }

  return fileBytes;
}

const yBytes = makeGrayscaleYEXR();
const loadedY = ImageIO.readEXR(yBytes);
console.log('Grayscale Y EXR channels loaded:', loadedY.getChannelNames());
console.log('Grayscale Y pixel (0,0):', loadedY.getPixel(0, 0));
console.log('Grayscale Y getChannel("Y"):', loadedY.getChannel('Y'));

