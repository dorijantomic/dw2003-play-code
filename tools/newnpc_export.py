#!/usr/bin/env python3
"""Step 1 of a new Gemini-made NPC or boss: write the folder you take to Gemini.

    python3 tools/newnpc_export.py <map_id> [--like <npc sprite id>] [--role townsperson|trainer|boss]
                                   [--name "..."] [--desc "..."] [--id 1103] [--out DIR] [--repo ROOT]
    python3 tools/newnpc_export.py --install <folder> [--repo ROOT]

Writes ~/dw3-newnpcs/<slug>/ (outside the repo, never committed; env NEWNPCS_DIR or --out change it):
  prompt.txt    the exact words for Gemini, built from the game's own sprites (measured, see measured.json)
  ref.png       3-4 real sprites of that map, enlarged, as the STYLE reference (disc art: local only)
  entry.json    a ready data/authored/quests/new_characters.json entry: next free npc id >= 1103, "views", height, and a
                walkable spot on the map found with the game's own collision (12 x 8 foot box)
  measured.json the numbers behind the prompt (height, width, colours, outline colour, background colour)
Then: Gemini <- prompt.txt + ref.png; save its picture as views.png in the folder; run
  tools/newnpc_export.py --install <folder>
which checks the picture (1 to 4 separate figures), copies it to data/authored/quests/art/<slug>.png, appends entry.json
to data/authored/quests/new_characters.json and quests/new_characters.json, and runs tools/make_quest_sprites.py
(on any failure both json files are put back). By hand: copy views.png there, paste entry.json into both files, run the tool.

--like picks one sprite (for example p070frtf) as THE style: its height, colours and outline are used, and it is first in ref.png.
The importer's sprite cell is 24 x 48 and puts the feet at row 44, so no figure can be taller than 44 px: a boss gets 44.
"""
import argparse
import glob
import json
import os
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from newmap_common import Grid, components, STEP, default_repo, read_json, valid_id, write_json  # noqa: E402
from PIL import Image  # noqa: E402

BAND = (28, 40)            # "townsperson" height band, px (the disc's people are 28 to 40, mostly 33 to 35)
MAX_ASPECT = 0.9           # wider than this x height = an animal/Digimon, not a person
FRAME_CAP = 44             # make_quest_sprites puts the feet at row 44 of a 48 px cell
FIRST_ID = 1103
REF_SCALE = 6
PIC_W, PIC_H, FIG_H = 1536, 512, 440
BG_CANDIDATES = [(255, 0, 255), (0, 255, 0), (0, 255, 255), (0, 0, 255), (255, 255, 0), (255, 128, 0), (128, 0, 255), (255, 255, 255)]
ROLES = {
    "townsperson": "an ordinary townsperson who lives on this map: friendly, relaxed standing pose, everyday clothes",
    "trainer": "a trainer who teaches and challenges partners: sporty outfit, a cap or headband, one badge or emblem, confident stance",
    "boss": "a boss: a bigger, broader, more imposing figure than the townspeople (it is drawn the largest size the game's sprite cell allows), "
            "heavier armour, cloak or a striking silhouette, one strong signature colour, stern stance",
}


def fail(msg):
    print("newnpc_export: " + msg, file=sys.stderr)
    sys.exit(2)


def newnpcs_dir():
    return Path(os.environ.get("NEWNPCS_DIR") or (Path.home() / "dw3-newnpcs"))


