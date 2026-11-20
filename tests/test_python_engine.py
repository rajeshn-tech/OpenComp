"""
OpenComp Test Suite - Python Core Engine & NumPy Precision Verification
Validates DAG evaluation, NumPy Float32 image processing, and Nuke formulas in Python.
"""

import sys
import os
import unittest
import numpy as np

# Ensure workspace root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.core.pixel_buffer import PixelBuffer
from src.core.graph import Graph
from src.nodes.registry import create_node


class TestPythonEngine(unittest.TestCase):
    def test_pixel_buffer_allocation_and_precision(self):
        buf = PixelBuffer(100, 50)
        self.assertEqual(buf.width, 100)
        self.assertEqual(buf.height, 50)
        self.assertEqual(buf.data.shape, (50, 100, 4))
        self.assertEqual(buf.data.dtype, np.float32)

        # Fill and test pixel
        buf.fill(0.2, 0.4, 0.6, 0.8)
        pixel = buf.get_pixel(10, 20)
        np.testing.assert_allclose(pixel, [0.2, 0.4, 0.6, 0.8], atol=1e-5)

        # Clone isolation
        clone = buf.clone()
        clone.data[20, 10] = [1.0, 1.0, 1.0, 1.0]
        self.assertFalse(np.allclose(buf.data[20, 10], [1.0, 1.0, 1.0, 1.0]))

    def test_dag_cycle_prevention(self):
        graph = Graph()
        n1 = create_node("Grade", "G1")
        n2 = create_node("Blur", "B1")
        graph.add_node(n1)
        graph.add_node(n2)

        ok1 = graph.connect("G1", "out", "B1", "in")
        self.assertTrue(ok1)

        # Attempt cycle B1 -> G1
        ok2 = graph.connect("B1", "out", "G1", "in")
        self.assertFalse(ok2, "Cycle connection must be rejected")

    def test_grade_math_numpy(self):
        grade = create_node("Grade", "G_Test")
        grade.set_knob_value("blackpoint", 0.1)
        grade.set_knob_value("whitepoint", 0.9)
        grade.set_knob_value("gain", 1.2)
        grade.set_knob_value("gamma", 1.5)

        # Input buffer of 0.5
        in_buf = PixelBuffer(4, 4)
        in_buf.fill(0.5, 0.5, 0.5, 1.0)

        out = grade.compute({"in": in_buf})
        self.assertIsNotNone(out)

        # Expected: A = 1.2 / (0.9 - 0.1) = 1.5; B = -1.5 * 0.1 = -0.15
        # x' = 1.5 * 0.5 - 0.15 = 0.6; out = 0.6 ^ (1 / 1.5) = 0.6 ^ 0.6667 ≈ 0.711378
        expected = np.power(0.6, 1.0 / 1.5)
        np.testing.assert_allclose(out.data[0, 0, 0], expected, atol=1e-4)

    def test_merge_over_numpy(self):
        merge = create_node("Merge", "M_Test")
        merge.set_knob_value("operation", "over")

        bg = PixelBuffer(2, 2)
        bg.fill(0.0, 0.0, 1.0, 1.0) # Solid Blue

        fg = PixelBuffer(2, 2)
        fg.fill(1.0, 0.0, 0.0, 0.5) # Solid Red, 50% Alpha

        out = merge.compute({"B": bg, "A": fg})
        self.assertIsNotNone(out)

        # Over: A + B * (1 - aA)
        # Red: 1.0, Blue: 0.5, Alpha: 1.0
        np.testing.assert_allclose(out.data[0, 0, :3], [1.0, 0.0, 0.5], atol=1e-4)
        np.testing.assert_allclose(out.data[0, 0, 3], 1.0, atol=1e-4)

    def test_keyer_despill_numpy(self):
        keyer = create_node("Keyer", "K_Test")
        keyer.set_knob_value("despill", True)

        green_screen = PixelBuffer(2, 2)
        green_screen.fill(0.1, 0.9, 0.1, 1.0)

        out = keyer.compute({"in": green_screen})
        self.assertIsNotNone(out)
        # Green channel despilled
        self.assertLessEqual(out.data[0, 0, 1], 0.15)


if __name__ == "__main__":
    print("----------------------------------------------------")
    print("🧪 RUNNING: tests/test_python_engine.py")
    print("----------------------------------------------------")
    unittest.main()

