# OpenComp — Production VFX Compositing Workstation

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)]()
[![Regression Tests](https://img.shields.io/badge/Master%20Suites-62%2F62%20Pass%20(100%25)-brightgreen.svg)]()
[![Production Nodes](https://img.shields.io/badge/Nodes-34%20Production%20Registered-blue.svg)]()
[![Air-Gap](https://img.shields.io/badge/Air--Gap-100%25%20Offline%20Verified-green.svg)]()

**OpenComp** is an open-source, high-performance, CPU-first, 32-bit floating-point node-based visual effects compositing workstation designed for film, episodic television, and commercial VFX pipelines. Operating with complete offline integrity in secure air-gapped studio environments, OpenComp delivers studio-grade compositing paradigms, mathematical equations, node libraries, and keyboard interaction models.

---

## 📚 Master Documentation Repository

The complete engineering, operational, architectural, and workflow documentation of OpenComp is consolidated into five authoritative documents in the [`Documents/`](Documents/) directory:

1. [**Complete Architecture & Technical Specification**](Documents/OPENCOMP_COMPLETE_DOCUMENTATION.md)  
   *(`Documents/OPENCOMP_COMPLETE_DOCUMENTATION.md`)*  
   System topology, dual-runtime architecture (Chromium V8 & native Python/NumPy), DAG evaluation model, `PixelBuffer` / `DeepPixelBuffer` memory models, dynamic BBox culling, 34-node mathematical catalog, OCIO v2 color science, six-phase roadmap history, and independent closure audit findings.

2. [**UI, Workspace Architecture & Specialized VFX Workflow Guide**](Documents/OPENCOMP_UI_AND_WORKFLOW_GUIDE.md)  
   *(`Documents/OPENCOMP_UI_AND_WORKFLOW_GUIDE.md`)*  
   Interface layout, advanced Viewer comparison modes (Single, Dual, Quad, Wipe, Split, Diff), 10-slot input engine, Node Graph canvas, Tab search, Curve Editor, and specialized workflows: Roto, Paint, Depth, Stereo Comp, and ZDefocus Optical Bokeh, along with artist testing protocols.

3. [**Testing, Verification & Virtual Validation Master Suite**](Documents/OPENCOMP_TESTING_AND_VALIDATION.md)  
   *(`Documents/OPENCOMP_TESTING_AND_VALIDATION.md`)*  
   Master virtual validation framework, numerical tolerances, complete 62-suite master regression test inventory (100% passing), phase-by-phase validation evidence (Phases 1–6), Milestone 1 ZDefocus optimization proofs, command equivalence proofs, and defect logs.

4. [**Studio Pipeline, Interchange Formats & Distributed Rendering Architecture**](Documents/OPENCOMP_PIPELINE_AND_RENDERING.md)  
   *(`Documents/OPENCOMP_PIPELINE_AND_RENDERING.md`)*  
   PipelineTokens, cross-platform UNC/POSIX path mapping, OpenEXR (half/float, DWAA/DWAB), OpenUSD / Alembic scene exchange, bidirectional Foundry Nuke (`.nk`) translation, OpenFX 1.4 host sandbox, headless CLI renderer (`opencomp-render`), native LAN render farm dispatcher, and multi-scheduler manifest synthesis (Deadline, Tractor, OpenCue).

5. [**Artist User Guide & Production Manual**](Documents/OPENCOMP_USER_GUIDE.md)  
   *(`Documents/OPENCOMP_USER_GUIDE.md`)*  
   Artist-facing user manual: installation, quickstart runbook, interface navigation, comprehensive 34-node production reference, linear color compositing rules, complete keyboard shortcuts table, troubleshooting, and FAQ.

---

## ⚡ Quick Start

### Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **Python**: v3.10+ with `numpy` (optional, for secondary Python/PySide6 engine)
- **Display**: Minimum $1920 \times 1080$ display resolution

### Launching OpenComp

#### Studio Desktop Workstation (Recommended)
Launch the standalone desktop application:
```cmd
run_desktop.bat
```

#### Browser / Local Server Workstation
Start the local server and connect via any modern browser:
```bash
node server.js --port 8080
# Open http://localhost:8080 in Chrome, Edge, or Brave
```

#### Secondary Python PySide6 Engine
Launch the native Python engine:
```cmd
run_python.bat
```

#### Automated Regression Test Suite
Run the master regression test runner across all 62 suites:
```bash
npm test
# Or directly: node tests/run_all_tests.mjs
```

---

## 💻 System Requirements

| Component | Minimum Specification | Recommended Production Specification |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11 64-bit, Rocky Linux 8/9, CentOS/RHEL 8/9, macOS 12+ | Windows 11 Pro 64-bit or Rocky Linux 9.4 (VFX Reference Platform CY2024) |
| **Processor (CPU)** | x86_64, 4 physical cores / 8 threads (AVX support) | Intel Core i9 / AMD Ryzen 9 / Threadripper / Xeon (16+ cores, AVX2 / AVX-512) |
| **System Memory (RAM)** | 16 GB DDR4/DDR5 | 32 GB–64 GB+ (for 4K/8K uncompressed plate caching) |
| **Disk Storage** | 2 GB free disk space for application | Fast NVMe SSD ($ge 3500\text{ MB/s}$) for EXR image sequence caching |
| **Display** | $1920 \times 1080$, 8-bit color | $2560 \times 1440$ or $3840 \times 2160$, 10-bit wide-gamut (DCI-P3 / Rec.709 calibrated) |
| **GPU / WebGL** | WebGL 2.0 capable GPU | NVIDIA RTX 3070 / 4080 / A4000+ or AMD Radeon Pro |

---

## 📁 Repository Structure

```text
OpenComp/
├── Documents/                             # Authoritative Consolidated Documentation
│   ├── OPENCOMP_COMPLETE_DOCUMENTATION.md # Architecture, roadmap, memory models & audit
│   ├── OPENCOMP_UI_AND_WORKFLOW_GUIDE.md  # Viewport, node graph, timeline & departmental VFX
│   ├── OPENCOMP_TESTING_AND_VALIDATION.md # 62 test suites, validation reports & benchmarks
│   ├── OPENCOMP_PIPELINE_AND_RENDERING.md # Tokens, OpenEXR, USD, OFX, CLI & Render Farm
│   └── OPENCOMP_USER_GUIDE.md             # Artist user guide, 34-node catalog & shortcuts
├── src/                                   # Application Source Code
│   ├── app.js                             # Web workstation UI entry point
│   ├── core/                              # Core DAG, buffers, color, math & engine subsystems
│   ├── nodes/                             # Production node implementations (34 node classes)
│   └── ui/                                # Viewer, canvas, properties, curve editor & widgets
├── tests/                                 # Automated Master Test Suite (62 suites)
│   ├── run_all_tests.mjs                  # Master test runner
│   └── ...                                # Individual unit, integration & forensic test files
├── demo/                                  # Production demo assets & showcase projects
│   └── vfx_showcase/                      # 1080p cinematic VFX shot (.opencomp & EXR assets)
├── README.md                              # This file (Short introduction & documentation links)
├── run_desktop.bat                        # Desktop application launcher
├── run_python.bat                         # Native Python engine launcher
└── server.js                              # Local HTTP server entry point
```

---

## 📄 License

OpenComp is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.
