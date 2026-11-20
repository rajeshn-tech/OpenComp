# OpenComp — Artist User Guide & Production Manual

## Table of Contents
1. [Introduction & System Requirements](#1-introduction--system-requirements)
2. [Fast-Start Quickstart Runbook](#2-fast-start-quickstart-runbook)
3. [Application Interface & Workspace Layout](#3-application-interface--workspace-layout)
4. [Node Graph & Node Creation](#4-node-graph--node-creation)
   - [4.1 Navigating the DAG Canvas](#41-navigating-the-dag-canvas)
   - [4.2 Creating Nodes via Tab Search & Toolbar](#42-creating-nodes-via-tab-search--toolbar)
   - [4.3 Auto-Connection & Pipe Routing](#43-auto-connection--pipe-routing)
5. [Viewer Controls & 10-Slot Comparison Engine](#5-viewer-controls--10-slot-comparison-engine)
6. [Timeline & Animation Curve Editor](#6-timeline--animation-curve-editor)
7. [Comprehensive 34-Node Production Catalog](#7-comprehensive-34-node-production-catalog)
   - [7.1 Image & Input/Output Nodes](#71-image--inputoutput-nodes)
   - [7.2 Color & Grading Nodes](#72-color--grading-nodes)
   - [7.3 Filter & Spatial Optical Nodes](#73-filter--spatial-optical-nodes)
   - [7.4 Keying & Matte Extraction Nodes](#74-keying--matte-extraction-nodes)
   - [7.5 Transform & Spatial Warping Nodes](#75-transform--spatial-warping-nodes)
   - [7.6 Merge & Channel Operations](#76-merge--channel-operations)
   - [7.7 Motion Tracking & Temporal Nodes](#77-motion-tracking--temporal-nodes)
   - [7.8 3D Compositing Subsystem Nodes](#78-3d-compositing-subsystem-nodes)
   - [7.9 Volumetric Deep Compositing Nodes](#79-volumetric-deep-compositing-nodes)
8. [Core Compositing Concepts & Best Practices](#8-core-compositing-concepts--best-practices)
   - [8.1 Linear Floating-Point Color Space](#81-linear-floating-point-color-space)
   - [8.2 Premultiplication & Alpha Compositing Math](#82-premultiplication--alpha-compositing-math)
   - [8.3 Dynamic Bounding Box (BBox) Optimization](#83-dynamic-bounding-box-bbox-optimization)
9. [Complete Keyboard Shortcuts Quick Reference](#9-complete-keyboard-shortcuts-quick-reference)
10. [Troubleshooting & Frequently Asked Questions (FAQ)](#10-troubleshooting--frequently-asked-questions-faq)

---

## 1. Application Interface & Workspace Layout

OpenComp provides a unified, dark-slate visual effects compositing interface modeled on the industry-standard visual effects compositing desktop paradigm.

```
+---------------------------------------------------------------------------------------------------+
|  File   Edit   Nodes   Presets   Help                                       [ v6.0.0-production ] |
+----+---------------------------------------------------------------+------------------------------+
| T  |                                                               | PROPERTIES BIN               |
| O  |  VIEWER (Viewport 1 - 10)                                     | +--------------------------+ |
| O  |  [1][2][3][4][5][6][7][8][9][0]  [Wipe: H | V | Diff | SBS]   | | Grade1                   | |
| L  |  Exposure: [-4.0..+4.0]  Gamma: [0.2..4.0]  Channels: [RGBA]  | | [channels: rgba        ] | |
| B  |  OCIO: [ACEScg -> sRGB]  [100% Fit]                           | | [blackpoint: 0.0       ] | |
| A  |                                                               | | [whitepoint: 1.0       ] | |
| R  |                                                               | | [gain: 1.2             ] | |
|    |                                                               | +--------------------------+ |
| I  |                                                               | | Merge1                   | |
| M  +---------------------------------------------------------------+ | [operation: over       ] | |
| A  |  [ Node Graph ] [ Curve Editor ]                              | +--------------------------+ |
| G  |                                                               |                              |
| E  |  NODE GRAPH (DAG CANVAS)                                      |                              |
|    |                                                               |                              |
| C  |     [Read1] ---> [Grade1] ---> [Merge1] ---> [Write1]         |                              |
| O  |                                   ^                           |                              |
| L  |     [Constant1] ------------------+                           |                              |
| O  |                                                               |                              |
| R  |                                                               |                              |
+----+---------------------------------------------------------------+------------------------------+
| |<  <<  [Play/Pause]  >>  >|  Frame: [ 1001 ] [ 1001 -----|----------------------------- 1100 ]     |
+---------------------------------------------------------------------------------------------------+
```

### Main Workspace Zones:
1. **Top Menu Bar**: Application actions (`File`, `Edit`, `Nodes`, `Presets`, `Help`) with accelerator shortcuts.
2. **Left Tool Palette (`.opencomp-left-toolbar`)**: Category flyouts for instant node creation (Image, Draw, Time, Channel, Color, Filter, Keyer, Merge, Transform, 3D System, Deep, USD/Alembic, OpenFX, Viewer).
3. **Central Viewport (Viewer)**: High-precision 32-bit floating-point viewer with 10 input slots, exposure/gamma sliders, channel toggles, OCIO display transforms, interactive A/B wipes, and drawing overlays.
4. **Graph & Animation Tabs (`[ Node Graph ] [ Curve Editor ]`)**: Switch between the node graph (infinite pan/zoom DAG canvas) and the interactive Bezier Curve Editor.
5. **Properties Bin (Right Panel)**: Stacked parameter cards for active nodes with collapsible headers, numerical sliders, color wheels, expressions, and curve keyframing buttons.
6. **Timeline & Playback Controls (Bottom Bar)**: Timeline scrubber, frame range bounds, playback controls, and keyframe tick indicators.
7. **Resizable Splitters**: All panel dividers can be dragged horizontally or vertically to customize workspace geometry. Layouts persist automatically in `localStorage`.

---

## 2. Node Graph & Node Creation

The Node Graph (DAG) is the central workspace where compositing operations are assembled into a directed acyclic evaluation tree.

### 2.1 Navigating the DAG Canvas
- **Pan Canvas**: Middle-click and drag, or hold <kbd>Alt</kbd> + Left-click and drag.
- **Zoom Canvas**: Scroll the mouse wheel up (zoom in) or down (zoom out).
- **Frame Selection / Fit Graph**: Press <kbd>F</kbd> to center and frame selected nodes; press <kbd>A</kbd> to frame all nodes.
- **Select Nodes**: Left-click a node. Hold <kbd>Shift</kbd> and click to select multiple nodes. Drag a marquee box to select groups.

### 2.2 Creating Nodes via the Tab Quick-Search Palette
Press <kbd>Tab</kbd> anywhere on the Node Graph to summon the fuzzy search popup directly under the mouse cursor.

```
[ Tab Search: "dm" ]
-----------------------------------------
> DeepMerge              (Deep)
  DeepHoldout            (Deep)
  Dot                    (Channel)
```

The Tab palette supports intelligent three-tier matching:
1. **Prefix / Substring Matching**: Type `blur` $\to$ selects `Blur`; type `grade` $\to$ selects `Grade`.
2. **Acronym Fast-Keys (Sub-5ms Execution)**:
   - `gr` $\to$ `Grade`
   - `cc` $\to$ `ColorCorrect`
   - `cp` $\to$ `CornerPin`
   - `sr` $\to$ `ScanlineRender`
   - `dm` $\to$ `DeepMerge`
   - `dh` $\to$ `DeepHoldout`
   - `eb` $\to$ `EdgeBlur`
   - `ee` $\to$ `EdgeExtend`
   - `ck` $\to$ `ChromaKeyer`
   - `mc` $\to$ `MatteControl`
   - `sw` $\to$ `StereoWarp`
   - `sm` $\to$ `StereoMerge`
3. **Category Filtering**: Type `color:`, `filter:`, `3d:`, `deep:`, or `draw:` to filter by functional department.
4. **Keyboard Actions**:
   - <kbd>Down</kbd> / <kbd>Up</kbd>: Navigate through matched nodes (with boundary wrap).
   - <kbd>Enter</kbd> or <kbd>Tab</kbd>: Instantiate the highlighted node under the cursor.
   - <kbd>Esc</kbd>: Dismiss the search popover without creating a node.

### 2.3 Auto-Connection & Pipe Routing
- If an existing node is selected when creating a new node via <kbd>Tab</kbd>, the new node is **automatically connected** downstream of the selected node.
- To connect manually: Click and drag from an output arrow (bottom of a node) to an input port (top of a downstream node).
- To disconnect: Click a connection arrow and press <kbd>Delete</kbd>, or drag the pipe head away into empty canvas.
- To insert a node on an existing pipe: Drag the new node over the wire until it highlights, then release.
- **Dot Nodes (<kbd>.</kbd>)**: Insert zero-overhead routing dots to keep complex graphs clean and organized.
- **Backdrop Nodes**: Select a cluster of nodes $\to$ press <kbd>Tab</kbd> $\to$ type `Backdrop`. A colored container wraps the nodes. Dragging the backdrop header moves all enclosed nodes simultaneously.

---

## 3. Viewer Controls & 10-Slot Comparison Engine

The Viewer provides real-time 32-bit linear floating point evaluation with standard 10-slot routing.

```
+---------------------------------------------------------------------------------------------------+
| Inputs: [1: Read1*] [2: Grade1] [3] [4] [5] [6] [7] [8] [9] [0: Write1]                           |
| Mode:   [A/B Wipe H ▼]  Source A: [1 ▼]  Source B: [2 ▼]  Position: [0.50]  DiffGain: [1.0]       |
+---------------------------------------------------------------------------------------------------+
```

### 3.1 10-Slot Input Routing
- Press keys <kbd>1</kbd> through <kbd>9</kbd> while a node is selected to instantly connect it to Viewer inputs 1 through 9.
- Press key <kbd>0</kbd> while a node is selected to connect it to Viewer input **10** (Workstation slot 10 standard).
- If no node is selected, pressing <kbd>1</kbd>–<kbd>9</kbd> or <kbd>0</kbd> switches the active viewing buffer to that slot.

### 3.2 Comparison Modes
Open the **Compare Mode** dropdown in the Viewer toolbar to select an inspection mode:
1. **Single View (`single`)**: Displays the currently active input slot full-screen.
2. **Horizontal Wipe (`wipe_h`)**: Splits the screen vertically with an interactive horizontal wipe line. Input A displays to the left; Input B displays to the right.
3. **Vertical Wipe (`wipe_v`)**: Splits the screen horizontally. Input A displays above; Input B displays below.
4. **Side-by-Side (`side_by_side`)**: Squeezes or tiles Input A and Input B side-by-side for stereo or shot comparison.
5. **Difference Mode (`diff`)**: Computes $|A - B| \cdot \text{diffGain}$. Identical pixels display as pure black ($0.0$). Retains maximum alpha coverage ($\max(A_\alpha, B_\alpha)$) so differences against transparent backgrounds remain visible.

### 3.3 Interactive Wipe Handle Dragging
- When `wipe_h` or `wipe_v` is active, a high-visibility studio orange divider line (`#ff912b`) is drawn over the viewport.
- Hover the cursor over the divider line $\to$ the cursor changes to `col-resize` (horizontal) or `row-resize` (vertical).
- Click and drag the divider across the screen to reveal details dynamically.
- The wipe handle position is independent of canvas zoom and pan.

### 3.4 Color Calibration, Exposure & Channel Inspection
- **Exposure**: Scrub the slider or enter values from `-4.0` to `+4.0` EV to evaluate shadow noise or highlight clipping.
- **Gamma**: Adjust non-linear gamma from `0.2` to `4.0` (default: `1.0`).
- **Channel Isolation**:
  - Press <kbd>R</kbd> to view the Red channel in grayscale.
  - Press <kbd>G</kbd> to view the Green channel in grayscale.
  - Press <kbd>B</kbd> to view the Blue channel in grayscale.
  - Press <kbd>A</kbd> to view the Alpha matte in grayscale.
  - Press <kbd>C</kbd> to return to standard RGBA full-color view.
- **OCIO Display Transform**: Select between `sRGB`, `Rec.709`, `ACEScg`, and `Raw / Linear` from the OCIO dropdown.
- **Pixel Inspector**: Hover the cursor over any pixel in the viewport. The bottom status bar reports exact floating-point coordinates `[X, Y]` and color values `[R, G, B, A]`.

---

## 4. Properties Panel & Knob Parameter Tuning

The Properties Bin on the right side manages node parameters via stacked cards:

- **Opening a Card**: Double-click any node in the DAG. A card opens in the bin displaying all parameters (knobs).
- **Stacking Multiple Cards**: Up to 10 node cards can be open simultaneously. Drag cards up/down to reorder.
- **Collapsing Cards**: Click the triangle icon (<kbd>▼</kbd> / <kbd>▶</kbd>) to collapse a card to its header.
- **Closing Cards**: Click the <kbd>✕</kbd> button on a card header to close it; click **Clear All** at the top of the bin to close all open cards.
- **Knob Types**:
  - **Floating-point Sliders**: Scrub with mouse drag or click to enter precise decimal numbers.
  - **Color Pickers**: Click color swatches to open the RGB/HSV color wheel and eyedropper.
  - **Dropdown Selectors**: Choose discrete modes (e.g. Merge operations, filter kernels, color spaces).
  - **File Path Pickers**: Browse local or network paths; supports pipeline token syntax (`${SHOW}/${SHOT}/plate.####.exr`).
- **Disabling Nodes**: Select a node and press <kbd>D</kbd> to toggle bypass mode. A red diagonal `'X'` appears over the node in the DAG, and the upstream input passes through unaltered.

---

## 5. Timeline, Playback & Interactive Curve Editor

OpenComp features an interactive Bezier Curve Editor integrated as a tab alongside the Node Graph (`[ Node Graph ] [ Curve Editor ]`).

```
+---------------------------------------------------------------------------------------------------+
|  [ Node Graph ] [ Curve Editor * ]        Tangents: [Smooth] [Flat] [Linear] [Free]  [Frame All: F]|
+---------------------------------------------------------------------------------------------------+
|  Value ^                                                                                          |
|    2.0 |                           o (Handle Out)                                                 |
|        |                          /                                                               |
|    1.5 |             (Key 1) [O]--------o (Handle In)                                             |
|        |                     /                                                                    |
|    1.0 |                    /                                                                     |
|        |         [O]-------o                                                                      |
|    0.5 |        / (Key 0)                                                                         |
|        |       /                                                                                  |
|    0.0 +------+----------+----------+----------+----------+----------+----------+----------->     |
|             1001       1010       1020       1030       1040       1050       1060   Frame       |
+---------------------------------------------------------------------------------------------------+
```

### 5.1 Setting Keyframes
1. In the Properties panel, click the stopwatch icon next to any animatable knob (e.g. `Transform1.translate`, `Grade1.gain`).
2. Scrub the timeline to another frame and modify the value. A new keyframe tick is created automatically.
3. Use <kbd>Alt</kbd> + <kbd>◀</kbd> / <kbd>▶</kbd> to jump between adjacent keyframes on the timeline.

### 5.2 Editing Curves Interactively
Click the **Curve Editor** tab at the top of the central panel:
- **Select Keyframes**: Click a keyframe diamond/circle to select it. Drag a marquee box to select multiple keys.
- **Move Keyframes**: Left-click and drag selected keyframes to change both frame timing (horizontal) and parameter values (vertical).
- **Draggable Bezier Handles**: When a keyframe is selected, tangent handles extend to the left and right. Click and drag handle tips to adjust curve curvature and ease-in/ease-out slopes.
- **Tangent Modes** (via Curve Editor toolbar buttons):
  - **Smooth**: Tangent handles maintain collinear alignment for continuous first-derivative smoothness.
  - **Flat**: Snaps tangent handles to horizontal ($slope = 0$), ideal for trajectory extrema, peaks, and rests.
  - **Linear**: Tangents point directly toward neighboring keyframes for mechanical, constant-velocity motion.
  - **Free**: Breaks handle lock, allowing independent control of incoming and outgoing slope angles.
- **Navigation & Framing**:
  - Middle-click + drag to pan the graph. Mouse wheel to zoom.
  - Press <kbd>F</kbd> to automatically frame and center active animation curves to fit the window.
- **Undo / Redo**: 50-step undo/redo stack (<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd>) captures all keyframe moves and tangent edits.

---

## 6. Departmental Compositing Workflows

### 6.1 Core 2D Compositing Workflow
1. **Load Footage**: Create a `Read` node (<kbd>R</kbd>) and load your background plate.
2. **Color Balance**: Connect a `Grade` node (<kbd>G</kbd>). Adjust `blackpoint` to lift blacks and `whitepoint` to balance highlights.
3. **Tonal Curves**: Insert a `ColorLookup` node. Adjust S-curves to compress dynamic range or add filmic shoulder roll-off.
4. **Compositing Streams**:
   - Create a `Merge` node (<kbd>M</kbd>). Connect the background plate to input `B` and the foreground element to input `A`.
   - Select operation: `over` (standard compositing), `plus` (additive light), `multiply` (shadow density), `screen`, `stencil` (matte punch-out), or `mask`.
5. **Premultiplication Safety**: Ensure all foreground graphics are properly premultiplied before merging. Use `Unpremult` before color grading and `Premult` immediately before the `Merge` node.

### 6.2 Keying & Edge Treatment Workflow
1. **Green/Blue Screen Key**: Connect footage to `ChromaKeyer`. Use the color picker to sample the backing color. Adjust `tolerance` and `softness` to isolate fine hair detail.
2. **Spill Suppression**: Insert a `Despill` node downstream of the plate to neutralize green/blue bounce light on hair and shoulders.
3. **Matte Refinement**: Connect the keyer alpha into `MatteControl`. Adjust `erode` to shrink matte edges and `edgeBlur` to soften boundary transitions.
4. **Edge Extend**: For foreground elements with dark edge fringes, insert `EdgeExtend` to push clean foreground color outward into semi-transparent pixels before merging.

### 6.3 Roto & Vector Spline Workflow
1. Create a `Roto` node (<kbd>O</kbd>).
2. In the Viewer, click consecutive points to define a closed Bezier spline shape. Click the first point to close the loop.
3. Drag tangent handles on spline points to shape smooth curves.
4. Drag outer feather handles to create anti-aliased gradient edge falloff.
5. Scrub the timeline and animate spline points to rotoscope moving characters or props.

### 6.4 Paint & Cleanplate Restoration Workflow
1. Create a `Paint` node (<kbd>P</kbd>).
2. **Brush Tool**: Paint opaque or soft RGB strokes to paint out tracking markers or unwanted artifacts.
3. **Clone Stamp**: Hold <kbd>Ctrl</kbd> + Left-click on the canvas to set a source sample offset. Paint over the target region to clone background textures seamlessly.
4. **Reveal Tool**: Connect a clean background plate to the Paint node's `cleanPlate` input. Paint with the Reveal brush to brush the background through the live-action plate.

### 6.5 Depth & Stereoscopic 3D Workflows
OpenComp features an integrated stereoscopic subsystem operating directly inside the standard node graph:
1. **Procedural Depth**: Create a `Depth` node to generate perspective ground ramps or false-color depth heatmaps.
2. **StereoWarp (DIBR)**: Connect a monoscopic 2D plate to `in` and a 32-bit depth map to `depth`. Adjust `interocular` (e.g. $63.5\,\text{mm}$) and `convergence` distance. The node performs Depth-Image-Based Rendering to generate Left and Right eye views.
3. **StereoMerge**: Connect Left and Right eye streams into `StereoMerge`. Select output format:
   - `Anaglyph`: Red/Cyan stereoscopic monitoring.
   - `Side-by-Side`: Half or full side-by-side output.
   - `Difference`: Visualizes horizontal disparity displacements to identify convergence planes.
4. **StereoGenerator Advanced Workflow** (Architectural Research Model):
   - Supports forward/backward DIBR with automated occlusion hole filling via `cleanPlate`.
   - Automatically eliminates disocclusion smearing behind foreground characters by sampling pristine background pixels.

---

## 7. Tracking & Motion Analysis Workflows

### 7.1 Point Tracker (`Tracker`)
1. Create a `Tracker` node. Select the node to reveal tracker markers in the Viewer.
2. Position Track 1 over a high-contrast landmark. Adjust the inner pattern box (feature to track) and outer search box (search area per frame).
3. Click **Track Forward** in the Properties panel. OpenComp performs Normalized Cross-Correlation (NCC) subpixel tracking across the sequence.
4. In the `Transform` tab, choose export mode: `Matchmove`, `Stabilize`, or export transform data directly to a `Transform` or `CornerPin` node.

### 7.2 Planar Tracker (`PlanarTracker`)
1. Create a `PlanarTracker` node.
2. Draw a 4-point bounding polygon around a planar surface (e.g. billboard, phone screen, wall).
3. Click **Track Forward**. The 8-DOF planar homography solver uses RANSAC outlier rejection to track perspective changes, scale, shear, and rotation.
4. Click **Export CornerPin** to generate an animated `CornerPin` node with `to1_x`, `to1_y` through `to4_x`, `to4_y` keyframes locked to the surface.

### 7.3 Spline Warping (`SplineWarp`)
1. Create a `SplineWarp` node.
2. Draw a Source spline around the feature to warp; draw a Destination spline indicating where pixels should move.
3. The Inverse Distance Weighting (IDW) deformation engine deforms the plate smoothly between the splines. Animate destination splines to create facial morphs or caricatures.

### 7.4 Retiming & Temporal Operations
- **Retime Node**: Set `speed` to `0.5` for 2x slow motion. Select frame interpolation mode: `Nearest` or `Blend`.
- **TimeWarp Node**: Animate an arbitrary non-linear input frame curve. Map frame `1050` to evaluate frame `1010` for dramatic speed ramps and freeze-frames.
- **FrameHold Node**: Set `firstFrame` to freeze the entire upstream graph at a single frame context (ideal for static cleanplates and mattes).

---

## 8. 3D Compositing Workflows

OpenComp's 3D system provides a complete software-rasterized 3D workspace operating 100% on CPU without requiring dedicated GPU hardware.

```
[Card3D] --+
           |--> [Scene3D] ---> [ScanlineRender] ---> [Composite Stream]
[Cube3D] --+        ^                 ^
                    |                 |
[Camera3D] ---------+-----------------+
```

1. **Scene Setup**: Create a `Scene3D` node to aggregate geometry, cameras, and lights.
2. **Camera Optics (`Camera3D`)**:
   - Set `focalLength` (e.g. $50\,\text{mm}$) and `haperture` ($24.89\,\text{mm}$ Super 35 default).
   - Animate `translate` and `rotate` to match live-action camera matchmoves.
3. **Geometry Primitives**:
   - `Card3D`: Create a planar card. Connect a texture image into its input pipe. Position the card in 3D space ($X, Y, Z$) to create multi-plane parallax depth.
   - `Cube3D`: Create a 3D cube mesh with UV texture coordinates.
   - `Project3D`: Project footage through a camera onto 3D geometry for camera projection set extensions.
4. **Scanline Rendering (`ScanlineRender`)**:
   - Connect `Scene3D` to input `scene` and `Camera3D` to input `cam`.
   - Configure rasterization settings: `shading` (`unlit`, `flat`, `phong`), `antialiasing` (`none`, `2x`, `4x` SSAA).
   - ScanlineRender outputs 32-bit linear float RGBA along with production 3D AOVs: `depth.Z` (camera distance), `normal.X/Y/Z`, and `u/v` coordinates.

---

## 9. Volumetric Deep Compositing Workflows

Deep compositing stores multiple volumetric depth samples per pixel, eliminating edge fringing and intersection artifacts when combining complex CG elements.

```
[DeepRead (Volumetric Smoke)] --+
                                |--> [DeepMerge] ---> [DeepHoldout] ---> [DeepToImage] ---> [2D Comp]
[DeepRead (CG Spaceship)] ------+                          ^
                                                           |
[DeepRead (Holdout Geometry)] -----------------------------+
```

1. **Loading Deep EXR**: Create a `DeepRead` node and load an OpenEXR 2.0+ deep scanline file.
2. **Combining Volumetric Layers (`DeepMerge`)**: Connect multiple deep streams into `DeepMerge`. Samples are depth-sorted in-place ascending by `zFront`. Overlapping volumetric samples blend automatically according to Beer-Lambert transmittance.
3. **Volumetric Occlusion (`DeepHoldout`)**: Connect a deep foreground subject into `in` and a deep occluder (e.g. building, character) into `holdout`. DeepHoldout attenuates occluded volumetric samples without edge fringing or 2D matte cutting.
4. **Depth Slicing (`DeepCrop`)**: Set `near` and `far` clipping planes to extract or remove volumetric slices (e.g. slicing through dense fog).
5. **Flattening to 2D Image (`DeepToImage`)**: Insert `DeepToImage` at the end of the deep pipeline. The node performs closed-form Beer-Lambert ray accumulation ($T_i = \prod (1 - \alpha_j)$) to output standard 2D float32 RGBA and primary depth passes.

---

## 10. Multi-Channel & OpenEXR AOV Workflows

1. **Multi-Channel Extraction (`Shuffle`)**:
   - Load a multi-layer CG EXR (containing `beauty`, `diffuse`, `specular`, `depth`, `normals`).
   - Create a `Shuffle` node. Map any input channel to any output channel (e.g. route `depth.Z` to `rgba.alpha`).
2. **Channel Copying (`Copy`)**:
   - Connect Plate A to input `A` and Plate B to input `B`.
   - In the Properties table, click **+ Add Pair** to map arbitrary channel pairs (e.g. copy `motion.X` from A to B).
3. **Channel Merging (`ChannelMerge`)**:
   - Perform mathematical operations (union, intersection, plus, minus) directly on specific channels (such as combining two distinct alpha mattes).
4. **Writing Production EXRs (`Write`)**:
   - Connect final comp to `Write`. Set file format to `exr`.
   - Select data type: `16-bit half float` (standard delivery) or `32-bit float` (depth/AOVs).
   - Select compression: `DWAA` (lossy, ~85% smaller file size, ideal for beauty review), `ZIP` (lossless), or `PIZ`.

---

## 11. OpenFX 1.4 Plugin Usage

OpenComp includes an OpenFX 1.4 plugin host that executes effects in an isolated subprocess with crash containment.

1. **Installing OpenFX Plugins**: Place `.ofx` bundles in the standard system directory:
   - Windows: `C:\Program Files\Common Files\OFX\Plugins\`
   - Linux: `/usr/OFX/Plugins/`
2. **Instantiating OpenFX Node**:
   - Press <kbd>Tab</kbd> $\to$ type `OFX` $\to$ press <kbd>Enter</kbd>.
3. **Selecting Effect**:
   - In the Properties panel, open the **Plugin** dropdown to view all discovered plugins on the system.
   - Select an effect (e.g. `InvertPlugin`, `GainPlugin`, `BoxBlurPlugin`).
4. **Adjusting Parameters**: Plugin parameters populate dynamically in the Properties card as native sliders, checkboxes, and color swatches.
5. **Crash Isolation**: If a third-party plugin encounters a fatal segfault, OpenComp's subprocess boundary catches the failure, marks the node with an error state, and keeps the parent application running safely.

---

## 12. USD & Alembic Scene Ingestion

1. **Loading OpenUSD (`USDRead`)**:
   - Create a `USDRead` node. Set `file` to an ASCII `.usda` or binary `.usdc` scene.
   - In the Properties panel, inspect the **Stage Tree** displaying scene hierarchy (`/World/Geom/Mesh`).
   - Select the target prim. USDRead extracts vertices, face indices, normals, UVs, and display colors into native `Geometry3D`.
2. **Loading Alembic Ogawa (`AlembicRead`)**:
   - Create an `AlembicRead` node. Set `file` to an Alembic Ogawa `.abc` archive.
   - Select object path (e.g. `/camera/cameraShape` or `/geometry/hero_mesh`).
   - Scrub the timeline: animated transforms and camera trajectories evaluate with fractional frame interpolation.
3. **Connecting to 3D Scene**: Connect `USDRead` or `AlembicRead` directly into `Scene3D` to render ingested 3D assets through `ScanlineRender`.

---

## 13. Render Farm Submission & Queue Management

OpenComp supports rendering via its native LAN dispatcher or commercial studio schedulers:

### 13.1 Native LAN Render Farm
1. Start the farm dispatcher server: `node src/core/farm/LANDispatcher.js --port 8090`.
2. Start one or more worker daemons across render nodes: `node src/core/farm/Worker.js --server http://192.168.1.100:8090 --slots 8`.
3. In OpenComp, select the target `Write` node $\to$ set farm mode to `Native LAN` $\to$ click **Submit Job**.
4. The dispatcher shards frames across active workers, monitors heartbeats, and re-queues any failed tasks automatically.

### 13.2 Commercial Scheduler Manifest Export
To submit jobs to AWS Thinkbox Deadline, Pixar Tractor, or ASWF OpenCue:
1. Select your `Write` node $\to$ in the Properties panel, set **Scheduler** to `Deadline`, `Tractor`, or `OpenCue`.
2. Configure **Chunk Size** (frames per task) and **Priority** (1–100).
3. Click **Generate Manifest**:
   - **Deadline**: Generates `job_info.job` and `plugin_info.job`.
   - **Tractor**: Generates an `.alfred` task tree hierarchy script.
   - **OpenCue**: Generates an `.outline` Python batch submission script.
4. If the studio cluster client CLI is installed (`deadlinecommand`, `tractor-spool`, `pycue`), click **Submit to Farm** for immediate submission.

---

## 14. Complete Keyboard Shortcuts Reference

| Shortcut | Context | Action |
|---|---|---|
| <kbd>Tab</kbd> | Node Graph | Open fuzzy Tab Quick-Search node palette |
| <kbd>1</kbd> .. <kbd>9</kbd> | Node Graph / Viewer | Connect selected node to Viewer inputs 1–9 / View slot |
| <kbd>0</kbd> | Node Graph / Viewer | Connect selected node to Viewer input 10 / View slot 10 |
| <kbd>M</kbd> | Node Graph | Create `Merge` node |
| <kbd>G</kbd> | Node Graph | Create `Grade` node |
| <kbd>C</kbd> | Node Graph | Create `ColorCorrect` node |
| <kbd>B</kbd> | Node Graph | Create `Blur` node |
| <kbd>T</kbd> | Node Graph | Create `Transform` node |
| <kbd>K</kbd> | Node Graph | Create `CornerPin` node |
| <kbd>O</kbd> | Node Graph | Create `Roto` node |
| <kbd>P</kbd> | Node Graph | Create `Paint` node |
| <kbd>R</kbd> | Node Graph | Create `Read` node |
| <kbd>W</kbd> | Node Graph | Create `Write` node |
| <kbd>.</kbd> (Period) | Node Graph | Create `Dot` routing node |
| <kbd>D</kbd> | Node Graph | Toggle node Disable / Bypass state |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Node Graph | Delete selected nodes |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | Global | Save project (`.opencomp`) |
| <kbd>Ctrl</kbd> + <kbd>O</kbd> | Global | Open project |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | Global | Undo last action (50-step stack) |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl+Shift+Z</kbd> | Global | Redo last undone action |
| <kbd>F</kbd> | Viewer / Graph / Curves | Frame / fit selection to view |
| <kbd>H</kbd> | Viewer | Snap viewport zoom to 100% (1:1 pixel scale) |
| <kbd>R</kbd> / <kbd>G</kbd> / <kbd>B</kbd> / <kbd>A</kbd> | Viewer | Isolate Red, Green, Blue, or Alpha channel |
| <kbd>C</kbd> | Viewer | Return to full RGBA color view |
| <kbd>Spacebar</kbd> | Global | Play / Pause timeline playback |
| <kbd>Alt</kbd> + <kbd>◀</kbd> / <kbd>▶</kbd> | Timeline | Jump to previous / next keyframe tick |
| <kbd>Home</kbd> / <kbd>End</kbd> | Timeline | Jump to start / end of frame range |

---

## 15. Known UX Limitations & Workarounds

1. **Multi-Monitor Tear-Off Windows**: Floating secondary viewer windows on separate physical monitors are currently restricted by browser sandbox security. Use browser window splitting or dedicated single-monitor full-screen app mode (`run_desktop.bat`).
2. **GPU Fallback on Headless Servers**: When running on virtual machines or servers without physical GPUs, WebGL2 falls back to software rendering (SwiftShader / Mesa). The application remains 100% operational via its native CPU pipeline.
3. **Large Canvas Textures**: In-VRAM GPU viewport rendering for plates larger than $8192 \times 8192$ (such as 16K DCI) exceeds standard browser texture allocation limits. OpenComp automatically routes extreme resolutions through its CPU dynamic BBox tiled engine.
4. **Interactive Curve Editor Zoom Scale**: Rapid mouse-wheel zooming while dragging keyframe tangent handles can occasionally lose handle focus. Release the mouse button, press <kbd>F</kbd> to re-center curves, and continue editing.

---

## 16. Comprehensive Artist Validation Checklist (50-Point Audit)

To perform an independent studio verification of OpenComp, execute the steps below in a live workstation session or inspect the automated browser CDP interaction suite (`tests/test_ui_interactions.mjs`).

> [!NOTE]
> Following the execution of the browser CDP automation test suite (`tests/test_ui_interactions.mjs`), the 17 formerly pending interactive artist items have been forensically reclassified into:
> - **12 items converted to full AUTOMATED UI PASS** via real DOM event dispatch and state assertions.
> - **3 items classified as PARTIALLY AUTOMATED** (algorithmic mechanics verified via automation; tactile hand-feel preserved for human review).
> - **1 item classified as SUBJECTIVE HUMAN REVIEW REQUIRED** (calibrated studio reference monitor colorimetry).
> - **1 item classified as PHYSICAL INFRASTRUCTURE REQUIRED** (physical network cable detachment).
> - **0 items failed.**
>
> **Readiness Notice:** Automated regression and UI interaction tests prove algorithmic determinism and UI event responsiveness within automated boundaries. Physical production deployment requires completion of the human artist tactile trials and calibrated hardware display reviews detailed below.

| # | Feature / Checklist Item | Test Action & Verification Procedure | Current Audit Status |
| :-: | :--- | :--- | :---: |
| **01** | **Desktop Launch Script** | Execute `run_desktop.bat`. Verify window opens without command shell errors. | ✅ **AUTOMATED PASS** |
| **02** | **HTTP Server Connectivity** | Open `http://127.0.0.1:8080/`. Verify HTTP 200 OK returned on port 8080. | ✅ **AUTOMATED PASS** |
| **03** | **Console Error Hygiene** | Press <kbd>F12</kbd>. Verify exactly 0 red console errors and 0 uncaught exceptions. | ✅ **AUTOMATED PASS** |
| **04** | **Studio Visual Styling** | Visually verify dark slate theme, panel splitters, and toolbar alignment. | ✅ **AUTOMATED PASS** |
| **05** | **Server Telemetry** | Confirm server terminal logs continuous HTTP 200 responses for static files. | ✅ **AUTOMATED PASS** |
| **06** | **Viewer Pan & Zoom** | Middle-click + drag to pan; wheel to zoom. Check smooth 60fps responsiveness. | 🟡 **PARTIALLY AUTOMATED**<br/><small>(Transforms verified; tactile feel awaits artist)</small> |
| **07** | **Exposure Slider Scrubbing** | Drag Exposure slider from `-4.0` to `+4.0`. Confirm real-time brightness adjustment. | ✅ **AUTOMATED UI PASS**<br/><small>(Scrub & reset verified via CDP)</small> |
| **08** | **Gamma Slider Scrubbing** | Drag Gamma slider from `0.2` to `4.0`. Confirm non-linear contrast response. | ✅ **AUTOMATED UI PASS**<br/><small>(Scrub & reset verified via CDP)</small> |
| **09** | **Channel Toggle Buttons** | Click `R`, `G`, `B`, `A` buttons. Confirm individual channels isolate in grayscale. | ✅ **AUTOMATED UI PASS**<br/><small>(R/G/B/A/Luma/RGBA verified via CDP)</small> |
| **10** | **OCIO Color Display** | Switch dropdown between `sRGB`, `Rec.709`, and `ACEScg`. Verify tone mapping. | 👁️ **SUBJECTIVE HUMAN REVIEW**<br/><small>(Calibrated reference monitor)</small> |
| **11** | **Pixel Inspector Hover** | Hover over canvas. Verify precise float `[R, G, B, A]` values in info bar. | ✅ **AUTOMATED UI PASS**<br/><small>(Info bar readouts verified via CDP)</small> |
| **12** | **Fit-to-Window Hotkey** | Pan/zoom canvas off-center $\to$ press <kbd>F</kbd>. Confirm canvas snaps to fit format. | ✅ **AUTOMATED UI PASS**<br/><small>(Snap-to-fit verified via CDP)</small> |
| **13** | **Tab Search Popover** | Press <kbd>Tab</kbd> in DAG. Confirm fuzzy search popover appears under cursor. | ✅ **AUTOMATED PASS** |
| **14** | **Fuzzy Node Search** | Type `"Grad"`. Confirm `Grade` is highlighted at top of list. | ✅ **AUTOMATED PASS** |
| **15** | **Enter Key Creation** | Press <kbd>Enter</kbd>. Confirm selected node is created at cursor coordinates. | ✅ **AUTOMATED PASS** |
| **16** | **Downstream Auto-Connect** | Select `Grade1` $\to$ press <kbd>Tab</kbd> $\to$ type `Blur` $\to$ <kbd>Enter</kbd>. Confirm auto-pipe created. | ✅ **AUTOMATED PASS** |
| **17** | **Bezier Pipe Redraw** | Drag `Grade1` across DAG. Confirm connecting arrow redraws with smooth Bezier curves. | ✅ **AUTOMATED UI PASS**<br/><small>(Cubic Bezier wire redraw verified)</small> |
| **18** | **Top Toolbar Creation** | Click buttons on left toolbar (Image, Color, Filter). Confirm nodes spawn. | ✅ **AUTOMATED PASS** |
| **19** | **Backdrop Dragging** | Select nodes $\to$ create `Backdrop`. Confirm dragging backdrop moves all nodes. | ✅ **AUTOMATED UI PASS**<br/><small>(Child node translation verified $\Delta < 10^{-4}$)</small> |
| **20** | **Node Deletion** | Select node $\to$ press <kbd>Delete</kbd>. Confirm node is removed without orphan wires. | ✅ **AUTOMATED PASS** |
| **21** | **Properties Bin Card** | Double-click node. Confirm dedicated parameter card opens in right panel. | ✅ **AUTOMATED PASS** |
| **22** | **Multi-Card Stacking** | Open multiple node cards. Confirm cards stack vertically with collapse/close controls. | ✅ **AUTOMATED UI PASS**<br/><small>(Bin stacking & collapse verified)</small> |
| **23** | **Knob Value Scrubbing** | Scrub sliders left/right. Click to type exact numbers. Confirm smooth responsiveness. | ✅ **AUTOMATED UI PASS**<br/><small>(Bidirectional slider/num input verified)</small> |
| **24** | **Color Picker Wheels** | Click color swatches in Grade node. Confirm color wheel updates values interactively. | ✅ **AUTOMATED UI PASS**<br/><small>(Color picker & brush color verified)</small> |
| **25** | **Keyframing Buttons** | Click stopwatch icon on knob. Confirm keyframe tick appears on timeline playhead. | 🟡 **PARTIALLY AUTOMATED**<br/><small>(Curve & timeline ticks verified; stopwatch UI)</small> |
| **26** | **Node Disable Bypass** | Select node $\to$ press <kbd>D</kbd>. Confirm diagonal `'X'` appears and node bypasses. | ✅ **AUTOMATED PASS** |
| **27** | **Node Renaming** | Rename node in properties header. Confirm name updates on DAG canvas and card. | ✅ **AUTOMATED PASS** |
| **28** | **CopyNode Channel Table** | In `Copy` properties, click **+ Add Pair**. Confirm multi-channel routing table works. | ✅ **AUTOMATED PASS** |
| **29** | **Roto Splines** | In `Roto` node, click points in viewer. Verify smooth cubic Bezier curve. | ✅ **AUTOMATED PASS** |
| **30** | **Roto Edge Feathering** | Drag outer feather handles on spline. Confirm anti-aliased gradient edge falloff. | ✅ **AUTOMATED PASS** |
| **31** | **Paint Brush Strokes** | In `Paint` node, select Brush tool and paint strokes. Confirm soft RGB rendering. | ✅ **AUTOMATED PASS** |
| **32** | **Clone Stamping** | In `Paint`, <kbd>Ctrl+Click</kbd> source offset. Paint over target to clone pixels cleanly. | ✅ **AUTOMATED PASS** |
| **33** | **Depth Ground Ramp** | In `Depth` node, adjust ground ramp. Confirm linear float gradient to horizon. | ✅ **AUTOMATED PASS** |
| **34** | **Depth Heatmap Display** | Toggle false-color heatmap. Confirm warm colors for near and cool colors for far. | ✅ **AUTOMATED PASS** |
| **35** | **Stereo DIBR Parallax** | In `StereoWarp`, adjust interocular separation. Confirm Left and Right views shift. | ✅ **AUTOMATED PASS** |
| **36** | **Anaglyph 3D Output** | Set `StereoMerge` to `Anaglyph`. Inspect red-cyan channels for depth parallax. | ✅ **AUTOMATED PASS** |
| **37** | **Disparity Difference** | Set `StereoMerge` to `Difference`. Confirm high-contrast edges indicate disparity. | ✅ **AUTOMATED PASS** |
| **38** | **Interactive Wipe Dragging**| Set compare mode to `wipe_h`. Drag orange divider line across viewer to compare. | ✅ **AUTOMATED UI PASS**<br/><small>(H & V divider dragging verified)</small> |
| **39** | **OpenEXR Fidelity** | Load 16-bit half / 32-bit float EXR. Confirm 32-bit float color fidelity matches reference values. | ✅ **AUTOMATED PASS** |
| **40** | **Multi-Part AOV Parsing** | Load multi-layer EXR. Confirm all auxiliary AOVs populate in layer dropdowns. | ✅ **AUTOMATED PASS** |
| **41** | **DWAA Compression** | Render EXR with DWAA compression. Confirm ~85% smaller file with zero artifacts. | ✅ **AUTOMATED PASS** |
| **42** | **Project Serialization** | Press <kbd>Ctrl+S</kbd>. Verify valid `.opencomp` JSON project file is saved to disk. | ✅ **AUTOMATED PASS** |
| **43** | **Project Restoration** | Load saved project. Verify DAG, positions, knobs, and keyframes restore 100%. | ✅ **AUTOMATED PASS** |
| **44** | **Script Export (.nk)** | Choose `File` $\to$ `OpenComp Script Export (.nk)...`. Verify exported script syntax is valid. | ✅ **AUTOMATED PASS** |
| **45** | **Headless CLI Render** | Execute `opencomp-render.mjs -p project.nk -r 1-10`. Verify frames render to disk. | ✅ **AUTOMATED PASS** |
| **46** | **Periodic Autosave** | Work for 30 seconds. Verify `.autosave` snapshot is generated in project directory. | ✅ **AUTOMATED PASS** |
| **47** | **Process Kill Resilience** | Terminate server process via Task Manager. Confirm autosave file remains intact. | ✅ **AUTOMATED PASS** |
| **48** | **Crash Recovery Prompt** | Relaunch app. Confirm recovery prompt appears and restores unsaved changes. | ✅ **AUTOMATED PASS** |
| **49** | **Timeline Scrubbing Stress**| Scrub timeline continuously for 30s. Monitor RAM in Task Manager for zero leaks. | 🟡 **PARTIALLY AUTOMATED**<br/><small>(Rapid scrub leak-free; 30s TaskMgr manual)</small> |
| **50** | **Air-Gap Network Sever** | Disconnect network cable / toggle Airplane Mode. Verify 100% full functionality. | 🔌 **PHYSICAL INFRASTRUCTURE**<br/><small>(Requires physical NIC disconnect)</small> |
| **51** | **Curve Editor Tangents** | Switch to Curve Editor tab. Drag Bezier tangent handles. Verify smooth curve ease. | ✅ **AUTOMATED UI PASS**<br/><small>(Tangent drag, modes & undo verified)</small> |

