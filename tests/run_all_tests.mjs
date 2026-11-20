/**
 * OpenComp - Master Test Runner
 * Executes all automated test suites across JavaScript and Python engines,
 * collecting telemetry, timing, and assertion counts.
 */

import { spawnSync } from 'child_process';
import { performance } from 'perf_hooks';

console.log('====================================================');
console.log('🚀 OPENCOMP AUTOMATED TEST RUNNER (ALL SUITES)');
console.log('====================================================\n');

const suites = [
  { name: '1. Engine & DAG Core Suite', cmd: 'node', args: ['tests/test_engine.mjs'] },
  { name: '2. Node Mathematics & Nuke Math Suite', cmd: 'node', args: ['tests/test_nodes_math.mjs'] },
  { name: '3. Foundry Nuke (.nk) I/O Suite', cmd: 'node', args: ['tests/test_nuke_io.mjs'] },
  { name: '4. OpenEXR & Image Sequence I/O Suite', cmd: 'node', args: ['tests/test_image_io.mjs'] },
  { name: '5. Real Production Scenarios Suite (720p/1080p/2K/4K)', cmd: 'node', args: ['tests/test_production_scenarios.mjs'] },
  { name: '6. Foundry Nuke 13/14/15 Real Script Compatibility Suite', cmd: 'node', args: ['tests/test_nuke_real_compat.mjs'] },
  { name: '7. Graph Stability, Memory Leak & Stress Suite', cmd: 'node', args: ['tests/test_stability_stress.mjs'] },
  { name: '8. Keyframe & Temporal Animation Suite', cmd: 'node', args: ['tests/test_keyframe_animation.mjs'] },
  { name: '9. Department 1: ROTO Verification Suite', cmd: 'node', args: ['tests/test_roto_department.mjs'] },
  { name: '10. Department 2: PAINT Verification Suite', cmd: 'node', args: ['tests/test_paint_department.mjs'] },
  { name: '11. Department 3: DEPTH Verification Suite', cmd: 'node', args: ['tests/test_depth_department.mjs'] },
  { name: '12. Department 4: STEREO COMP Verification Suite', cmd: 'node', args: ['tests/test_stereo_department.mjs'] },
  { name: '13. Python PySide6 / NumPy Engine Suite', cmd: '.venv\\Scripts\\python.exe', args: ['tests/test_python_engine.py'] },
  { name: '14. Dual JS/Python Engine Numerical Parity Suite', cmd: '.venv\\Scripts\\python.exe', args: ['tests/test_engine_parity.py'] },
  { name: '15. Resolution Scaling & V8 Limit Suite (4K/8K/12K/16K)', cmd: 'node', args: ['--max-old-space-size=4096', 'tests/test_resolution_scaling.mjs'] },
  { name: '16. Cross-Platform LAN, UNC & Air-Gap Suite', cmd: 'node', args: ['tests/test_lan_offline.mjs'] },
  { name: '17. Performance & Throughput Benchmark', cmd: 'node', args: ['tests/benchmark_perf.mjs'] },
  { name: '18. Forensic Audit of All 34 Nodes Suite', cmd: 'node', args: ['tests/audit_34_nodes_forensic.mjs'] },
  { name: '19. Forensic Full Resolution Processing Audit (4K/8K/12K/16K)', cmd: 'node', args: ['--max-old-space-size=4096', 'tests/test_full_resolution_forensic.mjs'] },
  { name: '20. Forensic Production Workflows Suite (Workflows A-E)', cmd: 'node', args: ['tests/test_production_workflows_forensic.mjs'] },
  { name: '21. Forensic Offline & Air-Gap Integrity Suite', cmd: 'node', args: ['tests/test_lan_offline_forensic.mjs'] },
  { name: '22. Forensic Tiled Engine & Seam Verification Suite', cmd: 'node', args: ['tests/test_tiled_engine_forensic.mjs'] },
  { name: '23. OpenEXR Half-Float & .cube 3D LUT Suite', cmd: 'node', args: ['tests/test_exr_half_lut.mjs'] },
  { name: '24. Multi-Node Tiled Graph Workflows Suite (Workflows 1-5)', cmd: 'node', args: ['tests/test_tiled_graph_workflows.mjs'] },
  { name: '25. Nuke-Style Tab Node Search & Auto-Connect Suite', cmd: 'node', args: ['tests/test_tab_search.mjs'] },
  { name: '26. Nodes Toolbar & Unified Creation Service Suite', cmd: 'node', args: ['tests/test_nodes_toolbar.mjs'] },
  { name: '27. Launch Architecture & Local HTTP Smoke Suite', cmd: 'node', args: ['tests/test_launch_smoke.mjs'] },
  { name: '28. Headless CLI Batch Renderer Suite', cmd: 'node', args: ['tests/test_cli_renderer.mjs'] },
  { name: '29. Multi-Channel & Multi-Layer OpenEXR Suite', cmd: 'node', args: ['tests/test_multichannel_exr.mjs'] },
  { name: '30. DWAA & DWAB Lossy Compression Suite', cmd: 'node', args: ['tests/test_dwa_compression.mjs'] },
  { name: '31. Autosave & Crash Recovery System Suite', cmd: 'node', args: ['tests/test_autosave_recovery.mjs'] },
  { name: '32. Production Render Validation Suite (10 Pipelines, 1080p-16K)', cmd: 'node', args: ['--max-old-space-size=4096', 'tests/test_production_render_pipeline.mjs'] },
  { name: '33. OpenColorIO (OCIO v2) Color Management Suite', cmd: 'node', args: ['tests/test_ocio_v2.mjs'] },
  { name: '34. Dynamic Bounding Box (BBox) Architecture Suite', cmd: 'node', args: ['tests/test_dynamic_bbox.mjs'] },
  { name: '35. Channel & Data Workflow Nodes Suite (Copy & ChannelMerge)', cmd: 'node', args: ['tests/test_channel_workflow_nodes.mjs'] },
  { name: '36. Professional Keying Workflow Suite (ChromaKeyer, Despill, MatteControl, EdgeExtend)', cmd: 'node', args: ['tests/test_keying_workflow.mjs'] },
  { name: '37. GPU Acceleration & CPU/GPU Parity Suite', cmd: 'node', args: ['tests/test_gpu_parity.mjs'] },
  { name: '38. Point Tracker Suite (TrackerNode & TrackerEngine)', cmd: 'node', args: ['tests/test_point_tracker.mjs'] },
  { name: '39. Planar Tracker Suite (PlanarTrackerNode & PlanarTrackerEngine)', cmd: 'node', args: ['tests/test_planar_tracker.mjs'] },
  { name: '40. SplineWarp Suite (SplineWarpNode & SplineWarpEngine)', cmd: 'node', args: ['tests/test_splinewarp.mjs'] },
  { name: '41. Retime & TimeWarp Suite (RetimeNode & TimeWarpNode)', cmd: 'node', args: ['tests/test_retime_timewarp.mjs'] },
  { name: '42. Phase 3 Unified Integration & Master System Validation Suite', cmd: 'node', args: ['tests/test_phase_3_integration.mjs'] },
  { name: '43. 3D Math, Vector3, Matrix4 & Scene Graph Core Suite', cmd: 'node', args: ['tests/test_3d_math_scene.mjs'] },
  { name: '44. Camera3D Optics, Pinhole Model & Frustum Ray Suite', cmd: 'node', args: ['tests/test_camera_3d.mjs'] },
  { name: '45. Geometry Primitives (Card3D, Cube3D) & Project3D Camera Projection Suite', cmd: 'node', args: ['tests/test_project3d.mjs'] },
  { name: '46. SoftwareRasterizer & ScanlineRender Multi-Channel AOV Suite', cmd: 'node', args: ['tests/test_scanline_render.mjs'] },
  { name: '47. Phase 4 Unified 3D Compositing Integration & Nuke Script I/O Suite', cmd: 'node', args: ['tests/test_phase_4_integration.mjs'] },
  { name: '48. Deep Core Architecture & DeepPixelBuffer Suite', cmd: 'node', args: ['tests/test_deep_core.mjs'] },
  { name: '49. Deep Flattening & Optical Ray Conversion Suite', cmd: 'node', args: ['tests/test_deep_flatten.mjs'] },
  { name: '50. Volumetric Deep Operators Suite (DeepMerge, DeepHoldout, DeepCrop)', cmd: 'node', args: ['tests/test_deep_ops.mjs'] },
  { name: '51. OpenEXR Deep I/O Subsystem Suite (Bridge, Client, DeepRead, DeepWrite)', cmd: 'node', args: ['tests/test_deep_exr_io.mjs'] },
  { name: '52. Phase 5 Unified Deep Compositing Integration Suite', cmd: 'node', args: ['tests/test_phase_5_integration.mjs'] },
  { name: '53. Phase 6.1: Pipeline Tokens & Path Resolution Suite', cmd: 'node', args: ['tests/test_pipeline_tokens.mjs'] },
  { name: '54. Phase 6.2: Render Farm Core & Native LAN Dispatcher Suite', cmd: 'node', args: ['tests/test_render_farm_core.mjs'] },
  { name: '55. Phase 6.3: Production UI Ergonomics (Viewer 10-Slot, Tab Search, Curve Editor) Suite', cmd: 'node', args: ['tests/test_production_ui.mjs'] },
  { name: '56. Phase 6.4: USD & Alembic Scene Exchange Suite', cmd: 'node', args: ['tests/test_usd_alembic_scene_io.mjs'] },
  { name: '57. Phase 6.5: OpenFX 1.4 Plugin Host & Dynamic C-ABI Architecture Suite', cmd: 'node', args: ['tests/test_openfx_host.mjs'] },
  { name: '58. Phase 6.6: Multi-Scheduler Integration & Studio Render Pipeline Suite', cmd: 'node', args: ['tests/test_scheduler_integrations.mjs'] },
  { name: '59. Phase 6.7: Unified Phase 6 Integration & Master System Validation Suite', cmd: 'node', args: ['tests/test_phase_6_integration.mjs'] },
  { name: '60. Phase 6.8: Browser UI Interaction Suite (CDP Automation)', cmd: 'node', args: ['tests/test_ui_interactions.mjs'] },
  { name: '61. Phase 2: Advanced Viewer & Color Pipeline Parity Suite', cmd: 'node', args: ['tests/test_ui_advanced_viewer_color.mjs'] },
  { name: '62. Milestone 1: ZDefocus CPU Optimization & Parity Suite', cmd: 'node', args: ['tests/test_zdefocus_optimization.mjs'] },
  { name: '63. Milestone 2: Grade Node Optimization & Parity Suite', cmd: 'node', args: ['tests/test_grade_optimization.mjs'] },
  { name: '64. Milestone 3: Buffer Channel Memory Optimization & Parity Suite', cmd: 'node', args: ['tests/test_buffer_channel_optimization.mjs'] },
  { name: '65. Milestone 4: ZDefocus Deep CPU Parallel Optimization Suite', cmd: 'node', args: ['tests/test_zdefocus_deep_optimization.mjs'] },
  { name: '66. UI Parity Phase 3: Professional Node Graph & Properties Suite', cmd: 'node', args: ['tests/test_ui_nodegraph_properties.mjs'] },
  { name: '67. UI Parity: Advanced Viewer & Color Pipeline Parity Suite', cmd: 'node', args: ['tests/test_ui_viewer_pipeline.mjs'] },
  { name: '68. UI Parity: Roto, Paint & Keying Workflows Suite', cmd: 'node', args: ['tests/test_ui_roto_paint_keying.mjs'] },
  { name: '69. UI Parity: Animation, Timeline & Tracking Suite', cmd: 'node', args: ['tests/test_ui_animation_timeline_tracking.mjs'] },
  { name: '70. UI Parity: 3D, Camera & Particles Suite', cmd: 'node', args: ['tests/test_ui_3d_camera_particles.mjs'] },
  { name: '71. UI Parity: Deep, Stereo & Advanced Imaging Suite', cmd: 'node', args: ['tests/test_ui_deep_stereo_imaging.mjs'] },
  { name: '72. UI Parity: Production Pipeline & Automation Suite', cmd: 'node', args: ['tests/test_ui_production_pipeline.mjs'] }
];