# ------------------------------------------------------------------ measuring real sprites
def sprite_stats(web, rec):
    """Frame 0 of row 'down' of a manifest sprite record: size of the figure, colours, outline."""
    p = Path(web) / rec["sheet"]
    if not p.exists():
        return None
    im = Image.open(p).convert("RGBA")
    fw, fh = rec["frameW"], rec["frameH"]
    f = im.crop((0, 0, fw, fh))
    a = f.getchannel("A")
    box = a.point(lambda v: 255 if v > 128 else 0).getbbox()
    if not box:
        return None
    px = f.load()
    cols, edge, soft = {}, {}, 0
    for y in range(fh):
        for x in range(fw):
            r, g, b, al = px[x, y]
            if 0 < al < 255:
                soft += 1
            if al <= 128:
                continue
            cols[(r, g, b)] = cols.get((r, g, b), 0) + 1
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= fw or ny >= fh or px[nx, ny][3] <= 128:
                    edge[(r, g, b)] = edge.get((r, g, b), 0) + 1
                    break
    return {"id": rec["id"], "h": box[3] - box[1], "w": box[2] - box[0], "colours": len(cols), "palette": list(cols),
            "edge": edge, "soft": soft, "box": box, "frame": f}


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def hexc(c):
    return "#%02x%02x%02x" % tuple(c[:3])


def pick_background(palette):
    """The flat background colour: the candidate farthest (sum of channel differences) from every colour in `palette`."""
    best = None
    for c in BG_CANDIDATES:
        d = min((abs(c[0] - p[0]) + abs(c[1] - p[1]) + abs(c[2] - p[2]) for p in palette), default=765)
        if best is None or d > best[0]:
            best = (d, c)
    return best[1], best[0]


# ------------------------------------------------------------------ the stand spot (game collision, like newmap_export)
def stand_spot(repo_web, map_id, scene):
    cp = Path(repo_web) / "assets" / "collision" / f"{map_id}.json"
    if not cp.exists():
        fail(f"no collision file for {map_id}: {cp}")
    grid = Grid.from_json(read_json(cp))
    ok = grid.lattice()
    main = components(ok)[0] if ok else set()
    if not main:
        fail(f"{map_id} has no walkable ground")
    avoid = []                                                     # rectangles to stay out of (x0, y0, x1, y1)
    for e in scene.get("exits", []) + scene.get("warps", []):
        if all(k in e for k in ("x", "y", "w", "h")):
            avoid.append((e["x"] - 24, e["y"] - 24, e["x"] + e["w"] + 24, e["y"] + e["h"] + 24))
    for d in scene.get("doors", []):
        avoid.append((d["x"] - 24, d["y1"] - 24, d["x"] + 24, d["y2"] + 24))
    npcs = [(n["x"], n["y"]) for n in scene.get("npcs", []) if n.get("x") or n.get("y")]
    extra = None
    if npcs:
        cx, cy = statistics.median(p[0] for p in npcs), statistics.median(p[1] for p in npcs)
    else:
        cx, cy = grid.cols * grid.cell / 2, grid.rows * grid.cell / 2
    best = None
    for (i, j) in sorted(main):
        x, y = i * STEP, j * STEP
        if x % 8 or y % 8:
            continue
        if any(a[0] <= x <= a[2] and a[1] <= y <= a[3] for a in avoid):
            continue
        if any((x - nx) ** 2 + (y - ny) ** 2 < 48 ** 2 for nx, ny in npcs):
            continue
        # open space around: the ring at 16 px must also be walkable and connected
        if not all(grid.foot_ok(x + dx, y + dy) for dx in (-16, 0, 16) for dy in (-16, 0, 16)):
            continue
        d = (x - cx) ** 2 + (y - cy) ** 2
        if best is None or d < best[0]:
            best = (d, x, y)
    if best is None:
        fail(f"no open walkable spot found on {map_id}")
    return best[1], best[2], (cx, cy)


