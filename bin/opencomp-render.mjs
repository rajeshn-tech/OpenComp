#!/usr/bin/env node
/**
 * OpenComp - Standalone Headless Command-Line Batch Renderer
 * Evaluates node graphs and renders image sequences without launching the GUI.
 * Supports legacy script (.nk) and OpenComp (.opencomp/.json) project files.
 * Provides atomic file writing, progress reporting, pre-flight validation, and graceful SIGINT handling.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';
import { ImageIO } from '../src/core/ImageIO.js';
import { BufferPool } from '../src/core/BufferPool.js';
import { globalOCIO } from '../src/core/OCIOManager.js';
import { globalPipelineTokens } from '../src/core/PipelineTokens.js';

const pkgPath = path.resolve('package.json');
const VERSION = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version : '1.0.0';

// Active in-flight temporary file tracking for clean signal abort
let activeTempFile = null;
let isAborting = false;

function printUsage() {
  console.log(`
================================================================================
OpenComp Headless Batch Renderer (CLI) - Version ${VERSION}
================================================================================
Usage:
  opencomp-render --project <file> [options]

Required Options:
  -p, --project <path>       Path to project file (.nk or .opencomp/.json)

Output & Execution Options:
  -o, --output <path>        Output image path or sequence pattern (e.g. renders/shot.####.exr)
  -f, --frames <range>       Frame range to render (e.g. 1-100, 1001-1050, 1,5,10, or 42)
  -n, --node <name>          Target output node name (defaults to first Write node)
      --format <WxH>         Resolution override (e.g. 1920x1080, 3840x2160)
  -c, --compression <type>   EXR compression (none, dwaa, dwab, zip, rle)
      --bitdepth <depth>     Bit depth override: float32 (default) or half16
      --quality <level>      DWA compression quality level (default 45.0)
      --colorspace <name>    Output color space override (e.g. sRGB, ACEScg, ACES2065-1)
      --ocio <path>          Path to custom OpenColorIO (.ocio) configuration file
      --recover              Load latest crash recovery autosave snapshot if present
      --overwrite            Permit overwriting existing rendered output files
      --validate             Perform pre-flight project validation only and exit
      --verbose              Detailed per-frame and node evaluation logging
  -v, --version              Print OpenComp version
  -h, --help                 Print this help guide

Exit Codes:
  0: Success (all requested frames rendered)
  1: Pipeline or rendering execution error
  2: Command-line argument or project validation error
  130: Interrupted by user (SIGINT/SIGTERM)
================================================================================
`);
}

/**
 * Parse frame range string into sorted array of integers
 * Examples: "1-5", "1001-1010", "1,3,5", "1-3,5,10-12", "42"
 */
