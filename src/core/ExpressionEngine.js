/**
 * OpenComp - Expression Engine
 * Safe, robust mathematical expression parser and evaluator for VFX node parameters.
 * Supports:
 * - Current frame variable ('frame', 't')
 * - Mathematical constants (PI, E, etc.)
 * - Standard and VFX math functions (sin, cos, tan, abs, min, max, clamp, lerp, smoothstep, noise, random)
 * - Cross-node knob referencing ('NodeName.knobName', 'parent.knobName')
 * - Cycle detection and graceful fallback
 * - Real-time syntax validation
 */

export class ExpressionEngine {
  /**
   * Deterministic pseudo-random number generator based on seed
   * @param {number} seed 
   * @returns {number} Float in range [0, 1)
   */
  static random(seed = 1.0) {
    const s = Math.sin(Number(seed) || 1.0) * 43758.5453123;
    return s - Math.floor(s);
  }

  /**
   * 1D smooth Perlin-style noise for natural VFX animation shake/wiggle
   * @param {number} x 
   * @returns {number} Value in range [-1, 1]
   */
  static noise(x) {
    const i = Math.floor(x);
    const f = x - i;
    // Cubic smoothstep
    const u = f * f * (3.0 - 2.0 * f);
    const g0 = Math.sin(i * 12.9898) * 43758.5453;
    const g1 = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const n0 = (g0 - Math.floor(g0)) * 2.0 - 1.0;
    const n1 = (g1 - Math.floor(g1)) * 2.0 - 1.0;
    return (1.0 - u) * n0 + u * n1;
  }

  /**
   * Linear interpolation
   * @param {number} a 
   * @param {number} b 
   * @param {number} t 
   * @returns {number}
   */
  static lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Clamp value between min and max
   * @param {number} v 
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  static clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * Smooth Hermite interpolation
   * @param {number} edge0 
   * @param {number} edge1 
   * @param {number} x 
   * @returns {number}
   */
  static smoothstep(edge0, edge1, x) {
    const t = ExpressionEngine.clamp((x - edge0) / (edge1 - edge0 || 1.0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  /**
   * Validate expression syntax without evaluating
   * @param {string} expr 
   * @returns {{ valid: boolean, error?: string }}
   */
  static validate(expr) {
    if (typeof expr !== 'string' || !expr.trim()) {
      return { valid: false, error: 'Expression cannot be empty' };
    }

    const clean = expr.trim();

    // Check balanced parentheses, brackets, braces
    let parens = 0;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === '(') parens++;
      else if (clean[i] === ')') parens--;
      if (parens < 0) return { valid: false, error: 'Unmatched closing parenthesis' };
    }
    if (parens !== 0) return { valid: false, error: 'Unclosed parenthesis' };

    // Disallow dangerous JS keywords, statements, and globals
    const forbidden = [
      'eval', 'function', 'import', 'export', 'window', 'document', 'global',
      'process', 'require', 'constructor', 'prototype', '__proto__', 'class',
      'let', 'const', 'var', 'for', 'while', 'do', 'switch', 'return', 'yield',
      'try', 'catch', 'throw', 'delete', 'void', 'this', 'async', 'await'
    ];

    const tokens = clean.split(/[^a-zA-Z0-9_]+/);
    for (const tok of tokens) {
      if (forbidden.includes(tok)) {
        return { valid: false, error: `Disallowed keyword in expression: '${tok}'` };
      }
    }

    // Try a test compilation using safe Function sandbox
    try {
      const sanitized = ExpressionEngine.sanitizeExpression(clean);
      new Function('frame', 't', 'width', 'height', 'Math', 'ref', 'clamp', 'lerp', 'smoothstep', 'noise', 'random', `"use strict"; return (${sanitized});`);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Sanitize and rewrite expression tokens:
   * e.g. NodeName.knobName -> ref("NodeName", "knobName")
   * e.g. sin(x) -> Math.sin(x)
   * @param {string} expr 
   * @returns {string}
   */
  static sanitizeExpression(expr) {
    let sanitized = expr.trim();

    // Support exponentiation operator ^ as **
    sanitized = sanitized.replace(/\^/g, '**');

    // Replace NodeName.knobName references: e.g. Grade1.gain or parent.gain
    // Regex matches identifier.identifier where not followed by parenthesis (which would be method)
    sanitized = sanitized.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\()/g, (match, nodeName, knobName) => {
      // Don't replace Math constants like Math.PI
      if (nodeName === 'Math') return match;
      return `ref("${nodeName}", "${knobName}")`;
    });

    // Replace standard math functions and constants with Math. prefix if not already prefixed
    const mathIdentifiers = [
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
      'sqrt', 'cbrt', 'pow', 'exp', 'log', 'log2', 'log10',
      'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc',
      'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2'
    ];

    for (const id of mathIdentifiers) {
      const regex = new RegExp(`(?<!Math\\.)\\b${id}\\b`, 'g');
      sanitized = sanitized.replace(regex, `Math.${id}`);
    }

    return sanitized;
  }

  /**
   * Safely evaluate expression in context
   * @param {string} expr Expression string
   * @param {Object} [context={}] Evaluation context ({ frame, width, height, ... })
   * @param {import('./Graph.js').Graph} [graph=null] Graph instance for resolving node references
   * @param {Set<string>} [evaluatingStack=new Set()] Cycle prevention stack
   * @returns {number|any}
   */
  static evaluate(expr, context = {}, graph = null, evaluatingStack = new Set()) {
    if (typeof expr !== 'string' || !expr.trim()) return undefined;

    const frame = Number(context.frame !== undefined ? context.frame : 1);
    const t = frame;
    const width = Number(context.width || 1920);
    const height = Number(context.height || 1080);

    const ref = (nodeName, knobName) => {
      if (!graph) return 0;
      const refKey = `${nodeName}.${knobName}`;
      if (evaluatingStack.has(refKey)) {
        console.warn(`Expression cycle detected on '${refKey}'. Breaking recursion.`);
        return 0;
      }

      evaluatingStack.add(refKey);
      try {
        let targetNode = null;
        if (nodeName.toLowerCase() === 'parent' && context.parentGroup) {
          targetNode = context.parentGroup;
        } else {
          targetNode = graph.getNode(nodeName) || graph.getAllNodes().find(n => n.name === nodeName);
        }

        if (!targetNode) return 0;

        const val = targetNode.getKnobValue(knobName, context);
        return typeof val === 'number' ? val : (Number(val) || 0);
      } finally {
        evaluatingStack.delete(refKey);
      }
    };

    try {
      const sanitized = ExpressionEngine.sanitizeExpression(expr);
      const fn = new Function(
        'frame', 't', 'width', 'height', 'Math', 'ref',
        'clamp', 'lerp', 'smoothstep', 'noise', 'random',
        `"use strict"; return (${sanitized});`
      );

      const result = fn(
        frame, t, width, height, Math, ref,
        ExpressionEngine.clamp, ExpressionEngine.lerp,
        ExpressionEngine.smoothstep, ExpressionEngine.noise, ExpressionEngine.random
      );

      return typeof result === 'number' && !isNaN(result) ? result : (Number(result) || 0);
    } catch (err) {
      // Return 0 or undefined on evaluation failure
      return 0;
    }
  }
}
