import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode: OldGradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

// Define candidate Optimized GradeNode
class OptimizedGradeNode extends OldGradeNode {
  _getLUT(gamma, reverse) {
    const key = reverse ? `rev_${gamma}` : `fwd_${gamma}`;
    if (this._cachedLUTKey === key && this._cachedLUT) {
      return { lut: this._cachedLUT, lutDelta: this._cachedLUTDelta };
    }
    const LUT_SIZE = 65536;
    const LUT_MAX = 4.0;
    const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;
    const exponent = reverse ? gamma : (1.0 / gamma);

    const lut = new Float32Array(LUT_SIZE + 1);
    const lutDelta = new Float32Array(LUT_SIZE + 1);

    for (let i = 0; i <= LUT_SIZE; i++) {
      lut[i] = Math.pow(i * LUT_INV_SCALE, exponent);
    }
    for (let i = 0; i < LUT_SIZE; i++) {
      lutDelta[i] = lut[i + 1] - lut[i];
    }
    lutDelta[LUT_SIZE] = 0;

    this._cachedLUTKey = key;
    this._cachedLUT = lut;
    this._cachedLUTDelta = lutDelta;
    return { lut, lutDelta };
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    if (this.disabled) return inputBuf.clone();

    const maskBuf = inputs['mask'];
    const isTiled = !!inputBuf.isTiled;

    const bp = Number(this.getKnobValue('blackpoint', context)) ?? 0.0;
    const wp = Math.max(0.0001, Number(this.getKnobValue('whitepoint', context)) ?? 1.0);
    const lift = Number(this.getKnobValue('lift', context)) ?? 0.0;
    const gain = Number(this.getKnobValue('gain', context)) ?? 1.0;
    const mult = Number(this.getKnobValue('multiply', context)) ?? 1.0;
    const offset = Number(this.getKnobValue('offset', context)) ?? 0.0;
    const gamma = Math.max(0.0001, Number(this.getKnobValue('gamma', context)) ?? 1.0);
    const blackClamp = !!this.getKnobValue('blackClamp', context);
    const whiteClamp = !!this.getKnobValue('whiteClamp', context);
    const reverse = !!this.getKnobValue('reverse', context);

    // Grade mathematical terms
    const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
    const A = mult * (gain - lift) / denom;
    const B = offset + lift - A * bp;
    const invA = A !== 0 ? (1.0 / A) : 0;
    const invGamma = 1.0 / gamma;
    const isLinearGamma = Math.abs(gamma - 1.0) < 1e-5;

    let lutData = null;
    if (!isLinearGamma) {
      lutData = this._getLUT(gamma, reverse);
    }

    const params = { A, B, invA, gamma, invGamma, isLinearGamma, blackClamp, whiteClamp, reverse };
    const outBBox = this.getBBox(inputs, context);

    if (isTiled) {
      const result = new TiledPixelBuffer(inputBuf.width, inputBuf.height, inputBuf.tileSize);
      result.bbox = outBBox;
      if (inputBuf.extraChannels && inputBuf.extraChannels.size > 0) {
        result.copyChannelsFrom(inputBuf);
      }
      for (let r = 0; r < inputBuf.rows; r++) {
        for (let c = 0; c < inputBuf.cols; c++) {
          const inTile = inputBuf.getTile(c, r);
          const outTile = result.getTile(c, r);
          const maskTile = (maskBuf && maskBuf.isTiled) ? maskBuf.getTile(c, r) : null;
          this._applyGrade(inTile.data, outTile.data, maskTile ? maskTile.data : null, inTile.data.length, params, lutData);
        }
      }
      return result;
    }

    const resampledMask = (maskBuf && (maskBuf.width !== inputBuf.width || maskBuf.height !== inputBuf.height))
      ? maskBuf.resample(inputBuf.width, inputBuf.height)
      : maskBuf;

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    result.bbox = outBBox;
    if (inputBuf.extraChannels && inputBuf.extraChannels.size > 0) {
      result.copyChannelsFrom(inputBuf);
    }
    this._applyGrade(inputBuf.data, result.data, resampledMask ? resampledMask.data : null, inputBuf.data.length, params, lutData);
    return result;
  }

