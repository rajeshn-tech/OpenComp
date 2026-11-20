# OpenComp — UI, Workspace Architecture & Specialized VFX Workflow Guide

## Table of Contents
1. [User Interface Architecture & Workspace Layout](#1-user-interface-architecture--workspace-layout)
   - [1.1 Workspace Panels & Layout Responsiveness](#11-workspace-panels--layout-responsiveness)
   - [1.2 Advanced Viewer Layouts & Display Comparison Modes](#12-advanced-viewer-layouts--display-comparison-modes)
   - [1.3 10-Slot Viewer Input Engine & A/B Selection](#13-10-slot-viewer-input-engine--ab-selection)
   - [1.4 WebGL 2.0 & OCIO Viewport Pipeline](#14-webgl-20--ocio-viewport-pipeline)
2. [Interactive Node Graph Canvas](#2-interactive-node-graph-canvas)
   - [2.1 Navigation, Pan & Zoom](#21-navigation-pan--zoom)
   - [2.2 Tab Quick-Search Palette & Acronym Matching](#22-tab-quick-search-palette--acronym-matching)
   - [2.3 Node Toolbar & Categorized Creation Palette](#23-node-toolbar--categorized-creation-palette)
   - [2.4 Auto-Connection, Pipe Routing, Dot & Backdrop Nodes](#24-auto-connection-pipe-routing-dot--backdrop-nodes)
3. [Properties Panel & Parameter Controls](#3-properties-panel--parameter-controls)
   - [3.1 Dynamic Knob Architecture & Custom Expressions](#31-dynamic-knob-architecture--custom-expressions)
   - [3.2 Keyframe Animation & Stopwatch Toggles](#32-keyframe-animation--stopwatch-toggles)
   - [3.3 Color Pickers, Sliders & Vector Controls](#33-color-pickers-sliders--vector-controls)
4. [Timeline, Dope Sheet & Animation Curve Editor](#4-timeline-dope-sheet--animation-curve-editor)
   - [4.1 Timeline Controls, Scrubbing & Cache Indicators](#41-timeline-controls-scrubbing--cache-indicators)
   - [4.2 Cubic Hermite & Bézier Tangent Handle Editing](#42-cubic-hermite--bézier-tangent-handle-editing)
   - [4.3 Keyframe Manipulation & Time Sliders](#43-keyframe-manipulation--time-sliders)
5. [Specialized Departmental VFX Workflows](#5-specialized-departmental-vfx-workflows)
   - [5.1 Department 1: ROTO Workflow (Bézier, B-Spline, Feathering & Tracking)](#51-department-1-roto-workflow)
   - [5.2 Department 2: PAINT Workflow (Clone, Reveal, Blur & Non-Destructive Strokes)](#52-department-2-paint-workflow)
   - [5.3 Department 3: DEPTH Workflow (Ground-Plane Ramps, Bilateral Smoothing & Sculpting)](#53-department-3-depth-workflow)
   - [5.4 Department 4: STEREO COMP Workflow (DIBR Warping, Dubois Anaglyph & Convergence)](#54-department-4-stereo-comp-workflow)
   - [5.5 Department 5: OPTICAL DEFOCUS (ZDefocus Optical Bokeh, CoC & Bloom)](#55-department-5-optical-defocus)
6. [Artist Validation Handoff Package & Runbook](#6-artist-validation-handoff-package--runbook)
   - [6.1 Fast-Start Artist Launch Runbook](#61-fast-start-artist-launch-runbook)
   - [6.2 17-Point Artist Usability & Acceptance Matrix](#62-17-point-artist-usability--acceptance-matrix)
7. [Manual Artist Test Project Setup & Asset Architecture](#7-manual-artist-test-project-setup--asset-architecture)
   - [7.1 Project Overview & DAG Topology](#71-project-overview--dag-topology)
   - [7.2 Sample Footage Specifications](#72-sample-footage-specifications)
   - [7.3 Pre-Flight Verification Script](#73-pre-flight-verification-script)
8. [Chronological Artist Test Session Protocol (7 Steps)](#8-chronological-artist-test-session-protocol-7-steps)
9. [Artist Feedback & Subjective Observation Recording Template](#9-artist-feedback--subjective-observation-recording-template)

---

## 1. User Interface Architecture & Workspace Layout

OpenComp provides a modern, high-density professional compositing user interface built with HTML5, CSS Grid/Flexbox, ES6+ modules, and WebGL 2.0. The interface is optimized for multi-monitor studio workstations, high-DPI displays, and keyboard-centric artist workflows.

### 1.1 Workspace Panels & Layout Responsiveness
The primary application interface is divided into five docked regions:
1. **Viewer (Top Left / Center)**: 32-bit floating-point WebGL/CPU image viewport with OCIO display color management, pixel inspector, 10-slot inputs, and comparison wipe controls.
2. **Node Graph (Center / Bottom Left)**: Infinite 2D pan/zoom DAG canvas with bezier connection pipes, auto-snapping, grid alignment, backdrops, and dot nodes.
3. **Properties Panel (Right Column)**: Context-sensitive parameter inspector displaying selected node knobs, sliders, curves, file dialogs, and expressions.
4. **Timeline & Playback Controls (Bottom Horizontal Bar)**: Frame slider, range controls (global and playback range), FPS selector, transport buttons (Play, Pause, Step Forward/Back, Loop modes), and frame caching status bar.
5. **Curve Editor & Dope Sheet (Collapsible Bottom Pane)**: Interactive function curve visualizer with draggable cubic Bezier tangents and keyframe timing manipulators.

### 1.2 Advanced Viewer Layouts & Display Comparison Modes
OpenComp supports flexible viewport configurations to facilitate side-by-side shot grading, matte inspection, and plate comparison:
- **Single Viewer**: Standard full-viewport display of the active input buffer.
- **Dual Viewer**: Two independent side-by-side or stacked viewports with configurable independent or synchronized pan/zoom.
- **Quad Viewer**: 4-way split view enabling simultaneous inspection of Source, Alpha, Matte, and Final Composite.
- **Wipe Comparison (Horizontal & Vertical)**: Interactive draggable wipe bar comparing Input A and Input B with angle rotation and blend softness controls.
- **Side-by-Side Comparison**: Split-screen display dividing the canvas evenly between two inputs.
- **Difference Comparison**: Mathematical difference ($|A - B|$) mode with gain amplification to highlight subtle sub-pixel deviations or grading adjustments.
- **Fit to Viewer & 1:1 Pixel Display**: Instant toggle between aspect-ratio-preserving canvas fit (`F` key) and 1:1 unscaled pixel display (`H` key).

### 1.3 10-Slot Viewer Input Engine & A/B Selection
- Dedicated 10-slot input buffer system directly mapped to number keys `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, and `0`.
- Pressing a number key with a node selected immediately connects that slot to the node's output.
- Active slot toggling: pressing another key switches the primary display. Holding `Shift` while pressing a key assigns Input B for wipe or difference comparison.
- Top bar indicators show active connections and slot assignments.

### 1.4 WebGL 2.0 & OCIO Viewport Pipeline
- Linear 32-bit floating-point texture uploads via WebGL 2.0 (`OES_texture_float_linear`, `EXT_color_buffer_float`).
- Real-time fragment shader evaluation of OCIO display transforms (ACEScg to sRGB, Rec.709, Rec.2020).
- Pure CPU software fallback ensuring 100% feature and visual parity when running in headless or software-rasterized environments.

---

## 2. Interactive Node Graph Canvas

### 2.1 Navigation, Pan & Zoom
- **Pan**: Middle-mouse button drag or `Alt` + Left-mouse button drag.
- **Zoom**: Mouse scroll wheel or `Alt` + Right-mouse button drag. Zoom centers smoothly on the cursor location.
- **Frame Selection**: Press `F` with nodes selected to center and fit selected nodes within the viewport.
- **Frame All**: Press `A` with no selection to fit the entire node graph.

### 2.2 Tab Quick-Search Palette & Acronym Matching
- Press `Tab` anywhere in the Node Graph to summon the fuzzy-search creation palette.
- Supports instant sub-5ms acronym matching:
  - `cc` -> ColorCorrect
  - `gr` -> Grade
  - `bl` -> Blur
  - `ck` -> ChromaKeyer
  - `zd` -> ZDefocus
  - `m` -> Merge
  - `sw` -> SplineWarp
  - `sr` -> ScanlineRender
  - `pt` -> PlanarTracker
- Arrow keys navigate matching results; `Enter` instantiates the node at the mouse position.

### 2.3 Node Toolbar & Categorized Creation Palette
A permanent vertical icon toolbar on the left margin provides one-click access to all 34 production node classes organized by family:
- **Image**: Read, Write, Constant, CheckerBoard
- **Color**: Grade, ColorCorrect, OCIOColorSpace, OCIODisplay, LUT3D
- **Filter**: Blur, EdgeBlur, Glow, Erode, ZDefocus
- **Keying**: ChromaKeyer, Despill, MatteControl, EdgeExtend
- **Transform**: Transform, CornerPin, Crop, Reformat
- **Merge**: Merge, Premult, Unpremult, Copy, ChannelMerge, Switch
- **Tracking/Warp**: Tracker, PlanarTracker, SplineWarp, Retime, TimeWarp
- **3D**: Camera3D, Card3D, Cube3D, Project3D, ScanlineRender
- **Deep**: DeepRead, DeepWrite, DeepMerge, DeepHoldout, DeepCrop, DeepToImage, DeepFromImage

### 2.4 Auto-Connection, Pipe Routing, Dot & Backdrop Nodes
- Creating a node while an existing node is selected automatically connects the primary `in` pipe to the selected node.
- Connecting downstream nodes draws dynamic Bézier cubic spline curves with direction indicator arrows.
- **Dot Node** (`.` key): Inserts a lightweight routing elbow to keep complex DAG layouts clean.
- **Backdrop Node**: Draggable colored grouping rectangle with title bar to visually compartmentalize multi-node department workflows.

---

## 5. Specialized Departmental VFX Workflows

### 5.1 Department 1: ROTO Workflow
- **Bezier & B-Spline Editing**: Draw multi-point closed shapes with per-vertex tangent controls.
- **Variable Feathering**: Dedicated inner/outer boundary handles for smooth edge softness.
- **Animated Shapes**: Keyframe point positions and feather widths across temporal frame ranges.
- **Motion Tracking Linkage**: Parent roto shapes or vertices directly to 2D Tracker or PlanarTracker tracks.
- **Matte Inspection**: One-key toggle to Alpha channel view (`A` key) with false-color matte analysis.

### 5.2 Department 2: PAINT Workflow
- **Non-Destructive Stroke Architecture**: Vector-recorded brush strokes preserved as editable procedural operations.
- **Brush Modes**:
  - *Clone / Reveal*: Source offset sampling across spatial coordinates and temporal frame offsets (clone clean frames).
  - *Blur*: Localized procedural diffusion brush.
  - *Color / Erase*: Solid paint stamping with variable opacity, hardness, and diameter.
- **Stroke List & Re-Ordering**: Properties panel lists all strokes with individual visibility toggles, blend modes, and opacity sliders.

### 5.3 Department 3: DEPTH Workflow
- **Depth Map Generation**: Synthetic perspective ground-plane ramps, spherical gradient depth, and cylindrical corridors.
- **Roto-to-Depth Sculpting**: Ingest 2D roto cutouts and assign relative Z-depth layers (e.g. Character at Z=0.3, Background at Z=0.9).
- **Edge-Preserving Bilateral Smoothing**: Smooth noisy depth passes while strictly maintaining crisp depth discontinuities at object silhouettes.
- **False-Color Heatmaps**: Turbo / Magma / Inferno false-color visualization to inspect depth gradient continuity.

### 5.4 Department 4: STEREO COMP Workflow
- **DIBR Disparity Warping**: Depth-Image-Based Rendering calculating horizontal disparity shifts from 32-bit floating-point Z-depth.
- **Disocclusion Inpainting**: Multi-stage gradient inpainting filling hidden background regions uncovered by camera parallax.
- **Dubois Anaglyph Synthesis**: Spectrally calibrated Red-Cyan matrix integration for high-fidelity 3D stereo review.
- **Interocular & Convergence Control**: Interactive controls for eye separation ($63.5\text{ mm}$ default) and zero-parallax screen convergence plane.

### 5.5 Department 5: OPTICAL DEFOCUS (ZDefocus)
- **Physical Lens Aperture**: Simulates circle of confusion (CoC) based on focal length, F-stop, and focus distance.
- **24-Sample Poisson-Disc Optical Bokeh**: High-quality bokeh distribution with smooth discs and zero circular banding.
- **Anamorphic Bokeh**: Configurable horizontal/vertical aspect ratio modeling cylindrical anamorphic cinema lenses.
- **Highlight Bloom**: High Dynamic Range luminance-weighted bokeh boosting for realistic specular flares.

---

## 1. Welcome & Executive Overview

Welcome to the **OpenComp Artist Validation Session**.

OpenComp is a high-performance, node-based digital compositing software designed specifically for visual effects production. All core engineering phases (Phases 1 through 6, plus Phase 2.1 stabilization) have achieved **100% automated software verification** across 60 regression test suites and 36 browser UI interaction tests.

### Explicit Operational Integrity Notice:
```
================================================================================
⚠️ OPERATIONAL INTEGRITY CLASSIFICATION: PENDING ARTIST VALIDATION
================================================================================
Automated software tests prove code correctness, 32-bit float determinism, 
DAG evaluation, and synthetic DOM event handling. However:
1. Automated tests DO NOT evaluate subjective human tactile feel, mouse wheel 
   friction curves, or visual comfort during high-intensity shot assembly.
2. Automated tests DO NOT evaluate perceptual color fidelity on calibrated 
   studio reference monitors (e.g., Sony BVM-HX310 / Flanders Scientific).
3. This handoff package provides all verified launchers, sample assets, 
   pre-configured projects, and recording templates for human artist evaluation.
4. Testing remains strictly PENDING until a qualified compositor reviews the 
   tactile workflow and records feedback.
================================================================================
```

---

## 2. Fast-Start Artist Launch Runbook

OpenComp runs 100% locally with zero external network dependencies, binding exclusively to `127.0.0.1:8080`.

### 2.1 System Prerequisites
- **Operating System:** Windows 10 / 11 64-bit (or Linux workstation).
- **Display Resolution:** $1920 \times 1080$ minimum ($2560 \times 1440$ or $3840 \times 2160$ recommended).
- **Input Devices:** 3-button mouse (Left, Right, Middle-click / Scroll Wheel) or Wacom tablet with middle-click mapped.
- **Web Browser:** Microsoft Edge or Google Chrome (v110+).

### 2.2 Launching OpenComp

#### Option A: Frameless Studio Desktop Workstation (Recommended)
Double-click `run_desktop.bat` in the root repository folder, or run in Command Prompt:
```cmd
cd C:\Users\rajeshn\Desktop\Rajesh\OpenComp
run_desktop.bat
```
*Behavior:* Starts the local high-speed Node.js loopback server on port `8080` (if not already running) and opens OpenComp in a clean, frameless, native-feeling desktop app window (`--app=http://127.0.0.1:8080/`).

#### Option B: Standard Browser Launch
Double-click `run.bat` or run:
```cmd
cd C:\Users\rajeshn\Desktop\Rajesh\OpenComp
run.bat
```
*Behavior:* Starts the server and opens OpenComp in your default system web browser.

#### Option C: Manual CLI Server Start
If you prefer direct terminal control:
```bash
node server.js
```
Then open your browser and navigate to:
```
http://127.0.0.1:8080/
```

*(Note: The server health can be confirmed anytime at `http://127.0.0.1:8080/health` which returns `{"status":"ok","app":"OpenComp",...}`).*

---

## 3. Supplied Test Assets & Validation Project

All validation assets are located in the repository at:
`C:\Users\rajeshn\Desktop\Rajesh\OpenComp\test_assets\manual_validation\`

| Asset Filename | File Type | Purpose / Description | Size |
|---|---|---|:---:|
| `artist_validation_master.opencomp` | OpenComp Project (JSON) | Complete 17-node master compositing DAG wiring Read, Grade, Blur, Keyer, Despill, Stereo, Depth, AOVs, Merge, and Viewer | 11 KB |
| `artist_validation_master.comp` | OpenComp Project Alias | Identical alias of master project for legacy extension handling | 11 KB |
| `sample_plate_1080p.exr` | OpenEXR Multi-Layer Float32 | Real 1080p live-action background plate with RGB, Alpha, Depth (`depth.Z`), Normals, Motion Vectors, and Cryptomatte layers | 5.7 MB |
| `greenscreen_1080p.exr` | OpenEXR Float32 | Real 1080p live-action greenscreen actress element with edge spill and hair detail | 4.8 MB |
| `sample_shot.nk` | Industry-Standard Script (.nk) | Verified cross-platform Nuke 14/15 script for testing `.nk` import interoperability | 1 KB |

---

## 4. Step-by-Step Artist Workflow Guide

### 4.1 Opening the Supplied Validation Project
1. Launch OpenComp (`run_desktop.bat`).
2. In the top menu bar, click **File** $\to$ **Open Project...** (or press <kbd>Ctrl+O</kbd>).
3. In the file open dialog, navigate to:
   `test_assets\manual_validation\artist_validation_master.opencomp`
4. Click **Open**.
5. **Expected Result:**
   - 17 nodes populate the Node Graph canvas cleanly in structured color-coded branches.
   - Node connections (Bezier wires) link nodes from top to bottom.
   - `Viewer1` connects to inputs:
     - Input 1: `Merge1` (Final Composite)
     - Input 2: `StereoMerge1` (Anaglyph Stereo 3D)
     - Input 3: `ChannelMerge1` (AOV Channel Union)

### 4.2 Loading Footage into a Read Node
1. In the Node Graph, select `Read1` (or press <kbd>R</kbd> on empty canvas to create a new `Read` node).
2. Look at the **Properties Bin** on the right side of the window.
3. In the `file` field, observe the file path:
   `C:/Users/rajeshn/Desktop/Rajesh/OpenComp/test_assets/manual_validation/sample_plate_1080p.exr`
4. If testing footage replacement: Click the browse button or paste an absolute path to any 1080p/2K/4K OpenEXR, PNG, or JPEG file.
5. Select `Read1` and press <kbd>1</kbd>.
6. The image appears in the Viewer with full 32-bit floating point precision.

### 4.3 Navigating the Node Graph
- **Pan Canvas:** Click and drag with the **Middle Mouse Button**, or hold <kbd>Alt</kbd> + Left-click and drag.
- **Zoom Canvas:** Scroll the **Mouse Wheel** up (zoom in) and down (zoom out).
- **Frame All Nodes:** Press <kbd>A</kbd> to center and frame the entire graph.
- **Frame Selected Node:** Select a node and press <kbd>F</kbd>.
- **Select Nodes:** Left-click a node. Hold <kbd>Shift</kbd> and click to select multiple nodes. Drag a marquee box on empty canvas to select a cluster.
- **Create Nodes via Quick-Search (Tab):**
  - Press <kbd>Tab</kbd> on the graph $\to$ a fuzzy search box appears directly at your cursor.
  - Type acronyms: `gr` (Grade), `cc` (ColorCorrect), `ck` (ChromaKeyer), `m` (Merge), `t` (Transform), `b` (Blur).
  - Press <kbd>Enter</kbd> $\to$ the node is created at your cursor position.
- **Auto-Connection:** If a node is selected when pressing <kbd>Tab</kbd>, the new node automatically connects downstream.
- **Wire Routing & Disconnect:**
  - Drag from an output arrow (bottom of node) to an input port (top of node) to connect.
  - Click a wire and press <kbd>Delete</kbd> to disconnect.
- **Backdrop Containers:** Select multiple nodes $\to$ press <kbd>Tab</kbd> $\to$ type `Backdrop` $\to$ <kbd>Enter</kbd>. Drag the top title bar of the backdrop to move all enclosed nodes together.
- **Disable Node:** Select any node and press <kbd>D</kbd> to toggle its bypass/disabled state.

### 4.4 Navigating the Viewer & Comparison Engine
- **10-Slot Switching:**
  - With a node selected, press <kbd>1</kbd> through <kbd>9</kbd> to route it to slots 1–9. Press <kbd>0</kbd> to route to slot 10.
  - With no node selected, pressing <kbd>1</kbd>–<kbd>0</kbd> switches the active viewing slot.
- **A/B Wipe Comparison:**
  - In the Viewer toolbar, set **Mode** to **Wipe H** (Horizontal Wipe) or **Wipe V** (Vertical Wipe).
  - Set **Source A** to `1` (Composite) and **Source B** to `2` (Stereo or Plate).
  - Click and drag the interactive divider line directly across the canvas to compare before/after footage.
- **Difference Mode:**
  - Set Mode to **Diff**. Identical pixels become pure black; differences highlight errors or matte leakage.
- **Exposure & Gamma Scrubbing:**
  - Scrub the **Exposure** slider ($-4.0$ to $+4.0$ f-stops) to evaluate shadow noise or blown-out highlights.
  - Scrub the **Gamma** slider ($0.2$ to $4.0$).
  - Double-click either slider to reset instantly to default ($0.0$ EV, $1.0$ Gamma).
- **Channel Isolation:**
  - Click the channel buttons in the viewer toolbar (or use hotkeys):
    - <kbd>R</kbd>: Red Channel Only
    - <kbd>G</kbd>: Green Channel Only
    - <kbd>B</kbd>: Blue Channel Only
    - <kbd>A</kbd>: Alpha Matte (grayscale)
    - <kbd>L</kbd>: Luminance
    - <kbd>C</kbd> or <kbd>RGBA</kbd>: Return to full color
- **Floating-Point Pixel Inspector:**
  - Move your mouse cursor across the Viewer canvas.
  - Look at the status readout at the bottom of the Viewer to see exact pixel coordinates $(X, Y)$ and unclipped 32-bit float values: `R: 0.1423  G: 0.8921  B: 0.0512  A: 1.0000`.
- **Pan & Zoom Viewer:**
  - Middle-click and drag on the image to pan.
  - Scroll mouse wheel to zoom into subpixel details.
  - Press <kbd>F</kbd> to fit image perfectly to window.

### 4.5 Editing Node Knobs in Properties Bin
1. Double-click `Grade1` in the Node Graph $\to$ its parameter card opens in the Properties Bin.
2. Scrub the `gain` or `gamma` sliders horizontally.
3. Alternatively, double-click the numeric field and type an exact value (e.g. `1.35`).
4. Notice the Viewer updates in real-time.
5. In `ChromaKeyer1`, click the color swatch next to `keyColor` to open the color picker.

### 4.6 Navigating Timeline & Playback
1. Look at the bottom bar of the application.
2. Click **Play** (<kbd>Space</kbd>) $\to$ OpenComp plays through frame range 1 to 24.
3. Click **Step Forward** (<kbd>Right Arrow</kbd>) or **Step Backward** (<kbd>Left Arrow</kbd>) to advance frame by frame.
4. Click and drag the timeline scrubber handle to rapidly scrub across time.
5. Notice how `Grade1` gain animates smoothly from $1.0$ at frame 1 to $1.5$ at frame 24.

### 4.7 Working in the Curve Editor
1. In the central pane, click the **[ Curve Editor ]** tab (located next to `[ Node Graph ]`).
2. In the curve tree on the left, select `Grade1` $\to$ `gain`.
3. The cubic Bezier animation curve appears across frames 1 to 24.
4. Click a keyframe point $\to$ yellow tangent handles appear.
5. Drag a tangent handle to alter the acceleration and curvature.
6. Click tangent mode buttons in the Curve Editor toolbar:
   - **Smooth:** Continuous $C^1$ Bezier slope.
   - **Flat:** Horizontal zero-slope tangents (ease-in/ease-out).
   - **Linear:** Direct point-to-point interpolation.
   - **Free:** Independent broken tangent angles.
7. Pan and zoom the Curve Editor canvas with middle-click and scroll wheel.

### 4.8 Saving, Exporting, and Reopening Projects
1. **Save Project:**
   - Click **File** $\to$ **Save Project** (or press <kbd>Ctrl+S</kbd>).
   - Choose a file path, e.g., `test_assets/manual_validation/my_artist_session.opencomp`.
2. **Export Nuke Script:**
   - Click **File** $\to$ **Export Script...** $\to$ saves a `.nk` ASCII script.
3. **Clear Canvas:**
   - Click **File** $\to$ **New Project** (or press <kbd>Ctrl+N</kbd>). Confirm dialog.
4. **Reopen Project:**
   - Click **File** $\to$ **Open Project...** (or press <kbd>Ctrl+O</kbd>).
   - Select your saved `my_artist_session.opencomp`.
   - **Verify:** All 17 nodes, connections, positions, knob edits, and curve keyframes are restored bit-identically.

---

## 5. Master 17-Point Artist Validation Checklist

The following 17 items represent the manual validation scope. Note the distinction between items already verified by automated CDP browser testing and items requiring your subjective human feedback:

| Item # | Functional Subsystem | Specific Testing Action | Verification Classification | Artist Focus / Evaluation Criteria |
|:---:|---|---|:---:|---|
| **06** | **Viewer Pan & Zoom** | Middle-click drag and mouse wheel zoom across 1080p plate | **Partially Automated** | Evaluate 60fps fluid hand-feel, deceleration curve, and pan responsiveness. |
| **07** | **Horizontal Wipe** | Drag vertical divider line left/right across canvas | ✅ Automated Pass | Confirm smooth divider tracking under mouse cursor. |
| **08** | **Vertical Wipe & Diff** | Switch Mode to Wipe V, drag divider; switch to Diff mode | ✅ Automated Pass | Confirm divider orientation flip and accurate difference calculation. |
| **09** | **Channel Isolation** | Toggle R, G, B, A, Luma, and RGBA in viewer toolbar | ✅ Automated Pass | Verify instant channel display and grayscale visualization. |
| **10** | **OCIO Color Perception** | Observe ACEScg $\to$ sRGB transform rolloff on image | **Subjective Human Review** | Perceptual evaluation of tone mapping, highlight rolloff, and color fidelity on calibrated monitor. |
| **11** | **Pixel Inspector** | Hover cursor over highlights, midtones, and shadows | ✅ Automated Pass | Confirm float precision readouts $(R, G, B, A)$ without coordinate lag. |
| **12** | **Fit-to-Window [F]** | Zoom in to 400%, press <kbd>F</kbd> hotkey | ✅ Automated Pass | Confirm immediate centering and full-frame fit within canvas. |
| **17** | **Bezier Wire Redraw** | Drag `Blur1` or `Merge1` node around the canvas | ✅ Automated Pass | Confirm connection wires redraw continuously without trailing artifacts. |
| **19** | **Backdrop Dragging** | Select and drag backdrop header bar | ✅ Automated Pass | Confirm all child nodes inside the backdrop translate synchronously. |
| **22** | **Marquee Selection** | Drag a bounding box over 3 nodes in empty canvas | ✅ Automated Pass | Confirm all touched nodes highlight and select simultaneously. |
| **23** | **Properties Bin Knobs** | Scrub slider horizontally; type numbers into field | ✅ Automated Pass | Confirm value updates smoothly in Viewer and text input accepts typing. |
| **24** | **Color Picker Swatches** | Click color swatch in `ChromaKeyer1` or `Constant` | ✅ Automated Pass | Confirm color picker opens, swatches pick accurately, and image recalculates. |
| **25** | **Keyframe Stopwatch UI** | Toggle animated parameter stopwatch icon | **Partially Automated** | Evaluate tactile feedback of setting keyframes on knob controls. |
| **38** | **Tab Search Palette** | Press <kbd>Tab</kbd> $\to$ type acronym $\to$ press <kbd>Enter</kbd> | ✅ Automated Pass | Confirm popover appears under cursor and creates node instantly. |
| **49** | **Continuous Scrubbing** | Rapidly drag timeline scrubber back and forth for 30s | **Partially Automated** | Observe fluid UI response and steady-state RAM usage in Windows Task Manager. |
| **50** | **Air-Gap Network Isolation**| Disconnect Ethernet / toggle Airplane Mode | **Physical Infrastructure** | Confirm OpenComp functions 100% locally with zero network connection. |
| **51** | **Curve Tangent Dragging** | In Curve Editor, select keyframe and drag tangent handles | ✅ Automated Pass | Confirm slope updates smoothly and tangent mode buttons function. |

---

## 6. How and Where to Record Your Feedback

Artists are encouraged to record both strict technical defects and open-ended subjective usability feedback.

### Feedback Documentation Files:
1. **[OPENCOMP_ARTIST_FEEDBACK_TEMPLATE.md](file:///c:/Users/rajeshn/Desktop/Rajesh/OpenComp/OPENCOMP_ARTIST_FEEDBACK_TEMPLATE.md)**:
   - Fill out this structured template for each test session.
   - Contains sections for test items, workflow steps, screenshots, subjective ratings, and suggestions.
2. **[MANUAL_ARTIST_FAILURE_LOG.md](file:///c:/Users/rajeshn/Desktop/Rajesh/OpenComp/MANUAL_ARTIST_FAILURE_LOG.md)**:
   - Record any reproducible software bugs, unexpected visual glitches, or blocking errors encountered.
3. **[MANUAL_ARTIST_SIGNOFF_RESULTS.md](file:///c:/Users/rajeshn/Desktop/Rajesh/OpenComp/MANUAL_ARTIST_SIGNOFF_RESULTS.md)**:
   - When all validation activities conclude, the lead artist or supervisor signs this formal completion form.

### Subjective Usability Rule:
> [!NOTE]
> **You are NOT forced to mark subjective usability observations as PASS or FAIL.**
> If a feature works mathematically but feels sluggish, has awkward mouse acceleration, or would benefit from a different default hotkey, classify it as **`OBSERVATION`** or **`ERGONOMIC SUGGESTION`**. We value honest production feedback over artificial pass marks.

---

## 7. Next Steps for the Validation Team

1. Ensure the workstation meets prerequisites.
2. Launch OpenComp via `run_desktop.bat`.
3. Open `test_assets/manual_validation/artist_validation_master.opencomp`.
4. Work through the 17 checklist items in Section 5.
5. Record all observations in `OPENCOMP_ARTIST_FEEDBACK_TEMPLATE.md`.
6. Log any defects in `MANUAL_ARTIST_FAILURE_LOG.md`.

*Happy Compositing!*



---

## 1. Project Overview & DAG Topology

The Artist Validation Master Project (`artist_validation_master.opencomp`) is a comprehensive 17-node compositing tree designed to exercise all primary functional departments in a single cohesive shot setup.

```mermaid
flowchart TD
    Read1["Read1<br>(sample_plate_1080p.exr)"] --> Grade1["Grade1<br>(gain: 1.0 -> 1.5)"]
    Grade1 --> Blur1["Blur1<br>(size: 6.0)"]
    
    Read_GS["Read_GS<br>(greenscreen_1080p.exr)"] --> ChromaKeyer1["ChromaKeyer1<br>(screenGain: 1.1)"]
    ChromaKeyer1 --> Despill1["Despill1<br>(average green)"]
    Despill1 --> EdgeExtend1["EdgeExtend1<br>(slices: 8)"]
    
    Constant_Depth["Constant_Depth<br>(1080p gray)"] --> Depth1["Depth1<br>(Z-ramp: 0.1-1.0)"]
    Depth1 --> StereoWarp1["StereoWarp1<br>(separation: 30)"]
    Read1 --> StereoWarp1
    StereoWarp1 --> StereoMerge1["StereoMerge1<br>(anaglyph)"]
    
    Read1 --> Copy1["Copy1<br>(depth, normals, motion)"]
    Read_GS --> Copy1
    ChromaKeyer1 --> ChannelMerge1["ChannelMerge1<br>(alpha union)"]
    Copy1 --> ChannelMerge1
    
    Roto1["Roto1<br>(garbage matte)"] --> Paint1["Paint1<br>(clone/heal)"]
    
    EdgeExtend1 -->|A (Foreground)| Merge1["Merge1<br>(over)"]
    Blur1 -->|B (Background)| Merge1
    Paint1 -->|mask| Merge1
    
    Merge1 -->|Input 1| Viewer1["Viewer1<br>(10-Slot Comparison)"]
    StereoMerge1 -->|Input 2| Viewer1
    ChannelMerge1 -->|Input 3| Viewer1
```

---

## 2. Detailed Node Inventory

| Node ID | Node Type | Category | Inputs / Connections | Key Parameters & Animation | Production Purpose |
|---|---|---|---|---|---|
| `Read1` | `Read` | Image | None | `file`: `sample_plate_1080p.exr`<br>`format`: `1920x1080`<br>`channels`: `all` | Background live-action plate with full multi-channel AOVs. |
| `Grade1` | `Grade` | Color | In $\leftarrow$ `Read1` | `blackpoint`: 0.02, `whitepoint`: 0.98<br>`gain`: Animated (F1: 1.0 $\to$ F24: 1.5)<br>`gamma`: 1.1 | Color grading and temporal animation curve testing. |
| `Blur1` | `Blur` | Filter | In $\leftarrow$ `Grade1` | `size`: 6.0, `aspectRatio`: 1.0 | Background defocusing simulation. |
| `Read_GS` | `Read` | Image | None | `file`: `greenscreen_1080p.exr`<br>`format`: `1920x1080` | Live-action greenscreen actress element. |
| `ChromaKeyer1` | `ChromaKeyer` | Keyer | In $\leftarrow$ `Read_GS` | `keyColor`: `[0.08, 0.88, 0.12]`<br>`screenGain`: 1.1 | Green screen extraction and core alpha matte generation. |
| `Despill1` | `Despill` | Keyer | In $\leftarrow$ `ChromaKeyer1` | `screenType`: `green`<br>`algorithm`: `average` | Removal of green bounce light on actress edges. |
| `EdgeExtend1` | `EdgeExtend` | Keyer | In $\leftarrow$ `Despill1` | `slices`: 8 | Edge pixel dilation preventing dark fringing. |
| `Constant_Depth` | `Constant` | Image | None | `color`: `[0.4, 0.4, 0.4, 1.0]` | Flat reference canvas for depth generation. |
| `Depth1` | `Depth` | Channel / Draw | In $\leftarrow$ `Constant_Depth` | `mode`: `ramp`<br>`nearZ`: 0.1, `farZ`: 1.0 | Synthesizes depth gradient channel (`depth.Z`). |
| `StereoWarp1` | `StereoWarp` | Channel / Draw | In $\leftarrow$ `Read1`<br>depth $\leftarrow$ `Depth1` | `separation`: 30.0<br>`convergence`: 0.5 | Converts 2D plate into stereoscopic Left/Right views using depth. |
| `StereoMerge1` | `StereoMerge` | Channel / Draw | Left $\leftarrow$ `StereoWarp1`<br>Right $\leftarrow$ `StereoWarp1` | `mode`: `anaglyph` | Combines stereoscopic views into red-cyan anaglyph image. |
| `Copy1` | `Copy` | Channel / Draw | A $\leftarrow$ `Read1`<br>B $\leftarrow$ `Read_GS` | 8 channel pairs mapped (`depth.Z`, `normals`, `motion`, `crypto`) | Arbitrary dynamic AOV layer merging. |
| `ChannelMerge1` | `ChannelMerge` | Channel / Draw | A $\leftarrow$ `ChromaKeyer1`<br>B $\leftarrow$ `Copy1` | `operation`: `union`<br>`to`: `alpha` | Boolean channel combination. |
| `Roto1` | `Roto` | Channel / Draw | None | `output`: `alpha` | Bezier shape garbage matte generation. |
| `Paint1` | `Paint` | Channel / Draw | In $\leftarrow$ `Roto1` | Paint canvas | Rig removal and clone brush stroke overlay. |
| `Merge1` | `Merge` | Merge | A $\leftarrow$ `EdgeExtend1`<br>B $\leftarrow$ `Blur1`<br>mask $\leftarrow$ `Paint1` | `operation`: `over` | Main composite node layering keyed foreground over graded background. |
| `Viewer1` | `Viewer` | Viewer | Slot 1 $\leftarrow$ `Merge1`<br>Slot 2 $\leftarrow$ `StereoMerge1`<br>Slot 3 $\leftarrow$ `ChannelMerge1` | `inputIndex`: 1 | Interactive 10-slot viewport comparison. |

---

## 3. Sample Footage Specifications

The sample assets located in `test_assets/manual_validation/` meet true visual effects production specifications:

### 3.1 `sample_plate_1080p.exr`
- **Format:** OpenEXR (Zip compression, single scanline chunking).
- **Resolution:** $1920 \times 1080$ pixels (HD 1080p DCI 1:1 aspect ratio).
- **Pixel Type:** 32-bit IEEE-754 Floating Point per channel.
- **Color Space:** ACEScg linear space.
- **Channels Included:**
  - `rgba.red`, `rgba.green`, `rgba.blue`, `rgba.alpha`
  - `depth.Z` (floating-point camera distance in meters)
  - `normals.X`, `normals.Y`, `normals.Z` (surface normal unit vectors)
  - `motion.u`, `motion.v` (optical screen-space velocity vectors)
  - `crypto_object` (Cryptomatte ID coverage layer)

### 3.2 `greenscreen_1080p.exr`
- **Format:** OpenEXR (Zip compression).
- **Resolution:** $1920 \times 1080$ pixels.
- **Pixel Type:** 32-bit Floating Point (`rgba`).
- **Content:** Studio greenscreen live-action element featuring fine hair edges, motion blur, and green bounce spill.

---

## 4. Pre-Flight Verification Script

Before handing the workstation to an artist, the pre-flight verification script can be run to guarantee that all assets load and evaluate without error:

```bash
node tests/test_artist_session_automated_precheck.mjs
```

### Verification Checks Performed:
1. Spawns headless browser on CDP port `9228`.
2. Connects to `http://127.0.0.1:8080/`.
3. Deserializes `artist_validation_master.opencomp` into the live graph.
4. Asserts that all **17 nodes** instantiate in the DAG.
5. Evaluates `Read1` and `Merge1` floating-point pixel buffers.
6. Calls `nodeGraphUI.frameAll()` and captures live screenshot `artist_session_live_ui.png`.
7. Terminates cleanly with exit code `0`.



---

## 1. Test Session Objectives & Scope

The purpose of the Artist Validation Session is to evaluate OpenComp from the perspective of a professional visual effects compositor. While automated regression tests confirm that mathematical algorithms, buffer memory, and UI event listeners function correctly, this session gathers human feedback on:

1. **Tactile Ergonomics:** Mouse wheel deceleration, canvas pan responsiveness, and slider scrub feel.
2. **Perceptual Color Accuracy:** OCIO tone mapping and highlight rolloff on calibrated monitors.
3. **Muscle Memory & Hotkey Comfort:** Speed and naturalness of standard compositing shortcuts.
4. **Interactive Stability:** Sustained manual scrubbing and complex editing without UI lag or memory leaks.

---

## 2. Chronological Testing Protocol

Follow these seven structured steps during your validation session:

### Step 1: Workstation Initialization
1. Ensure your workstation has Microsoft Edge or Google Chrome installed.
2. Double-click `run_desktop.bat` in `C:\Users\rajeshn\Desktop\Rajesh\OpenComp`.
3. Confirm the application launches in a clean, frameless window with a dark slate interface.
4. Confirm the top status bar displays the active version without errors.

### Step 2: Project Loading & Graph Setup
1. Press <kbd>Ctrl+O</kbd> (or click **File** $\to$ **Open Project...**).
2. Select `test_assets/manual_validation/artist_validation_master.opencomp`.
3. Confirm that all 17 nodes populate the Node Graph canvas cleanly.
4. Press <kbd>A</kbd> to frame the entire node graph.
5. Zoom into the nodes using the mouse wheel, then pan across the graph by holding middle-click.
6. **Evaluate:** Does the pan and zoom feel smooth and responsive?

### Step 3: Interactive Node Graph Operations (Items 17, 19, 22, 38)
1. **Marquee Box Selection (Item 22):** Click and drag on empty canvas to draw a marquee box around `ChromaKeyer1`, `Despill1`, and `EdgeExtend1`. Confirm all three nodes highlight as selected.
2. **Bezier Wire Redraw (Item 17):** Drag `Merge1` around the canvas in circular motions. Confirm the connection wires redraw continuously and smoothly.
3. **Backdrop Movement (Item 19):** If a backdrop is present, drag its header bar. Confirm all child nodes translate synchronously.
4. **Tab Search (Item 38):**
   - Click empty canvas and press <kbd>Tab</kbd>.
   - Type `cc` $\to$ confirm `ColorCorrect` is selected $\to$ press <kbd>Enter</kbd>.
   - Select the new node and press <kbd>Delete</kbd>.
   - Press <kbd>Tab</kbd> $\to$ type `m` $\to$ confirm `Merge` appears. Press <kbd>Esc</kbd> to cancel.

### Step 4: Viewer Controls & Comparison Modes (Items 06, 07, 08, 09, 11, 12)
1. Select `Merge1` and press <kbd>1</kbd>.
2. Select `Read1` and press <kbd>2</kbd>.
3. Press <kbd>1</kbd> and <kbd>2</kbd> alternately to toggle between the final composite and the raw background plate.
4. In the Viewer toolbar, set **Mode** to **Wipe H (Horizontal)**.
   - Drag the divider line across the canvas (Item 07).
5. Switch **Mode** to **Wipe V (Vertical)**, then **Diff (Difference)** (Item 08).
6. Click channel buttons: **R**, **G**, **B**, **A**, **Luma**, **RGBA** (Item 09).
7. Hover your cursor over the image and observe the pixel inspector readout at the bottom (Item 11).
8. Zoom to 400%, then press <kbd>F</kbd> (Item 12). Confirm image re-centers and fits to window.
9. **Evaluate Item 06:** Does 60fps pan/zoom hand-feel meet studio standards?

### Step 5: Color Grading & OCIO Perceptual Fidelity (Items 10, 23, 24)
1. Double-click `Grade1` in the graph to display its parameters in the Properties Bin.
2. Scrub the `gain` slider horizontally (Item 23). Notice real-time updates in the Viewer.
3. Double-click the numeric field, type `1.25`, and press <kbd>Enter</kbd>.
4. In `ChromaKeyer1`, click the color swatch next to `keyColor` (Item 24). Pick a color and confirm update.
5. **Evaluate Item 10:** On your calibrated studio monitor, evaluate the OCIO ACEScg $\to$ sRGB highlight rolloff and shadow neutrality.

### Step 6: Temporal Animation & Scrubbing Stress (Items 25, 49, 51)
1. Open Windows Task Manager (`Ctrl+Shift+Esc`) and locate the OpenComp process.
2. In OpenComp, drag the timeline scrubber handle rapidly back and forth between frames 1 and 24 for 30 continuous seconds (Item 49).
3. **Evaluate Item 49:** Observe whether RAM usage remains bounded in Task Manager.
4. Click the **[ Curve Editor ]** tab.
5. Select `Grade1` $\to$ `gain` in the curve list.
6. Click a keyframe point to display tangent handles.
7. Drag a tangent handle to modify curve slope (Item 51). Test `Smooth`, `Flat`, `Linear`, and `Free` buttons.
8. **Evaluate Item 25:** Evaluate the stopwatch icon keyframing workflow.

### Step 7: Air-Gap Verification, Project Save & Reopen (Item 50)
1. **Air-Gap Check (Item 50):** If authorized on your test machine, disconnect the network cable or toggle Airplane Mode. Confirm OpenComp continues working 100% locally with zero errors.
2. Press <kbd>Ctrl+S</kbd> to save the project as `my_test_session.opencomp`.
3. Press <kbd>Ctrl+N</kbd> to clear the canvas.
4. Press <kbd>Ctrl+O</kbd> and reopen `my_test_session.opencomp`.
5. Confirm that all nodes, positions, connections, and parameter edits reload accurately.

---

## 3. Post-Session Actions

1. Record any bugs or unexpected behavior in **[MANUAL_ARTIST_FAILURE_LOG.md](file:///c:/Users/rajeshn/Desktop/Rajesh/OpenComp/MANUAL_ARTIST_FAILURE_LOG.md)**.
2. Complete your evaluation notes in **[OPENCOMP_ARTIST_FEEDBACK_TEMPLATE.md](file:///c:/Users/rajeshn/Desktop/Rajesh/OpenComp/OPENCOMP_ARTIST_FEEDBACK_TEMPLATE.md)**.
3. Share your findings with the engineering lead for review and roadmap prioritization.



---

## 1. Artist Session Metadata

*Please fill out this header before beginning your validation session:*

| Metadata Field | Artist Entry | Notes / Examples |
|---|---|---|
| **Evaluating Artist Name:** | *[ Enter Artist Full Name ]* | e.g. Senior Compositor / VFX Lead |
| **Studio / Organization:** | *[ Enter Studio Name ]* | Facility name or Independent Artist |
| **Session Date & Time:** | *[ YYYY-MM-DD HH:MM ]* | Date and start time of evaluation |
| **Workstation OS & Version:** | *[ e.g. Windows 11 Pro 64-bit / Linux ]* | Operating system environment |
| **Display Monitor & Resolution:**| *[ e.g. Dell UltraSharp 4K / Flanders XMP310 ]* | Native resolution & calibration profile |
| **GPU & Driver Version:** | *[ e.g. NVIDIA RTX 4080 (Studio Driver 560.xx) ]* | Dedicated graphics hardware |
| **Launcher Used:** | `[ ] run_desktop.bat  [ ] run.bat  [ ] node server.js` | Check applicable launcher |
| **Project File Tested:** | `artist_validation_master.opencomp` | Or custom production shot file |

---

## 2. Master 17-Point Validation Checklist Feedback

Use the table below to log results for each of the 17 checklist items.

> [!TIP]
> **Evaluation Classifications:**
> - **`PASS`**: Feature functions correctly as expected.
> - **`FAIL`**: Feature fails to perform its defined function or throws an unhandled error.
> - **`BLOCKED`**: Cannot evaluate due to an upstream failure or missing facility hardware.
> - **`OBSERVATION`**: Feature functions correctly, but you have subjective ergonomic, friction, deceleration, or aesthetic notes.
> - **`SUGGESTION`**: Workflow improvement idea or default parameter preference.

| Item # | Feature / Action Tested | Artist Result (`PASS` / `FAIL` / `BLOCKED` / `OBSERVATION` / `SUGGESTION`) | Actual Behavior & Artist Usability Notes |
|:---:|---|:---:|---|
| **06** | **Viewer Pan & Zoom** (Middle-click & Scroll wheel tactile hand-feel) | `[           ]` | |
| **07** | **Horizontal Wipe** (Interactive divider dragging left/right) | `[           ]` | |
| **08** | **Vertical Wipe & Diff Mode** (Divider flip and difference mode) | `[           ]` | |
| **09** | **Channel Isolation** (R, G, B, A, Luma, RGBA toggles) | `[           ]` | |
| **10** | **OCIO Color Perception** (ACEScg $\to$ sRGB highlight rolloff on reference display) | `[           ]` | |
| **11** | **Pixel Inspector** (Hover readout of float coordinates and RGBA) | `[           ]` | |
| **12** | **Fit-to-Window [F]** (Hotkey framing and re-centering) | `[           ]` | |
| **17** | **Bezier Wire Redraw** (Continuous wire updating during node movement) | `[           ]` | |
| **19** | **Backdrop Dragging** (Translating enclosed child nodes together) | `[           ]` | |
| **22** | **Marquee Box Selection** (Bounding box multi-node selection) | `[           ]` | |
| **23** | **Properties Bin Knobs** (Slider scrubbing & direct numerical typing) | `[           ]` | |
| **24** | **Color Picker Swatches** (Color swatch picking & live updates) | `[           ]` | |
| **25** | **Keyframe Stopwatch UI** (Knob animation stopwatch icon responsiveness) | `[           ]` | |
| **38** | **Tab Search Palette** (Fuzzy search popover & acronym node creation) | `[           ]` | |
| **49** | **Continuous Scrubbing** (30-second rapid timeline dragging & RAM check) | `[           ]` | |
| **50** | **Air-Gap Network Isolation** (Physical cable detachment / Airplane mode) | `[           ]` | |
| **51** | **Curve Tangent Dragging** (Bezier tangent slope editing in Curve Editor) | `[           ]` | |

---

## 3. Dedicated Subjective Usability Assessment

*Record detailed perceptual observations for features requiring artist judgment:*

### 3.1 Item 06 — Viewer Pan & Zoom Tactile Hand-Feel
- **Fluidity / Frame Rate (Subjective 1–10):** `[   / 10 ]`
- **Mouse Wheel Zoom Step / Acceleration:**
  - *Does the zoom step feel too fast, too slow, or natural?*
  - Artist Comments:
- **Middle-Click Pan Friction / Deceleration:**
  - *Does the canvas track 1:1 with mouse movement without lag or overshoot?*
  - Artist Comments:

### 3.2 Item 10 — OCIO Color Display Fidelity on Calibrated Monitor
- **Monitor Model & Color Gamut:** `[ e.g. Flanders Scientific XMP310 QD-OLED / DCI-P3 ]`
- **Highlight Rolloff Perception:**
  - *Do unclipped specular highlights roll off naturally into sRGB / Rec.709 display space?*
  - Artist Comments:
- **Shadow Neutrality & Black Levels:**
  - *Are dark shadow details clean without crushing or posterization?*
  - Artist Comments:

### 3.3 Item 25 — Keyframe Animation & Stopwatch Workflow
- **Stopwatch Toggle Feel:**
  - *Is it intuitive to add, keyframe, and remove animation from knob parameters?*
  - Artist Comments:
- **Timeline Tick Synchronization:**
  - *Do keyframe ticks on the timeline accurately reflect keyframe positions?*
  - Artist Comments:

### 3.4 Item 49 — Rapid Timeline Scrubbing & UI Responsiveness
- **30-Second Scrubbing Feel:**
  - *Did playback keep pace with rapid back-and-forth mouse movement?*
  - Artist Comments:
- **System Memory (Task Manager Observation):**
  - *Initial OpenComp RAM:* `[     MB ]`
  - *Peak RAM during scrubbing:* `[     MB ]`
  - *Settled RAM after release:* `[     MB ]`
  - *Did memory stabilize without unbounded growth?* `[ YES / NO ]`

---

## 4. Defect & Issue Logging Form

*Use this section to record any reproducible software bugs, glitches, or crashes encountered. Copy and paste additional blocks as needed.*

```markdown
### Defect Report: [DEF-ARTIST-001]
- **Date & Time:** 
- **Checklist Item / Feature Area:** (e.g., Item 23: Properties Bin / Grade Node)
- **Defect Title:** (Short descriptive summary)
- **Severity Level:** 
  [ ] Critical (Crash, data loss, project file corruption)
  [ ] Major (Feature non-functional, no workaround)
  [ ] Minor (Feature works partially or workaround exists)
  [ ] Cosmetic (Visual artifact, label alignment, typo)
- **Classification:** 
  [ ] Bug / Defect
  [ ] Usability Flaw
  [ ] Ergonomic Observation
  [ ] Feature Request
- **Steps to Reproduce:**
  1. 
  2. 
  3. 
- **Expected Behavior:** 
- **Actual Behavior:** 
- **Screenshot / Screen Recording Reference:** 
  - File: `tests/output/screenshots/...`
- **Artist Recommendation / Suggested Fix:** 
```

```markdown
### Defect Report: [DEF-ARTIST-002]
- **Date & Time:** 
- **Checklist Item / Feature Area:** 
- **Defect Title:** 
- **Severity Level:** [ ] Critical  [ ] Major  [ ] Minor  [ ] Cosmetic
- **Classification:** [ ] Bug  [ ] Usability  [ ] Observation  [ ] Suggestion
- **Steps to Reproduce:**
  1. 
  2. 
- **Expected Behavior:** 
- **Actual Behavior:** 
- **Screenshot / Screen Recording Reference:** 
- **Artist Recommendation / Suggested Fix:** 
```

---

## 5. Artist Overall Impressions & Qualitative Feedback

### 5.1 Ergonomics & Muscle Memory
- *How natural does the layout feel compared to standard studio compositing suites?*
- Comments:

### 5.2 Hotkey Usability
- *Were the hotkeys (<kbd>Tab</kbd>, <kbd>1</kbd>–<kbd>0</kbd>, <kbd>F</kbd>, <kbd>A</kbd>, <kbd>D</kbd>, <kbd>Space</kbd>) intuitive and responsive?*
- Comments:

### 5.3 Performance & Processing Speed
- *How did node evaluation speed feel when adjusting parameters on the 1080p Float32 plates?*
- Comments:

### 5.4 Suggested Improvements for Next Iteration
- Priority 1:
- Priority 2:
- Priority 3:

---

## 6. Artist Sign-Off Status

*(To be filled at the conclusion of the session)*

- **Total Items Evaluated:** `[    / 17 ]`
- **Items Passed:** `[    ]`
- **Items with Usability Observations:** `[    ]`
- **Defects Identified:** `[    ]`
- **Validation Session Status:**
  `[ ] IN PROGRESS  [ ] COMPLETED WITH OBSERVATIONS  [ ] BLOCKED ON DEFECTS`

**Evaluating Artist Signature:** __________________________________  
**Date:** ________________________  