export function parseFrameRange(rangeStr) {
  if (!rangeStr) return [1];
  const frames = new Set();
  const parts = String(rangeStr).split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid frame range component: "${trimmed}"`);
      }
      const step = start <= end ? 1 : -1;
      for (let f = start; step > 0 ? f <= end : f >= end; f += step) {
        frames.add(f);
      }
    } else {
      const f = parseInt(trimmed, 10);
      if (isNaN(f)) {
        throw new Error(`Invalid frame number: "${trimmed}"`);
      }
      frames.add(f);
    }
  }

  const result = Array.from(frames).sort((a, b) => a - b);
  if (result.length === 0) throw new Error('No valid frames found in range specification');
  return result;
}

/**
 * Format sequence filename replacing ####, %04d, @@@ tokens with frame numbers
 */
export function formatSequencePath(pattern, frame) {
  return ImageIO.resolveSequenceFrame(pattern, frame);
}

/**
 * Parse CLI arguments into structured configuration object
 */
export function parseArguments(args) {
  const config = {
    project: null,
    output: null,
    frames: null,
    node: null,
    format: null,
    compression: null,
    bitdepth: 'float32',
    quality: 45.0,
    tokens: {},
    recover: false,
    overwrite: false,
    validate: false,
    verbose: false,
    help: false,
    version: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      config.help = true;
    } else if (arg === '-v' || arg === '--version') {
      config.version = true;
    } else if (arg === '-p' || arg === '--project') {
      config.project = args[++i];
    } else if (arg === '-o' || arg === '--output') {
      config.output = args[++i];
    } else if (arg === '-f' || arg === '--frames') {
      config.frames = args[++i];
    } else if (arg === '-n' || arg === '--node') {
      config.node = args[++i];
    } else if (arg === '--format') {
      config.format = args[++i];
    } else if (arg === '-c' || arg === '--compression') {
      config.compression = args[++i];
    } else if (arg === '--bitdepth') {
      config.bitdepth = args[++i];
    } else if (arg === '--quality') {
      config.quality = parseFloat(args[++i]);
    } else if (arg === '--token') {
      const tokenArg = args[++i];
      if (tokenArg && tokenArg.includes('=')) {
        const [k, ...vParts] = tokenArg.split('=');
        config.tokens[k.trim()] = vParts.join('=').trim();
      }
    } else if (arg === '--colorspace') {
      config.colorspace = args[++i];
    } else if (arg === '--ocio') {
      config.ocio = args[++i];
    } else if (arg === '--recover') {
      config.recover = true;
    } else if (arg === '--overwrite') {
      config.overwrite = true;
    } else if (arg === '--validate') {
      config.validate = true;
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else {
      throw new Error(`Unknown command line argument: ${arg}`);
    }
  }

  return config;
}

/**
 * Load project file into a new Graph instance
 */
export function loadProject(projectPath, recover = false) {
  let targetPath = projectPath;
  if (recover) {
    const autosavePath = `${projectPath}.autosave`;
    if (fs.existsSync(autosavePath)) {
      console.log(`[RECOVER] Loading latest autosave snapshot: "${autosavePath}"`);
      targetPath = autosavePath;
    } else {
      console.warn(`[RECOVER] No autosave snapshot found at "${autosavePath}", falling back to primary project.`);
    }
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Project file does not exist: "${targetPath}"`);
  }

  const ext = path.extname(targetPath).toLowerCase();
  const fileContent = fs.readFileSync(targetPath, 'utf8');
  const graph = new Graph();

  if (ext === '.nk') {
    NukeScriptIO.parseNukeScript(fileContent, createNode, graph);
  } else {
    // Check if JSON / OpenComp or Autosave envelope format
    try {
      const parsed = JSON.parse(fileContent);
      const data = parsed.data || parsed; // Support both envelope and raw
      graph.deserialize(data, createNode);
    } catch (err) {
      try {
        NukeScriptIO.parseNukeScript(fileContent, createNode, graph);
      } catch (innerErr) {
        throw new Error(`Failed to parse project file "${targetPath}": ${err.message}`);
      }
    }
  }

  return graph;
}

/**
 * Pre-flight graph validation
 */
export function validateGraph(graph, targetNodeId = null) {
  const nodes = graph.getAllNodes();
  if (nodes.length === 0) {
    throw new Error('Project graph is empty (contains 0 nodes)');
  }

  let targetNode = null;
  if (targetNodeId) {
    targetNode = graph.getNode(targetNodeId);
    if (!targetNode) {
      throw new Error(`Requested target node "${targetNodeId}" not found in graph`);
    }
  } else {
    // Auto-discover Write node
    const writeNodes = nodes.filter(n => n.type === 'Write');
    if (writeNodes.length > 0) {
      targetNode = writeNodes[0];
    } else {
      // Fallback: use first node with output
      targetNode = nodes[nodes.length - 1];
    }
  }

  // Check for disconnected inputs on target node
  const hasConnectedInputs = targetNode.inputs.some(inp => inp.connection && inp.connection.nodeId);
  if (targetNode.inputs.length > 0 && !hasConnectedInputs && targetNode.type === 'Write') {
    throw new Error(`Target Write node "${targetNode.id}" has no connected inputs`);
  }

  // Check upstream media dependencies
  const warnings = [];
  for (const node of nodes) {
    if (node.type === 'Read') {
      const fileKnob = node.getKnobValue('file');
      const sourceType = node.getKnobValue('sourceType');
      if (fileKnob && !fs.existsSync(fileKnob) && !fileKnob.includes('#') && !fileKnob.includes('%')) {
        warnings.push(`Read node "${node.id}" references missing file: "${fileKnob}"`);
      }
    }
  }

  return { targetNode, warnings };
}