  _applyGrade(src, dst, mask, len, params, lutData) {
    const { A, B, invA, gamma, invGamma, isLinearGamma, blackClamp, whiteClamp, reverse } = params;
    const lut = lutData ? lutData.lut : null;
    const lutDelta = lutData ? lutData.lutDelta : null;

    // Fast Path: Unmasked Grade
    if (!mask) {
      if (!reverse) {
        if (isLinearGamma) {
          if (blackClamp && !whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;
              dst[i] = r < 0 ? 0 : r;
              dst[i + 1] = g < 0 ? 0 : g;
              dst[i + 2] = b < 0 ? 0 : b;
              dst[i + 3] = src[i + 3];
            }
          } else if (blackClamp && whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;
              if (r < 0) r = 0; else if (r > 1) r = 1;
              if (g < 0) g = 0; else if (g > 1) g = 1;
              if (b < 0) b = 0; else if (b > 1) b = 1;
              dst[i] = r;
              dst[i + 1] = g;
              dst[i + 2] = b;
              dst[i + 3] = src[i + 3];
            }
          } else {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;
              if (blackClamp) {
                if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
              }
              if (whiteClamp) {
                if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
              }
              dst[i] = r;
              dst[i + 1] = g;
              dst[i + 2] = b;
              dst[i + 3] = src[i + 3];
            }
          }
        } else {
          // Non-linear gamma with high-precision LUT
          if (blackClamp && !whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;

              if (r <= 0) {
                dst[i] = 0;
              } else if (r <= 4.0) {
                const idxF = r * 16384.0;
                const idx = idxF | 0;
                dst[i] = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                dst[i] = Math.pow(r, invGamma);
              }

              if (g <= 0) {
                dst[i + 1] = 0;
              } else if (g <= 4.0) {
                const idxF = g * 16384.0;
                const idx = idxF | 0;
                dst[i + 1] = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                dst[i + 1] = Math.pow(g, invGamma);
              }

              if (b <= 0) {
                dst[i + 2] = 0;
              } else if (b <= 4.0) {
                const idxF = b * 16384.0;
                const idx = idxF | 0;
                dst[i + 2] = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                dst[i + 2] = Math.pow(b, invGamma);
              }

              dst[i + 3] = src[i + 3];
            }
          } else if (blackClamp && whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;

              if (r <= 0) {
                dst[i] = 0;
              } else if (r <= 4.0) {
                const idxF = r * 16384.0;
                const idx = idxF | 0;
                const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                dst[i] = val > 1.0 ? 1.0 : val;
              } else {
                dst[i] = 1.0;
              }

              if (g <= 0) {
                dst[i + 1] = 0;
              } else if (g <= 4.0) {
                const idxF = g * 16384.0;
                const idx = idxF | 0;
                const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                dst[i + 1] = val > 1.0 ? 1.0 : val;
              } else {
                dst[i + 1] = 1.0;
              }

              if (b <= 0) {
                dst[i + 2] = 0;
              } else if (b <= 4.0) {
                const idxF = b * 16384.0;
                const idx = idxF | 0;
                const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                dst[i + 2] = val > 1.0 ? 1.0 : val;
              } else {
                dst[i + 2] = 1.0;
              }

              dst[i + 3] = src[i + 3];
            }
          } else {
            // General clamping (e.g. !blackClamp)
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;

              if (r > 0) {
                if (r <= 4.0) {
                  const idxF = r * 16384.0;
                  const idx = idxF | 0;
                  r = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  r = Math.pow(r, invGamma);
                }
              } else if (blackClamp) {
                r = 0;
              }

              if (g > 0) {
                if (g <= 4.0) {
                  const idxF = g * 16384.0;
                  const idx = idxF | 0;
                  g = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  g = Math.pow(g, invGamma);
                }
              } else if (blackClamp) {
                g = 0;
              }

              if (b > 0) {
                if (b <= 4.0) {
                  const idxF = b * 16384.0;
                  const idx = idxF | 0;
                  b = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  b = Math.pow(b, invGamma);
                }
              } else if (blackClamp) {
                b = 0;
              }

              if (whiteClamp) {
                if (r > 1) r = 1;
                if (g > 1) g = 1;
                if (b > 1) b = 1;
              }

              dst[i] = r;
              dst[i + 1] = g;
              dst[i + 2] = b;
              dst[i + 3] = src[i + 3];
            }
          }
        }
      } else {
        // Reverse Grade
        if (isLinearGamma) {
          for (let i = 0; i < len; i += 4) {
            let r = (src[i] - B) * invA;
            let g = (src[i + 1] - B) * invA;
            let b = (src[i + 2] - B) * invA;
            if (blackClamp) {
              if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
            }
            if (whiteClamp) {
              if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
            }
            dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
          }
        } else {
          for (let i = 0; i < len; i += 4) {
            let r = src[i];
            let g = src[i + 1];
            let b = src[i + 2];

            if (r > 0) {
              if (r <= 4.0) {
                const idxF = r * 16384.0;
                const idx = idxF | 0;
                r = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                r = Math.pow(r, gamma);
              }
            }
            if (g > 0) {
              if (g <= 4.0) {
                const idxF = g * 16384.0;
                const idx = idxF | 0;
                g = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                g = Math.pow(g, gamma);
              }
            }
            if (b > 0) {
              if (b <= 4.0) {
                const idxF = b * 16384.0;
                const idx = idxF | 0;
                b = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                b = Math.pow(b, gamma);
              }
            }

            r = (r - B) * invA;
            g = (g - B) * invA;
            b = (b - B) * invA;

            if (blackClamp) {
              if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
            }
            if (whiteClamp) {
              if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
            }
            dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
          }
        }
      }
      return;
    }

    // Masked Grade Path
    for (let i = 0; i < len; i += 4) {
      const maskVal = mask[i + 3];

      if (maskVal <= 0.0001) {
        dst[i] = src[i];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i + 2];
        dst[i + 3] = src[i + 3];
        continue;
      }

      if (maskVal >= 0.9999) {
        let r = src[i];
        let g = src[i + 1];
        let b = src[i + 2];

        if (!reverse) {
          r = A * r + B;
          g = A * g + B;
          b = A * b + B;

          if (r <= 0) {
            if (blackClamp) r = 0;
          } else if (!isLinearGamma) {
            if (r <= 4.0) {
              const idxF = r * 16384.0;
              const idx = idxF | 0;
              r = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              r = Math.pow(r, invGamma);
            }
          }

          if (g <= 0) {
            if (blackClamp) g = 0;
          } else if (!isLinearGamma) {
            if (g <= 4.0) {
              const idxF = g * 16384.0;
              const idx = idxF | 0;
              g = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              g = Math.pow(g, invGamma);
            }
          }

          if (b <= 0) {
            if (blackClamp) b = 0;
          } else if (!isLinearGamma) {
            if (b <= 4.0) {
              const idxF = b * 16384.0;
              const idx = idxF | 0;
              b = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              b = Math.pow(b, invGamma);
            }
          }
        } else {
          if (r > 0 && !isLinearGamma) {
            if (r <= 4.0) {
              const idxF = r * 16384.0;
              const idx = idxF | 0;
              r = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              r = Math.pow(r, gamma);
            }
          }
          if (g > 0 && !isLinearGamma) {
            if (g <= 4.0) {
              const idxF = g * 16384.0;
              const idx = idxF | 0;
              g = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              g = Math.pow(g, gamma);
            }
          }
          if (b > 0 && !isLinearGamma) {
            if (b <= 4.0) {
              const idxF = b * 16384.0;
              const idx = idxF | 0;
              b = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              b = Math.pow(b, gamma);
            }
          }

          r = (r - B) * invA;
          g = (g - B) * invA;
          b = (b - B) * invA;
        }

        if (blackClamp) {
          if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
        }
        if (whiteClamp) {
          if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
        }

        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = src[i + 3];
        continue;
      }

      // Blended intermediate
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      const origR = r;
      const origG = g;
      const origB = b;

      if (!reverse) {
        r = A * r + B;
        g = A * g + B;
        b = A * b + B;

        if (r <= 0) {
          if (blackClamp) r = 0;
        } else if (!isLinearGamma) {
          if (r <= 4.0) {
            const idxF = r * 16384.0;
            const idx = idxF | 0;
            r = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            r = Math.pow(r, invGamma);
          }
        }

        if (g <= 0) {
          if (blackClamp) g = 0;
        } else if (!isLinearGamma) {
          if (g <= 4.0) {
            const idxF = g * 16384.0;
            const idx = idxF | 0;
            g = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            g = Math.pow(g, invGamma);
          }
        }

        if (b <= 0) {
          if (blackClamp) b = 0;
        } else if (!isLinearGamma) {
          if (b <= 4.0) {
            const idxF = b * 16384.0;
            const idx = idxF | 0;
            b = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            b = Math.pow(b, invGamma);
          }
        }
      } else {
        if (r > 0 && !isLinearGamma) {
          if (r <= 4.0) {
            const idxF = r * 16384.0;
            const idx = idxF | 0;
            r = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            r = Math.pow(r, gamma);
          }
        }
        if (g > 0 && !isLinearGamma) {
          if (g <= 4.0) {
            const idxF = g * 16384.0;
            const idx = idxF | 0;
            g = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            g = Math.pow(g, gamma);
          }
        }
        if (b > 0 && !isLinearGamma) {
          if (b <= 4.0) {
            const idxF = b * 16384.0;
            const idx = idxF | 0;
            b = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            b = Math.pow(b, gamma);
          }
        }

        r = (r - B) * invA;
        g = (g - B) * invA;
        b = (b - B) * invA;
      }

      if (blackClamp) {
        if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
      }
      if (whiteClamp) {
        if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
      }

      dst[i] = origR + (r - origR) * maskVal;
      dst[i + 1] = origG + (g - origG) * maskVal;
      dst[i + 2] = origB + (b - origB) * maskVal;
      dst[i + 3] = src[i + 3];
    }
  }
}

