"""
OpenComp Test Suite - Numerical Parity Between JavaScript and Python Engines
Ensures that both compositing engines (JavaScript V8 Float32 and Python NumPy Float32)
produce mathematically identical pixel outputs within floating-point tolerance (atol < 1e-4).
"""

import sys
import os
import json
import subprocess
import unittest
import numpy as np

# Ensure workspace root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.core.pixel_buffer import PixelBuffer
from src.core.graph import Graph
from src.nodes.registry import create_node


class TestEngineParity(unittest.TestCase):
    def test_grade_and_merge_parity(self):
        # 1. Evaluate in Python Engine
        py_graph = Graph()
        
        # Background: Constant (0.1, 0.2, 0.3, 1.0)
        bg = PixelBuffer(4, 4)
        bg.fill(0.1, 0.2, 0.3, 1.0)
        
        # Foreground: Constant (0.4, 0.6, 0.8, 0.5)
        fg = PixelBuffer(4, 4)
        fg.fill(0.4, 0.6, 0.8, 0.5)
        
        # Grade Foreground: gain=1.2, gamma=1.1, blackpoint=0.05, whitepoint=0.95
        grade = create_node("Grade", "G_Parity")
        grade.set_knob_value("blackpoint", 0.05)
        grade.set_knob_value("whitepoint", 0.95)
        grade.set_knob_value("gain", 1.2)
        grade.set_knob_value("gamma", 1.1)
        
        graded_fg = grade.compute({"in": fg})
        
        # Merge Over: graded_fg over bg
        merge = create_node("Merge", "M_Parity")
        merge.set_knob_value("operation", "over")
        
        py_output = merge.compute({"B": bg, "A": graded_fg})
        py_pixel = py_output.data[0, 0] # (4,)

        # 2. Evaluate Exact Same Math in JavaScript Engine via Node CLI
        js_code = """
        import { PixelBuffer } from './src/core/PixelBuffer.js';
        import { GradeNode } from './src/nodes/GradeNode.js';
        import { MergeNode } from './src/nodes/MergeNode.js';

        const bg = new PixelBuffer(4, 4);
        bg.fill(0.1, 0.2, 0.3, 1.0);

        const fg = new PixelBuffer(4, 4);
        fg.fill(0.4, 0.6, 0.8, 0.5);

        const grade = new GradeNode('G_JS');
        grade.setKnobValue('blackpoint', 0.05);
        grade.setKnobValue('whitepoint', 0.95);
        grade.setKnobValue('gain', 1.2);
        grade.setKnobValue('gamma', 1.1);

        const graded = grade.compute({ in: fg });

        const merge = new MergeNode('M_JS');
        merge.setKnobValue('operation', 'over');
        const out = merge.compute({ B: bg, A: graded });

        const p = out.getPixel(0, 0);
        console.log(JSON.stringify(p));
        """
        
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", js_code],
            capture_output=True,
            text=True,
            check=True
        )
        
        js_pixel = np.array(json.loads(proc.stdout.strip()), dtype=np.float32)

        # 3. Assert Strict Numerical Parity
        print(f"\n  Python Output Pixel: {py_pixel}")
        print(f"  JavaScript Output:   {js_pixel}")
        np.testing.assert_allclose(
            py_pixel, js_pixel, atol=1e-4,
            err_msg="Discrepancy detected between JavaScript and Python Float32 outputs!"
        )


if __name__ == "__main__":
    print("----------------------------------------------------")
    print("🧪 RUNNING: tests/test_engine_parity.py")
    print("----------------------------------------------------")
    unittest.main()