# ------------------------------------------------------------------ install
def install(folder, repo):
    folder = Path(folder)
    ent_p = folder / "entry.json"
    pic = folder / "views.png"
    if not ent_p.exists():
        fail(f"{ent_p} not found (run the export first)")
    if not pic.exists():
        fail(f"{pic} not found: save Gemini's picture there as views.png")
    entry = read_json(ent_p)
    nid, slug = int(entry["npc_id"]), folder.name
    srcs = [repo / "data" / "authored" / "quests" / "new_characters.json", repo / "quests" / "new_characters.json"]
    old = {}
    for s in srcs:
        if s.exists():
            old[s] = s.read_text(encoding="utf-8")
            if any(int(c["npc_id"]) == nid for c in json.loads(old[s])["characters"]):
                fail(f"npc_id {nid} is already in {s}")
    if not old:
        fail("no new_characters.json found in the repo")
    sys.path.insert(0, str(repo / "tools"))
    import make_quest_sprites as mq  # the repo's own importer
    try:
        figs = mq.views_from_picture(str(pic), entry.get("height", 34), entry.get("flip_side", False), entry.get("aspect", 0.6))
    except ValueError as e:
        fail(str(e))
    art_rel = entry["views"]
    art = repo / art_rel
    art.parent.mkdir(parents=True, exist_ok=True)
    had_art = art.exists()
    shutil.copyfile(pic, art)
    try:
        for s, text in old.items():
            data = json.loads(text)
            data["characters"].append(entry)
            s.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        r = subprocess.run([sys.executable, str(repo / "tools" / "make_quest_sprites.py")], cwd=str(repo), capture_output=True, text=True)
        sys.stdout.write(r.stdout)
        if r.returncode != 0:
            sys.stderr.write(r.stderr)
            raise RuntimeError("make_quest_sprites.py failed")
    except Exception as e:
        for s, text in old.items():
            s.write_text(text, encoding="utf-8", newline="\n")
        if not had_art:
            art.unlink(missing_ok=True)
        fail(f"{e}; the json files are back as they were")
    print(f"installed npc {nid} ({entry['name']}): {len(figs)} view(s) used, sprite web/extra_sprites/q{nid}.png, "
          f"stands on {entry['residents'][0]['map']} at {entry['residents'][0]['x']},{entry['residents'][0]['y']}")
    return 0