// 2. Run Parity & Benchmark across all scenarios
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

// Create synthetic mask
const maskBuf = new PixelBuffer(plateBuf.width, plateBuf.height);
for (let y = 0; y < plateBuf.height; y++) {
  const normY = y / plateBuf.height;
  for (let x = 0; x < plateBuf.width; x++) {
    const idx = (y * plateBuf.width + x) * 4;
    // Gradient: top third = 0, middle third = ramp 0..1, bottom third = 1
    let m = 0;
    if (normY > 0.66) m = 1.0;
    else if (normY > 0.33) m = (normY - 0.33) / 0.33;
    maskBuf.data[idx + 3] = m;
  }
}

const testSuites = [
  { name: 'Grade_Atmosphere (Unmasked)', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false }, mask: false },
  { name: 'Grade_FilmMaster (Unmasked)', knobs: { lift: 0.015, gain: 1.05, gamma: 1.05, blackClamp: true, whiteClamp: false }, mask: false },
  { name: 'Grade_Rim (Unmasked)', knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false }, mask: false },
  { name: 'Linear Grade (Unmasked)', knobs: { lift: 0.1, gain: 1.5, gamma: 1.0, blackClamp: true, whiteClamp: false }, mask: false },
  { name: 'Both Clamps (Unmasked)', knobs: { lift: 0.05, gain: 1.2, gamma: 1.2, blackClamp: true, whiteClamp: true }, mask: false },
  { name: 'No Clamps (Unmasked)', knobs: { lift: -0.1, gain: 1.3, gamma: 0.8, blackClamp: false, whiteClamp: false }, mask: false },
  { name: 'Reverse Grade (Unmasked)', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false, reverse: true }, mask: false },
  { name: 'Grade_Rim (Masked)', knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false }, mask: true },
];

