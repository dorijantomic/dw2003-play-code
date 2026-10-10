#!/usr/bin/env python3
"""Extract data-only tables for translated language and item-shop screens.

Source ranges: cnty_sel-full-decode-2026-08-05.md byte map and the registered
cnty-draw/decor/palette/root translations. No executable bytes are emitted.
"""
import argparse
import json
import struct
from pathlib import Path
from build_native_screens import (
    DEFAULT_DISC, SCREEN_BASE, LBA_OFFSETS, LBA_LEN_SECTORS,
    load_exe, read_overlay, read_sectors, sha256,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_BASE = 0x800843C0
DATA_END = 0x8008442B
# Every bank read by the translated shop root, list and detail-panel providers:
# item descriptions, item names, shop prompts and merchant names respectively.
SHOP_BANKS = ((0x63, 403, "item-descriptions"), (0x6a, 403, "item-names"),
              (0x71, 43, "shop-prompts"), (0x94, 68, "merchant-names"))
# The card album (pro/stcrdabm) reads three indexed text families, each
# language + a fixed offset: the card-name run (+0x16, 317 = every card name),
# the card-text/effect run (+0x1D, 242) and the album's own nine-string chrome
# bank (+0x24: "Card Album", "[triangle] Button: Back", "L1", "R1", "/", "AP",
# "HP", "X"). The album's own preload F0x800856A8 also requests the five
# CARDPAK record files (file-table ids 0x7F6..0x7FA, 64 records of 1580 bytes
# each); those records are already extracted to web/assets/data/card_catalog.json
# by tools/extract_card_catalog.py, so only their five ids are recorded here.
ALBUM_BANKS = ((0x16, 317, "card-names"), (0x1d, 242, "card-text"), (0x24, 9, "album-text"))
ALBUM_RECORD_FILE_IDS = (0x7f6, 0x7f7, 0x7f8, 0x7f9, 0x7fa)
# The inn screen's eshtlnam family: language + 0x5C, read by resident F0x800110E0.
INN_BANKS = ((0x5c, 22, "inn-names"),)
# The stage-entry location title card (pro/fieldstg F0x800875AC): the area-name family
# (language + 0xA9, esstarea) and the place-name family (language + 0xB7, esstname), plus
# the two fieldstg data tables the card reads: the {u8 area, u8 place, s16 scene} name
# table (zero-scene terminated) and the ten 0x24-byte bar templates.
PLACE_BANKS = ((0xA9, 22, "area-names"), (0xB7, 136, "place-names"))
FIELDSTG_INDEX = 358             # LBA_FIELDSTG_PRO_IDX, ~/ddw3/rust/dw2003_exe_data/src/lba.rs
FIELDSTG_BASE = 0x80082CB0
PLACE_NAME_TABLE = 0x80097098
PLACE_BAR_TEMPLATES = (0x80097458, 10 * 0x24)
SHOP_RECORDS_ADDR = 0x8008D0B4
SHOP_RECORD_COUNT = 31
ITEM_DIRECTORY_TABLE = 0x80042BC8
ITEM_RECORD_BASE = 0x80041838
ITEM_RECORD_COUNT = 403
ITEM_RECORD_STRIDE = 12
ITEM_ICON_CLIPS = 0x80042BA8
SHOP_NAMES_ADDR = 0x8008CB40
SHOP_FONT_BASE = 0x8004DD74
SHOP_FONT_END = 0x80051206
SHOP_UI_TABLE_BASE = 0x8008CAA8
SHOP_UI_TABLE_END = SHOP_NAMES_ADDR
SHOP_DESCRIPTOR_RANGES = ((0x80040244, 0x8004151C, "shop_descriptors_main.bin"),
                          (0x8005CB54, 0x8005CCB0, "shop_descriptors_extra.bin"))
# The naming screen: its text banks (partner names, chrome text) in seven
# languages, and the overlay's data tail that follows the last routine.
NAME_BANKS = ((0x40, 4, "partner-names"), (0x86, 19, "chrome-text"))
NAME_TABLES_BASE = 0x80086830   # the byte after the last routine (a bare return)
# The registration wizard: its text banks (Digimon names, wizard text, keyboard
# chrome text), the overlay's data tail after the last routine, and the resident
# starter-pack membership table its commit reads.
WIZARD_BANKS = ((0x4E, 251, "digimon-names"), (0x8D, 31, "wizard-text"), (0x86, 19, "chrome-text"))
WIZARD_TABLES_BASE = 0x800885E4   # the byte after the last routine (tweenLinearTick)
STARTER_MEMBERS_ADDR = 0x8004B490
STARTER_MEMBERS = [0, 6, 7, 2, 3, 6, 1, 5, 7]
# The pause pages (pro/ststatus): the overlay's data tail after its last routine, the
# four text families no other screen carries (the other three reuse the shop's item
# names and descriptions and the wizard's Digimon names), and the resident tables the
# pages read (partner profiles, technique records, signature sets and bonuses).
PAUSE_TABLES_BASE = 0x8009A784   # the byte after the last routine's `jr $ra; addiu $sp`
PAUSE_TABLES_END = 0x8009BCB0    # the end of the overlay image
PAUSE_BANKS = ((0xB0, "pause-text"), (0x47, "pause-labels"), (0xA2, "technique-names"), (0x9B, "technique-info"),
               (0x08, "map-zone-names"), (0x01, "map-zone-names-b"))
PAUSE_SHARED_BANKS = ((0x6A, "shop-banks", "item-names"), (0x63, "shop-banks", "item-descriptions"),
                      (0x4E, "wizard", "digimon-names"))
PAUSE_TECHNIQUES = (0x80042BDC, 0x12)          # base, stride; the count is the name bank's
# The Digimon profile table: ONE disc table, in the exe's own image, that every screen
# showing a Digimon reads - the pause pages (pro/ststatus), the fight report and the
# battle tag list (pro/stfgtrep), the training gym (pro/stgtrain), the Digimon lab
# (pro/stgdglab), and the battle command list's DNA pane and Digivolve form list
# (pro/fightstg). It is cut ONCE to assets/data/digimon_profiles.bin and every screen
# loads that one file through web/resident-data.js `loadProfileRecords`; no screen's own
# data file carries a copy of it.
#   base, stride, rows. The DNA pane (fightstg.s:22012-22022) and the Digivolve form
#   list (F0x80094478, fightstg.s:18056-18066) each index it as
#   0x8003EF5C + 0x58*id with no bound at all, and 0x8003EF5C + 55*0x58 = 0x80040244,
#   exactly where the shop descriptor table starts, so 55 rows is the whole table.
#   The LOOKUP is narrower: the species getter F0x800134AC stops at
#   `slti $v0, cur_idx, 0x34` (exe/f1.s:26), 52 records. That scan bound belongs to the
#   reader (engine/dw3/ui/native/pause-status.ts PROFILE_SCAN_ROWS), never to the data:
#   a data file cut at the getter's 52 rows hides the last three forms from every
#   screen, which is what the per-screen copies did.
PROFILE_TABLE = (0x8003EF5C, 0x58, 0x37)
PROFILE_SCAN_ROWS = 0x34
# What each screen manifest records about the table it reads out of the shared cut.
SHARED_PROFILES = {"path": "digimon_profiles.bin", "base": PROFILE_TABLE[0], "stride": PROFILE_TABLE[1],
                   "rows": PROFILE_TABLE[2], "scanRows": PROFILE_SCAN_ROWS, "source": "exe",
                   "loader": "web/resident-data.js loadProfileRecords",
                   "note": "the one cut of the table, relative to assets/data/"}
PAUSE_SIGNATURES = (0x8004B53C, 0xA0)          # set table (8 per slot) then bonus table (12 per slot)

# The battle command list (pro/fightstg, loaded at 0x80082CB0): its menu config
# (count, blit x, blit row origin, blit row step, row cel, row x, row y, row step;
# F0x8009B0C8 copies these eight words), the blit's source rectangle, the command
# names in seven languages, and the 12x12 marker strip the battle loader uploads to
# VRAM (0, 0xF4): PGFGTW00 (disc index 0x456) entry 0, a 16bpp 156x12 image
# (wfightmn.s L0x0000020c-0x00000260: entry 1 at (0x200, 0), entry 0 at (0, 0xF4)).
FIGHT_BASE = 0x80082CB0
FIGHT_CONFIG = (0x800A34CC, 32)
# The joke list the confused Digimon is shown (FIGHTSTG_F0x8009AB74/0x8009A898,
# sequencer sub-state 3, fightstg.s:16358-:16395): its owner hands the SAME shared
# list factory F0x8009B0C8 its own eight-word config at .L0x8009a8e4-:e8c
# (fightstg.s:24619-24620), which is why the joke rows sit and pulse exactly where
# the command rows do. The block sits immediately before the blit rectangle.
FIGHT_JOKE_CONFIG = (0x800A3634, 32)
FIGHT_BLIT_RECT = (0x800A3654, 8)
FIGHT_TECH_CONFIG = (0x800A3554, 32)
FIGHT_TAG_CONFIG = (0x800A3574, 32)
# The Digivolve form list (F0x80094478 state 0, fightstg.s:18080-18083) hands its
# own eight-word config to the shared list factory F0x8009B0C8, and the form panel's
# page-zero number loop (F0x80094AD0, fightstg.s:18461) walks the 13 three-byte rows
# at 0x800A350C: x, y, and the halfword slot each printed number comes from.
FIGHT_FORM_CONFIG = (0x800A34EC, 32)
FIGHT_FORM_PANEL_TABLE = (0x800A350C, 40)
# The DNA pane (F0x800980E4) carries its own three data blocks: the species strip's
# eight-word config at 0x800A3594 and the option list's at 0x800A35B4 (fightstg.s:33969-
# :33984, each handed to the same shared list factory F0x8009B0C8), then the four MP-plate
# x anchors at 0x800A35D4 (fightstg.s:33985-33988). The block ends at 0x800A35E4,
# where the overlay's next data word begins, so 0x50 bytes is all of it.
FIGHT_DNA_TABLES = (0x800A3594, 0x50)
FIGHT_DNA_CONFIG_STRIP = (4, 0xA8, 0x93, 0x13, 0x24, 0xA7, 0x92, 0x13)
FIGHT_DNA_CONFIG_OPTIONS = (2, 0xA8, 0xA6, 0x13, 0x22, 0xA7, 0xA5, 0x13)
FIGHT_DNA_MP_XS = (172, 216, 217, 251)
# The DNA pane and the Digivolve form list index the shared Digimon profile table with
# no bound at all, so PROFILE_TABLE above is theirs as much as the pause pages'.
# F0x80095E40 reads the row icon out of the exe's technique table: 18 bytes per
# technique, the cel selector at +4, drawn as that byte + 0x37.
FIGHT_ICON_TABLE = (0x80042BDC, 0x12, 512)
FIGHT_BANK = 0x7F
# The battle boot loader waits on 0x7F, 0x4E, 0xA2, 0x9B, 0x6A and 0x63 (wfightmn);
# the TECH list reads 0x7F (UI words), 0x9B (technique descriptions) and 0xA2 (names);
# the form list's row names come from 0x4E (the Digimon-name bank, the byte at
# species record +0x55).
FIGHT_BANK_OFFSETS = (0x4E, 0x7F, 0x9B, 0xA2)
# Resource 0x1CF: the enemy stat records. pro/fieldstg loads it at battle setup with
# `li $a0, 0x1cf` into the resident loader `[0x80044b38+0x40c]` (fieldstg.s:7540-754c),
# and FIGHTSTG_F0x8009b8d0 loads the same id at fightstg.s:25682-25683. The resolver's stride
# is 70 bytes (fightstg.s:25708-25718) and its scan (F0x8009b864) ends at the first
# record whose `+0x00` halfword is zero, so the count comes out of the data.
ENEMY_STATS_RESOURCE = 0x1CF
ENEMY_STATS_STRIDE = 0x46
# Every field below has a reader in ~/ddw3/asm/dw2003/pro/fightstg.s. The line numbers
# are that file's own; each entry is what the load is used for, read at the call site.
ENEMY_STATS_FIELDS = (
    {"name": "id", "offset": 0, "size": 2, "type": "s16", "decoded": True,
     "reader": "FIGHTSTG_F0x8009b864 lh $v0, ($v1) (fightstg.s:25655) is the word the "
               "linear scan matches against the enemy id; a zero ends the scan (:25657)"},
    {"name": "field04", "offset": 4, "size": 2, "type": "s16", "decoded": True,
     "reader": "lh $v0, 0x4($v0) (:31667), multiplied by two running totals and divided "
               "by the magic constant 0x68db8bad built at :31675-31676"},
    {"name": "nameId", "offset": 6, "size": 2, "type": "s16", "decoded": True,
     "reader": "FIGHTSTG_F0x80093364 lh $a2, 0x6($s0) (:16980) installs the plate's enemy "
               "name as element+0x114(bank 0x4e, id); the same read at :6207, :22825 and "
               ":23176 puts the name on the message line"},
    {"name": "attack", "offset": 8, "size": 2, "type": "s16", "decoded": True,
     "reader": "lh $v0, 0x8($v0) at :10190, :12540, :14578, :14587 and :28455; :10190 "
               "stores it into the AI state command's parameter at +0x54"},
    {"name": "tech1", "offset": 10, "size": 2, "type": "s16", "decoded": True,
     "reader": "FIGHTSTG_F0x80089148 lh $s1, 0xa($a0) (:6306), the first case of the "
               "eight-way jump table at 0x80082da8 that picks a technique; read again at "
               ":14372"},
    {"name": "tech2", "offset": 12, "size": 2, "type": "s16", "decoded": True,
     "reader": "FIGHTSTG_F0x80089148 lh $s1, 0xc($a0) (:6309), the second case of that "
               "jump table; read again at :14555"},
    {"name": "strength", "offset": 14, "size": 2, "type": "s16", "decoded": True,
     "reader": "lh $v1, 0xe($a2) (:29725), multiplied by the descriptor's own scale at "
               "0x80042b1c+slot*0xc+0x22 and shifted down by 4 — enemies.json's `str` "
               "matches this offset in all 193 records"},
    {"name": "defence", "offset": 16, "size": 2, "type": "s16", "decoded": True,
     "reader": "lh $v1, 0x10($v0) (:27304), negated, halved and stored into the active "
               "enemy's state; enemies.json's `def` matches this offset in all 193 records"},
    {"name": "spirit", "offset": 18, "size": 2, "type": "s16", "decoded": True,
     "reader": "lh $v0, 0x12($v0) (:27309), the same halving for the second of that pair; "
               "enemies.json's `spt` matches this offset in all 193 records"},
    {"name": "wisdom", "offset": 20, "size": 2, "type": "s16", "decoded": False,
     "reader": "no reader found in pro/fightstg.s in this pass; enemies.json's `wis` "
               "matches this offset in all 193 records, so the field is real and read "
               "elsewhere"},
    {"name": "speed", "offset": 22, "size": 2, "type": "s16", "decoded": False,
     "reader": "no reader found in pro/fightstg.s in this pass; enemies.json's `spd` "
               "matches this offset in all 193 records"},
    {"name": "resistances", "offset": 24, "size": 14, "type": "7 x s16 (fire, water, ice, "
                                                            "wind, thunder, machine, dark)",
     "decoded": False,
     "reader": "no reader found in pro/fightstg.s in this pass; enemies.json's "
               "`resistances` matches these seven offsets in all 193 records"},
    {"name": "statusResist", "offset": 38, "size": 10, "type": "5 x s16 (poison, paralyze, "
                                                            "confuse, sleep, ko)",
     "decoded": False,
     "reader": "no reader found in pro/fightstg.s in this pass; enemies.json's "
               "`status_resist` matches these five offsets in all 193 records"},
    {"name": "aiMoves", "offset": 50, "size": 12,
     "type": "3 x {u8 action, u8 comparator, s16 value}", "decoded": True,
     "reader": "the AI walk at :6045-6046 and :6057 reads +0x32+4i as the action passed to "
               "FIGHTSTG_F0x80089148, +0x33+4i as the condition passed to "
               "FIGHTSTG_check_move_cond, and +0x34+4i as that call's value"},
    {"name": "counter", "offset": 66, "size": 4, "type": "{u8 action, u8 comparator, s16 value}",
     "decoded": True,
     "reader": ":12512/:12516 read +0x43 as the counter's condition and :12517 +0x44 as "
               "its value, then :12522 reads +0x42 as the action"},
)
FIGHT_STRIP_PACK = 0x456
FIGHT_STRIP_VRAM = (0, 0xF4)
# The battle boot loader (pro/wfightmn, loaded at 0x800A5DE0): its manifest root
# F0x800A6414 builds the 0x54 loader task F0x800A5ECC. The task asks the resident
# cache for the five scene packs (wfightmn.s L0x0000017c-L0x000001cc), uploads
# them to VRAM (L0x000001d0-L0x00000394), releases them (L0x000003fc) and then
# asks for eight text banks (L0x00000470-L0x00000514) and waits for them.
# Only the five packs' bytes are shipped, because the loader reads them: their
# records are uploaded to VRAM. The text banks are asked for and awaited but
# never read by the loader, so only their sector counts (the cache sizes the
# buffer from them) are recorded.
WFIGHT_PACKS = ((0x456, "menu-pack-pgfgtw00"), (0x79E, "common-atlas-1"), (0x7AE, "common-atlas-2"),
                (0x7E1, "common-atlas-3"), (0x7E3, "common-atlas-4"))
WFIGHT_DIRECT_BANKS = ((0x286, "direct-bank-a"), (0x455, "direct-bank-b-pgfgtc00"))
WFIGHT_LANGUAGE_FAMILIES = ((0x7F, "battle-text"), (0x4E, "digimon-names"), (0xA2, "technique-names"),
                            (0x9B, "technique-info"), (0x6A, "item-names"), (0x63, "item-descriptions"))
# The fight report (pro/stfgtrep, loaded at 0x80082CB0): its own text bank (0x55 + language),
# the overlay's data tail after the last routine F0x80086924 (reward table 0x80086A88, the
# evolution/technique requirement groups, the icon-frame runs, the level-up stat tables) and
# the resident tables the reward services read (the species records) plus the text engine's
# wait-for-button table. The twelve function-pointer slots at 0x8008913C..0x80089168 are
# code addresses, so they are zeroed: the ports bind those slots by name, not by pointer.
REPORT_BASE = 0x80082CB0
REPORT_TABLES_BASE = 0x80086A88
REPORT_BANK = 0x55
REPORT_SLOTS = (0x8008913C, 0x8008916C)
REPORT_SHARED_BANKS = ((0x4E, "wizard", "digimon-names"), (0x6A, "shop-banks", "item-names"),
                       (0xA2, "pause", "technique-names"))
# The text engine's wait-for-button table: logical button ids by wait operand.
TEXT_BUTTONS_ADDR = 0x8004DCCC
TEXT_BUTTONS_LEN = 20
SHOP_CURSOR_TABLE = 0x8004DCE0
SHOP_CURSOR_STRINGS = 0x8005CCD0


def extract(disc: Path) -> dict:
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/cnty_sel")
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
    tables = overlay[DATA_BASE - SCREEN_BASE:DATA_END - SCREEN_BASE]
    if len(tables) != 107:
        raise ValueError("Language-screen table block is truncated")
    # The production boot default is data too, not a synthesized instruction.
    initial_language = struct.unpack_from("<I", resident, 0x8005CCA8 - base)[0]
    return {
        "schema": 1,
        "module": "pro/cnty_sel",
        "dataBase": DATA_BASE,
        "bytes": list(tables),
        "initialLanguage": initial_language,
        "source": {"discIndex": entry["disc_index"], "overlaySha256": sha256(overlay),
                   "residentSha256": sha256(resident), "dataSha256": sha256(tables)},
    }


def extract_shop_banks(disc: Path, out_dir: Path, families=SHOP_BANKS) -> None:
    """Copy the indexed text families (default: the four shop ones) in all seven languages."""
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        for offset, expected_count, role in families:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"shop bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                if len(data) != sectors * 2048:
                    raise ValueError(f"shop bank {bank_id} is truncated")
                count = struct.unpack_from("<I", data)[0]
                if count != expected_count or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"shop bank {bank_id} is not the expected {role} table")
                offsets = [struct.unpack_from("<I", data, 4 + i * 4)[0] for i in range(count)]
                if offsets != sorted(offsets) or any(off >= len(data) or data.find(b"\0", off) < 0 for off in offsets):
                    raise ValueError(f"shop bank {bank_id} has invalid string offsets")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                entries.append({"id": bank_id, "language": language, "role": role,
                                "file": f"{bank_id}.bin", "count": count,
                                "size": len(data), "sha256": sha256(data),
                                "discLba": lba, "discSectors": sectors})
    (out_dir / "manifest.json").write_text(json.dumps({"schema": 1, "banks": entries}, indent=2) + "\n")