# ------------------------------------------------------------------ export
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map", nargs="?")
    ap.add_argument("--like", default=None)
    ap.add_argument("--role", default="townsperson", choices=list(ROLES))
    ap.add_argument("--name", default=None)
    ap.add_argument("--desc", default=None, help="one line about the character's looks; goes into the prompt")
    ap.add_argument("--id", type=int, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--repo", default=str(default_repo()))
    ap.add_argument("--install", default=None, metavar="FOLDER")
    a = ap.parse_args()
    repo = Path(a.repo)
    if a.install:
        return install(a.install, repo)
    if not a.map:
        fail("give a map id (or --install <folder>)")
    web = repo / "web"
    man = read_json(web / "assets" / "manifest.json")
    maps = {m["id"]: m for m in man["maps"]}
    if a.map not in maps:
        fail(f"map {a.map!r} is not in web/assets/manifest.json")
    recs = {n["id"]: n for n in man.get("npcs", []) + man.get("characters", [])}
    scene_p = web / "assets" / "scenes" / f"{a.map}.json"
    scene = read_json(scene_p) if scene_p.exists() else {}

    # every sprite of the game, measured once (frame 0, row down)
    stats = {}
    for sid, rec in recs.items():
        s = sprite_stats(web, rec)
        if s:
            stats[sid] = s
    if not stats:
        fail("no sprite sheets found under web/assets/sprites")
    field = set()                                                  # sprites that really stand on a map as NPCs
    for f in glob.glob(str(web / "assets" / "scenes" / "*.json")):
        field |= {n.get("sprite") for n in read_json(f).get("npcs", [])}
    people = {k: s for k, s in stats.items() if k in field and BAND[0] <= s["h"] <= BAND[1] and s["w"] <= MAX_ASPECT * s["h"]}
    on_map = [k for k in dict.fromkeys(n.get("sprite") for n in scene.get("npcs", [])) if k in stats]
    map_people = [k for k in on_map if k in people]
    if a.like:
        if a.like not in stats:
            fail(f"--like {a.like!r}: no such sprite with a sheet in the manifest")
        basis = [a.like]
        basis_note = f"--like {a.like}"
    elif len(map_people) >= 3:
        basis, basis_note = map_people, f"{len(map_people)} townspeople sprites on {a.map}"
    else:
        basis = list(people)
        basis_note = (f"all {len(people)} townspeople sprites of the game ({a.map} has only {len(map_people)}; "
                      f"on this map they measure {sorted(stats[k]['h'] for k in map_people)})")
    h_med = round(statistics.median(stats[k]["h"] for k in basis))
    w_med = round(statistics.median(stats[k]["w"] for k in basis))
    ncol = round(statistics.median(stats[k]["colours"] for k in basis))
    edge_all = {}
    for k in basis:
        for c, n in stats[k]["edge"].items():
            edge_all[c] = edge_all.get(c, 0) + n
    tot = sum(edge_all.values()) or 1
    outline = max(edge_all, key=edge_all.get)
    dark_share = sum(n for c, n in edge_all.items() if luma(c) < 80) / tot
    soft = sum(stats[k]["soft"] for k in basis)
    tall = [k for k, s in stats.items() if s["h"] >= FRAME_CAP]
    height = h_med if a.role != "boss" else FRAME_CAP
    w_game = min(21, round(w_med * height / h_med))                # same shape scaled to the height; the importer squeezes to at most 21 px wide
    aspect = w_game / height
    # background: far from every colour of every sprite we show or measure
    ref_ids = ([a.like] if a.like else []) + [k for k in sorted(basis, key=lambda k: (abs(stats[k]["h"] - h_med), k)) if k != a.like]
    if len(ref_ids) < 3:                                           # top up from the whole game's people, nearest height first
        ref_ids += [k for k in sorted(people, key=lambda k: (abs(stats[k]["h"] - h_med), k)) if k not in ref_ids][:4 - len(ref_ids)]
    ref_ids = ref_ids[:4]
    if a.role == "boss":                                           # a boss reference also shows the biggest fitting people
        big = [k for k in sorted(stats, key=lambda k: (-stats[k]["h"], k)) if stats[k]["h"] <= FRAME_CAP and k in field]
        ref_ids = ref_ids[:2] + big[:2]
    pal = {c for k in set(basis) | set(ref_ids) for c in stats[k]["palette"]}
    bg, bg_dist = pick_background(pal)

    # id, slug, folder
    out_root = Path(a.out) if a.out else newnpcs_dir()
    taken = set()
    for s in (repo / "data" / "authored" / "quests" / "new_characters.json", repo / "quests" / "new_characters.json"):
        if s.exists():
            taken |= {int(c["npc_id"]) for c in read_json(s)["characters"]}
    ch_p = repo / "quests" / "characters.json"
    if ch_p.exists():
        taken |= {int(k) for k in read_json(ch_p).get("by_npc_id", {}) if str(k).isdigit()}
    if out_root.is_dir() and not a.out:
        for p in out_root.glob("*/entry.json"):
            try:
                taken.add(int(read_json(p)["npc_id"]))
            except Exception:
                pass
    nid = a.id
    if nid is None:
        nid = FIRST_ID
        while nid in taken:
            nid += 1
    elif nid < FIRST_ID and nid < 1000:
        fail("--id must be 1000 or more")
    elif nid in taken:
        fail(f"npc_id {nid} is already used")
    name = a.name or {"townsperson": "New Townsperson", "trainer": "New Trainer", "boss": "New Boss"}[a.role]
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-") or "npc"
    slug = f"{slug}-{nid}"
    if not valid_id(slug):
        fail("bad name for a folder")
    folder = out_root if a.out else out_root / slug
    if folder.exists() and any(folder.iterdir()):
        fail(f"{folder} already has files; remove it or pick another --id")
    folder.mkdir(parents=True, exist_ok=True)

    sx, sy, centre = stand_spot(web, a.map, scene)

    # ref.png: real sprites, enlarged with hard pixels, on the flat background colour
    cells = []
    for k in ref_ids:
        s = stats[k]
        c = s["frame"].crop(s["box"])
        cells.append(c.resize((c.width * REF_SCALE, c.height * REF_SCALE), Image.NEAREST))
    gap = 4 * REF_SCALE
    sheet = Image.new("RGBA", (sum(c.width for c in cells) + gap * (len(cells) + 1), max(c.height for c in cells) + 2 * gap), bg + (255,))
    x = gap
    for c in cells:
        sheet.alpha_composite(c, (x, sheet.height - gap - c.height))
        x += c.width + gap
    sheet.convert("RGB").save(folder / "ref.png")

    scale = FIG_H / height
    outline_px = max(4, round(scale))
    fig_w = round(FIG_H * aspect)
    prompt = f"""Make ONE picture of a new character for a classic 2D role-playing game. Picture size exactly {PIC_W} x {PIC_H} pixels.
Style: copy the attached reference (ref.png), which shows real characters of the same game enlarged {REF_SCALE} times: chunky, short, round
proportions (the game's figures measure {w_med} px wide for {h_med} px tall; this one gets {w_game} px wide for {height} px tall,
width about {round(aspect * 100)} percent of height), big simple shapes, tiny details.
It will be shrunk about {round(scale)} times to {height} px tall, so only big clear shapes survive: no fine detail, no thin lines, no small text.

CHARACTER: {name}. {ROLES[a.role][0].upper() + ROLES[a.role][1:]}.{(" " + a.desc.strip()) if a.desc else ""}

LAYOUT: exactly 3 full-body figures of the SAME character in one horizontal row, left to right:
  1. FRONT view (facing the camera)  2. SIDE view (facing RIGHT)  3. BACK view (facing away).
All three exactly the same size and design, about {FIG_H} px tall (head to feet, nothing cut off), about {fig_w} px wide, feet on the same
horizontal line near the bottom, standing still, arms down. Leave at least 120 px of empty background between figures: they must not touch or overlap.
No other figure, no object floating around, no text, no labels, no border, no frame, no shadow on the floor, no floor.

BACKGROUND: one single flat solid colour {hexc(bg)} (RGB {bg[0]}, {bg[1]}, {bg[2]}) over the whole picture, no gradient, no texture, no noise.
That colour is not used anywhere on the character, not even a little.

COLOURS AND LINES (measured from the game's own {basis_note}): about {ncol} colours for the whole figure, flat fills, each material
has a base tone and one darker shade, no gradients, no glow, no soft airbrushed shading, no anti-aliased blur: crisp hard pixel-art edges.
A dark outline around the whole figure in {hexc(outline)} (a dark near-black; {round(dark_share * 100)} percent of the game's edge pixels are dark),
about {outline_px} px thick in this picture (1 px at game size).

Same lighting for all three figures: from the top left. Return one image only."""
    (folder / "prompt.txt").write_text(prompt + "\n", encoding="utf-8")

    rel_art = f"data/authored/quests/art/{slug}.png"
    entry = {"npc_id": nid, "name": name, "views": rel_art, "height": height,
             "residents": [{"map": a.map, "x": sx, "y": sy, "dir": "down"}]}
    write_json(folder / "entry.json", entry)
    measured = {"map": a.map, "role": a.role, "basis": basis_note, "basis_sprites": basis, "ref_sprites": ref_ids,
                "median_height": h_med, "median_width": w_med, "aspect": round(aspect, 3), "colours_median": ncol,
                "outline": hexc(outline), "outline_dark_share": round(dark_share, 3), "soft_alpha_pixels": soft,
                "height_used": height, "frame_cap": FRAME_CAP, "game_sprites_at_or_over_cap": len(tall),
                "background": hexc(bg), "background_min_distance_to_palette": bg_dist,
                "spot": {"x": sx, "y": sy, "npc_centre": [centre[0], centre[1]]}}
    write_json(folder / "measured.json", measured)
    print(f"new {a.role} npc {nid} '{name}' for {a.map}; folder {folder}")
    print(f"  measured from {basis_note}: height {h_med} (used {height}), width {w_med}, colours {ncol}, outline {hexc(outline)}, "
          f"background {hexc(bg)} (distance {bg_dist} from the palette)")
    print(f"  stands at {sx},{sy} (walkable); next: Gemini <- prompt.txt + ref.png; save views.png in the folder; "
          f"python3 tools/newnpc_export.py --install {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
