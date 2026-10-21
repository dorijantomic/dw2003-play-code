#!/usr/bin/env python3
"""Shared K11 helpers: firing-mode classifier, body-family map, arm signature, similarity.

The SAME rules are emitted into web/fight/digimon-anatomy.js (JS mirror), so this module is
the single source of truth for the classification and the tuning weights.
"""
import re

# ---------------------------------------------------------------- body families
# Donor ranking groups: what matters for borrowing a motion is the LOCOMOTION skeleton
# (how the body stands and moves), not the flavour of the species.
BODY_FAMILY = {
    "biped-upright": "biped",
    "biped-hunched": "biped",
    "winged-biped": "biped",
    "multi-armed": "biped",
    "humanoid-torso-only": "biped",
    "quadruped": "quadruped",
    "winged-quadruped": "quadruped",
    "serpentine": "serpentine",
    "aquatic-swimmer": "serpentine",
    "insectoid": "insectoid",
    "blob": "blob",
    "floating": "blob",
    "plant-rooted": "plant",
    "other": "other",
}

# ---------------------------------------------------------------- firing modes
MODES = ["left-arm", "right-arm", "both-arms", "arms-unspecified", "mouth", "head", "eyes",
         "chest", "back", "tail", "wings", "whole-body", "self", "unknown", "other"]

_ARM = re.compile(r"\b(arms?|hands?|fists?|claws?|palms?|forearms?|wrists?|gauntlets?|blades?|"
                  r"sickles?|pincers?|lances?|swords?|guns?|cannons?|launchers?|knuckles?|"
                  r"fingers?|talons?|chelipeds?|tentacles?|vines?|chains?|hooks?|paws?|"
                  r"forepaws?|foreclaws?|forelegs?|talismans?|maces?|tridents?|rods?|brush|"
                  r"bows?|unarmed)\b")
_LEFT = re.compile(r"\bleft\b|\bl-arm|\bl arm|\bl hand")
_RIGHT = re.compile(r"\bright\b|\br-arm|\br arm|\br hand")
_MOUTH = re.compile(r"\bmouths?\b|\bjaws?\b|beaks?|\bbreath|spit|tusks?|fangs?|trunks?|snouts?|"
                    r"\bmaw\b|tongues?|vocal|howl|roars?|songs?|voice|screams?|shouts?|sing\b|"
                    r"barks?|caws?")
_EYES = re.compile(r"\beyes?\b|gaze|glare|stare|glamour")
_HEAD = re.compile(r"heads?|horns?|crests?|mandibles?|antennae?|brows?|visors?|helmets?|skulls?|"
                   r"faces?|masks?|manes?|\bars\b|tiara|diadem")
_CHEST = re.compile(r"chest|belly|abdomen|torso|digicore|\bcore\b|shoulders?|turbine|sternum|"
                    r"waist")
_BACK = re.compile(r"\bback\b|spines?|shells?|turret|pack\b|ridge")
_TAIL = re.compile(r"\btails?\b|stinger|tails\b")
_WING = re.compile(r"\bwings?\b|wingbeats?")
_SELF = re.compile(r"^(self|own body|none\b|n/a|nothing)|no strike|no launch|ambient|"
                   r"passive")
_WHOLE = re.compile(r"whole|entire|\bbody\b|all of it|skin|surface")


def classify_mode(style, body_part):
    """Map (attackSources.style, attackSources.bodyPart free text) -> one of MODES.

    Order matters: an explicit side on an arm word wins, then body-located nouns (so
    "snout cannon" is a mouth and "head gun barrel" is a head), and only then a bare arm word
    (a limb with no side named). Word boundaries matter: "charm" must not read as an arm.
    """
    text = (body_part or "").strip().lower()
    if style == "self-buff":
        return "self"
    if not text:
        return "unknown"
    if "unknown" in text:
        return "unknown"
    if _SELF.search(text):
        return "self"
    has_arm = _ARM.search(text) is not None
    left = _LEFT.search(text) is not None
    right = _RIGHT.search(text) is not None
    if has_arm and left and right:
        return "both-arms"
    if has_arm and "both" in text:
        return "both-arms"
    if has_arm and left:
        return "left-arm"
    if has_arm and right:
        return "right-arm"
    if _MOUTH.search(text):
        return "mouth"
    if _EYES.search(text):
        return "eyes"
    if _WING.search(text):
        return "wings"
    if _TAIL.search(text):
        return "tail"
    if _CHEST.search(text):
        return "chest"
    if _BACK.search(text):
        return "back"
    if _HEAD.search(text):
        return "head"
    if _WHOLE.search(text):
        return "whole-body"
    if has_arm:
        return "arms-unspecified"
    if style == "summon":
        return "whole-body"
    return "other"


# arm kinds that give the arm a job beyond holding something
WEAPON_KINDS = {"gun", "cannon", "blade", "hammer", "axe", "sword", "lance", "claw", "pincer",
                "tentacle", "fist", "shield"}


