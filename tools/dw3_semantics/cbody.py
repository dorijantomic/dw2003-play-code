"""Tolerant feature extraction over m2c output.

This is deliberately not a C parser. m2c emits a small, regular subset of C and
the rules downstream need shape, not an AST. Anything the extractor cannot
account for is recorded as an incompleteness marker rather than guessed at, so a
body that is only partly understood can never be mistaken for a complete one.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

# m2c writes `?` for a return type it could not determine, and prefixes a file
# with extern declarations for everything the body calls. Only a definition --
# a signature followed by `{` -- is matched here; the declarations end in `;`.
SIGNATURE_RE = re.compile(
    r"^(?P<ret>[A-Za-z_\?][\w \*\?]*?)\s*(?P<name>F0x[0-9a-fA-F]{8})\s*\((?P<args>[^)]*)\)\s*\{",
    re.MULTILINE,
)
EXTERN_FN_RE = re.compile(
    r"^(?P<ret>[A-Za-z_\?][\w \*\?]*?)\s*(?P<name>F0x[0-9a-fA-F]{8})\s*\((?P<args>[^)]*)\)\s*;",
    re.MULTILINE,
)
EXTERN_RE = re.compile(r"^\s*extern\s+(?P<type>[^;]+?)\s+(?P<name>D0x[0-9a-fA-F]{8})\s*;", re.MULTILINE)
DECL_RE = re.compile(r"^\s{4}(?P<type>[A-Za-z_][\w \*\?]*?)\s*(?P<name>\w+);\s*$", re.MULTILINE)
DIRECT_CALL_RE = re.compile(r"\b(F0x[0-9a-fA-F]{8})\s*\(")
SLOT_CALL_RE = re.compile(r"(?P<base>[\w\[\]\.\->]+?)->unk(?P<off>-?[0-9A-Fa-f]+)\s*\(")
GLOBAL_RE = re.compile(r"\bD0x[0-9a-fA-F]{8}\b")
MEMBER_RE = re.compile(r"(?P<base>\*?[A-Za-z_]\w*)(?:->|\.)unk(?P<off>-?[0-9A-Fa-f]+)")
STRING_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
INT_RE = re.compile(r"\b(?:0[xX][0-9a-fA-F]+|\d+)\b")
RETURN_RE = re.compile(r"^\s*return\s*(?P<expr>[^;]*);", re.MULTILINE)
ASSIGN_RE = re.compile(r"^\s*(?P<lhs>[^=;{}]+?)\s=\s(?P<rhs>[^;]+);\s*$", re.MULTILINE)

CONTROL_KEYWORDS = ("if", "else", "while", "do", "for", "switch", "case", "goto")

# m2c emits these when it could not recover something. Their presence means the
# body is not a mechanically complete representation of the original function.
INCOMPLETE_MARKERS = (
    ("saved_reg", re.compile(r"\bsaved_reg_\w+")),
    ("unknown_type", re.compile(r"(?<![\w\"])\?(?![\w\"])")),
    ("unaligned_access", re.compile(r"\bunaligned_\w+")),
    ("bitcast", re.compile(r"\bM2C_\w+")),
    ("error_marker", re.compile(r"\bERROR\b")),
)


@dataclass
class Access:
    base: str
    offset: int
    write: bool


@dataclass
class Features:
    parsed: bool = False
    parse_error: str | None = None
    return_type: str = "void"
    params: list[tuple[str, str]] = field(default_factory=list)
    locals: list[tuple[str, str]] = field(default_factory=list)
    externs: dict[str, str] = field(default_factory=dict)
    extern_functions: dict[str, dict] = field(default_factory=dict)
    statements: int = 0
    body_lines: int = 0
    control: dict[str, int] = field(default_factory=dict)
    direct_calls: list[str] = field(default_factory=list)
    slot_calls: list[tuple[str, int]] = field(default_factory=list)
    globals: list[str] = field(default_factory=list)
    accesses: list[Access] = field(default_factory=list)
    constants: list[int] = field(default_factory=list)
    strings: list[str] = field(default_factory=list)
    returns: list[str] = field(default_factory=list)
    assignments: list[tuple[str, str]] = field(default_factory=list)
    incomplete: list[str] = field(default_factory=list)
    body: str = ""
    exact_hash: str = ""
    shape_hash: str = ""
    struct_hash: str = ""

    @property
    def complete(self) -> bool:
        """Whether every instruction is represented by recovered C."""
        return self.parsed and not self.incomplete

    @property
    def empty(self) -> bool:
        return self.parsed and self.statements == 0

    @property
    def call_count(self) -> int:
        return len(self.direct_calls) + len(self.slot_calls)

    def offsets_for(self, base: str) -> list[int]:
        return sorted({a.offset for a in self.accesses if a.base == base})


def _split_params(text: str) -> list[tuple[str, str]]:
    text = text.strip()
    if not text or text == "void":
        return []
    params: list[tuple[str, str]] = []
    for chunk in text.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        match = re.match(r"^(?P<type>.*?[\w\?])\s*\*?\s*(?P<name>\w+)$", chunk)
        if match:
            ctype = match.group("type").strip()
            if "*" in chunk[len(ctype):]:
                ctype += " *"
            params.append((match.group("name"), ctype))
        else:
            params.append((chunk, "?"))
    return params


def _body_of(text: str, start: int) -> str:
    """Return the outermost brace-balanced body beginning at `start`."""
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:index]
    return text[start + 1:]


def _normalize(body: str, *, holes: bool) -> str:
    """Canonical body text for family hashing.

    Whitespace and local temporary names are always erased. With `holes`, the
    parameterisable content -- integer literals, global addresses and callee
    ids -- is erased too, so two bodies that differ only in which constants and
    callees they use collapse to the same shape.
    """
    text = re.sub(r"\bblock_\d+\b", "BLOCK", body)
    text = re.sub(r"\b(?:temp|var|phi|sp)_\w+\b", "V", text)
    text = re.sub(r"\barg[0-9A-Fa-f]+\b", "A", text)
    if holes:
        text = GLOBAL_RE.sub("G", text)
        text = DIRECT_CALL_RE.sub("C(", text)
        text = INT_RE.sub("N", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract(text: str, expected_name: str | None = None) -> Features:
    features = Features(body="")
    matches = list(SIGNATURE_RE.finditer(text))
    if not matches:
        features.parse_error = "no recognisable m2c function definition"
        return features
    match = matches[0]
    if expected_name:
        # A file may contain more than one definition; take the one whose name
        # is the address the inventory asked about rather than the first.
        for candidate in matches:
            if candidate.group("name") == expected_name:
                match = candidate
                break
    features.parsed = True
    features.return_type = match.group("ret").strip()
    features.params = _split_params(match.group("args"))
    body = _body_of(text, match.end() - 1)
    features.body = body
    features.body_lines = len([line for line in body.splitlines() if line.strip()])

    for extern in EXTERN_RE.finditer(text):
        features.externs[extern.group("name")] = extern.group("type").strip()
    for decl in DECL_RE.finditer(body):
        features.locals.append((decl.group("name"), decl.group("type").strip()))

    local_names = {name for name, _ in features.locals}
    statement_body = body
    for name, _ in features.locals:
        statement_body = re.sub(rf"^\s*[\w \*\?]*\b{re.escape(name)};\s*$", "", statement_body, flags=re.MULTILINE)
    features.statements = statement_body.count(";")

    features.control = {
        keyword: len(re.findall(rf"\b{keyword}\b", body)) for keyword in CONTROL_KEYWORDS
    }
    features.control["return"] = len(re.findall(r"\breturn\b", body))

    features.direct_calls = DIRECT_CALL_RE.findall(body)
    for call in SLOT_CALL_RE.finditer(body):
        features.slot_calls.append((call.group("base"), int(call.group("off"), 16)))
    features.globals = sorted(set(GLOBAL_RE.findall(body)))
    features.strings = STRING_RE.findall(body)
    features.constants = []
    for token in INT_RE.findall(body):
        try:
            features.constants.append(int(token, 0))
        except ValueError:
            continue
    features.returns = [m.group("expr").strip() for m in RETURN_RE.finditer(body)]

    written: set[tuple[str, int]] = set()
    for assign in ASSIGN_RE.finditer(body):
        lhs, rhs = assign.group("lhs").strip(), assign.group("rhs").strip()
        features.assignments.append((lhs, rhs))
        member = MEMBER_RE.search(lhs)
        if member:
            written.add((member.group("base").lstrip("*"), int(member.group("off"), 16)))
    for member in MEMBER_RE.finditer(body):
        base = member.group("base").lstrip("*")
        if base in local_names or base.startswith(("arg", "D0x")) or True:
            offset = int(member.group("off"), 16)
            features.accesses.append(Access(base, offset, (base, offset) in written))

    for extern in EXTERN_FN_RE.finditer(text):
        features.extern_functions[extern.group("name")] = {
            "return_type": extern.group("ret").strip(),
            "params": _split_params(extern.group("args")),
        }

    # Scan this function's own signature and body only. A `?` inside an extern
    # declaration describes a callee m2c could not type, which says nothing
    # about whether *this* body was fully recovered.
    own_text = match.group(0) + body
    for label, pattern in INCOMPLETE_MARKERS:
        if pattern.search(own_text):
            features.incomplete.append(label)

    features.exact_hash = hashlib.sha256(
        _normalize(body, holes=False).encode()).hexdigest()
    features.shape_hash = hashlib.sha256(
        _normalize(body, holes=True).encode()).hexdigest()
    features.struct_hash = hashlib.sha256(
        repr(sorted({(a.base.startswith("arg"), a.offset) for a in features.accesses})).encode(),
    ).hexdigest()
    return features
