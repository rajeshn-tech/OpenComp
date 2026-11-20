/**
 * OpenComp - Pipeline Tokens & Path Resolution Engine
 * Handles explicit asset token substitution, frame pattern formatting,
 * escaped token handling, and cross-platform path mapping (Windows UNC <--> Linux NFS POSIX).
 * 
 * Note: Pure isomorphic JavaScript - zero Node-only imports (node:path, node:process)
 * to maintain seamless compatibility with browser ES module runtimes.
 */

const ESCAPE_PREFIX = '\u0001OPENCOMP_ESC_';
const ESCAPE_SUFFIX = '\u0002';

export class PipelineTokens {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.tokens={}] - Explicit studio/pipeline token definitions
   * @param {Array<{windows?: string, linux?: string, from?: string, to?: string, name?: string, caseSensitive?: boolean}>} [options.pathMappings=[]] - Cross-platform path mapping rules
   * @param {boolean} [options.strict=false] - Throw error on missing/unmapped tokens
   * @param {boolean} [options.useEnv=false] - Whether to fall back to process.env
   */
  constructor(options = {}) {
    // Support either constructor(tokens, pathMappings) or constructor({ tokens, pathMappings, strict, useEnv })
    if (options && (options.tokens !== undefined || options.pathMappings !== undefined || options.strict !== undefined || options.useEnv !== undefined)) {
      this.tokens = { ...options.tokens };
      this.pathMappings = [];
      this.strict = Boolean(options.strict);
      this.useEnv = Boolean(options.useEnv);
      if (Array.isArray(options.pathMappings)) {
        for (const m of options.pathMappings) this.addPathMapping(m);
      }
    } else {
      // Legacy signature constructor(customTokens, pathMappings)
      this.tokens = typeof options === 'object' && options !== null ? { ...options } : {};
      this.pathMappings = [];
      this.strict = false;
      this.useEnv = false;
      if (Array.isArray(arguments[1])) {
        for (const m of arguments[1]) this.addPathMapping(m);
      }
    }

    // Standard baseline token keys recognized by OpenComp
    this.standardKeys = new Set([
      'SHOT', 'SEQUENCE', 'VERSION', 'PROJECT', 'ASSET', 'USER', 'EXT', 'FRAME'
    ]);
  }

  /**
   * Set or update a pipeline token value
   * @param {string} key
   * @param {string|number} value
   */
  setToken(key, value) {
    if (!key) return;
    this.tokens[key] = String(value);
  }

  /**
   * Bulk set multiple tokens
   * @param {Object} tokenObj
   */
  setTokens(tokenObj) {
    if (tokenObj && typeof tokenObj === 'object') {
      for (const [k, v] of Object.entries(tokenObj)) {
        this.setToken(k, v);
      }
    }
  }

  /**
   * Clear all registered custom tokens
   */
  clearTokens() {
    this.tokens = {};
  }

  /**
   * Add a cross-platform path translation rule
   * @param {Object|string} ruleOrFrom
   * @param {string} [maybeTo]
   * @param {string} [name='']
   * @param {boolean} [caseSensitive=false]
   */
  addPathMapping(ruleOrFrom, maybeTo, name = '', caseSensitive = false) {
    let winPrefix = '';
    let linuxPrefix = '';
    let ruleName = name;
    let isCaseSensitive = caseSensitive;

    if (typeof ruleOrFrom === 'object' && ruleOrFrom !== null) {
      winPrefix = ruleOrFrom.windows || ruleOrFrom.win || ruleOrFrom.from || '';
      linuxPrefix = ruleOrFrom.linux || ruleOrFrom.to || '';
      ruleName = ruleOrFrom.name || '';
      isCaseSensitive = ruleOrFrom.caseSensitive ?? false;
    } else if (typeof ruleOrFrom === 'string' && typeof maybeTo === 'string') {
      winPrefix = ruleOrFrom;
      linuxPrefix = maybeTo;
    }

    if (!winPrefix || !linuxPrefix) return;

    const normWin = winPrefix.replace(/\\/g, '/').replace(/\/+$/, '');
    const normLinux = linuxPrefix.replace(/\\/g, '/').replace(/\/+$/, '');

    this.pathMappings.push({
      windows: normWin,
      linux: normLinux,
      name: ruleName,
      caseSensitive: isCaseSensitive
    });
  }

  /**
   * Static evaluate convenience method using global pipeline tokens singleton
   * @param {string} templateStr
   * @param {Object} [context={}]
   * @returns {string}
   */
  static evaluate(templateStr, context = {}) {
    return globalPipelineTokens.resolve(templateStr, context);
  }

  static resolve(templateStr, context = {}) {
    return globalPipelineTokens.resolve(templateStr, context);
  }

  /**
   * Format integer frame number with arbitrary zero-padding
   * @param {number} frame
   * @param {number} [padding=4]
   * @returns {string}
   */
  static formatFrame(frame, padding = 4) {
    const isNegative = frame < 0;
    const absFrame = Math.abs(Math.trunc(frame));
    const padStr = String(absFrame).padStart(padding, '0');
    return isNegative ? `-${padStr}` : padStr;
  }

  /**
   * Resolves environment variables, template tokens, and frame numbers in a string template.
   * 
   * Syntax supported:
   * - ${TOKEN}, ${TOKEN:04d}
   * - $TOKEN
   * - {TOKEN}, {TOKEN:04d}
   * - #### (N hashes -> N padded digits)
   * - %04d, %03d, %d (printf style)
   * - Literal escaping: \${TOKEN}, \$TOKEN, \{TOKEN\}, \####, \%04d, \\
   * 
   * @param {string} templateStr
   * @param {Object} [context={}] - Context variables (e.g. { frame: 1042, shot: 'sh010' })
   * @param {Object} [options={}] - Override options (strict, useEnv)
   * @returns {string}
   */
  resolve(templateStr, context = {}, options = {}) {
    if (!templateStr || typeof templateStr !== 'string') return '';

    const isStrict = options.strict !== undefined ? Boolean(options.strict) : this.strict;
    const allowEnv = options.useEnv !== undefined ? Boolean(options.useEnv) : this.useEnv;

    const merged = { ...this.tokens, ...context };

    // Case-insensitive lookup helper
    const lookup = (key) => {
      if (merged[key] !== undefined) return merged[key];
      const upper = key.toUpperCase();
      if (merged[upper] !== undefined) return merged[upper];
      const lower = key.toLowerCase();
      if (merged[lower] !== undefined) return merged[lower];

      if (allowEnv && typeof process !== 'undefined' && process.env) {
        if (process.env[key] !== undefined) return process.env[key];
        if (process.env[upper] !== undefined) return process.env[upper];
        if (process.env[lower] !== undefined) return process.env[lower];
      }
      return undefined;
    };

    // 1. Stash escaped tokens to protect them from resolution
    const escapedStash = [];
    const stash = (literal) => {
      const idx = escapedStash.length;
      escapedStash.push(literal);
      return `${ESCAPE_PREFIX}${idx}${ESCAPE_SUFFIX}`;
    };

    let s = templateStr;
    // Escaped double backslash \\
    s = s.replace(/\\\\/g, () => stash('\\'));
    // Escaped ${...}
    s = s.replace(/\\(\$\{[a-zA-Z0-9_]+(?::[0-9]+d)?\})/g, (m, token) => stash(token));
    // Escaped $WORD
    s = s.replace(/\\(\$[a-zA-Z0-9_]+)/g, (m, token) => stash(token));
    // Escaped {...}
    s = s.replace(/\\(\{[a-zA-Z0-9_]+(?::[0-9]+d)?\})/g, (m, token) => stash(token));
    // Escaped ####
    s = s.replace(/\\(#+)/g, (m, token) => stash(token));
    // Escaped %04d / %d
    s = s.replace(/\\(%0?\d+d|%d)/g, (m, token) => stash(token));

    // 2. Resolve frame hashes if frame number is present in context
    if (context.frame !== undefined) {
      const frameNum = Number(context.frame);
      // Hash tokens: ####, ###, etc.
      s = s.replace(/(#+)/g, (m) => {
        return PipelineTokens.formatFrame(frameNum, m.length);
      });

      // Houdini @ tokens: @@@@, @@@, etc.
      s = s.replace(/(@+)/g, (m) => {
        return PipelineTokens.formatFrame(frameNum, m.length);
      });

      // Printf tokens: %04d, %3d, %d
      s = s.replace(/%0?(\d+)d/g, (m, digits) => {
        return PipelineTokens.formatFrame(frameNum, parseInt(digits, 10));
      });
      s = s.replace(/%d/g, () => String(Math.trunc(frameNum)));
    }

    // 3. Resolve ${TOKEN} or ${TOKEN:04d}
    s = s.replace(/\$\{([a-zA-Z0-9_]+)(?::([0-9]+)d)?\}/g, (match, key, pad) => {
      const val = lookup(key);
      if (val !== undefined) {
        if (pad) return PipelineTokens.formatFrame(Number(val), parseInt(pad, 10));
        return String(val);
      }
      if (isStrict) {
        throw new Error(`MissingTokenError: Unresolved token "\${${key}}" in template "${templateStr}"`);
      }
      return match;
    });

    // 4. Resolve $TOKEN (non-bracketed)
    s = s.replace(/\$([a-zA-Z0-9_]+)/g, (match, key) => {
      let val = lookup(key);
      if (val !== undefined) return String(val);

      // Handle cases where a separator underscore follows a known token (e.g. "$ASSET_$VERSION")
      if (key.includes('_')) {
        const parts = key.split('_');
        for (let i = parts.length - 1; i >= 1; i--) {
          const prefix = parts.slice(0, i).join('_');
          const suffix = parts.slice(i).join('_');
          const prefixVal = lookup(prefix);
          if (prefixVal !== undefined) {
            const trailing = suffix ? ('_' + suffix) : '_';
            return String(prefixVal) + trailing;
          }
        }
      }

      if (isStrict) {
        throw new Error(`MissingTokenError: Unresolved token "$${key}" in template "${templateStr}"`);
      }
      return match;
    });

    // 5. Resolve {TOKEN} or {TOKEN:04d} (not preceded by $)
    s = s.replace(/\{([a-zA-Z0-9_]+)(?::([0-9]+)d)?\}/g, (match, key, pad) => {
      const val = lookup(key);
      if (val !== undefined) {
        if (pad) return PipelineTokens.formatFrame(Number(val), parseInt(pad, 10));
        return String(val);
      }
      if (isStrict) {
        throw new Error(`MissingTokenError: Unresolved token "{${key}}" in template "${templateStr}"`);
      }
      return match;
    });

    // 6. Restore escaped tokens
    s = s.replace(new RegExp(`${ESCAPE_PREFIX}(\\d+)${ESCAPE_SUFFIX}`, 'g'), (m, idx) => {
      return escapedStash[parseInt(idx, 10)];
    });

    return s;
  }

  /**
   * Translates path between Windows UNC/drive letters and Linux POSIX NFS mounts
   * @param {string} filePath
   * @param {'linux'|'windows'} [targetPlatform='linux']
   * @param {Object} [options={}]
   * @param {boolean} [options.strict=false] - Throw error on unmapped absolute path
   * @returns {string}
   */
  mapPath(filePath, targetPlatform = 'linux', options = {}) {
    if (!filePath || typeof filePath !== 'string') return '';

    const isStrict = options.strict !== undefined ? Boolean(options.strict) : this.strict;

    // Check if relative path (starts with ./ or ../ or has no leading root/drive)
    const isUNC = filePath.startsWith('\\\\') || filePath.startsWith('//');
    const isWinDrive = /^[a-zA-Z]:/.test(filePath);
    const isLinuxAbs = filePath.startsWith('/');
    const isRelative = !isUNC && !isWinDrive && !isLinuxAbs;

    if (isRelative) {
      // Relative paths remain relative; only normalize separators to target platform
      return targetPlatform === 'windows' ? filePath.replace(/\//g, '\\') : filePath.replace(/\\/g, '/');
    }

    let normPath = filePath.replace(/\\/g, '/');
    let mapped = false;

    for (const rule of this.pathMappings) {
      if (targetPlatform === 'linux') {
        // Source is Windows (UNC or drive letter)
        const match = rule.caseSensitive 
          ? normPath.startsWith(rule.windows) 
          : normPath.toLowerCase().startsWith(rule.windows.toLowerCase());
        if (match) {
          normPath = rule.linux + normPath.slice(rule.windows.length);
          mapped = true;
          break;
        }
      } else if (targetPlatform === 'windows') {
        // Source is Linux
        const match = rule.caseSensitive 
          ? normPath.startsWith(rule.linux) 
          : normPath.toLowerCase().startsWith(rule.linux.toLowerCase());
        if (match) {
          normPath = rule.windows + normPath.slice(rule.linux.length);
          mapped = true;
          break;
        }
      }
    }

    if (!mapped && isStrict) {
      throw new Error(`UnmappedPathError: Path "${filePath}" could not be mapped to target platform "${targetPlatform}"`);
    }

    if (targetPlatform === 'windows') {
      return normPath.replace(/\//g, '\\');
    }
    return normPath.replace(/\\/g, '/');
  }

  /**
   * Resolves a full array of absolute file paths for an entire frame sequence
   * @param {string} templateStr - e.g. "/path/${SHOT}.####.exr"
   * @param {number[]} frameRange - e.g. [1001, 1002, 1003]
   * @param {Object} [context={}]
   * @param {Object} [options={}]
   * @returns {string[]}
   */
  resolveFrameSequence(templateStr, frameRange, context = {}, options = {}) {
    if (!Array.isArray(frameRange)) {
      throw new TypeError('frameRange must be an array of frame numbers');
    }
    return frameRange.map(f => this.resolve(templateStr, { ...context, frame: f }, options));
  }

  /**
   * Given an array of discrete file paths, detects the sequence pattern, frame range, and missing frames
   * @param {string[]} filePaths
   * @returns {{pattern: string, frames: number[], start: number, end: number, padding: number, missing: number[]}|null}
   */
  static parseSequencePattern(filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return null;

    // Matches digits before file extension: e.g. shot.0101.exr or beauty_1001.exr
    const frameRegex = /^(.*?[._-])(\d+)(\.[a-zA-Z0-9]+)$/;
    const matches = [];

    for (const fp of filePaths) {
      const norm = String(fp).replace(/\\/g, '/');
      const lastSlash = norm.lastIndexOf('/');
      const base = lastSlash === -1 ? norm : norm.slice(lastSlash + 1);
      const dir = lastSlash === -1 ? '.' : (norm.slice(0, lastSlash) || '/');

      const m = base.match(frameRegex);
      if (m) {
        const prefix = m[1];
        const digitStr = m[2];
        const ext = m[3];
        matches.push({
          dir,
          prefix,
          frame: parseInt(digitStr, 10),
          padding: digitStr.length,
          ext
        });
      }
    }

    if (matches.length === 0) return null;

    const first = matches[0];
    const matchingSet = matches.filter(m => 
      m.dir === first.dir && 
      m.prefix === first.prefix && 
      m.ext === first.ext && 
      m.padding === first.padding
    );

    if (matchingSet.length === 0) return null;

    const frames = Array.from(new Set(matchingSet.map(m => m.frame))).sort((a, b) => a - b);
    const start = frames[0];
    const end = frames[frames.length - 1];
    const hashPattern = '#'.repeat(first.padding);
    let pattern;
    if (first.dir === '.') {
      pattern = `${first.prefix}${hashPattern}${first.ext}`;
    } else if (first.dir.endsWith('/')) {
      pattern = `${first.dir}${first.prefix}${hashPattern}${first.ext}`;
    } else {
      pattern = `${first.dir}/${first.prefix}${hashPattern}${first.ext}`;
    }

    // Detect missing frames in the sequence
    const missing = [];
    const frameSet = new Set(frames);
    for (let f = start; f <= end; f++) {
      if (!frameSet.has(f)) {
        missing.push(f);
      }
    }

    return {
      pattern,
      frames,
      start,
      end,
      padding: first.padding,
      missing
    };
  }
}

/** Default singleton instance */
export const globalPipelineTokens = new PipelineTokens();