console.log('-----------------------------------------------------------------------------------------------------');
console.log('Test Scenario                      | Old Time   | New Time   | Speedup | Max Absolute Err | RMSE');
console.log('-----------------------------------------------------------------------------------------------------');

for (const suite of testSuites) {
  const oldNode = new OldGradeNode('old');
  const newNode = new OptimizedGradeNode('new');
  for (const [k, v] of Object.entries(suite.knobs)) {
    oldNode.setKnobValue(k, v);
    newNode.setKnobValue(k, v);
  }
  const inputs = { in: plateBuf };
  if (suite.mask) inputs.mask = maskBuf;

  // Warmup
  oldNode.compute(inputs);
  newNode.compute(inputs);

  // Measure Old
  const tOld0 = performance.now();
  const oldOut = oldNode.compute(inputs);
  const tOld = performance.now() - tOld0;

  // Measure New
  const tNew0 = performance.now();
  const newOut = newNode.compute(inputs);
  const tNew = performance.now() - tNew0;

  // Compute Error Metrics
  let maxErr = 0;
  let sumSqErr = 0;
  const len = oldOut.data.length;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(oldOut.data[i] - newOut.data[i]);
    if (diff > maxErr) maxErr = diff;
    sumSqErr += diff * diff;
  }
  const rmse = Math.sqrt(sumSqErr / len);

  const nameStr = suite.name.padEnd(34);
  const oldStr = `${tOld.toFixed(2)} ms`.padStart(10);
  const newStr = `${tNew.toFixed(2)} ms`.padStart(10);
  const spdStr = `${(tOld / tNew).toFixed(2)}x`.padStart(7);
  const maxErrStr = maxErr.toExponential(4).padStart(16);
  const rmseStr = rmse.toExponential(4).padStart(12);

  console.log(`${nameStr} | ${oldStr} | ${newStr} | ${spdStr} | ${maxErrStr} | ${rmseStr}`);
}
console.log('-----------------------------------------------------------------------------------------------------');
