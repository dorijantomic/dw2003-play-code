"""Scratch: inspect s96x-alias type-7 grid pack headers (files 2351-2379)."""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extract_zone_grids as G

d = G.Disc(G.DISC)
for fno in (2351, 2353, 2355, 2367, 2377, 1712, 1686):
    blob, lba, ln = d.file_bytes(fno)
    if blob is None:
        print(f"file {fno}: unmapped")
        continue
    words = struct.unpack_from("<16I", blob, 0)
    print(f"file {fno} (lba {lba}, {ln} sectors, {len(blob)}B): "
          + " ".join(f"{w:#x}" for w in words))
