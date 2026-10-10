"""Candidate signature, field-width and structure inference."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

C_TYPES = {
    "s8": "int8_t", "u8": "uint8_t",
    "s16": "int16_t", "u16": "uint16_t",
    "s32": "int32_t", "u32": "uint32_t",
    "s64": "int64_t", "u64": "uint64_t",
    "f32": "float", "f64": "double",
    "void": "void", "?": "void",
}
WIDTHS = {
    "int8_t": 1, "uint8_t": 1,
    "int16_t": 2, "uint16_t": 2,
    "int32_t": 4, "uint32_t": 4, "float": 4,
    "int64_t": 8, "uint64_t": 8, "double": 8,
}


def hex_offset(offset: int) -> str:
    """Signed hex. m2c emits `->unk-4` for access before the pointer."""
    return f"-0x{-offset:02x}" if offset < 0 else f"0x{offset:02x}"


@dataclass
class Signature:
    text: str
    return_type: str
    params: list[tuple[str, str]]
    structs: dict[str, dict] = field(default_factory=dict)
    structure_fields: list[str] = field(default_factory=list)
    complete: bool = False
    unknowns: list[str] = field(default_factory=list)


def c_type(raw: str) -> str:
    raw = (raw or "void").strip()
    pointer = raw.count("*")
    base = raw.replace("*", "").strip()
    mapped = C_TYPES.get(base, base if re.fullmatch(r"[A-Za-z_]\w*", base) else "void")
    return mapped + (" " + "*" * pointer if pointer else "")


def _field_widths(features) -> dict[tuple[str, int], str]:
    """Width of each accessed slot, from the type of the value moved through it."""
    widths: dict[tuple[str, int], str] = {}
    local_types = {name: c_type(t) for name, t in features.locals}
    for lhs, rhs in features.assignments:
        member = re.search(r"(\*?[A-Za-z_]\w*)(?:->|\.)unk(-?[0-9A-Fa-f]+)", lhs) or \
                 re.search(r"(\*?[A-Za-z_]\w*)(?:->|\.)unk(-?[0-9A-Fa-f]+)", rhs)
        if not member:
            continue
        key = (member.group(1).lstrip("*"), int(member.group(2), 16))
        other = rhs if member.re.search(lhs) else lhs
        for name, ctype in local_types.items():
            if re.search(rf"\b{re.escape(name)}\b", other) and ctype in WIDTHS:
                widths.setdefault(key, ctype)
                break
    return widths


def infer(fn, features, role_verdicts, family=None) -> Signature:
    if features is None or not features.parsed:
        return Signature(
            text=f"/* no body */ void {fn.id.split(':')[1]}(void)",
            return_type="void", params=[], complete=False,
            unknowns=["no successful decompilation; signature not inferable"],
        )

    widths = _field_widths(features)
    receiver = features.params[0][0] if features.params else None
    struct_name = None
    structure_fields: list[str] = []
    structs: dict[str, dict] = {}

    if receiver and any(a.base == receiver for a in features.accesses):
        offsets = features.offsets_for(receiver)
        struct_name = _struct_name(fn, family, offsets)
        slots = {}
        for offset in offsets:
            ctype = widths.get((receiver, offset), "uint32_t")
            slots[offset] = ctype
            label = hex_offset(offset).replace("-0x", "neg_0x")
            structure_fields.append(
                f"{struct_name}.unk_{label}@{hex_offset(offset)}:{ctype}")
        structs[struct_name] = {
            "slots": {hex_offset(o): t for o, t in sorted(slots.items())},
            "observed_extent": hex_offset(max(offsets)) if offsets else "0x00",
            "basis": "offsets accessed through the first parameter of this function",
        }

    params: list[tuple[str, str]] = []
    for index, (name, raw) in enumerate(features.params):
        if index == 0 and struct_name:
            params.append(("self", f"{struct_name} *"))
        else:
            params.append((name, c_type(raw)))

    return_type = c_type(features.return_type)
    top = role_verdicts[0] if role_verdicts else None
    if top and top.role == "getter" and receiver:
        ctype = widths.get((receiver, top.detail.get("offset", -1)))
        if ctype:
            return_type = ctype

    name = fn.curated_name or _provisional_name(fn)
    rendered = ", ".join(
        f"{ctype}{'' if ctype.endswith('*') else ' '}{pname}" for pname, ctype in params
    ) or "void"
    text = f"{return_type}{'' if return_type.endswith('*') else ' '}{name}({rendered})"

    unknowns: list[str] = []
    if features.incomplete:
        unknowns.append(
            "m2c could not fully recover the body ("
            + ", ".join(sorted(set(features.incomplete))) + "); "
            "parameter list and structure extent are lower bounds",
        )
    if not features.params and features.accesses:
        unknowns.append("accesses a receiver that m2c did not expose as a parameter")

    return Signature(
        text=text,
        return_type=return_type,
        params=params,
        structs=structs,
        structure_fields=structure_fields,
        complete=features.complete and not unknowns,
        unknowns=unknowns,
    )


def _struct_name(fn, family, offsets) -> str:
    """Provisional structure name.

    Shared across a family so members agree, otherwise scoped to the function.
    Never invents a domain name -- that requires reasoning, not shape.
    """
    if family is not None and family.can_carry_name:
        return f"Struct_{family.id.split(':')[1][:8]}"
    return f"Struct_{fn.module.split('/')[-1]}_{fn.address:08x}"


def _provisional_name(fn) -> str:
    return f"{fn.module.split('/')[-1]}_{fn.address:08x}"
