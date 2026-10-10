"""Recovered-C emission with a real syntax gate.

Three emission grades, never silently interchanged:

* `clean_typed_c` -- the body is mechanically complete and the generated
  translation unit passes `gcc -fsyntax-only`;
* `recovered_pseudocode` -- a body exists but is not mechanically complete, so
  the output is explicitly marked and its unknown fields are preserved verbatim;
* `typed_skeleton` -- no usable body; a signature and the accessed structure
  are emitted with the unknowns spelled out.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from . import RULE_VERSION

PRELUDE = """/* generated translation unit -- syntax check only */
typedef signed char s8; typedef unsigned char u8;
typedef signed short s16; typedef unsigned short u16;
typedef signed int s32; typedef unsigned int u32;
typedef signed long long s64; typedef unsigned long long u64;
typedef float f32; typedef double f64;
typedef signed char int8_t; typedef unsigned char uint8_t;
typedef signed short int16_t; typedef unsigned short uint16_t;
typedef signed int int32_t; typedef unsigned int uint32_t;
typedef signed long long int64_t; typedef unsigned long long uint64_t;
#define NULL ((void *)0)
"""


@dataclass
class Emission:
    grade: str
    text: str
    syntax_ok: bool
    diagnostic: str | None = None


def _struct_decl(signature) -> str:
    if not signature.structs:
        return ""
    blocks = []
    for name, spec in signature.structs.items():
        lines = [f"typedef struct {name} {{"]
        previous = 0
        for offset_hex, ctype in spec["slots"].items():
            offset = int(offset_hex, 0)  # base 0 accepts the signed form
            if offset < 0:
                # Access before the pointer: a real observation, but it cannot
                # be placed in a struct without knowing the true base.
                lines.append(f"    /* observed access at {offset_hex}, "
                             "before this pointer; base unknown */")
                continue
            if offset > previous:
                lines.append(f"    uint8_t _pad_0x{previous:02x}[0x{offset - previous:x}];")
            lines.append(f"    {ctype} unk_0x{offset:02x};  /* +0x{offset:02x} */")
            previous = offset + 4
        lines.append(f"}} {name};")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _rewrite_body(body: str, signature, names: dict[str, str]) -> str:
    text = re.sub(r"((?:->|\.))unk(-?[0-9A-Fa-f]+)",
                  lambda m: f"{m.group(1)}unk_0x{int(m.group(2), 16):02x}", body)
    for call, name in names.items():
        text = re.sub(rf"\b{re.escape(call)}\b", name, text)
    if signature.params and signature.params[0][0] == "self":
        text = re.sub(r"\barg0\b", "self", text)
    return text


def _externs(features, names: dict[str, str]) -> str:
    lines = []
    for global_name, ctype in sorted(features.externs.items()):
        clean = ctype.replace("?", "uint32_t")
        lines.append(f"extern {clean} {global_name};")
    for global_name in features.globals:
        if global_name not in features.externs:
            lines.append(f"extern uint32_t {global_name};")
    for call in sorted(set(features.direct_calls)):
        lines.append(f"extern void {names.get(call, call)}();")
    return "\n".join(sorted(set(lines)))


def syntax_check(text: str) -> tuple[bool, str | None]:
    with tempfile.NamedTemporaryFile("w", suffix=".c", delete=False) as handle:
        handle.write(text)
        path = Path(handle.name)
    try:
        result = subprocess.run(
            ["gcc", "-fsyntax-only", "-std=c11", "-w", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return True, None
        return False, (result.stderr.strip().splitlines() or ["unknown"])[0][:300]
    except (OSError, subprocess.SubprocessError) as error:
        return False, f"syntax check unavailable: {error}"
    finally:
        path.unlink(missing_ok=True)


def _header(candidate, fn, grade: str) -> str:
    end = f"0x{fn.end_address:08x}" if fn.end_address else "unknown"
    return "\n".join([
        "/*",
        f" * {fn.id}",
        f" * grade:        {grade}",
        f" * generated_by: infer_recovered_semantics {RULE_VERSION}",
        f" * module:       {fn.module}  ({fn.source})",
        f" * assembly:     {fn.address_hex}..{end}"
        + (f", line {fn.source_line}" if fn.source_line else ""),
        f" * body:         {fn.body_path.as_posix() if fn.body_path else 'none'}",
        f" * confidence:   {candidate['confidence']:.2f}  ({candidate['confidence_basis']})",
        f" * role:         {candidate['role'] or 'unclassified'}",
        " *",
        " * NOT verified original behavior. A candidate reconstruction for review.",
        " */",
    ])


def emit(candidate, fn, signature, names: dict[str, str]) -> Emission:
    features = fn.features
    struct_text = _struct_decl(signature)

    if features is None or not features.parsed:
        text = "\n".join([
            _header(candidate, fn, "typed_skeleton"), "",
            "#include <stdint.h>", "",
            struct_text, "" if struct_text else "",
            f"/* no successful decompilation: {candidate['lift']} */",
            "\n".join(f"/* unknown: {item} */" for item in signature.unknowns),
            f"{signature.text};",
        ])
        return Emission("typed_skeleton", text, False, "no body")

    body = _rewrite_body(features.body, signature, names)
    externs = _externs(features, names)
    unit = "\n".join([
        PRELUDE, struct_text, externs, "",
        f"{signature.text} {{{body}}}",
    ])
    ok, diagnostic = syntax_check(unit)

    if features.complete and ok:
        text = "\n".join([
            _header(candidate, fn, "clean_typed_c"), "",
            "#include <stdint.h>", "",
            struct_text, "" if struct_text else "",
            externs, "",
            f"{signature.text} {{{body}}}",
        ])
        return Emission("clean_typed_c", text, True)

    reasons = []
    if not features.complete:
        reasons.append("body not mechanically complete: " + ", ".join(sorted(set(features.incomplete))))
    if not ok:
        reasons.append(f"generated unit fails C syntax check: {diagnostic}")
    text = "\n".join([
        _header(candidate, fn, "recovered_pseudocode"), "",
        "/* RECOVERED PSEUDOCODE -- NOT COMPILABLE C.",
        *(f" * {reason}" for reason in reasons),
        " * Unknown fields are preserved exactly as the decompiler emitted them.",
        " */", "",
        struct_text, "" if struct_text else "",
        "\n".join(f"/* unknown: {item} */" for item in signature.unknowns),
        "#if 0", externs, "",
        f"{signature.text} {{{body}}}",
        "#endif",
    ])
    return Emission("recovered_pseudocode", text, ok, diagnostic)