def body_family(plan):
    return BODY_FAMILY.get(plan, "other")


def arm_signature(rec):
    """Group-B signature: the arm kinds per side plus the built-in weapons."""
    sides = {"left": [], "right": [], "center": []}
    for a in rec.get("arms") or []:
        kind = a.get("kind")
        if kind and kind != "none":
            sides.setdefault(a.get("side"), []).append(kind)
    builtin = sorted("%s:%s" % (a.get("side"), a.get("kind"))
                     for a in rec.get("arms") or [] if a.get("builtIn") and a.get("kind") != "hand")
    return {
        "left": sorted(sides.get("left") or []),
        "right": sorted(sides.get("right") or []),
        "center": sorted(sides.get("center") or []),
        "builtIn": builtin,
    }


def signature_key(rec):
    s = arm_signature(rec)
    return "L[%s] R[%s]%s%s" % (
        "+".join(s["left"]) or "-",
        "+".join(s["right"]) or "-",
        (" C[%s]" % "+".join(s["center"])) if s["center"] else "",
        (" builtin{%s}" % ",".join(s["builtIn"])) if s["builtIn"] else "")


def firing_summary(rec):
    """Per-model emitter picture used by K13: which side fires, per attack style."""
    out = {}
    for a in rec.get("attackSources") or []:
        mode = classify_mode(a.get("style"), a.get("bodyPart"))
        out.setdefault(a.get("style"), {})
        out[a.get("style")][mode] = out[a.get("style")].get(mode, 0) + 1
    return out


# ---------------------------------------------------------------- similarity
W = {
    "bodyPlan": 0.30,
    "bodyFamily": 0.12,
    "firingSide": 0.23,
    "armament": 0.20,
    "size": 0.10,
    "speciesType": 0.05,
}
SIZE_ORDER = ["tiny", "small", "medium", "large", "giant"]


def _side_of(rec):
    d = rec.get("dominantSide")
    if d in ("left", "right", "both"):
        return d
    return None


def _arm_tokens(rec):
    toks = set()
    for a in rec.get("arms") or []:
        if a.get("kind") and a.get("kind") != "none":
            toks.add("%s:%s" % (a.get("side"), a.get("kind")))
            toks.add("kind:%s" % a.get("kind"))
    for m in rec.get("armament") or []:
        toks.add("where:%s" % m.get("where"))
        toks.add("what:%s" % m.get("kind"))
    return toks


def similarity_detail(a, b):
    """Anatomy-only resemblance between two records (or model folders).

    Returns {score: 0..1, reasons: [strings]}. Deterministic: no randomness, no ids.
    """
    reasons = []
    score = 0.0

    def band(pts, why):
        nonlocal score
        score += pts
        reasons.append("%+.2f %s" % (pts, why))

    if a.get("bodyPlan") == b.get("bodyPlan"):
        band(W["bodyPlan"] + W["bodyFamily"], "same bodyPlan (%s)" % a.get("bodyPlan"))
    elif body_family(a.get("bodyPlan")) == body_family(b.get("bodyPlan")):
        band(W["bodyFamily"], "same body family (%s)" % body_family(a.get("bodyPlan")))
    else:
        reasons.append("+0.00 body family differs (%s vs %s)" %
                       (body_family(a.get("bodyPlan")), body_family(b.get("bodyPlan"))))

    sa, sb = _side_of(a), _side_of(b)
    if sa == sb:
        band(W["firingSide"], "same dominant side (%s)" % (sa or "unstated"))
    elif sa and sb:
        if "both" in (sa, sb):
            band(W["firingSide"] * 0.6, "one side fires from both arms (%s vs %s)" % (sa, sb))
        else:
            band(W["firingSide"] * 0.15, "opposite dominant side (%s vs %s) - motion must be mirrored" % (sa, sb))
    else:
        band(W["firingSide"] * 0.35, "one side unstated (%s vs %s)" % (sa, sb))

    ta, tb = _arm_tokens(a), _arm_tokens(b)
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 1.0
    band(W["armament"] * jac, "armament Jaccard %.2f (%d shared tokens)" % (jac, len(ta & tb)))

    ia = SIZE_ORDER.index(a.get("sizeClass")) if a.get("sizeClass") in SIZE_ORDER else 2
    ib = SIZE_ORDER.index(b.get("sizeClass")) if b.get("sizeClass") in SIZE_ORDER else 2
    gap = abs(ia - ib)
    band(W["size"] * (1.0 if gap == 0 else 0.6 if gap == 1 else 0.0),
         "size %s vs %s (gap %d)" % (a.get("sizeClass"), b.get("sizeClass"), gap))

    if a.get("speciesType") == b.get("speciesType"):
        band(W["speciesType"], "same speciesType (%s)" % a.get("speciesType"))
    elif set(a.get("speciesTags") or []) & set(b.get("speciesTags") or []):
        band(W["speciesType"] * 0.5, "shared species tag")

    return {"score": round(score, 4), "reasons": reasons}
