import struct
from decode_timeline import decode_timeline


def test_reference_marker_counts():
    bin0 = open("/home/dorij/ddw3/pack/dw2003/fight/model/m373rena/0.bin", "rb").read()
    positions = decode_timeline(bin0)
    loop_markers = sum(1 for p in positions for e in p["table"] if e["value"] == 0x8000)
    end_markers  = sum(1 for p in positions for e in p["table"] if e["value"] == 0xffff)
    assert loop_markers == 14, f"expected 14 loop markers, got {loop_markers}"
    assert end_markers  == 25, f"expected 25 end markers, got {end_markers}"
    for p in positions:
        for e in p["table"]:
            if e["value"] == 0x8000:
                assert 0 <= e["loop_target"] < len(p["table"])


if __name__ == "__main__":
    test_reference_marker_counts()
    print("PASS")