let totalPassed = 0;
let totalFailed = 0;
const results = [];

const masterStart = performance.now();

for (const suite of suites) {
  process.stdout.write(`⏳ Running ${suite.name}... `);
  const t0 = performance.now();
  const proc = spawnSync(suite.cmd, suite.args, { encoding: 'utf8', shell: true });
  const t1 = performance.now();
  const duration = (t1 - t0).toFixed(0);

  if (proc.status === 0) {
    console.log(`✅ PASSED (${duration} ms)`);
    totalPassed++;
    results.push({ name: suite.name, status: 'PASSED', duration, output: proc.stdout });
  } else {
    console.log(`❌ FAILED (${duration} ms)`);
    console.error(proc.stderr || proc.stdout);
    totalFailed++;
    results.push({ name: suite.name, status: 'FAILED', duration, error: proc.stderr || proc.stdout });
  }
}

const masterDuration = ((performance.now() - masterStart) / 1000).toFixed(2);

console.log('\n====================================================');
console.log('📊 MASTER TEST SUMMARY');
console.log('====================================================');
console.log(`Total Suites Executed: ${suites.length}`);
console.log(`Passed:                ${totalPassed}`);
console.log(`Failed:                ${totalFailed}`);
console.log(`Total Execution Time:  ${masterDuration} s`);
console.log('====================================================');

if (totalFailed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL SUITES PASSED! AUTOMATED REGRESSION VERIFICATION COMPLETE.');
  process.exit(0);
}