def extract_album_data(disc: Path, out_dir: Path) -> None:
    """Copy the album's three text families and record its five CARDPAK ids.

    The chrome pack (handle 0x06050000, STALBMCS/TM) and the five record files
    (handles 0x7F6..0x7FA) are already data: the pack by
    tools/extract_screen_packs.py (`stalbm`) and the records by
    tools/extract_card_catalog.py (card_catalog.json + the icon atlas). This
    extractor carries the album's own indexed text banks, which nothing else
    reads, and states the record ids the preload requests. Data only: no
    executable byte is written.
    """
    extract_shop_banks(disc, out_dir / "banks", ALBUM_BANKS)
    (out_dir / "manifest.json").write_text(json.dumps({
        "schema": 1,
        "chromePack": {"handle": 0x06050000, "screenPack": "stalbm",
                       "source": "tools/extract_screen_packs.py"},
        "recordFiles": {"ids": list(ALBUM_RECORD_FILE_IDS), "stride": 1580,
                        "source": "tools/extract_card_catalog.py (card_catalog.json)"},
        "banksDir": "banks",
    }, indent=2) + "\n")


def extract_place_card_data(disc: Path, out_dir: Path) -> None:
    """Copy the location card's two text families and its fieldstg name and bar tables."""
    extract_shop_banks(disc, out_dir, PLACE_BANKS)
    manifest = json.loads((out_dir / "manifest.json").read_text())
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, FIELDSTG_INDEX)
    start = PLACE_NAME_TABLE - FIELDSTG_BASE
    end = start
    while struct.unpack_from("<h", overlay, end + 2)[0] != 0:
        end += 4
    names = overlay[start:end + 4]
    counts = {role: count for _, count, role in PLACE_BANKS}
    for i in range(0, len(names) - 4, 4):
        if names[i] >= counts["area-names"] or names[i + 1] >= counts["place-names"]:
            raise ValueError(f"place name record {i // 4} indexes past its bank")
    bars = overlay[PLACE_BAR_TEMPLATES[0] - FIELDSTG_BASE:][:PLACE_BAR_TEMPLATES[1]]
    if len(bars) != PLACE_BAR_TEMPLATES[1]:
        raise ValueError("place card bar templates are truncated")
    tables = []
    for name, address, data in (("name-table.bin", PLACE_NAME_TABLE, names),
                                ("bar-templates.bin", PLACE_BAR_TEMPLATES[0], bars)):
        (out_dir / name).write_bytes(data)
        tables.append({"file": name, "address": address, "size": len(data), "sha256": sha256(data)})
    manifest["tables"] = tables
    manifest["records"] = len(names) // 4 - 1
    manifest["source"] = {"discIndex": FIELDSTG_INDEX, "overlaySha256": sha256(overlay)}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def extract_name_data(disc: Path, out_dir: Path) -> None:
    """Copy the naming screen's text banks and overlay data tables as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stdgname")
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for offset, expected_count, role in NAME_BANKS:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"naming bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                count = struct.unpack_from("<I", data)[0]
                if count != expected_count or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"naming bank {bank_id} is not the expected {role} table")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                entries.append({"id": bank_id, "language": language, "role": role,
                                "file": f"{bank_id}.bin", "count": count, "size": len(data),
                                "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
    start = NAME_TABLES_BASE - SCREEN_BASE
    tables = overlay[start:]
    if len(tables) != 0x2C80 or struct.unpack_from("<II", overlay, start - 8) != (0x03E00008, 0):
        raise ValueError("naming data tail does not follow the last routine")
    (out_dir / "tables.bin").write_bytes(tables)
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stdgname", "tablesBase": NAME_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tables), "sha256": sha256(tables)},
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_wizard_data(disc: Path, out_dir: Path) -> None:
    """Copy the registration wizard's text banks, overlay data tail and member table."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stplnmet")
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for offset, expected_count, role in WIZARD_BANKS:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"wizard bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                count = struct.unpack_from("<I", data)[0]
                if count != expected_count or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"wizard bank {bank_id} is not the expected {role} table")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                entries.append({"id": bank_id, "language": language, "role": role,
                                "file": f"{bank_id}.bin", "count": count, "size": len(data),
                                "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        members = list(resident[STARTER_MEMBERS_ADDR - base:STARTER_MEMBERS_ADDR - base + 9])
        cursor_table = resident[SHOP_CURSOR_TABLE - base:SHOP_CURSOR_TABLE - base + 20]
        cursor_strings = resident[SHOP_CURSOR_STRINGS - base:SHOP_CURSOR_STRINGS - base + 16]
        text_buttons = list(resident[TEXT_BUTTONS_ADDR - base:TEXT_BUTTONS_ADDR - base + TEXT_BUTTONS_LEN])
    if text_buttons != [0xd, 0, 0, 0, 0xc, 0, 0, 0, 0xd, 0, 0, 0, 0xe, 0, 0, 0, 0xf, 0, 0, 0]:
        raise ValueError("text wait-button table is not the expected logical ids")
    cursor_ptrs = struct.unpack("<5I", cursor_table)
    if (len(cursor_strings) != 16 or
            sorted(set(cursor_ptrs)) != [SHOP_CURSOR_STRINGS + i * 4 for i in range(4)]):
        raise ValueError("cursor glyph table is not the expected string set")
    if members != STARTER_MEMBERS:
        raise ValueError("starter-pack membership table is not the expected {0,6,7},{2,3,6},{1,5,7}")
    start = WIZARD_TABLES_BASE - SCREEN_BASE
    tables = overlay[start:]
    if len(tables) != 0x16CC or struct.unpack_from("<II", overlay, start - 8) != (0x03E00008, 0):
        raise ValueError("wizard data tail does not follow the last routine")
    (out_dir / "tables.bin").write_bytes(tables)
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stplnmet", "tablesBase": WIZARD_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tables), "sha256": sha256(tables)},
         "starterMembers": {"address": STARTER_MEMBERS_ADDR, "bytes": members},
         "cursorGlyphs": {"tableBase": SHOP_CURSOR_TABLE, "tableBytes": list(cursor_table),
                          "stringsBase": SHOP_CURSOR_STRINGS, "stringBytes": list(cursor_strings)},
         "textButtons": {"address": TEXT_BUTTONS_ADDR, "bytes": text_buttons},
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_pause_data(disc: Path, out_dir: Path) -> None:
    """Copy the pause pages' text banks, overlay data tail and resident tables as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/ststatus")
    entries = []
    technique_count = 0
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for offset, role in PAUSE_BANKS:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"pause bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                count = struct.unpack_from("<I", data)[0]
                if struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"pause bank {bank_id} is not an indexed text table")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                if offset == 0xA2 and language == 0:
                    technique_count = count
                entries.append({"id": bank_id, "language": language, "role": role,
                                "file": f"pause/{bank_id}.bin", "count": count, "size": len(data),
                                "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        ranges = []
        blob = bytearray()
        def take(address: int, size: int, role: str) -> None:
            start = address - base
            if start < 0 or start + size > len(resident):
                raise ValueError(f"pause resident range {role} lies outside the resident image")
            ranges.append({"role": role, "base": address, "offset": len(blob), "size": size})
            blob.extend(resident[start:start + size])
        # The profile table is NOT taken here: every screen reads it out of the one cut,
        # assets/data/digimon_profiles.bin, so no screen's own file can carry a copy.
        take(PAUSE_TECHNIQUES[0], PAUSE_TECHNIQUES[1] * technique_count, "techniques")
        take(PAUSE_SIGNATURES[0], PAUSE_SIGNATURES[1], "signatures")
        take(0x8004DCE0, 20, "cursor-glyph-pointers")
        take(0x8005CCD0, 16, "cursor-glyph-strings")
        # Resident pause-home label, stat-index and row tables. This range is
        # authored data; the translated list tick lives in engine/dw3/ui/.
        home_first, home_end = 0x8003EE7C, 0x8003EF44
        home_data = resident[home_first - base:home_end - base]
        if len(home_data) != home_end - home_first:
            raise ValueError("pause home data lies outside the resident image")
    start = PAUSE_TABLES_BASE - SCREEN_BASE
    tail = overlay[start:]
    if (len(tail) != PAUSE_TABLES_END - PAUSE_TABLES_BASE or
            struct.unpack_from("<II", overlay, start - 8) != (0x03E00008, 0x27BD0030)):
        raise ValueError("pause data tail does not follow the last routine")
    (out_dir / "tables.bin").write_bytes(tail)
    (out_dir / "resident.bin").write_bytes(bytes(blob))
    (out_dir / "home-data.bin").write_bytes(home_data)
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/ststatus", "tablesBase": PAUSE_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tail), "sha256": sha256(tail)},
         "resident": {"file": "resident.bin", "size": len(blob), "sha256": sha256(bytes(blob)),
                      "ranges": ranges},
         "homeData": {"file": "home-data.bin", "base": home_first,
                      "size": len(home_data), "sha256": sha256(home_data)},
         "techniqueCount": technique_count,
         "sharedProfiles": SHARED_PROFILES,
         "sharedBanks": [{"offset": o, "dir": d, "role": r} for o, d, r in PAUSE_SHARED_BANKS],
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_battlecmd_data(disc: Path, out_dir: Path) -> None:
    """Copy the battle command list's config, blit rectangle, names and marker strip."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/fightstg")
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for offset in FIGHT_BANK_OFFSETS:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"battle command bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                count = struct.unpack_from("<I", data)[0]
                if count < 7 or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"battle command bank {bank_id} is not an indexed text table")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                entries.append({"id": bank_id, "language": language, "role": "battle-text",
                                "file": f"{bank_id}.bin", "count": count, "size": len(data),
                                  "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        lba = struct.unpack_from("<I", resident, LBA_OFFSETS + FIGHT_STRIP_PACK * 4 - base)[0]
        sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + FIGHT_STRIP_PACK * 2 - base)[0]
        pack = read_sectors(fh, lba, sectors * 2048)
    def take(address: int, size: int) -> bytes:
        start = address - FIGHT_BASE
        chunk = overlay[start:start + size]
        if start < 0 or len(chunk) != size:
            raise ValueError(f"battle command data 0x{address:08x} lies outside the overlay")
        return chunk
    config = take(*FIGHT_CONFIG)
    joke_config = take(*FIGHT_JOKE_CONFIG)
    tech_config = take(*FIGHT_TECH_CONFIG)
    tag_config = take(*FIGHT_TAG_CONFIG)
    form_config = take(*FIGHT_FORM_CONFIG)
    panel_table = take(*FIGHT_FORM_PANEL_TABLE)
    dna_tables = take(*FIGHT_DNA_TABLES)
    if list(struct.unpack("<8i", tech_config)) != [1, 0x0E, 0x45, 0x0E, -1, 0, 0, 0]:
        raise ValueError("battle TECH config is not the six-row TECH list")
    if list(struct.unpack("<8i", tag_config)) != [2, 0x11, 0x4E, 0x20, 0x2F, 0x10, 0x4D, 0x20]:
        raise ValueError("battle TAG config is not the two-row partner list")
    if list(struct.unpack("<8i", form_config)) != [0, 0xA8, 0x93, 0x13, 0x24, 0xA7, 0x92, 0x13]:
        raise ValueError("battle form config is not the Digivolve form list")
    # The 39 bytes F0x80094AD0 reads are thirteen (x, y, slot) triples in the
    # PlayStation's own byte order; the slot column must land on the panel's
    # six-and-seven accumulated sums at +0x70 and +0x7C.
    triples = [tuple(panel_table[i * 3:i * 3 + 3]) for i in range(13)]
    if triples[0] != (0x3C, 0x52, 6) or triples[-1] != (0x7E, 0xA6, 18):
        raise ValueError("battle form panel table is not the thirteen page-zero numbers")
    if [row[2] for row in triples] != list(range(6, 19)):
        raise ValueError("battle form panel table slots are not 6..18")
    # The DNA pane's two config blocks are the shared list's own geometry, so they are
    # checked the same way as the other four: eight words each, and the four MP-plate x
    # anchors the pane's widgets read. A slice that drifted would move the species strip,
    # the option rows and the MP plate.
    if list(struct.unpack_from("<8i", dna_tables, 0)) != list(FIGHT_DNA_CONFIG_STRIP):
        raise ValueError("battle DNA species-strip config is not the pane's list")
    if list(struct.unpack_from("<8i", dna_tables, 0x20)) != list(FIGHT_DNA_CONFIG_OPTIONS):
        raise ValueError("battle DNA option config is not the pane's two-row list")
    if list(struct.unpack_from("<4i", dna_tables, 0x40)) != list(FIGHT_DNA_MP_XS):
        raise ValueError("battle DNA MP-plate x anchors are not the pane's four")
    # The three blocks are consecutive and exactly fill the slice: two 0x20-byte configs
    # then the four 4-byte anchors, so nothing of the next table at 0x800A35E4 is carried.
    if FIGHT_DNA_TABLES[1] != 0x20 * 2 + 4 * 4:
        raise ValueError("battle DNA table size is not the two configs plus the four anchors")
    if FIGHT_DNA_TABLES[0] + FIGHT_DNA_TABLES[1] != 0x800A35E4:
        raise ValueError("battle DNA tables do not end at the next data word")
    rect = take(*FIGHT_BLIT_RECT)
    if list(struct.unpack("<8i", config)) != [6, 0x11, 0x6E, 0x13, 0x22, 0x10, 0x6D, 0x13]:
        raise ValueError("battle command config is not the six-row list")
    # The joke list is the shared widget driven by its own config block, so the two
    # must agree wherever the widget reads geometry: the row count and the marker's
    # strip x / row origin / row step (F0x8009ABD8 reads +0x5C, +0x60, +0x64) plus the
    # row cel F0x8009ADD4 passes to the sprite call (+0x68). The disc carries all eight
    # words identical (fightstg.s:33919-33934 against :34009-34019), which is why the
    # confused list's icon and pulse sit exactly where the command list's do.
    if (struct.unpack_from("<5i", joke_config) != struct.unpack_from("<5i", config)):
        raise ValueError("battle joke config is not the command config's first five words")
    if struct.unpack("<8i", joke_config) != struct.unpack("<8i", config):
        raise ValueError("battle joke config is not the command config's eight words")
    if struct.unpack("<4h", rect)[1:] != (0xF4, 12, 12):
        raise ValueError("battle command blit rectangle is not the 12x12 strip cell")
    # PACK archive: a u32 offset table; entry 0 is a 16bpp TIM (flags 2, no CLUT).
    first = next(i for i in range(64) if struct.unpack_from("<I", pack, i * 4)[0])
    offsets = [struct.unpack_from("<I", pack, k * 4)[0]
               for k in range(struct.unpack_from("<I", pack, first * 4)[0] // 4)]
    tim = pack[offsets[0]:next(o for o in offsets[1:] if o)]
    magic, flags, block, x, y, w, h = struct.unpack_from("<IIIHHHH", tim, 0)
    if (magic, flags, w, h) != (0x10, 2, 156, 12) or block != 12 + w * h * 2:
        raise ValueError("PGFGTW00 entry 0 is not the 156x12 16bpp marker strip")
    strip = tim[20:20 + w * h * 2]
    (out_dir / "strip.bin").write_bytes(strip)
    tables = config + rect + joke_config
    (out_dir / "tables.bin").write_bytes(tables)
    icons_at = FIGHT_ICON_TABLE[0] - base
    icons = bytes(resident[icons_at:icons_at + FIGHT_ICON_TABLE[1] * FIGHT_ICON_TABLE[2]])
    if len(icons) != FIGHT_ICON_TABLE[1] * FIGHT_ICON_TABLE[2]:
        raise ValueError("battle TECH icon table is not in the exe image")
    (out_dir / "tech-tables.bin").write_bytes(tech_config + rect + icons)
    (out_dir / "tag-tables.bin").write_bytes(tag_config + rect)
    form_tables = form_config + rect + panel_table + icons
    (out_dir / "form-tables.bin").write_bytes(form_tables)
    (out_dir / "dna-tables.bin").write_bytes(dna_tables)
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/fightstg",
         "tables": {"file": "tables.bin", "sha256": sha256(tables),
                    "ranges": [{"role": "menu-config", "base": FIGHT_CONFIG[0], "offset": 0, "size": 32},
                               {"role": "blit-rect", "base": FIGHT_BLIT_RECT[0], "offset": 32, "size": 8},
                               {"role": "joke-config", "base": FIGHT_JOKE_CONFIG[0], "offset": 40, "size": 32}]},
         "techTables": {"file": "tech-tables.bin", "sha256": sha256(tech_config + rect + icons),
                        "ranges": [{"role": "tech-config", "base": FIGHT_TECH_CONFIG[0], "offset": 0, "size": 32},
                                   {"role": "blit-rect", "base": FIGHT_BLIT_RECT[0], "offset": 32, "size": 8},
                                   {"role": "tech-icons", "base": FIGHT_ICON_TABLE[0], "offset": 40,
                                    "size": FIGHT_ICON_TABLE[1] * FIGHT_ICON_TABLE[2]}]},
         "tagTables": {"file": "tag-tables.bin", "sha256": sha256(tag_config + rect),
                       "ranges": [{"role": "tag-config", "base": FIGHT_TAG_CONFIG[0], "offset": 0, "size": 32},
                                  {"role": "blit-rect", "base": FIGHT_BLIT_RECT[0], "offset": 32, "size": 8}]},
         "formTables": {"file": "form-tables.bin", "sha256": sha256(form_tables),
                        "ranges": [{"role": "form-config", "base": FIGHT_FORM_CONFIG[0], "offset": 0, "size": 32},
                                   {"role": "blit-rect", "base": FIGHT_BLIT_RECT[0], "offset": 32, "size": 8},
                                   {"role": "form-panel-page0", "base": FIGHT_FORM_PANEL_TABLE[0],
                                    "offset": 40, "size": FIGHT_FORM_PANEL_TABLE[1]},
{"role": "form-tech-icons", "base": FIGHT_ICON_TABLE[0],
                                    "offset": 80,
                                    "size": FIGHT_ICON_TABLE[1] * FIGHT_ICON_TABLE[2]}]},
         "dnaTables": {"file": "dna-tables.bin", "sha256": sha256(dna_tables),
                       "ranges": [{"role": "dna-strip-config", "base": FIGHT_DNA_TABLES[0],
                                   "offset": 0, "size": 32},
                                  {"role": "dna-option-config", "base": FIGHT_DNA_TABLES[0] + 0x20,
                                   "offset": 32, "size": 32},
                                  {"role": "dna-mp-plate-xs", "base": FIGHT_DNA_TABLES[0] + 0x40,
                                   "offset": 64, "size": 16}]},
         "sharedProfiles": SHARED_PROFILES,
         "strip": {"file": "strip.bin", "width": w, "height": h, "format": "rgb555",
                   "vram": list(FIGHT_STRIP_VRAM), "packIndex": FIGHT_STRIP_PACK, "entry": 0,
                   "sha256": sha256(strip)},
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_enemy_stat_table(disc: Path, out_dir: Path) -> None:
    """Decode resource 0x1cf, the enemy stat records the battle reads by enemy id.

    FIGHTSTG_F0x8009b8d0 (fightstg.s:25676) is the resolver every screen uses: it calls
    the resident loader `[0x80044f4c]` with `0x1cf` (:25679-25683), hands the enemy id
    to FIGHTSTG_F0x8009b864 (:25685) and multiplies the returned index by 0x46
    (:25690-25695). FIGHTSTG_F0x8009b864 (:25646) is a linear scan whose stride is
    `addiu $v1, 0x46` (:25663) over the halfword at `+0x00` (:25655), and it stops at
    the first record whose `+0x00` is zero (:25657 -> :25668), so the record count is
    read out of the data rather than assumed. Only the offsets with a reader in
    pro/fightstg.s are emitted; the raw 0x46 bytes travel with each record.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        lba = struct.unpack_from("<I", resident, LBA_OFFSETS + ENEMY_STATS_RESOURCE * 4 - base)[0]
        sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + ENEMY_STATS_RESOURCE * 2 - base)[0]
        if not lba or not sectors:
            raise ValueError(f"resource 0x{ENEMY_STATS_RESOURCE:x} has no disc extent")
        data = read_sectors(fh, lba, sectors * 2048)
    records = []
    index = 0
    while (index + 1) * ENEMY_STATS_STRIDE <= len(data):
        raw = data[index * ENEMY_STATS_STRIDE:(index + 1) * ENEMY_STATS_STRIDE]
        enemy_id = struct.unpack_from("<h", raw, 0)[0]
        if enemy_id == 0:
            break                                   # the scan's terminator
        row = {"index": index, "id": enemy_id,
               "field04": struct.unpack_from("<h", raw, 0x04)[0],
               "nameId": struct.unpack_from("<h", raw, 0x06)[0],   # bank 0x4e line
               "attack": struct.unpack_from("<h", raw, 0x08)[0],
               "tech1": struct.unpack_from("<h", raw, 0x0A)[0],
               "tech2": struct.unpack_from("<h", raw, 0x0C)[0],
               "strength": struct.unpack_from("<h", raw, 0x0E)[0],
               "defence": struct.unpack_from("<h", raw, 0x10)[0],
               "spirit": struct.unpack_from("<h", raw, 0x12)[0],
               "aiMoves": [{"action": raw[0x32 + 4 * k], "comparator": raw[0x33 + 4 * k],
                            "value": struct.unpack_from("<h", raw, 0x34 + 4 * k)[0]} for k in range(3)],
               "counter": {"action": raw[0x42], "comparator": raw[0x43],
                           "value": struct.unpack_from("<h", raw, 0x44)[0]},
               "raw": raw.hex()}
        records.append(row)
        index += 1
    if not records or records[-1]["id"] == 0:
        raise ValueError("enemy stat table has no zero-id terminator")
    if data[index * ENEMY_STATS_STRIDE:(index + 1) * ENEMY_STATS_STRIDE].strip(b"\0"):
        raise ValueError("the bytes after the enemy stat terminator are not zero")
    (out_dir / "enemy_stats.json").write_text(json.dumps(
        {"schema": 1, "resource": ENEMY_STATS_RESOURCE, "recordStride": ENEMY_STATS_STRIDE,
         "recordCount": len(records), "terminatorIndex": index,
         "discLba": lba, "discSectors": sectors, "size": len(data),
         "sha256": sha256(data),
         "nameBank": {"resource": 0x4E, "lines": 251,
                      "note": "stats + 0x06 is a line of bank 0x4e, not a species id"},
         "fields": ENEMY_STATS_FIELDS,
         "records": records,
         "source": {"loader": "[0x80044f4c]", "resolver": "FIGHTSTG_F0x8009b8d0",
                    "scanner": "FIGHTSTG_F0x8009b864", "asm": "pro/fightstg.s"}},
        indent=2) + "\n")


def extract_wfight_loader_data(disc: Path, out_dir: Path) -> None:
    """Copy the five scene packs the battle boot loader uploads and every bank's sector count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/wfightmn")
    resources = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])

        def extent(bank_id: int) -> tuple[int, int]:
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"wfightmn loader bank {bank_id} has no disc extent")
            return lba, sectors

        for bank_id, role in WFIGHT_PACKS:
            lba, sectors = extent(bank_id)
            data = read_sectors(fh, lba, sectors * 2048)
            if len(data) != sectors * 2048:
                raise ValueError(f"wfightmn loader pack {bank_id} is truncated")
            # A PACK archive: its first u32 is the offset of record 0 (the table's own size).
            first = struct.unpack_from("<I", data, 0)[0]
            if first == 0 or first >= len(data):
                raise ValueError(f"wfightmn loader pack {bank_id} has no record table")
            (out_dir / f"{bank_id}.bin").write_bytes(data)
            resources.append({"id": bank_id, "role": role, "sectors": sectors, "file": f"{bank_id}.bin",
                              "sha256": sha256(data), "discLba": lba})
        for bank_id, role in WFIGHT_DIRECT_BANKS:
            lba, sectors = extent(bank_id)
            resources.append({"id": bank_id, "role": role, "sectors": sectors, "file": None, "discLba": lba})
        for family, role in WFIGHT_LANGUAGE_FAMILIES:
            for language in range(7):
                lba, sectors = extent(family + language)
                resources.append({"id": family + language, "role": role, "family": family, "language": language,
                                  "sectors": sectors, "file": None, "discLba": lba})
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/wfightmn", "resources": resources,
         "source": {"discIndex": entry["disc_index"], "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_report_data(disc: Path, out_dir: Path) -> None:
    """Copy the fight report's text bank, overlay data tail and resident species records as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stfgtrep")
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for language in range(7):
            bank_id = REPORT_BANK + language
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"report bank {bank_id} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            count = struct.unpack_from("<I", data)[0]
            if count < 12 or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                raise ValueError(f"report bank {bank_id} is not an indexed text table")
            (out_dir / f"{bank_id}.bin").write_bytes(data)
            entries.append({"id": bank_id, "language": language, "role": "report-text",
                            "file": f"{bank_id}.bin", "count": count, "size": len(data),
                            "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        text_buttons = resident[TEXT_BUTTONS_ADDR - base:TEXT_BUTTONS_ADDR - base + TEXT_BUTTONS_LEN]
    start = REPORT_TABLES_BASE - REPORT_BASE
    tail = bytearray(overlay[start:])
    if struct.unpack_from("<II", overlay, start - 8) != (0x03E00008, 0x27BD0040):
        raise ValueError("report data tail does not follow the last routine")
    code_end = REPORT_BASE + start
    slots = []
    for address in range(REPORT_SLOTS[0], REPORT_SLOTS[1], 4):
        word = struct.unpack_from("<I", tail, address - REPORT_TABLES_BASE)[0]
        if not REPORT_BASE <= word < code_end:
            raise ValueError(f"report slot 0x{address:08x} does not hold an overlay routine address")
        slots.append({"address": address, "routine": word})
        struct.pack_into("<I", tail, address - REPORT_TABLES_BASE, 0)
    # No other word of the tail may point into the routines: the slots are the only code pointers.
    for offset in range(0, len(tail), 4):
        word = struct.unpack_from("<I", tail, offset)[0]
        if REPORT_BASE <= word < code_end:
            raise ValueError(f"report data tail holds a code address at 0x{REPORT_TABLES_BASE + offset:08x}")
    if list(text_buttons) != [0xd, 0, 0, 0, 0xc, 0, 0, 0, 0xd, 0, 0, 0, 0xe, 0, 0, 0, 0xf, 0, 0, 0]:
        raise ValueError("text wait-button table is not the expected logical ids")
    (out_dir / "tables.bin").write_bytes(bytes(tail))
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stfgtrep", "tablesBase": REPORT_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tail), "sha256": sha256(bytes(tail)),
                    "zeroedRoutineSlots": slots},
         "sharedProfiles": SHARED_PROFILES,
         "textButtons": {"address": TEXT_BUTTONS_ADDR, "bytes": list(text_buttons)},
         "sharedBanks": [{"offset": o, "dir": d, "role": r} for o, d, r in REPORT_SHARED_BANKS],
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_shop_catalog(disc: Path, out: Path) -> None:
    """Extract only the merchant count/pointer records and their item-ID arrays."""
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stitshop")
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
    records = []
    for shop_id in range(SHOP_RECORD_COUNT):
        record_addr = SHOP_RECORDS_ADDR + shop_id * 8
        record_off = record_addr - SCREEN_BASE
        if record_off < 0 or record_off + 8 > len(overlay):
            raise ValueError(f"shop {shop_id} record is outside the overlay")
        count, items_addr = struct.unpack_from("<II", overlay, record_off)
        items_off = items_addr - SCREEN_BASE
        if (count < 1 or count > 128 or items_off < 0 or
                items_addr + count * 2 > SHOP_RECORDS_ADDR or
                items_off + count * 2 > len(overlay)):
            raise ValueError(f"shop {shop_id} item array is outside the overlay")
        items = list(struct.unpack_from(f"<{count}H", overlay, items_off))
        if 0 in items:
            raise ValueError(f"shop {shop_id} has a zero item ID")
        records.append({"shopId": shop_id, "recordAddress": record_addr,
                        "itemsAddress": items_addr, "count": count, "items": items})
    name_offset = SHOP_NAMES_ADDR - SCREEN_BASE
    shop_name_ids = list(struct.unpack_from("<30I", overlay, name_offset))
    if sorted(shop_name_ids) != list(range(1, 31)):
        raise ValueError("shop name table is not the expected 30-name permutation")
    shop_ui_tables = overlay[SHOP_UI_TABLE_BASE - SCREEN_BASE:SHOP_UI_TABLE_END - SCREEN_BASE]
    if len(shop_ui_tables) != SHOP_UI_TABLE_END - SHOP_UI_TABLE_BASE or \
            list(struct.unpack_from("<4I", shop_ui_tables)) != [1, 2, 3, 4]:
        raise ValueError("shop category and class tables are truncated")
    directories = []
    for category in range(5):
        table_off = ITEM_DIRECTORY_TABLE + category * 4 - base
        address = struct.unpack_from("<I", resident, table_off)[0]
        start = address - base
        if start < 0 or start >= len(resident):
            raise ValueError(f"inventory category {category} points outside resident data")
        items = []
        for offset in range(0, 1024, 2):
            if start + offset + 2 > len(resident):
                raise ValueError(f"inventory category {category} is truncated")
            item = struct.unpack_from("<H", resident, start + offset)[0]
            if item == 0:
                break
            items.append(item)
        else:
            raise ValueError(f"inventory category {category} lacks a terminator")
        directories.append({"category": category, "address": address, "items": items})
    record_start = ITEM_RECORD_BASE - base
    record_size = ITEM_RECORD_COUNT * ITEM_RECORD_STRIDE
    records_data = resident[record_start:record_start + record_size]
    if len(records_data) != record_size:
        raise ValueError("resident item records are truncated")
    icon_count = max(records_data[i * ITEM_RECORD_STRIDE + 9]
                     for i in range(ITEM_RECORD_COUNT)) + 1
    icon_start = ITEM_ICON_CLIPS - base
    icon_clips = resident[icon_start:icon_start + icon_count]
    if len(icon_clips) != icon_count:
        raise ValueError("resident item icon clip table is truncated")
    cursor_table = resident[SHOP_CURSOR_TABLE - base:SHOP_CURSOR_TABLE - base + 20]
    cursor_strings = resident[SHOP_CURSOR_STRINGS - base:SHOP_CURSOR_STRINGS - base + 16]
    cursor_ptrs = struct.unpack("<5I", cursor_table)
    if (len(cursor_strings) != 16 or
            sorted(set(cursor_ptrs)) != [SHOP_CURSOR_STRINGS + i * 4 for i in range(4)]):
        raise ValueError("shop cursor glyph table is not the expected string set")
    out.parent.mkdir(parents=True, exist_ok=True)
    item_record_file = out.with_name("shop_item_records.bin")
    item_record_file.write_bytes(records_data)
    descriptor_files = []
    for start, end, filename in SHOP_DESCRIPTOR_RANGES:
        raw = resident[start - base:end - base]
        if len(raw) != end - start:
            raise ValueError(f"resident shop descriptor range {filename} is truncated")
        (out.parent / filename).write_bytes(raw)
        descriptor_files.append({"base": start, "size": len(raw), "file": filename,
                                 "sha256": sha256(raw)})
    for item_id in range(1, ITEM_RECORD_COUNT):
        pointer = struct.unpack_from("<I", records_data, item_id * ITEM_RECORD_STRIDE)[0]
        if pointer and not any(row["base"] <= pointer and pointer + 14 <= row["base"] + row["size"]
                               for row in descriptor_files):
            raise ValueError(f"item {item_id} descriptor lies outside extracted ranges")
    out.write_text(json.dumps({"schema": 1, "module": "pro/stitshop",
                               "recordBase": SHOP_RECORDS_ADDR, "records": records,
                               "shopNames": {"base": SHOP_NAMES_ADDR, "ids": shop_name_ids},
                               "uiTables": {"base": SHOP_UI_TABLE_BASE,
                                            "bytes": list(shop_ui_tables),
                                            "sha256": sha256(shop_ui_tables)},
                               "inventoryDirectoryTable": ITEM_DIRECTORY_TABLE,
                               "inventoryDirectories": directories,
                               "itemRecords": {"base": ITEM_RECORD_BASE, "count": ITEM_RECORD_COUNT,
                                               "stride": ITEM_RECORD_STRIDE,
                                               "file": item_record_file.name,
                                               "sha256": sha256(records_data)},
                               "itemDescriptors": descriptor_files,
                               "itemIconClips": {"base": ITEM_ICON_CLIPS,
                                                 "bytes": list(icon_clips)},
                               "cursorGlyphs": {"tableBase": SHOP_CURSOR_TABLE,
                                                "tableBytes": list(cursor_table),
                                                "stringsBase": SHOP_CURSOR_STRINGS,
                                                "stringBytes": list(cursor_strings)},
                               "source": {"discIndex": entry["disc_index"],
                                          "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


def extract_digimon_profiles(disc: Path, out: Path) -> None:
    """Cut the one Digimon profile table, the table every screen showing a Digimon reads.

    One cut, whole records, no code and nothing else of the resident image: 0x58 bytes
    per record from 0x8003EF5C, and 55 records because the next table (the shop's
    descriptors) starts at 0x80040244. Each record names itself at +0x55 with its own
    1-based row, which is the check that the slice starts where it claims to.
    """
    address, stride, rows = PROFILE_TABLE
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
    start = address - base
    profiles = bytes(resident[start:start + stride * rows])
    if len(profiles) != stride * rows:
        raise ValueError("the Digimon profile table is not in the exe image")
    if address + len(profiles) != SHOP_DESCRIPTOR_RANGES[0][0]:
        raise ValueError("the profile table does not end where the shop descriptors begin")
    if PROFILE_SCAN_ROWS >= rows:
        raise ValueError("the species getter's scan must be narrower than the table")
    for row in range(rows):
        if profiles[row * stride + 0x55] != row + 1:
            raise ValueError(f"Digimon profile row {row} does not carry its own id")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(profiles)


def extract_shop_font(disc: Path, out: Path) -> None:
    """Copy resident font records, lookup tables and glyph metrics as data."""
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
    start, end = SHOP_FONT_BASE - base, SHOP_FONT_END - base
    if start < 0 or end > len(resident):
        raise ValueError("shop font data lies outside the resident image")
    data = resident[start:end]
    if (len(data) != 0x3492 or
            sha256(data) != "1bcbd1f78b1375c61bb707574c3f758ac82de89dced3f4f3495f41c67ff11b0e" or
            struct.unpack_from("<II", data, 0x8c) != (SHOP_FONT_BASE, 0x8004DDD4)):
        raise ValueError("shop font data does not match the verified resident slice")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)


# The memory-card screen (pro/stgmcard, loaded at 0x80082CB0): its two own text banks
# (esmemcrd 0x78, esstarea 0xA9; the third, esshpnam 0x94, is the shop's merchant-names
# family) and the overlay's data tail after the bare return F0x80088080: widget
# descriptors, party icon clip groups, nameplate clips, slot x positions, result code
# strings, region table, identity table, the shared block (whose seven routine-pointer
# words 0x80088784..0x8008879C are zeroed: the ports bind by name) and the save icon.
MEMCARD_BASE = 0x80082CB0
MEMCARD_TABLES_BASE = 0x80088088
MEMCARD_TABLES_END = 0x80088950
MEMCARD_SLOTS = (0x80088784, 0x800887A0)
MEMCARD_BANKS = ((0x78, 41, "memory-card-text"), (0xA9, 0, "area-names"))


def extract_memcard_data(disc: Path, out_dir: Path) -> None:
    """Copy the save screen's two text banks and its overlay data tail as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stgmcard")
    entries = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for offset, expected_count, role in MEMCARD_BANKS:
            for language in range(7):
                bank_id = offset + language
                lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
                sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
                if not lba or not sectors:
                    raise ValueError(f"memory card bank {bank_id} has no disc extent")
                data = read_sectors(fh, lba, sectors * 2048)
                count = struct.unpack_from("<I", data)[0]
                if (expected_count and count != expected_count) or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                    raise ValueError(f"memory card bank {bank_id} is not an indexed text table")
                (out_dir / f"{bank_id}.bin").write_bytes(data)
                entries.append({"id": bank_id, "language": language, "role": role,
                                "file": f"{bank_id}.bin", "count": count, "size": len(data),
                                "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        text_buttons = resident[TEXT_BUTTONS_ADDR - base:TEXT_BUTTONS_ADDR - base + TEXT_BUTTONS_LEN]
    start = MEMCARD_TABLES_BASE - MEMCARD_BASE
    if struct.unpack_from("<I", overlay, start - 8)[0] != 0x03E00008:
        raise ValueError("memory card data tail does not follow the bare return")
    tail = bytearray(overlay[start:MEMCARD_TABLES_END - MEMCARD_BASE])
    code_end = MEMCARD_BASE + start
    slots = []
    for address in range(MEMCARD_SLOTS[0], MEMCARD_SLOTS[1], 4):
        word = struct.unpack_from("<I", tail, address - MEMCARD_TABLES_BASE)[0]
        if not MEMCARD_BASE <= word < code_end:
            raise ValueError(f"memory card slot 0x{address:08x} does not hold an overlay routine address")
        slots.append({"address": address, "routine": word})
        struct.pack_into("<I", tail, address - MEMCARD_TABLES_BASE, 0)
    for offset in range(0, len(tail), 4):
        word = struct.unpack_from("<I", tail, offset)[0]
        if MEMCARD_BASE <= word < code_end:
            raise ValueError(f"memory card data tail holds a code address at 0x{MEMCARD_TABLES_BASE + offset:08x}")
    if list(text_buttons) != [0xd, 0, 0, 0, 0xc, 0, 0, 0, 0xd, 0, 0, 0, 0xe, 0, 0, 0, 0xf, 0, 0, 0]:
        raise ValueError("text wait-button table is not the expected logical ids")
    (out_dir / "tables.bin").write_bytes(bytes(tail))
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stgmcard", "tablesBase": MEMCARD_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tail), "sha256": sha256(bytes(tail)),
                    "zeroedRoutineSlots": slots},
         "textButtons": {"address": TEXT_BUTTONS_ADDR, "bytes": list(text_buttons)},
         "sharedBanks": [{"offset": 0x94, "dir": "shop-banks", "role": "merchant-names"}],
         "banks": entries, "source": {"discIndex": entry["disc_index"],
                                      "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


# The training gym (pro/stgtrain, loaded at 0x80082CB0): its own text bank (estraini 0x10B +
# language), the overlay's data tail after the last routine F0x8008C1C8 (the animation and
# picture tables, the stat roll tables, the rank drill menus, the drill records and the
# service table), the resident species records the element roll reads, and the twelve TRANIN
# training-scene packs the gym's loader asks the disc for (DAT/TRAINING/TRANIN00-04 and
# TRANIN10-16). The seven routine-pointer words of the service table (0x8008D2AC..0x8008D2F4)
# are code addresses, so they are zeroed: the ports bind those services by name.
GYM_BASE = 0x80082CB0
GYM_TABLES_BASE = 0x8008C224
GYM_BANK = 0x10B
GYM_SLOTS = (0x8008D2AC, 0x8008D2F8)
GYM_PACK_TABLE = 0x8008CE3C     # 16-byte records: word 0 = the TRANIN file's disc index
GYM_PACK_COUNT = 25
GYM_RESIDENT_SIGNATURES = PAUSE_SIGNATURES   # the set ids, then the bonuses the effective-stat copy reads


def extract_gym_data(disc: Path, out_dir: Path) -> None:
    """Copy the gym's text bank, overlay data tail, species records and TRANIN packs as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "tranin").mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stgtrain")
    banks = []
    packs = []
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for language in range(7):
            bank_id = GYM_BANK + language
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"gym bank {bank_id} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            count = struct.unpack_from("<I", data)[0]
            if count < 0x60 or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                raise ValueError(f"gym bank {bank_id} is not an indexed text table")
            (out_dir / f"{bank_id}.bin").write_bytes(data)
            banks.append({"id": bank_id, "language": language, "role": "gym-text", "file": f"{bank_id}.bin",
                          "count": count, "size": len(data), "sha256": sha256(data),
                          "discLba": lba, "discSectors": sectors})
        signature = resident[GYM_RESIDENT_SIGNATURES[0] - base:GYM_RESIDENT_SIGNATURES[0] - base + GYM_RESIDENT_SIGNATURES[1]]
        text_buttons = resident[TEXT_BUTTONS_ADDR - base:TEXT_BUTTONS_ADDR - base + TEXT_BUTTONS_LEN]
        disc_indexes = sorted({struct.unpack_from("<I", overlay, GYM_PACK_TABLE - GYM_BASE + i * 16)[0]
                               for i in range(GYM_PACK_COUNT)} - {0})
        for index in disc_indexes:
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + index * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + index * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"gym pack {index} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            (out_dir / "tranin" / f"{index}.bin").write_bytes(data)
            packs.append({"id": index, "file": f"tranin/{index}.bin", "sectors": sectors, "size": len(data),
                          "sha256": sha256(data), "discLba": lba})
    start = GYM_TABLES_BASE - GYM_BASE
    if struct.unpack_from("<I", overlay, start - 8)[0] != 0x03E00008:
        raise ValueError("gym data tail does not follow the last routine")
    tail = bytearray(overlay[start:])
    code_end = GYM_TABLES_BASE
    slots = []
    for address in range(GYM_SLOTS[0], GYM_SLOTS[1], 4):
        word = struct.unpack_from("<I", tail, address - GYM_TABLES_BASE)[0]
        if not GYM_BASE <= word < code_end:
            raise ValueError(f"gym slot 0x{address:08x} does not hold an overlay routine address")
        slots.append({"address": address, "routine": word})
        struct.pack_into("<I", tail, address - GYM_TABLES_BASE, 0)
    for offset in range(0, len(tail), 4):
        word = struct.unpack_from("<I", tail, offset)[0]
        if GYM_BASE <= word < code_end:
            raise ValueError(f"gym data tail holds a code address at 0x{GYM_TABLES_BASE + offset:08x}")
    if list(text_buttons) != [0xd, 0, 0, 0, 0xc, 0, 0, 0, 0xd, 0, 0, 0, 0xe, 0, 0, 0, 0xf, 0, 0, 0]:
        raise ValueError("text wait-button table is not the expected logical ids")
    (out_dir / "tables.bin").write_bytes(bytes(tail))
    (out_dir / "signature.bin").write_bytes(bytes(signature))
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stgtrain", "tablesBase": GYM_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tail), "sha256": sha256(bytes(tail)),
                    "zeroedRoutineSlots": slots},
         "sharedProfiles": SHARED_PROFILES,
         "signature": {"file": "signature.bin", "base": GYM_RESIDENT_SIGNATURES[0], "size": len(signature),
                       "sha256": sha256(bytes(signature))},
         "textButtons": {"address": TEXT_BUTTONS_ADDR, "bytes": list(text_buttons)},
         "packTable": {"address": GYM_PACK_TABLE, "count": GYM_PACK_COUNT},
         "packs": packs, "banks": banks,
         "source": {"discIndex": entry["disc_index"], "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


# The Digimon lab (pro/stgdglab, loaded at 0x80082CB0): its own text bank (esdglabo 0x39 + language),
# the overlay's data tail after the last routine F0x8008F424 (the stat-index and label tables, the
# animation rows, the per-slot evolution requirement blocks, the chart's form table and the
# species lookup records) and the resident tables the lab's screens read: the technique records
# and the signature sets the effective-statistics copy uses. The species profile records (their
# value0 is the save's form id) are the one shared cut, PROFILE_TABLE above. The four
# other text families the lab asks for (0x4E Digimon names,
# 0x47 pause labels, 0xA2 technique names, 0x9B technique info) are the wizard's and the pause pages'
# banks and are referenced, not copied. The routine-pointer words in the tail (the Select Action
# choice table and the module's service table) are code addresses, so they are zeroed: the ports
# bind those routines by name.
LAB_BASE = 0x80082CB0
LAB_TABLES_BASE = 0x8008F470
LAB_BANK = 0x39
LAB_SLOTS = ((0x8008F4B8, 0x8008F4C4), (0x8008FD90, 0x8008FDB0))
LAB_SHARED_BANKS = ((0x4E, "wizard", "digimon-names"), (0x47, "pause", "pause-labels"),
                    (0xA2, "pause", "technique-names"), (0x9B, "pause", "technique-info"))


def extract_lab_data(disc: Path, out_dir: Path) -> None:
    """Copy the lab's text bank, overlay data tail and resident tables as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = json.loads((ROOT / "data/native_screen_roots.json").read_text())
    entry = next(row for row in roots if row["module"] == "pro/stgdglab")
    banks = []
    technique_count = 0
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        overlay = read_overlay(fh, resident, base, entry["disc_index"])
        for language in range(7):
            bank_id = LAB_BANK + language
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"lab bank {bank_id} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            count = struct.unpack_from("<I", data)[0]
            if count < 0x2D or struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                raise ValueError(f"lab bank {bank_id} is not an indexed text table")
            (out_dir / f"{bank_id}.bin").write_bytes(data)
            banks.append({"id": bank_id, "language": language, "role": "lab-text", "file": f"{bank_id}.bin",
                          "count": count, "size": len(data), "sha256": sha256(data),
                          "discLba": lba, "discSectors": sectors})
        lba = struct.unpack_from("<I", resident, LBA_OFFSETS + 0xA2 * 4 - base)[0]
        sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + 0xA2 * 2 - base)[0]
        technique_count = struct.unpack_from("<I", read_sectors(fh, lba, sectors * 2048))[0]
        blob = bytearray()
        ranges = []

        def take(address: int, size: int, role: str) -> None:
            start = address - base
            if start < 0 or start + size > len(resident):
                raise ValueError(f"lab resident range {role} lies outside the resident image")
            ranges.append({"role": role, "base": address, "offset": len(blob), "size": size})
            blob.extend(resident[start:start + size])

        # The profile table is NOT taken here: it is the one shared cut.
        take(PAUSE_TECHNIQUES[0], PAUSE_TECHNIQUES[1] * technique_count, "techniques")
        take(PAUSE_SIGNATURES[0], PAUSE_SIGNATURES[1], "signatures")
        text_buttons = resident[TEXT_BUTTONS_ADDR - base:TEXT_BUTTONS_ADDR - base + TEXT_BUTTONS_LEN]
    start = LAB_TABLES_BASE - LAB_BASE
    if struct.unpack_from("<II", overlay, start - 8) != (0x03E00008, 0x00001021):
        raise ValueError("lab data tail does not follow the last routine")
    tail = bytearray(overlay[start:])
    code_end = LAB_TABLES_BASE
    slots = []
    for first, end in LAB_SLOTS:
        for address in range(first, end, 4):
            word = struct.unpack_from("<I", tail, address - LAB_TABLES_BASE)[0]
            if not LAB_BASE <= word < code_end:
                raise ValueError(f"lab slot 0x{address:08x} does not hold an overlay routine address")
            slots.append({"address": address, "routine": word})
            struct.pack_into("<I", tail, address - LAB_TABLES_BASE, 0)
    for offset in range(0, len(tail), 4):
        word = struct.unpack_from("<I", tail, offset)[0]
        if LAB_BASE <= word < code_end:
            raise ValueError(f"lab data tail holds a code address at 0x{LAB_TABLES_BASE + offset:08x}")
    if list(text_buttons) != [0xd, 0, 0, 0, 0xc, 0, 0, 0, 0xd, 0, 0, 0, 0xe, 0, 0, 0, 0xf, 0, 0, 0]:
        raise ValueError("text wait-button table is not the expected logical ids")
    (out_dir / "tables.bin").write_bytes(bytes(tail))
    (out_dir / "resident.bin").write_bytes(bytes(blob))
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "module": "pro/stgdglab", "tablesBase": LAB_TABLES_BASE,
         "tables": {"file": "tables.bin", "size": len(tail), "sha256": sha256(bytes(tail)),
                    "zeroedRoutineSlots": slots},
         "resident": {"file": "resident.bin", "size": len(blob), "sha256": sha256(bytes(blob)), "ranges": ranges},
         "sharedProfiles": SHARED_PROFILES,
         "techniqueCount": technique_count,
         "textButtons": {"address": TEXT_BUTTONS_ADDR, "bytes": list(text_buttons)},
         "sharedBanks": [{"offset": o, "dir": d, "role": r} for o, d, r in LAB_SHARED_BANKS],
         "banks": banks, "source": {"discIndex": entry["disc_index"], "overlaySha256": sha256(overlay)}}, indent=2) + "\n")


