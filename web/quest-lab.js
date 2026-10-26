// A test panel for the extra quests (open the game with ?questlab=1, or via quest-lab.html).
//
// Every quest is listed with two buttons:
//   Go     makes the quest startable (its prerequisites done, no story needed), puts its characters on the map, and stands you
//          in front of the one who gives it. Press Enter to talk and the scene plays.
//   Goals  meets all of its objectives at once, so you can see the turn-in scene and the reward.
// "Hide" folds the panel into a small tab. "Reset quests" clears the quest layer's own progress. Nothing here touches the story or the normal save.
const $ = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const css = `
#questlab[hidden],#questlab-tab[hidden]{display:none}
#questlab-tab{position:fixed;top:8px;right:8px;z-index:99999;font:12px system-ui,sans-serif;padding:3px 8px}
#questlab{position:fixed;top:8px;right:8px;z-index:99999;width:300px;max-height:92vh;overflow:auto;background:#0d1b2acc;color:#e8f1fa;
  font:12px/1.35 system-ui,sans-serif;border:1px solid #5aa0d0;border-radius:6px;padding:8px}
#questlab h4{margin:0 0 6px;font-size:13px;display:flex;justify-content:space-between;align-items:center}
#questlab .q{border-top:1px solid #34546e;padding:5px 0}
#questlab .t{font-weight:600}#questlab .s{opacity:.75;font-size:11px}
#questlab button{font:inherit;margin:3px 4px 0 0;padding:2px 8px;border-radius:4px;border:1px solid #5aa0d0;background:#1e4a6b;color:#fff;cursor:pointer}
#questlab button:hover{background:#2b6a99}#questlab .msg{margin:4px 0;color:#ffd77a}`;

function ready() {
  return window.__quests?.defs?.length && window.__state?.started && window.__state?.scenes;
}

/** Put a quest's characters on the current map regardless of the story state (their spawn flags), one record each. */
function showCast(def) {
  const scene = window.__state.scenes[window.__quests.where().lastMap];
  if (!scene) return [];
  const want = new Set([def.offer?.npc, def.turnIn?.npc, ...def.objectives.filter((o) => o.type === "talk").map((o) => o.npc)].filter((n) => n != null));
  const done = new Set(), here = [];
  scene.npcs = scene.npcs.filter((n) => {
    if (!want.has(n.npc_id)) return true;
    if (done.has(n.npc_id)) return false;
    done.add(n.npc_id); n.spawn_flags = []; here.push(n.npc_id); return true;
  });
  scene._cast = null;                       // the stage cast is built once on entry: rebuild it from the records above
  return here;
}

function go(def, say) {
  const q = window.__quests, st = window.__state;
  const giver = def.offer ?? def.objectives.find((o) => o.type === "talk") ?? null;
  const where = q.where().lastMap;
  const mapOf = (r) => r?.maps?.find((m) => m === where) ?? r?.maps?.[0] ?? null;
  const target = giver ? mapOf(giver) : null;
  const info = q.lab.prepare(def.id);
  if (info.level > 1) for (const p of [st.partnerStats, ...(Array.isArray(st.partyStats) ? st.partyStats : [])]) if (p && (p.level ?? 1) < info.level) p.level = info.level;
  if (target && target !== where) {
    sessionStorage.setItem("questlabGo", def.id);
    const u = new URL(location.href); u.searchParams.set("map", target); location.href = u.toString();
    return;
  }
  const here = showCast(def);
  const npc = giver && window.__state.scenes[where]?.npcs.find((n) => n.npc_id === giver.npc);
  if (npc) { st.x = npc.x; st.y = npc.y + 36; st.dir = "up"; st.moving = false; say(`Standing in front of ${giver.name ?? "the giver"}. Press Enter to talk.`); }
  else say(here.length ? "Characters are on the map." : "No giver on this map.");
}

function build() {
  document.head.append($("style", { textContent: css }));
  const box = $("div", { id: "questlab" });
  const msg = $("div", { className: "msg" });
  const say = (t) => { msg.textContent = t; };
  const list = $("div");
  const search = $("input", { type: "search", placeholder: "search title, giver, place, id..." });
  search.style.cssText = "width:100%;box-sizing:border-box;margin:4px 0;padding:3px 6px;font:inherit";
  const count = $("div", { className: "s" });
  search.addEventListener("input", () => refresh());
  const refresh = () => {
    list.textContent = "";
    const needle = search.value.trim().toLowerCase();
    let shown = 0;
    for (const d of window.__quests.defs) {
      if (!d.offer && !d.objectives.some((o) => o.type === "talk")) continue;      // board and route jobs have no scene to see
      if (needle && !`${d.id} ${d.title} ${d.giver ?? ""} ${d.short ?? ""} ${(d.offer?.maps ?? []).join(" ")} ${window.__quests.status(d.id)}`.toLowerCase().includes(needle)) continue;
      if (++shown > 40) continue;                                                  // keep the panel light with hundreds of quests
      list.append($("div", { className: "q" },
        $("div", { className: "t" }, d.title),
        $("div", { className: "s" }, `${d.giver ?? ""} · ${window.__quests.status(d.id)}${d.offer?.scene || d.objectives.some((o) => o.scene) ? " · scene" : ""}`),
        $("button", { textContent: "Go", onclick: () => { go(d, say); setTimeout(refresh, 300); } }),
        $("button", { textContent: "Goals", onclick: () => { say(window.__quests.lab.finishGoals(d.id) ? "Goals met. Talk to the giver." : "Nothing to finish."); refresh(); } })));
    }
    const total = window.__quests.defs.filter((d) => d.offer || d.objectives.some((o) => o.type === "talk")).length;
    count.textContent = `${Math.min(shown, 40)} shown of ${shown} matching, ${total} quests with a giver`;
  };
  const hide = $("button", { textContent: "Hide" });
  const head = $("h4", {}, "Quest lab",
    $("span", {}, $("button", { textContent: "Reset quests", onclick: () => { window.__quests.lab.reset(); say("Quest progress cleared."); refresh(); } }), " ", hide));
  box.append(head, msg, search, count, list);
  document.body.append(box);
  // keys typed into the game must not be taken by the panel
  box.addEventListener("keydown", (e) => e.stopPropagation());
  // "Hide" folds the panel into a small "Quest lab" tab; clicking the tab brings it back
  const tab = $("button", { id: "questlab-tab", textContent: "Quest lab", hidden: true,
    onclick: () => { box.hidden = false; tab.hidden = true; } });
  hide.onclick = () => { box.hidden = true; tab.hidden = false; };
  document.body.append(tab);
  refresh();
  setInterval(() => { if (document.activeElement !== search) refresh(); }, 4000);
  const pending = sessionStorage.getItem("questlabGo");
  if (pending) { sessionStorage.removeItem("questlabGo"); const d = window.__quests.defs.find((x) => x.id === pending); if (d) setTimeout(() => go(d, say), 800); }
}

const wait = setInterval(() => { if (ready()) { clearInterval(wait); build(); } }, 300);
