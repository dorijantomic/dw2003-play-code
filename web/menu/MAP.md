# web/menu
The pause menu: ITEMS, SORT, MAP, TECHNIQUES, STATUS, See Digivolve and the full EQUIP screen — one state object, its per-screen drawing, and its pure selectors.
web/menu.ts re-exports the public surface; createMenu() is the object the game loop drives (m.handleKey / m.update / m.draw).

| file | lines | job | main exports |
|---|---|---|---|
| create.ts | 1215 | builds the menu object: state fields, key handler, per-frame update, screen draw dispatch | createMenu |
| draw-common.ts | 256 | shared plates: party cards, sidebar, header/footer, home list, swap bracket | gold, valueText, white, _drawCard, _drawSidebar |
| draw-digivolve.ts | 312 | the See Digivolve screen and the status detail sheet under it | _drawSeeDigivolve, _drawDetail |
| draw-items.ts | 333 | ITEMS tab/list screen and the full EQUIP slot screen | _drawItems, _drawEquip, GREY |
| draw-map.ts | 233 | world MAP pane: cursor/pan move, location list, techniques table | _mapMove, _drawMapPane, _stepHeldLists, _drawTechniques |
| logic.ts | 322 | menu logic with no pixels: cursor moves, item use, equip maths, tech slots | ensureEquipment, formTechSlots, moveCursor, sheetStatValue, seeDigivolvePanelStat |
| pure.ts | 210 | strings, layout constants and pure selectors every menu screen reads | EQUIP_SLOTS, VSYNC, ststat, ITEM_CATS, cmfont |
| state.ts | 4 | the menu's one shared object: the decoded UI layout | MS |
| types.ts | 101 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- add/reorder a top-menu row (incl. CARD FOLDERS, demo row) -> pure.ts (TOP_ITEMS_BASE, topItems)
- a cursor press that beeps, or one that must not -> logic.ts (moveCursor, cue words)
- which bag ids an ITEMS tab lists -> logic.ts (ITEM_CAT_KINDS) + create.ts (m.itemList)
- equipment bonuses / sheet stat numbers -> logic.ts (syncEquipBonuses, sheetStatValue)
- map pan vs cursor geometry -> draw-map.ts (_mapMove, _drawMapPane)
