"""Generalization check: decode_timeline must run cleanly and stay structurally
sound (in-range loop_target on every pure 0x8000 marker) across the full 245-model
corpus, not just the reference model. NOT every position terminates with the
literal value 0xffff -- that's a convention in some models' data, not a structural
guarantee of the algorithm (confirmed by hand-tracing m366giru / m437bast's raw
bytes, where positions legitimately terminate on other sentinel values)."""
import glob
from decode_timeline import decode_timeline


def test_all_245_models_decode_cleanly():
    bin0s = sorted(glob.glob("/home/dorij/ddw3/pack/dw2003/fight/model/*/0.bin"))
    assert len(bin0s) >= 245, f"expected >=245 models, found {len(bin0s)}"
    checked = 0
    for path in bin0s:
        positions = decode_timeline(open(path, "rb").read())
        for p in positions:
            table = p["table"]
            for e in table:
                if e["value"] == 0x8000:
                    assert 0 <= e["loop_target"] < len(table), (
                        f"{path}: pure marker loop_target {e['loop_target']} "
                        f"out of range for table len {len(table)}"
                    )
        checked += 1
    assert checked == len(bin0s)


if __name__ == "__main__":
    test_all_245_models_decode_cleanly()
    print("PASS")
