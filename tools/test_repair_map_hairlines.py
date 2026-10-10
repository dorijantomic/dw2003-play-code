"""What the hairline repair must and must not touch."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def run(tmp, *args):
    """Run the repair against a throwaway web/assets/maps tree."""
    return subprocess.run(
        [sys.executable, str(ROOT / "tools/repair_map_hairlines.py"), *args],
        cwd=tmp, capture_output=True, text=True, check=True)


def canvas(tmp, name, paint):
    maps = Path(tmp) / "web/assets/maps"
    maps.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (32, 32), (200, 100, 50, 255))
    paint(im.load())
    im.save(maps / f"{name}.png")
    return maps / f"{name}.png"


class RepairHairlines(unittest.TestCase):
    def test_closes_a_transparent_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            def paint(px):
                for y in range(4, 24):
                    px[10, y] = (0, 0, 0, 0)
            p = canvas(tmp, "s001", paint)
            run(tmp)
            out = Image.open(p).convert("RGBA").load()
            self.assertEqual(out[10, 12], (200, 100, 50, 255))

    def test_closes_a_half_transparent_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            def paint(px):
                for x in range(4, 24):
                    px[x, 9] = (10, 10, 10, 127)
            p = canvas(tmp, "s002", paint)
            run(tmp)
            out = Image.open(p).convert("RGBA").load()
            self.assertEqual(out[12, 9], (200, 100, 50, 255))

    def test_leaves_a_prop_cut_out_alone(self):
        """A cut-out a prop fills is a blob, not a line — it must survive."""
        with tempfile.TemporaryDirectory() as tmp:
            def paint(px):
                for y in range(8, 20):
                    for x in range(8, 20):
                        px[x, y] = (0, 0, 0, 0)
            p = canvas(tmp, "s003", paint)
            run(tmp)
            out = Image.open(p).convert("RGBA").load()
            self.assertEqual(out[12, 12][3], 0)

    def test_leaves_a_short_line_alone(self):
        """Below --min-run it is detail, not a stitch seam."""
        with tempfile.TemporaryDirectory() as tmp:
            def paint(px):
                for y in range(10, 13):
                    px[10, y] = (0, 0, 0, 0)
            p = canvas(tmp, "s004", paint)
            run(tmp)
            out = Image.open(p).convert("RGBA").load()
            self.assertEqual(out[10, 11][3], 0)

    def test_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            def paint(px):
                for y in range(4, 24):
                    px[10, y] = (0, 0, 0, 0)
            p = canvas(tmp, "s005", paint)
            run(tmp)
            first = Path(p).read_bytes()
            second = run(tmp)
            self.assertIn("0 hairlines closed", second.stdout)
            self.assertEqual(first, Path(p).read_bytes())


if __name__ == "__main__":
    unittest.main()
