// web/ui-lab-screens.js -- the screen table of the ui-lab "Remaster vs Pixel" view: one row per screen id of the menu inventory, with
// the key script that opens it in the real game. No disc data here: ids, labels, keys and lab calls only.
//
//   id      the screen id (the same id the build tasks T1..T9 use)
//   label   what the sidebar shows
//   task    the build task that hooks the screen into look C (T1..T9), or "pixel" = left pixel by design
//   parent  the screen this one is reached from (its steps run first)
//   steps   [["eval", js] | ["press", key, times?] | ["wait", ms]], null = not scripted yet (the inventory gives no key script)
//   needs   seeds this screen needs: "items" (the bag), "bits" (money), "party", "charIdx" (battle)
//
// Keys: Enter = cross (confirm), Escape = back, K = circle, V = square, I = start, E = R1, Q = L1.
// Pause home rows: 0 ITEMS, 1 SORT, 2 MAP, 3 TECHNIQUES, 4 STATUS, 5 CARD FOLDERS, 6 QUESTS, 7 GLOSSARY, 8 OPTIONS.

const open = (js: string) => ["eval", js];
const press = (key: string, n = 1) => ["press", key, n];
const wait = (ms: number) => ["wait", ms];
/** Open the pause home and go to a row: __labOpen('menu'), the cursor down `row` times, Enter. */
const home = (row: number | undefined) => [open("__labOpen('menu')"), wait(700), ...(row ? [press("ArrowDown", row)] : []), press("Enter")];

/** Field techniques for the lead partner (form 30 equipped, Small Heal 0xb8 + Mega Heal 0xb9 in its ledger slots). */
const TECH_SEED = "Object.assign(__state.partnerStats, { formLedger: [{ id: 30, formLevel: 5, dvexp: 0, techSlots: [0xb8, 0xb9, 0, 0, 0, 0] }], equippedForms: [30] })";

export const SEEDS = Object.freeze({
    items: "import('./vendor/engine.js').then((e) => [70, 71, 66, 43, 92, 236, 292, 402, 91].forEach((id) => e.storeAddItem(__state, id, 1)))",
    bits: "__state.bits = 99999",
    party: null,                                    // __labOpen seeds the three starters itself
    charIdx: "__state.charIdx = 1",
});

