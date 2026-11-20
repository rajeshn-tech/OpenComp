/**
 * OpenComp - Grade Node
 * High-performance implementation of industry standard's Grade algorithm.
 * Optimized with branch hoisting, transcendental power elimination for linear gamma,
 * 65536-entry interpolated LUT with near-zero and specular HDR exact bypass,
 * fast masked processing, and direct memory writing.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class GradeNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Grade', 'Color', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input');
    this.addInput('mask', 'mask', 'mask (Optional)');

    this.addKnob('blackpoint', 'Blackpoint', 'number', 0.0, { min: -1.0, max: 2.0, step: 0.005 });
    this.addKnob('whitepoint', 'Whitepoint', 'number', 1.0, { min: 0.01, max: 5.0, step: 0.01 });
    this.addKnob('lift', 'Lift', 'number', 0.0, { min: -1.0, max: 2.0, step: 0.01 });
    this.addKnob('gain', 'Gain', 'number', 1.0, { min: 0.0, max: 5.0, step: 0.01 });
    this.addKnob('multiply', 'Multiply', 'number', 1.0, { min: 0.0, max: 5.0, step: 0.01 });
    this.addKnob('offset', 'Offset', 'number', 0.0, { min: -1.0, max: 1.0, step: 0.005 });
    this.addKnob('gamma', 'Gamma', 'number', 1.0, { min: 0.1, max: 4.0, step: 0.01 });
    this.addKnob('blackClamp', 'Black Clamp', 'boolean', true);
    this.addKnob('whiteClamp', 'White Clamp', 'boolean', false);
    this.addKnob('reverse', 'Reverse', 'boolean', false);

    this._cachedLUTKey = null;
    this._cachedLUT = null;
    this._cachedLUTDelta = null;
    this._cachedUseLUT = false;
  }

  _getLUT(gamma, reverse) {
    const key = reverse ? `rev_${gamma}` : `fwd_${gamma}`;
    if (this._cachedLUTKey === key && this._cachedLUT) {
      return { lut: this._cachedLUT, lutDelta: this._cachedLUTDelta, useLUT: this._cachedUseLUT };
    }
    const exponent = reverse ? gamma : (1.0 / gamma);
    // When exponent is extreme (< 0.25 or > 4.0), Math.pow is evaluated directly for exact precision
    const useLUT = exponent >= 0.25 && exponent <= 4.0;

    let lut = null;
    let lutDelta = null;

    if (useLUT) {
      const LUT_SIZE = 65536;
      const LUT_MAX = 4.0;
      const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;

      lut = new Float32Array(LUT_SIZE + 1);
      lutDelta = new Float32Array(LUT_SIZE + 1);

      for (let i = 0; i <= LUT_SIZE; i++) {
        lut[i] = Math.pow(i * LUT_INV_SCALE, exponent);
      }
      for (let i = 0; i < LUT_SIZE; i++) {
        lutDelta[i] = lut[i + 1] - lut[i];
      }
      lutDelta[LUT_SIZE] = 0;
    }

    this._cachedLUTKey = key;
    this._cachedLUT = lut;
    this._cachedLUTDelta = lutDelta;
    this._cachedUseLUT = useLUT;
    return { lut, lutDelta, useLUT };
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
    const useLUT = lutData ? lutData.useLUT : false;

    // Fast Path: Unmasked Grade
    if (!mask) {
      if (!reverse) {
        if (isLinearGamma) {
          if (blackClamp && !whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;
              if (r < 0) r = 0;
              if (g < 0) g = 0;
              if (b < 0) b = 0;
              dst[i] = r;
              dst[i + 1] = g;
              dst[i + 2] = b;
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

              if (r > 0) {
                if (useLUT && r >= 0.002 && r <= 4.0) {
                  const idxF = r * 16384.0;
                  const idx = idxF | 0;
                  dst[i] = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  dst[i] = Math.pow(r, invGamma);
                }
              } else {
                dst[i] = 0;
              }

              if (g > 0) {
                if (useLUT && g >= 0.002 && g <= 4.0) {
                  const idxF = g * 16384.0;
                  const idx = idxF | 0;
                  dst[i + 1] = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  dst[i + 1] = Math.pow(g, invGamma);
                }
              } else {
                dst[i + 1] = 0;
              }

              if (b > 0) {
                if (useLUT && b >= 0.002 && b <= 4.0) {
                  const idxF = b * 16384.0;
                  const idx = idxF | 0;
                  dst[i + 2] = lut[idx] + (idxF - idx) * lutDelta[idx];
                } else {
                  dst[i + 2] = Math.pow(b, invGamma);
                }
              } else {
                dst[i + 2] = 0;
              }

              dst[i + 3] = src[i + 3];
            }
          } else if (blackClamp && whiteClamp) {
            for (let i = 0; i < len; i += 4) {
              let r = A * src[i] + B;
              let g = A * src[i + 1] + B;
              let b = A * src[i + 2] + B;

              if (r > 0) {
                if (useLUT && r >= 0.002 && r <= 4.0) {
                  const idxF = r * 16384.0;
                  const idx = idxF | 0;
                  const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                  dst[i] = val > 1.0 ? 1.0 : val;
                } else {
                  const val = Math.pow(r, invGamma);
                  dst[i] = val > 1.0 ? 1.0 : val;
                }
              } else {
                dst[i] = 0;
              }

              if (g > 0) {
                if (useLUT && g >= 0.002 && g <= 4.0) {
                  const idxF = g * 16384.0;
                  const idx = idxF | 0;
                  const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                  dst[i + 1] = val > 1.0 ? 1.0 : val;
                } else {
                  const val = Math.pow(g, invGamma);
                  dst[i + 1] = val > 1.0 ? 1.0 : val;
                }
              } else {
                dst[i + 1] = 0;
              }

              if (b > 0) {
                if (useLUT && b >= 0.002 && b <= 4.0) {
                  const idxF = b * 16384.0;
                  const idx = idxF | 0;
                  const val = lut[idx] + (idxF - idx) * lutDelta[idx];
                  dst[i + 2] = val > 1.0 ? 1.0 : val;
                } else {
                  const val = Math.pow(b, invGamma);
                  dst[i + 2] = val > 1.0 ? 1.0 : val;
                }
              } else {
                dst[i + 2] = 0;
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
                if (useLUT && r >= 0.002 && r <= 4.0) {
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
                if (useLUT && g >= 0.002 && g <= 4.0) {
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
                if (useLUT && b >= 0.002 && b <= 4.0) {
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
              if (useLUT && r >= 0.002 && r <= 4.0) {
                const idxF = r * 16384.0;
                const idx = idxF | 0;
                r = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                r = Math.pow(r, gamma);
              }
            }
            if (g > 0) {
              if (useLUT && g >= 0.002 && g <= 4.0) {
                const idxF = g * 16384.0;
                const idx = idxF | 0;
                g = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                g = Math.pow(g, gamma);
              }
            }
            if (b > 0) {
              if (useLUT && b >= 0.002 && b <= 4.0) {
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

      if (maskVal <= 0) {
        dst[i] = src[i];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i + 2];
        dst[i + 3] = src[i + 3];
        continue;
      }

      if (maskVal >= 1.0) {
        let r = src[i];
        let g = src[i + 1];
        let b = src[i + 2];

        if (!reverse) {
          r = A * r + B;
          g = A * g + B;
          b = A * b + B;

          if (r > 0) {
            if (!isLinearGamma) {
              if (useLUT && r >= 0.002 && r <= 4.0) {
                const idxF = r * 16384.0;
                const idx = idxF | 0;
                r = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                r = Math.pow(r, invGamma);
              }
            }
          } else if (blackClamp) {
            r = 0;
          }

          if (g > 0) {
            if (!isLinearGamma) {
              if (useLUT && g >= 0.002 && g <= 4.0) {
                const idxF = g * 16384.0;
                const idx = idxF | 0;
                g = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                g = Math.pow(g, invGamma);
              }
            }
          } else if (blackClamp) {
            g = 0;
          }

          if (b > 0) {
            if (!isLinearGamma) {
              if (useLUT && b >= 0.002 && b <= 4.0) {
                const idxF = b * 16384.0;
                const idx = idxF | 0;
                b = lut[idx] + (idxF - idx) * lutDelta[idx];
              } else {
                b = Math.pow(b, invGamma);
              }
            }
          } else if (blackClamp) {
            b = 0;
          }
        } else {
          if (r > 0 && !isLinearGamma) {
            if (useLUT && r >= 0.002 && r <= 4.0) {
              const idxF = r * 16384.0;
              const idx = idxF | 0;
              r = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              r = Math.pow(r, gamma);
            }
          }
          if (g > 0 && !isLinearGamma) {
            if (useLUT && g >= 0.002 && g <= 4.0) {
              const idxF = g * 16384.0;
              const idx = idxF | 0;
              g = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              g = Math.pow(g, gamma);
            }
          }
          if (b > 0 && !isLinearGamma) {
            if (useLUT && b >= 0.002 && b <= 4.0) {
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

      // Blended intermediate (0 < maskVal < 1.0)
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

        if (r > 0) {
          if (!isLinearGamma) {
            if (useLUT && r >= 0.002 && r <= 4.0) {
              const idxF = r * 16384.0;
              const idx = idxF | 0;
              r = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              r = Math.pow(r, invGamma);
            }
          }
        } else if (blackClamp) {
          r = 0;
        }

        if (g > 0) {
          if (!isLinearGamma) {
            if (useLUT && g >= 0.002 && g <= 4.0) {
              const idxF = g * 16384.0;
              const idx = idxF | 0;
              g = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              g = Math.pow(g, invGamma);
            }
          }
        } else if (blackClamp) {
          g = 0;
        }

        if (b > 0) {
          if (!isLinearGamma) {
            if (useLUT && b >= 0.002 && b <= 4.0) {
              const idxF = b * 16384.0;
              const idx = idxF | 0;
              b = lut[idx] + (idxF - idx) * lutDelta[idx];
            } else {
              b = Math.pow(b, invGamma);
            }
          }
        } else if (blackClamp) {
          b = 0;
        }
      } else {
        if (r > 0 && !isLinearGamma) {
          if (useLUT && r >= 0.002 && r <= 4.0) {
            const idxF = r * 16384.0;
            const idx = idxF | 0;
            r = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            r = Math.pow(r, gamma);
          }
        }
        if (g > 0 && !isLinearGamma) {
          if (useLUT && g >= 0.002 && g <= 4.0) {
            const idxF = g * 16384.0;
            const idx = idxF | 0;
            g = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            g = Math.pow(g, gamma);
          }
        }
        if (b > 0 && !isLinearGamma) {
          if (useLUT && b >= 0.002 && b <= 4.0) {
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
