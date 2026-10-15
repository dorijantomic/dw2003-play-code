# Notes for agents working in this repo

Short pointers to knowledge that is easy to lose. Read the linked file before touching the area.

## Extra quests and new characters (a layer on top of the game, never part of the story)

- Read first: `docs/quests-bible.md` (design rules, stages, how to add quests), `docs/quests-lore.md` (Digimon World 3 plot and
  hooks), `docs/quests-art-brief.md` (new characters and sprites), `docs/quests-plan.md` (engine side).
- Quests are built, not hand-edited: sources in `data/authored/quests/` (`pack_*.py` written with `dsl.py`, `legacy.json`,
  `characters.json`, `new_characters.json`), `python3 tools/build_quests.py` writes `web/quests.json`,
  `python3 tools/check_quests.py` must say OK. Only ids listed in `data/authored/quests/shipped.txt` ship; the rest are drafts.
  Quest ids are append-only (progress is stored by id).
- Quality bar: a small story with a turn, more than one kind of step, often a choice at hand-in (`verdict=`). Not "go here, talk
  to X, kill N". A character's ordinary chat always comes first; quests never swallow a hint the player needs.
- Quests never write story flags or the master story counter. Text may use only letters, digits and `. , ' - : " ! ?`.
- New characters (npc_id 1000+): put an image-generator picture in `data/authored/quests/art/`, add an entry to
  `new_characters.json`, run `python3 tools/make_quest_sprites.py`. Background removal, sizing, walk and idle-breathing clips are
  automatic. Style references cut from game sprites go in `art/ref/` and are git-ignored.
- Never commit game data or anything derived from the disc (`web/assets`, `docs/generated/*`, `extra_species.json`).
- Try it: `web/quest-lab.html` (test panel, Go / Goals per quest) with `python3 -m http.server 8770 --directory web`.
