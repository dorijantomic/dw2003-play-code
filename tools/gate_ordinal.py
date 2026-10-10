#!/usr/bin/env python3
"""The story ordinal a stage's own auto-event gate can be satisfied with.

Reads `web/assets/data/auto_event_gates.json` for `s<stage>` and returns the
ordinal of the first event whose remaining conditions are stored flags expected
to be 0 -- unset is already the state a field has, so such a gate opens with the
ordinal write alone. A gate that needs a flag set to 1 is not returned: faking it
would run an event a player would not meet. Prints nothing when no such gate
exists, which the caller reports rather than guesses around.
"""
import json
import sys


def gate_ordinal(stage: int) -> int | None:
    gates = json.load(open("web/assets/data/auto_event_gates.json"))
    found = []
    for event, row in gates.get(f"s{stage}", {}).items():
        ordinal = None
        ok = True
        for flag, expected in row["conds"]:
            if 0x6000 <= flag <= 0x60FF:
                ordinal = flag - 0x6000
            elif expected != 0:
                ok = False
        if ok and ordinal is not None:
            found.append(ordinal)
    # Earliest satisfiable beat: the first story moment this stage would show.
    return min(found) if found else None


def main() -> int:
    ordinal = gate_ordinal(int(sys.argv[1]))
    if ordinal is not None:
        print(ordinal)
    return 0


if __name__ == "__main__":
    sys.exit(main())