/**
 * Main batch render execution pipeline
 */
export async function renderBatch(config, progressCallback = null) {
  const startTime = performance.now();

  // 1. Load project
  const graph = loadProject(config.project, config.recover);
  if (config.verbose) {
    console.log(`[INFO] Loaded project "${config.project}" with ${graph.getAllNodes().length} nodes`);
  }

  // 2. Pre-flight validation
  const { targetNode, warnings } = validateGraph(graph, config.node);
  if (config.verbose) {
    console.log(`[INFO] Target output node: "${targetNode.id}" (${targetNode.type})`);
    for (const w of warnings) console.warn(`[WARN] ${w}`);
  }

  if (config.validate) {
    console.log(`[SUCCESS] Pre-flight validation passed cleanly for target node "${targetNode.id}"`);
    return { success: true, framesRendered: 0, totalDurationMs: performance.now() - startTime };
  }

  // 3. Resolve output pattern
  let outputPattern = config.output;
  if (!outputPattern) {
    if (targetNode.type === 'Write' && targetNode.getKnobValue('file')) {
      outputPattern = targetNode.getKnobValue('file');
    } else {
      const projBase = path.basename(config.project, path.extname(config.project));
      outputPattern = path.join('renders', `${projBase}.####.exr`);
    }
  }

  // Apply custom token substitution on output pattern if present
  if (config.tokens && Object.keys(config.tokens).length > 0) {
    outputPattern = globalPipelineTokens.resolve(outputPattern, config.tokens);
  }

  // Ensure destination directory exists
  const outputDir = path.dirname(path.resolve(outputPattern));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 4. Resolve frame range
  let frameList = null;
  if (config.frames) {
    frameList = parseFrameRange(config.frames);
  } else {
    // Check target node or root defaults
    const startF = targetNode.getKnobValue('firstFrame') || 1;
    const endF = targetNode.getKnobValue('lastFrame') || 1;
    frameList = parseFrameRange(`${startF}-${endF}`);
  }

  console.log(`[INFO] Starting batch render: ${frameList.length} frame(s) [${frameList[0]}..${frameList[frameList.length - 1]}]`);
  console.log(`[INFO] Destination pattern: "${outputPattern}"`);

  const renderedFiles = [];
  const frameTimes = [];

  // Setup signal abort listener
  const cleanupAndAbort = () => {
    if (isAborting) return;
    isAborting = true;
    console.log('\n[ABORT] Received interruption signal. Cleaning up temporary files...');
    if (activeTempFile && fs.existsSync(activeTempFile)) {
      try { fs.unlinkSync(activeTempFile); } catch (e) {}
    }
    console.log('[ABORT] Render terminated.');
    process.exit(130);
  };

  process.once('SIGINT', cleanupAndAbort);
  process.once('SIGTERM', cleanupAndAbort);

  if (config.ocio) {
    globalOCIO.setConfigPath(config.ocio);
    console.log(`[INFO] Loaded custom OCIO configuration: "${config.ocio}"`);
  }

  // 5. Sequential Frame Render Loop
  for (let idx = 0; idx < frameList.length; idx++) {
    const frame = frameList[idx];
    const frameStart = performance.now();

    // Resolve target path for this frame
    const finalPath = path.resolve(ImageIO.resolveSequenceFrame(outputPattern, frame, config.tokens));

    if (fs.existsSync(finalPath) && !config.overwrite) {
      throw new Error(`Output file already exists and --overwrite is not set: "${finalPath}"`);
    }

    // Atomic temporary file path
    const tempPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
    activeTempFile = tempPath;

    // Invalidate dirty flags on animated nodes
    for (const n of graph.getAllNodes()) {
      if (n.knobs) {
        for (const k of Object.values(n.knobs)) {
          if (k.keyframes && Object.keys(k.keyframes).length > 0) {
            n.markDirty();
            break;
          }
        }
      }
    }

    // Evaluate target node at current frame
    const context = { frame, time: frame / 24.0 };
    const resultBuffer = graph.evaluate(targetNode.id, context);

    if (!resultBuffer) {
      throw new Error(`Evaluation failed at frame ${frame}: Target node "${targetNode.id}" returned null buffer`);
    }

    // Apply color space transformation if requested
    const cs = config.colorspace || targetNode.getKnobValue('colorspace') || 'default';
    if (cs !== 'default' && cs !== 'linear' && cs !== 'raw' && cs !== globalOCIO.getWorkingSpace()) {
      globalOCIO.transform(resultBuffer, globalOCIO.getWorkingSpace(), cs);
    }

    // Determine bit depth and compression settings
    const isHalf = (config.bitdepth === 'half16') || (targetNode.getKnobValue('bitDepth') === 'half16');
    const compression = config.compression || targetNode.getKnobValue('compression') || 'none';

    // Serialize EXR buffer
    let fileBytes;
    if (compression.toLowerCase() === 'dwaa' || compression.toLowerCase() === 'dwab') {
      // Use Python OpenEXR bridge for DWA lossy compression if available
      fileBytes = await ImageIO.writeEXRWithCompression(resultBuffer, isHalf, compression.toLowerCase(), config.quality);
    } else {
      fileBytes = ImageIO.writeEXR(resultBuffer, isHalf);
    }

    // Atomic write: write to temp file then rename
    fs.writeFileSync(tempPath, fileBytes);

    if (fs.existsSync(tempPath)) {
      const stat = fs.statSync(tempPath);
      if (stat.size < 64) {
        throw new Error(`Rendered frame ${frame} produced invalid/empty file (${stat.size} bytes)`);
      }
      fs.renameSync(tempPath, finalPath);
      activeTempFile = null;
    }

    const frameDuration = performance.now() - frameStart;
    frameTimes.push(frameDuration);
    renderedFiles.push(finalPath);

    const fileSizeMb = (fs.statSync(finalPath).size / (1024 * 1024)).toFixed(2);
    const progressPct = (((idx + 1) / frameList.length) * 100).toFixed(1);

    console.log(`[FRAME ${String(frame).padStart(4, ' ')}] (${idx + 1}/${frameList.length}, ${progressPct}%) -> "${path.basename(finalPath)}" (${frameDuration.toFixed(1)} ms, ${fileSizeMb} MB)`);

    if (progressCallback) {
      progressCallback({
        frame,
        index: idx + 1,
        total: frameList.length,
        durationMs: frameDuration,
        path: finalPath
      });
    }

    // Release temporary allocation pool to prevent memory accumulation across long sequences
    BufferPool.clear();
  }

  // Remove signal listeners
  process.removeListener('SIGINT', cleanupAndAbort);
  process.removeListener('SIGTERM', cleanupAndAbort);

  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const meanFrameTime = (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(1);

  console.log('================================================================================');
  console.log(`🎉 BATCH RENDER COMPLETE!`);
  console.log(`Total Frames Rendered: ${renderedFiles.length}`);
  console.log(`Total Elapsed Time:    ${totalDuration} s (Mean: ${meanFrameTime} ms/frame)`);
  console.log(`Output Directory:      "${outputDir}"`);
  console.log('================================================================================');

  return {
    success: true,
    framesRendered: renderedFiles.length,
    renderedFiles,
    totalDurationMs: performance.now() - startTime,
    meanFrameDurationMs: parseFloat(meanFrameTime)
  };
}

// Direct CLI Execution Handler
if (process.argv[1] && (process.argv[1].endsWith('opencomp-render.mjs') || process.argv[1].endsWith('opencomp-render'))) {
  try {
    const rawArgs = process.argv.slice(2);
    const config = parseArguments(rawArgs);

    if (config.help || rawArgs.length === 0) {
      printUsage();
      process.exit(0);
    }

    if (config.version) {
      console.log(`OpenComp Render Engine v${VERSION}`);
      process.exit(0);
    }

    if (!config.project) {
      console.error('[ERROR] Missing required argument: --project <path>');
      printUsage();
      process.exit(2);
    }

    renderBatch(config)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`\n[FATAL RENDER ERROR] ${err.message}`);
        if (config.verbose && err.stack) console.error(err.stack);
        process.exit(1);
      });
  } catch (err) {
    console.error(`\n[ARGUMENT ERROR] ${err.message}`);
    process.exit(2);
  }
}