export const LAB_SCREENS = Object.freeze([
    { id: "home", label: "Pause home", task: "T1", steps: [open("__labOpen('menu')"), wait(700)] },
    { id: "items", label: "Items categories", task: "T1", parent: null, needs: ["items"], steps: home(0) },
    { id: "folders", label: "Card Folders", task: "T1", needs: ["items"], steps: home(5) },
    { id: "demo", label: "Digivolve Demo setup", task: "T1", steps: [open("__labOpen('demosetup')"), wait(700)] },
    { id: "help", label: "Help counter: topics", task: "T1", steps: [open("import('./vendor/engine.js').then((m) => __helpMenu.open(m.ui.helpMenuFor(210, 8)))"), wait(900)] },
    { id: "inn", label: "Inn: Stay / Do not stay", task: "T1", steps: [open("__labOpen('inn')"), wait(900)] },
    { id: "lab", label: "DRI lab root", task: "T1", steps: [open("__labOpen('dri')"), wait(900)] },
    { id: "counter", label: "Shop counter", task: "T1", steps: [open("__labOpen('shop',0)"), wait(900)] },
    { id: "sellCat", label: "Sell categories", task: "T1", parent: "counter", steps: [press("ArrowDown"), press("Enter")] },    // Buy is row 0, Sell row 1
    { id: "cardShop", label: "Card shop root", task: "T1", steps: [open("__labOpen('cardshop')"), wait(900)] },
    { id: "deck", label: "Deck: folder chooser", task: "T1", steps: [open("__labOpen('carddeck')"), wait(900)] },

    { id: "formation", label: "Sort: choose partner", task: "T2", steps: home(1) },
    { id: "swap", label: "Sort: switch with who?", task: "T2", parent: "formation", steps: [press("Enter")] },
    { id: "techPartner", label: "Techniques: partner", task: "T2", steps: home(3) },
    // the lab partners know no technique: give the lead an equipped form with Small Heal + Mega Heal (ids 0xb8 / 0xb9) in its slots, then
    // wait out the picker's unroll (it ignores Enter for about 3 s)
    { id: "techList", label: "Technique list", task: "T2", parent: "techPartner", steps: [open(TECH_SEED), wait(3000), press("Enter"), wait(1500)] },
    { id: "statusPartner", label: "Status: partner", task: "T2", steps: home(4) },
    { id: "labPartner", label: "DRI partner chooser", task: "T2", parent: "lab", steps: [press("Enter")] },
    { id: "gym", label: "Gym partner", task: "T2", steps: [open("__labOpen('gym')"), wait(900)] },
    { id: "itemTarget", label: "Item target partner", task: "T2", parent: "bag", steps: [press("Enter")] },
    { id: "equipWho", label: "Equip who?", task: "T2", needs: ["bits"], steps: [open("__labOpen('shop',0)"), wait(900), press("Enter", 5)] },    // Buy, Short Sword, 1, Buy, Equip? yes
    { id: "switch", label: "Switch Digimon", task: "T2", parent: "labPartner", steps: [press("Enter")] },

    { id: "bag", label: "Items bag", task: "T3", parent: "items", steps: [press("Enter")] },
    { id: "techTarget", label: "Technique target", task: "T3", parent: "techList", steps: [press("Enter"), wait(900)] },
    { id: "equipGrid", label: "Equipment item grid", task: "T3", parent: "equipment", needs: ["items"], steps: [press("Enter"), wait(900)] },
    { id: "buy", label: "Shop buy list", task: "T3", parent: "counter", steps: [press("Enter")] },
    { id: "sellList", label: "Sell list", task: "T3", parent: "sellCat", steps: [press("Enter")] },
    { id: "pawnBuy", label: "Pawn shop buy list", task: "T3", steps: [open("__labOpen('shop',1)"), wait(900), press("Enter"), wait(900)] },
    { id: "album", label: "Card album", task: "T3", needs: ["items"], parent: "folders", steps: [press("Enter")] },
    { id: "deckActions", label: "Deck: folder actions", task: "T3", parent: "deck", steps: [press("Enter")] },
    { id: "deckGrid", label: "Deck: card grid", task: "T3", parent: "deckActions", steps: [press("Enter")] },
    { id: "cardBuy", label: "Card shop: Buy One Card", task: "T3", parent: "cardShop", steps: [press("Enter")] },
    // lab root choice 2 (Down twice), the "See whose digivolve?" capsules (wait out their unroll), Enter on the lead
    { id: "chart", label: "Digivolve Chart", task: "T3", parent: "lab", steps: [press("ArrowDown", 2), press("Enter"), wait(2500), press("Enter"), wait(2500)] },
    { id: "drill", label: "Gym drill grid", task: "T3", parent: "gym", steps: [press("Enter")] },

    { id: "statusSheet", label: "Status sheet", task: "T4", parent: "statusPartner", steps: [wait(3000), press("Enter"), wait(1500)] },
    { id: "digivolve", label: "Status: See Digivolve", task: "T4", parent: "statusSheet", steps: [press("Enter"), wait(900)] },
    { id: "equipment", label: "Status: See Equipment", task: "T4", parent: "statusSheet", steps: [press("ArrowDown"), press("Enter"), wait(900)] },
    { id: "effects", label: "Weapon effects card", task: "T4", parent: "buy", steps: [press("K"), wait(900)] },
    { id: "pawnEffects", label: "Pawn accessory effects", task: "T4", parent: "pawnBuy", steps: [press("K")] },
    { id: "gymResult", label: "Gym result", task: "T4", steps: null },
    { id: "report", label: "Fight report EXP", task: "T4", steps: [open("__labOpen('fightreport')"), wait(900)] },
    { id: "reportLevel", label: "Fight report level-up", task: "T4", steps: [open("__labOpen('fightreport',60)"), wait(900), press("Enter"), wait(1500), press("Enter"), wait(1500)] },
    { id: "battleWon", label: "Battle Won!", task: "T4", steps: null },

    { id: "buyQty", label: "How many?", task: "T5", parent: "buy", steps: [press("Enter")] },
    { id: "buyConfirm", label: "Buy / No", task: "T5", parent: "buyQty", steps: [press("Enter")] },
    { id: "equip", label: "Equip?", task: "T5", parent: "buyConfirm", needs: ["bits"], steps: [press("Enter"), wait(600)] },   // Buy on a weapon -> Equip? Yes / No
    { id: "equipped", label: "Equipped.", task: "T5", parent: "equipWho", steps: [press("Enter"), wait(900)] },
    { id: "sellQty", label: "How many to sell?", task: "T5", parent: "sellList", steps: [press("Enter")] },
    { id: "sellConfirm", label: "Sell / No", task: "T5", parent: "sellQty", steps: [press("Enter")] },
    // bits 0 BEFORE the shop opens (the shop keeps its own copy of the purse): Buy, then the first item -> "Not enough BIT."
    { id: "refusal", label: "Cannot buy", task: "T5", steps: [open("(__state.bits = 0, __labOpen('shop',0))"), wait(900), press("Enter"), wait(300), press("Enter"), wait(600)] },
    { id: "cardBuyConfirm", label: "Card buy confirm", task: "T5", parent: "cardBuy", steps: [press("Enter")] },
    { id: "gymConfirm", label: "Gym confirm", task: "T5", parent: "drill", steps: [press("Enter")] },
    { id: "saveConfirm", label: "Save confirm window", task: "T7", parent: "save", steps: [press("Enter")] },
    { id: "loadConfirm", label: "Load confirm window", task: "T7", parent: "load", steps: [press("Enter")] },
    { id: "yesno", label: "Yes/No question box", task: "T5", steps: [open("import('./vendor/engine.js').then((m) => __yesNoBox.open(m.ui.YESNO_LAUNCHERS[0]))"), wait(900)] },
    { id: "choice", label: "Choice list", task: "T5", steps: [open("__choice.open('Take on this quest?', ['Yes', 'No', 'Maybe later'], () => {})"), wait(900)] },

    { id: "itemUse", label: "Item use message", task: "T6", parent: "itemTarget", steps: [press("Enter"), wait(1200), press("Enter"), wait(1200), press("Enter"), wait(1200)] },
    { id: "placecard", label: "Place-name card", task: "T6", steps: [open("__labOpen('placecard')"), wait(900)] },
    { id: "talk", label: "Speech balloon", task: "T6", steps: [open("__labOpen('textbox')"), wait(900)] },
    { id: "talkPlain", label: "Plain dialogue window", task: "T6", steps: [open("__labOpen('textbox_plain')"), wait(900)] },
    { id: "talkLegacy", label: "Legacy textbox", task: "T6", steps: [open("__labOpen('textbox_legacy')"), wait(900)] },
    { id: "helpPage", label: "Help counter: topic page", task: "T6", parent: "help", steps: [press("Enter")] },

    { id: "map", label: "Pause map", task: "T7", steps: home(2) },
    { id: "deckRename", label: "Deck: rename keyboard", task: "T7", parent: "deckActions", steps: [press("ArrowDown"), press("Enter")] },
    { id: "language", label: "Language select", task: "T7", steps: [open("__labOpen('cntysel')"), wait(900)] },
    { id: "registration", label: "Pack select / registration", task: "T7", steps: [open("__labOpen('packselect')"), wait(900)] },
    { id: "name", label: "Name entry", task: "T7", steps: [open("__labOpen('nameentry')"), wait(900)] },
    { id: "nameKeys", label: "Name entry keyboard", task: "T7", parent: "name", steps: [press("Enter")] },
    { id: "assetmode", label: "Choose Visual Style", task: "T7", steps: [open("__labOpen('assetmode')"), wait(900)] },
    { id: "end", label: "END card", task: "T7", steps: [open("__labOpen('endscreen')"), wait(900)] },
    { id: "save", label: "Save slots", task: "T7", steps: [open("__labOpen('save')"), wait(900)] },
    { id: "load", label: "Load slots", task: "T7", steps: [open("__labOpen('load')"), wait(900)] },

    { id: "commands", label: "Battle command menu", task: "T8", needs: ["charIdx"], steps: [open("__battle.start({ enemyId: 'Kunemon', enemyLevel: 1, enemyHp: 60000, enemyMp: 999, screenId: 34, mapId: 's330' })"), wait(2500)] },
    { id: "battleMsg", label: "Battle message box", task: "T8", parent: "commands", steps: [press("Enter")] },
    { id: "tech", label: "Battle tech list", task: "T8", parent: "commands", steps: [press("ArrowDown"), press("Enter")] },
    { id: "dv", label: "Battle digivolve forms", task: "T8", parent: "commands", steps: [press("ArrowDown", 2), press("Enter")] },
    { id: "tag", label: "Battle tag partner", task: "T8", parent: "commands", steps: [press("ArrowDown", 3), press("Enter")] },
    { id: "item", label: "Battle item list", task: "T8", parent: "commands", steps: [press("ArrowDown", 4), press("Enter")] },

    { id: "quests", label: "Quests", task: "T9", steps: home(6) },
    { id: "glossary", label: "Glossary: Digimon list", task: "T9", steps: home(7) },
    { id: "glossary2", label: "Glossary: Digimon page 2", task: "T9", parent: "glossary", steps: [press("E")] },
    { id: "glossaryItems", label: "Glossary: Items tab", task: "T9", parent: "glossary2", steps: [press("E")] },
    { id: "optGame", label: "Options GAME", task: "T9", steps: home(8) },
    { id: "optScreen", label: "Options SCREEN", task: "T9", parent: "optGame", steps: [press("E")] },
    { id: "optSound", label: "Options SOUND", task: "T9", parent: "optScreen", steps: [press("E")] },
    { id: "optEffects", label: "Options EFFECTS", task: "T9", parent: "optSound", steps: [press("E")] },
    { id: "optEffectsCat", label: "Effects switch list", task: "T9", parent: "optEffects", steps: [press("Enter")] },
    { id: "mapscreen", label: "Map screen book", task: "T9", steps: [open("__openMapScreen()"), wait(900)] },
    { id: "fly", label: "FLY book (empty)", task: "T9", steps: [open("__fx.fly = true; __openBook('fly')"), wait(900)] },

    { id: "field", label: "Field", task: "pixel", steps: null },
    { id: "title", label: "Title: Press Start", task: "pixel", steps: [open("__labOpen('titlescreen')"), wait(900)] },
]);

/** The steps of a row, its parents' first. Returns null when any step of the chain is not scripted. */
export function stepsFor(id: string, table = LAB_SCREENS) {
    const byId = new Map(table.map((r) => [r.id, r]));
    const chain = [];
    for (let r = byId.get(id), guard = 0; r && guard < 12; r = r.parent ? byId.get(r.parent) : null, guard++) {
        if (!r.steps) return null;
        chain.unshift(...r.steps);
    }
    return chain.length ? chain : null;
}

/** The seeds a row (and its parents) need, in order, without repeats. */
export function needsFor(id: string, table = LAB_SCREENS) {
    const byId = new Map(table.map((r) => [r.id, r]));
    const out: string[] = [];
    for (let r = byId.get(id), guard = 0; r && guard < 12; r = r.parent ? byId.get(r.parent) : null, guard++) for (const n of r.needs ?? []) if (!out.includes(n)) out.push(n);
    return out;
}