# The field conversation box (engine/dw3/ui/dialogue-session.ts): the resident ranges its ports read and the
# English ESTALK00..09 packs (bank ids 199 + 7*n; the 7 neighbours are the M,U,E,F,I,D,S language variants).
DIALOGUE_RANGES = ((0x800101A0, 0xF8), (0x8004DCCC, 0xA8), (0x80048D88, 0x20), (0x80056A28, 0x4000))
ESTALK_FIRST_BANK, ESTALK_STRIDE, ESTALK_ENGLISH, ESTALK_COUNT = 199, 7, 2, 10
# English ESDMG packs (the cutscene SAY bank [0x80099DC8]); bank ids from lba.rs LBA_ESDMGnnn_BIN_IDX.
ESDMG_BANKS = ((200, 276), (260, 283), (270, 290), (300, 297), (305, 304), (400, 311), (500, 318),
               (600, 325), (700, 332), (800, 339), (900, 346))


def extract_dialogue_data(disc: Path, out_dir: Path) -> None:
    """Copy the dialogue resident ranges and the English conversation packs as data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    ranges, packs, blob = [], [], bytearray()
    with disc.open("rb") as fh:
        base, resident = load_exe(fh)
        for address, size in DIALOGUE_RANGES:
            chunk = resident[address - base:address - base + size]
            if address < base or len(chunk) != size:
                raise ValueError(f"dialogue range {address:#x} lies outside the resident image")
            ranges.append({"address": address, "offset": len(blob), "size": size, "sha256": sha256(chunk)})
            blob += chunk
        for n in range(ESTALK_COUNT):
            bank_id = ESTALK_FIRST_BANK + ESTALK_STRIDE * n
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"ESTALK{n:02d} bank {bank_id} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            count = struct.unpack_from("<I", data)[0]
            if struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
                raise ValueError(f"ESTALK{n:02d} is not an indexed text table")
            (out_dir / f"estalk{n:02d}.bin").write_bytes(data)
            packs.append({"file": f"estalk{n:02d}.bin", "bank": bank_id, "count": count, "size": len(data),
                          "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
        esdmg = []
        for number, bank_id in ESDMG_BANKS:
            lba = struct.unpack_from("<I", resident, LBA_OFFSETS + bank_id * 4 - base)[0]
            sectors = struct.unpack_from("<H", resident, LBA_LEN_SECTORS + bank_id * 2 - base)[0]
            if not lba or not sectors:
                raise ValueError(f"ESDMG{number} bank {bank_id} has no disc extent")
            data = read_sectors(fh, lba, sectors * 2048)
            # an ESDMG file is a directory: [u32 entry offsets] (offsets[0] = 4*entries), each entry an
            # ESTALK-style [u32 count][u32 offsets][tokens] pack.
            first = struct.unpack_from("<I", data)[0]
            count = first // 4
            offsets = struct.unpack_from(f"<{count}I", data)
            if first % 4 or list(offsets) != sorted(offsets):
                raise ValueError(f"ESDMG{number} is not an entry directory")
            for entry in offsets:
                lines = struct.unpack_from("<I", data, entry)[0]
                if struct.unpack_from("<I", data, entry + 4)[0] != 4 + lines * 4:
                    raise ValueError(f"ESDMG{number} entry at {entry:#x} is not an indexed text table")
            (out_dir / f"esdmg{number}.bin").write_bytes(data)
            esdmg.append({"file": f"esdmg{number}.bin", "bank": bank_id, "count": count, "size": len(data),
                          "sha256": sha256(data), "discLba": lba, "discSectors": sectors})
    (out_dir / "resident-ranges.bin").write_bytes(bytes(blob))
    (out_dir / "manifest.json").write_text(json.dumps(
        {"schema": 1, "residentRanges": {"file": "resident-ranges.bin", "size": len(blob),
                                         "sha256": sha256(bytes(blob)), "ranges": ranges},
         "estalk": packs, "esdmg": esdmg}, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disc", type=Path, default=DEFAULT_DISC)
    parser.add_argument("--out", type=Path, default=ROOT / "web/assets/data/country_screen.json")
    parser.add_argument("--shop-out", type=Path, default=ROOT / "web/assets/data/shop-banks")
    parser.add_argument("--album-out", type=Path, default=ROOT / "web/assets/data/album")
    parser.add_argument("--inn-out", type=Path, default=ROOT / "web/assets/data/inn-banks")
    parser.add_argument("--place-out", type=Path, default=ROOT / "web/assets/data/place-banks")
    parser.add_argument("--name-out", type=Path, default=ROOT / "web/assets/data/name")
    parser.add_argument("--wizard-out", type=Path, default=ROOT / "web/assets/data/wizard")
    parser.add_argument("--pause-out", type=Path, default=ROOT / "web/assets/data/pause")
    parser.add_argument("--battlecmd-out", type=Path, default=ROOT / "web/assets/data/battlecmd")
    parser.add_argument("--wfight-out", type=Path, default=ROOT / "web/assets/data/wfight")
    parser.add_argument("--report-out", type=Path, default=ROOT / "web/assets/data/report")
    parser.add_argument("--memcard-out", type=Path, default=ROOT / "web/assets/data/memcard")
    parser.add_argument("--gym-out", type=Path, default=ROOT / "web/assets/data/gym")
    parser.add_argument("--lab-out", type=Path, default=ROOT / "web/assets/data/lab")
    parser.add_argument("--shop-catalog-out", type=Path, default=ROOT / "web/assets/data/shop_catalog.json")
    parser.add_argument("--shop-font-out", type=Path, default=ROOT / "web/assets/data/shop_font.bin")
    parser.add_argument("--dialogue-out", type=Path, default=ROOT / "web/assets/data/dialogue-box")
    parser.add_argument("--profiles-out", type=Path,
                        default=ROOT / "web/assets/data/digimon_profiles.bin")
    args = parser.parse_args()
    result = extract(args.disc)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    extract_shop_banks(args.disc, args.shop_out)
    extract_album_data(args.disc, args.album_out)
    extract_shop_banks(args.disc, args.inn_out, INN_BANKS)
    extract_place_card_data(args.disc, args.place_out)
    extract_shop_catalog(args.disc, args.shop_catalog_out)
    extract_name_data(args.disc, args.name_out)
    extract_wizard_data(args.disc, args.wizard_out)
    extract_pause_data(args.disc, args.pause_out)
    extract_shop_font(args.disc, args.shop_font_out)
    extract_battlecmd_data(args.disc, args.battlecmd_out)
    extract_enemy_stat_table(args.disc, args.battlecmd_out)
    extract_wfight_loader_data(args.disc, args.wfight_out)
    extract_report_data(args.disc, args.report_out)
    extract_memcard_data(args.disc, args.memcard_out)
    extract_gym_data(args.disc, args.gym_out)
    extract_lab_data(args.disc, args.lab_out)
    extract_dialogue_data(args.disc, args.dialogue_out)
    extract_digimon_profiles(args.disc, args.profiles_out)
    print(f"{args.out}: {len(result['bytes'])} data bytes; no executable image")
    print(f"{args.shop_out}: 28 indexed shop text banks; no executable image")
    print(f"{args.album_out}: 21 indexed album text banks (card names, card text, album chrome); no executable image")
    print(f"{args.inn_out}: 7 inn (eshtlnam) text banks; no executable image")
    print(f"{args.place_out}: 14 location card text banks, the name table and bar templates; no executable image")
    print(f"{args.name_out}: 14 naming text banks and the data tail; no executable image")
    print(f"{args.wizard_out}: 21 wizard text banks, the data tail and the member table; no executable image")
    print(f"{args.pause_out}: 42 pause text banks, the data tail and its own resident tables; no executable image")
    print(f"{args.battlecmd_out}: 7 battle command text banks, the command and joke configs, blit rectangle, marker strip and the 193-record enemy stat table; no executable image")
    print(f"{args.wfight_out}: 5 battle boot loader packs and 49 bank sector counts; no executable image")
    print(f"{args.report_out}: 7 fight report text banks and the data tail; no executable image")
    print(f"{args.memcard_out}: 14 memory card text banks and the data tail; no executable image")
    print(f"{args.gym_out}: 7 gym text banks, the data tail, the signature table and 12 TRANIN packs; no executable image")
    print(f"{args.lab_out}: 7 lab text banks, the data tail and resident tables; no executable image")
    print(f"{args.dialogue_out}: 4 resident ranges, 10 English ESTALK and 11 English ESDMG packs; no executable image")
    print(f"{args.profiles_out}: the one cut of the 55-record Digimon profile table every screen reads; no executable image")
    print(f"{args.shop_catalog_out}: 31 merchant stock records; no executable image")
    print(f"{args.shop_font_out}: 13458 resident font data bytes; no executable image")


if __name__ == "__main__":
    main()
