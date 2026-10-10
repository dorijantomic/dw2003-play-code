-- Pause-menu explorer: map every pause screen and every button edge on the
-- original game, from one saved moment, without a human in the loop.
--
-- Method (Go-Explore style, see docs/workflow/pause-explorer.md):
--   * A screen is named by a KEY: which pause objects are alive, a few words of
--     each (step number, cursors, choices), the chosen row/variant, the scene,
--     and a hash of the save data (party, bag, money, roster). Words come from
--     PAUSE_SPEC (tools/build_pause_explorer_spec.py).
--   * Objects are found with NO code hooks: every frame the explorer walks the
--     resident task table and each object's child array, and matches the main
--     routine each object keeps at +0x48. On this core each exec hook slows the
--     whole emulator (116 hooks: 2.4 fps; 1 hook: 49.4 of 50 fps), so the only
--     hook left is the one on the sound routine.
--   * Each new screen is saved to a state file once its key has held still for
--     SETTLE frames. Every button is then tried from that file: load, idle WARM
--     frames, hold the button HOLD frames, watch until the key holds still again.
--   * An edge records the button, the screens passed through with their frame
--     offsets, the sounds played, and the page steps reached for the first time.
--   * Each settled moment also gets a SHADOW: a hash of the first SHADOW bytes
--     of every running routine's object, leaving out words that moved while the
--     key held still. When a known screen is reached again with a different
--     shadow, that moment is saved as an alternate (up to MAX_ALTS) and every
--     button is replayed from it. Two different results from one key mean the
--     key is too coarse (the Ape refinement check).
--
-- Safety:
--   * Runs only while the player guard says control=agent (game_driver.py
--     explore takes control, saves the starting moment and restores it).
--   * Stops on: an empty queue, a node/trial/frame budget, the STOP file in the
--     run folder, a guard error, or any Lua error. Hooks are removed on stop.
--   * Hook callbacks never return a value: a numeric return from a BizHawk
--     memory callback replaces the accessed value.
--
-- Arm (from WSL, through the locked driver):
--   python3 tools/windows-rig/game_driver.py explore <name> --control ...
-- Status:  PXP.status()      Stop:  PXP.stop("reason")

local ROOT = BIZHAWK_RIG_ROOT or "C:/bizhawk-rig"
local CFG = PAUSE_EXPLORE_CFG or {}
local RUN = assert(CFG.run, "set PAUSE_EXPLORE_CFG.run")
local OUT = CFG.out or (ROOT .. "/dumps/pause-explore/" .. RUN)
local STATES = CFG.states or (ROOT .. "/states/pxp-" .. RUN)
if not PAUSE_SPEC then dofile(CFG.spec or (ROOT .. "/pause-explorer-spec.lua")) end
local SPEC = assert(PAUSE_SPEC, "PAUSE_SPEC missing")

local WARM = CFG.warm or 8          -- idle frames after a load, before the press
local HOLD = CFG.hold or 4          -- frames the button is held
local SETTLE = CFG.settle or 30     -- frames the key must hold still
local MAXF = CFG.max_frames or 900  -- frames to wait for a settle after the press
local MAX_NODES = CFG.max_nodes or 300
local MAX_TRIALS = CFG.max_trials or 6000
local MAX_DEPTH = CFG.max_depth or 40
local CALIBRATE = CFG.calibrate or 120
local SHADOW = CFG.shadow or 0x200
local MAX_ALTS = CFG.max_alts or 2
local BUTTONS = CFG.buttons or {"Up", "Down", "Left", "Right", "Cross", "Circle",
  "Square", "Triangle", "Start", "Select", "L1", "R1", "L2", "R2"}
local DPAD = {Up = true, Down = true, Left = true, Right = true}

local MASK = 0x1fffff
local function rd32(a) return memory.read_u32_le(a & MASK, "MainRAM") end
local function hex(v) return string.format("%x", (v or 0) & 0xffffffff) end

-- ---------------------------------------------------------------- output ----

local function esc(s)
  return (tostring(s):gsub('[%c"\\]', function(c)
    return string.format("\\u%04x", string.byte(c))
  end))
end

local function json(v)
  local t = type(v)
  if t == "table" then
    if #v > 0 or next(v) == nil then
      local out = {}
      for i = 1, #v do out[i] = json(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = '"' .. esc(k) .. '":' .. json(v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  elseif t == "number" then
    return (math.type and math.type(v) == "integer") and string.format("%d", v) or tostring(v)
  elseif t == "boolean" then
    return tostring(v)
  elseif v == nil then
    return "null"
  end
  return '"' .. esc(v) .. '"'
end

local function append(file, value)
  local f = assert(io.open(OUT .. "/" .. file, "a"))
  f:write(json(value), "\n")
  f:close()
end

local function exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

-- ----------------------------------------------------------------- state ----

local P = {
  frame = 0, phase = "calibrate", n = 0,
  keys = {}, key_ids = 0,          -- key string -> id
  nodes = {}, by_key = {},          -- node list; key -> node
  queue = {}, qi = 1,               -- tasks {node, button, alt}
  trials = 0, edges = 0, alt_checks = 0, coarse = 0, unsettled = 0,
  steps = {}, sounds = {},
  volatile = {}, guids = {}, stopped = false, reason = nil,
}
PXP = P

local pages, by_handler = {}, {}
for i, pg in ipairs(SPEC.pages) do
  pages[i] = {name = pg.name, handler = pg.handler, words = pg.words, fields = pg.fields,
              -- the field each tick switches on: +0x0C for the list and the
              -- host, +0x10 for the pages (their ticks' `switch (r(0x10))`)
              step_off = (pg.name == "top" or pg.name == "host") and 0xc or 0x10,
              cases = pg.steps}
  by_handler[pg.handler] = pages[i]
end

-- The trace case file (see trace mode below), loaded here so the walk can use it.
local T = CFG.trace and dofile(CFG.trace) or nil
-- T.page_range = {lo, hi}: any object whose routine table lies in that range is a
-- page too, keyed by its four step words (+0x0C..+0x18). This lets a trace watch
-- a screen that the pause spec does not describe (a shop overlay).
local RANGE_FIELDS = {0xc, 0x10, 0x14, 0x18}
local function range_page(h)
  local r = T and T.page_range
  if not r or h < r[1] or h >= r[2] then return nil end
  local name = "ov" .. string.format("%x", h)
  if not by_handler[h] then
    by_handler[h] = {name = name, handler = h, words = {}, fields = RANGE_FIELDS, step_off = 0x10, cases = {}}
  end
  return by_handler[h]
end

-- T.scene_roots: the traced screen's own scene roots (found like the pause one).
if T and T.scene_roots then
  SPEC.scene_roots = SPEC.scene_roots or {}
  for _, r in ipairs(T.scene_roots) do SPEC.scene_roots[#SPEC.scene_roots + 1] = r end
end

local OBJ = SPEC.object
local root_handler_of = {}
for _, r in ipairs(SPEC.scene_roots or {}) do root_handler_of[r.handler] = r.handler end
local function ram_ptr(v) return v >= 0x80000000 and v < 0x80200000 and v % 4 == 0 end

-- Scene roots no global points to: found by one bounded heap scan per scene
-- (the scene's first object is the first heap allocation), then re-checked
-- each frame by its routine word.
local function root_ok(obj, r)
  if not ram_ptr(obj) or rd32(obj + OBJ.handler) ~= r.handler then return false end
  for j, w in ipairs(r.words) do
    if rd32(r.handler + (j - 1) * 4) ~= w then return false end
  end
  return true
end

local SCENE_ID = 0
for _, g in ipairs(SPEC.globals) do if g.name == "scene_id" then SCENE_ID = g.addr end end

local function scene_roots()
  local scene = rd32(SCENE_ID)
  local cache = P.roots
  if cache and cache.scene == scene then
    local ok = true
    for _, found in ipairs(cache.list) do if not root_ok(found[1], found[2]) then ok = false end end
    if ok and (#cache.list > 0 or P.frame - cache.frame < 30) then return cache.list end
  end
  local list = {}
  local base = rd32(SPEC.heap.start_word)
  if ram_ptr(base) then
    for a = base, base + SPEC.heap.window - 4, 4 do
      local v = rd32(a + OBJ.handler)
      for _, r in ipairs(SPEC.scene_roots or {}) do
        if v == r.handler and root_ok(a, r) then list[#list + 1] = {a, r} end
      end
    end
  end
  P.roots = {scene = scene, list = list, frame = P.frame}
  return list
end

-- The object tree, walked once per frame: task slots and scene roots, then
-- child arrays.
-- Returns the live pause pages {page, obj} in walk order and every handler seen.
local function walk()
  if P.walk_frame == P.frame then return P.walk_live, P.walk_handlers end
  local live, handlers, seen = {}, {}, {}
  local function visit(obj, depth, parent)
    if depth > 6 or seen[obj] or not ram_ptr(obj) then return end
    seen[obj] = true
    local h = rd32(obj + OBJ.handler)
    handlers[h] = true
    local pg = by_handler[h] or range_page(h)
    local mine = parent
    if pg then
      local here = true
      for j, w in ipairs(pg.words) do
        if rd32(h + (j - 1) * 4) ~= w then here = false break end
      end
      if here then
        live[#live + 1] = {page = pg, obj = obj}
        mine = live[#live]
        if parent then parent.has_child = true end
      end
    end
    -- Descend only where a page can hang: from a task slot (the list is a child
    -- of the field's objects), and from the scene root, the host and the pages
    -- (a page holds its child page). Widgets hold no pages, and every Lua read
    -- is slow, so their arrays are skipped. Each visited object costs 3 reads.
    -- A trace with T.page_range does not know where its screen hangs, so it
    -- descends everywhere down to T.walk_depth (default 4).
    if depth == 0 or pg or h == root_handler_of[h] or (T and T.page_range and depth < (T.walk_depth or 4)) then
      local n, arr = rd32(obj + OBJ.child_count), rd32(obj + OBJ.child_array)
      if n > 0 and n <= 256 and ram_ptr(arr) then
        for i = 0, n - 1 do visit(rd32(arr + 4 * i), depth + 1, mine) end
      end
    end
    P.reads = (P.reads or 0) + 3
  end
  for i = 0, SPEC.tasks.slots - 1 do visit(rd32(SPEC.tasks.addr + 4 * i), 0, nil) end
  for _, found in ipairs(scene_roots()) do visit(found[1], 0, nil) end
  P.walk_frame, P.walk_live, P.walk_handlers = P.frame, live, handlers
  return live, handlers
end

-- Components are {name, value} pairs; the key is their joined text. Keeping the
-- parts lets calibration and the coarse check say WHICH part moved.
local transitional = {}
for _, t in ipairs(SPEC.transitional or {}) do
  transitional[#transitional + 1] = t
end

-- True while a live page sits in a step the spec marks as a wait the key
-- cannot see (a scene change and its disc load).
local function in_transit()
  -- The pause spec's scene-change waits do not apply to another screen's trace.
  if T and T.page_range then return false end
  for _, t in ipairs(transitional) do
    if t.addr and rd32(t.addr) == t.value then
      local done = false
      if t.unless_addr then
        done = rd32(t.unless_addr) == t.unless_value
      else
        for _, l in ipairs(walk()) do
          if l.page.name == t.until_page and rd32(l.obj + t.until_offset) >= t.until_min then done = true end
        end
      end
      if not done then return true end
    end
  end
  for _, l in ipairs(walk()) do
    for _, t in ipairs(transitional) do
      if t.page and l.page.name == t.page and rd32(l.obj + t.offset) == t.value then return true end
    end
  end
  return false
end

local function components()
  local parts = {}
  local live = walk()
  local any = #live > 0
  for _, l in ipairs(live) do
    local vals = {}
    -- A page with a child page open waits in one step; its other fields are
    -- leftovers until the child closes (2026-09-30: the last chosen partner and
    -- item multiplied every bag cell). The list and the host are keyed in full.
    local fields = l.page.fields
    if l.has_child and l.page.name ~= "host" and l.page.name ~= "top" then fields = {fields[1], fields[2]} end
    for _, n in ipairs(SPEC.narrow or {}) do
      if n.page == l.page.name and #fields > n.keep and rd32(l.obj + n.when_offset) == n.when_value then
        local kept = {}
        for k = 1, n.keep do kept[k] = fields[k] end
        fields = kept
      end
    end
    for k, off in ipairs(fields) do vals[k] = hex(rd32(l.obj + off)) end
    -- Derived parts: an item id word keyed by the item's kind (descriptor bytes).
    for _, d in ipairs(SPEC.derived or {}) do
      if d.page == l.page.name and rd32(l.obj + d.when_offset) == d.when_value then
        local id = rd32(l.obj + d.offset)
        local kind = "0"
        if id > 0 and id < 0x1000 then
          local desc = rd32(d.table + id * d.stride)
          if ram_ptr(desc) then
            local b = {}
            for i, off in ipairs(d.bytes) do b[i] = hex(memory.read_u8((desc + off) & MASK, "MainRAM")) end
            kind = table.concat(b, ".")
          end
        end
        vals[#vals + 1] = "k" .. kind
      end
    end
    parts[#parts + 1] = {l.page.name, table.concat(vals, ",")}
  end
  for _, g in ipairs(SPEC.globals) do
    if any or g.name == "scene" or g.name == "scene_id" or g.name == "scene_request" then
      parts[#parts + 1] = {g.name, hex(rd32(g.addr))}
    end
  end
  for _, w in ipairs(SPEC.world) do
    if not P.volatile[w.name] then
      parts[#parts + 1] = {w.name, string.sub(memory.hash_region(w.addr & MASK, w.size, "MainRAM"), 1, 16)}
    end
  end
  return parts, any
end

local function keytext(parts)
  local out = {}
  for i, p in ipairs(parts) do out[i] = p[1] .. "=" .. p[2] end
  return table.concat(out, "|")
end

local function key_id(key)
  local id = P.keys[key]
  if not id then
    P.key_ids = P.key_ids + 1
    id = P.key_ids
    P.keys[key] = id
    append("keys.jsonl", {id = id, key = key})
  end
  return id
end

local function diff(a, b)
  local byname, out = {}, {}
  for _, p in ipairs(a) do byname[p[1]] = p[2] end
  for _, p in ipairs(b) do
    if byname[p[1]] ~= p[2] then out[#out + 1] = p[1] end
    byname[p[1]] = nil
  end
  for name in pairs(byname) do out[#out + 1] = name end
  table.sort(out)
  return out
end

local function snapshot()
  local snap = {}
  for i, l in ipairs(walk()) do
    local words = {}
    for off = 0, SHADOW - 4, 4 do words[#words + 1] = rd32(l.obj + off) end
    snap[l.page.name .. "#" .. i] = words
  end
  return snap
end

-- Words equal in both snapshots, hashed; words that moved are left out.
local function shadow(a, b)
  if not a or not b then return nil end
  local names = {}
  for name in pairs(b) do names[#names + 1] = name end
  table.sort(names)
  local h = 0
  for _, name in ipairs(names) do
    local wa, wb = a[name], b[name]
    for i = 1, #wb do
      local v = (wa and wa[i] == wb[i]) and wb[i] or 0
      h = (h * 31 + v + i) % 4294967291
    end
    for c in string.gmatch(name, ".") do h = (h * 31 + string.byte(c)) % 4294967291 end
  end
  return string.format("%x", h)
end

-- ----------------------------------------------------------------- hooks ----

local function hook(addr, name, fn)
  local g = event.on_bus_exec(fn, addr, name, "System Bus")
  P.guids[#P.guids + 1] = g
end

-- The sound hook alone cuts the emulator from ~171 to 48 frames a second (bench,
-- 2026-09-30), and a hook costs nothing once removed. So it is on from each press
-- until the screen has held still for SOUND_TAIL frames outside a wait, and on
-- again at the next change (that change's own frame can lose a sound: the edge
-- says sound_gap). For the first SOUND_AUDIT trials it stays on, and a sound that
-- plays while it would have been off is counted in late_sounds.
local SOUND_TAIL = CFG.sound_tail or 12
local SOUND_AUDIT = CFG.sound_audit or 300
P.late_sounds, P.sound_gaps = 0, 0
local function sound_hook()
  if P.hooked then return end
  P.hooked = true
  hook(SPEC.sound_entry, "pxp_sound", function()
    local ok, r = pcall(emu.getregisters)
    if ok and type(r) == "table" and r.a0 then
      P.sounds[#P.sounds + 1] = {P.frame, hex(r.a0)}
      if P.cur and P.cur.quiet then
        P.late_sounds = P.late_sounds + 1
        append("late_sounds.jsonl", {trial = P.cur.id, n = P.cur.n, sound = hex(r.a0)})
      end
    end
  end)
end
local function sound_unhook()
  for _, g in ipairs(P.guids) do pcall(event.unregisterbyid, g) end
  P.guids, P.hooked = {}, false
end
if not CFG.bench then sound_hook() end

-- Step coverage: which step values each page reached, and in which trial first.
local function record_steps(trial)
  for _, l in ipairs(walk()) do
    local name = l.page.name
    local v = rd32(l.obj + l.page.step_off)
    local seen = P.steps[name]
    if not seen then seen = {} P.steps[name] = seen end
    if not seen[v] then
      seen[v] = trial
      if P.cur then P.cur.new_steps[#P.cur.new_steps + 1] = name .. ":" .. v end
    end
  end
end

-- ----------------------------------------------------------------- nodes ----

local function field_like(parts)
  for _, p in ipairs(parts) do
    for _, pg in ipairs(pages) do if p[1] == pg.name then return false end end
  end
  return true
end

local function handler_list()
  local _, handlers = walk()
  local out = {}
  for h in pairs(handlers) do
    if h >= 0x80010000 and h < 0x80200000 and not by_handler[h] then out[#out + 1] = h end
  end
  table.sort(out)
  for i, h in ipairs(out) do out[i] = hex(h) end
  return out
end

-- sample_lists: inside a long list, a cursor place moves like its neighbours. So
-- there only Down, Right and Cross are tried: Down and Right still walk the cursor
-- over every place, and Cross still reaches every item's own screen. Every button
-- is tried at the ends.
-- The bag holds 16 cells a page in two columns (pause-bag.ts: Up and Down move by
-- 2, Left and Right by 1, page = cell >> 4); its ends are the first and last row
-- of each page and the tab's last two items.
-- EQUIPMENT's item list (step 0xF) shows 8 rows: +0x64 row, +0x6C scroll top,
-- +0x68 length (pause-equipment.ts case 0xf); its ends are the first and the last
-- screenful, where Up and Down scroll; in the middle only the bottom row walks on.
local SAMPLE_KEEP = {Down = true, Right = true, Cross = true}

local function key_fields(key, page)
  local v = string.match(key, "|" .. page .. "=([^|]*)") or string.match(key, "^" .. page .. "=([^|]*)")
  if not v then return nil end
  local f = {}
  for x in string.gmatch(v, "[^,]+") do f[#f + 1] = tonumber(x, 16) end
  return f
end

local function inside_list(key)
  local f = key_fields(key, "bag")
  if f and #f >= 6 then
    local count, cell = f[4], f[5]
    local at = cell % 16
    return at >= 2 and at < 14 and cell < count - 2
  end
  f = key_fields(key, "equipment")
  if f and #f >= 8 and f[2] == 0xf then
    local index, len = f[7] + f[5], f[6]
    return index > 8 and index < len - 9
  end
  return false
end
P.inside_list = inside_list

local function allowed_button(node, b)
  if node.root and b ~= "Start" then return false end
  if DPAD[b] and not CFG.map_dpad and string.find(node.key, "map=", 1, true) then return false end
  if CFG.sample_lists then
    if inside_list(node.key) and not SAMPLE_KEEP[b] then return false end
  end
  return true
end

local function enqueue(node, alt)
  if node.depth >= MAX_DEPTH then return end
  for _, b in ipairs(P.buttons) do
    local allowed = allowed_button(node, b)
    if allowed then P.queue[#P.queue + 1] = {node = node, button = b, alt = alt} end
  end
end

local function add_node(parts, key, path, depth, from, sh)
  local node = {id = #P.nodes + 1, key = key, key_id = key_id(key), depth = depth,
                path = path, root = (#P.nodes == 0), shadow = sh, alts = {}}
  node.state = STATES .. "/n" .. node.id .. ".State"
  savestate.save(node.state, true)
  client.screenshot(OUT .. "/shots/n" .. node.id .. ".png")
  P.nodes[node.id] = node
  P.by_key[key] = node
  -- A screen whose save data differs from the start (after a swap, a heal, an
  -- equip) is recorded but not explored further unless expand_world is set:
  -- otherwise every screen repeats once per party order.
  local same_world = true
  if P.root_world then
    for _, p in ipairs(parts) do
      if P.root_world[p[1]] ~= nil and P.root_world[p[1]] ~= p[2] then same_world = false end
    end
  else
    P.root_world = {}
    for _, w in ipairs(SPEC.world) do
      for _, p in ipairs(parts) do if p[1] == w.name then P.root_world[p[1]] = p[2] end end
    end
  end
  node.world_changed = not same_world
  node.expand = (node.root or ((not field_like(parts)) and (same_world or CFG.expand_world))
    or CFG.expand_fields) and true or false
  append("nodes.jsonl", {id = node.id, key_id = node.key_id, key = key, depth = depth,
    path = path, from = from, root = node.root, expanded = node.expand, shadow = sh,
    world_changed = node.world_changed,
    state = node.state, shot = "shots/n" .. node.id .. ".png", frame = P.frame,
    other_handlers = handler_list()})
  if node.expand then enqueue(node, false) end
  return node
end

local function add_alt(node, path, sh)
  local alt = {n = #node.alts + 1, path = path, shadow = sh}
  alt.state = STATES .. "/n" .. node.id .. "-alt" .. alt.n .. ".State"
  node.alts[alt.n] = alt
  savestate.save(alt.state, true)
  append("alts.jsonl", {node = node.id, alt = alt.n, path = path, shadow = sh, state = alt.state})
  if node.expand then enqueue(node, alt) end
end

-- ------------------------------------------------------------------ stop ----

-- ---------------------------------------------------------------- resume ----
-- A run stops on its wall clock long before a large menu is done. At the stop
-- the explorer writes resume.lua (a Lua table, since BizHawk's Lua has no JSON
-- reader); the next run loads it with CFG.resume and carries on with the same
-- screens, saved moments and queue. The trial cut off by the stop goes back to
-- the front of the queue.
local function luaser(v)
  local t = type(v)
  if t == "table" then
    local out = {}
    for k, x in pairs(v) do
      local key = type(k) == "number" and ("[" .. string.format("%d", k) .. "]") or ("[" .. string.format("%q", k) .. "]")
      out[#out + 1] = key .. "=" .. luaser(x)
    end
    return "{" .. table.concat(out, ",") .. "}"
  elseif t == "string" then
    return string.format("%q", v)
  elseif t == "number" then
    return (math.type and math.type(v) == "integer") and string.format("%d", v) or tostring(v)
  end
  return tostring(v)
end

local function write_resume()
  local nodes = {}
  for i, n in ipairs(P.nodes) do
    local alts = {}
    for j, a in ipairs(n.alts or {}) do alts[j] = {n = a.n, path = a.path, shadow = a.shadow, state = a.state} end
    nodes[i] = {id = n.id, key = n.key, key_id = n.key_id, depth = n.depth, path = n.path, root = n.root,
                shadow = n.shadow, state = n.state, expand = n.expand, world_changed = n.world_changed,
                results = n.results or {}, alts = alts}
  end
  local queue = {}
  if P.cur then
    local t = P.cur.task
    queue[#queue + 1] = {node = t.node.id, button = t.button, alt = t.alt and t.alt.n or 0}
  end
  for i = P.qi, #P.queue do
    local t = P.queue[i]
    queue[#queue + 1] = {node = t.node.id, button = t.button, alt = t.alt and t.alt.n or 0}
  end
  local R = {nodes = nodes, queue = queue, keys = P.keys, key_ids = P.key_ids, steps = P.steps,
             trials = P.trials, edges = P.edges, alt_checks = P.alt_checks, coarse = P.coarse,
             unsettled = P.unsettled, root_world = P.root_world or {}, volatile = P.volatile,
             poked = P.poked or 0, frames = P.frame}
  local f = assert(io.open(OUT .. "/resume.lua", "w"))
  f:write("return ", luaser(R), "\n")
  f:close()
  return #queue
end

local function finish(reason)
  if P.stopped then return end
  P.stopped, P.reason = true, reason
  for _, g in ipairs(P.guids) do pcall(event.unregisterbyid, g) end
  for _, g in ipairs(P.tguids or {}) do pcall(event.unregisterbyid, g) end
  pcall(event.unregisterbyname, "pxp_frame")
  pcall(joypad.set, {}, 1)
  pcall(client.speedmode, 100)
  pcall(emu.limitframerate, true)
  if P.sound_was ~= nil then pcall(client.SetSoundOn, P.sound_was) end
  local cov, hit, total = {}, 0, 0
  for _, pg in ipairs(pages) do
    local seen = P.steps[pg.name] or {}
    local got, never = {}, {}
    for v, trial in pairs(seen) do got[#got + 1] = {v, trial} end
    table.sort(got, function(a, b) return a[1] < b[1] end)
    for _, c in ipairs(pg.cases) do
      total = total + 1
      if seen[c] then hit = hit + 1 else never[#never + 1] = c end
    end
    cov[#cov + 1] = {page = pg.name, step_offset = hex(pg.step_off), seen = got,
                     cases = pg.cases, never = never}
  end
  local f = assert(io.open(OUT .. "/coverage.json", "w"))
  f:write(json(cov), "\n")
  f:close()
  local queue_left = write_resume()
  local summary = {reason = reason, label = CFG.label, pokes = P.poked, nodes = #P.nodes, edges = P.edges, trials = P.trials,
    alt_checks = P.alt_checks, coarse = P.coarse, unsettled = P.unsettled,
    steps_hit = hit, steps_total = total, queue_left = queue_left, resumed_from = CFG.resume,
    volatile = P.volatile, buttons = P.buttons, frames = P.frame,
    skipped = P.skipped or 0, bench = P.bench_result, traced = P.traced, service_map = P.svcmap,
    late_sounds = P.late_sounds, sound_gaps = P.sound_gaps, sound_tail = SOUND_TAIL, sound_audit = SOUND_AUDIT,
    walk_reads_per_frame = math.floor((P.reads or 0) / math.max(P.frame, 1)),
    wall_seconds = os.time() - P.started,
    fps = math.floor(P.frame / math.max(os.time() - P.started, 1)),
    cfg = {warm = WARM, hold = HOLD, settle = SETTLE, max_frames = MAXF,
           max_nodes = MAX_NODES, max_trials = MAX_TRIALS, max_depth = MAX_DEPTH,
           map_dpad = CFG.map_dpad and true or false, expand_world = CFG.expand_world and true or false,
           sample_lists = CFG.sample_lists and true or false}}
  f = assert(io.open(OUT .. "/summary.json", "w"))
  f:write(json(summary), "\n")
  f:close()
  print("PXP DONE " .. json(summary))
end

function P.stop(reason) finish(reason or "stopped by request") end

function P.status()
  print(string.format("PXP walk_reads_per_frame=%.1f", (P.reads or 0) / math.max(P.frame, 1)))
  print(string.format("PXP phase=%s nodes=%d edges=%d trials=%d queue=%d coarse=%d unsettled=%d stopped=%s reason=%s frame=%d",
    P.phase, #P.nodes, P.edges, P.trials, #P.queue - P.qi + 1, P.coarse, P.unsettled,
    tostring(P.stopped), tostring(P.reason), P.frame))
end

-- ----------------------------------------------------------------- trial ----

local start_trial
function start_trial()
  if P.qi > #P.queue then return finish("queue empty: no new screens") end
  if P.trials >= MAX_TRIALS then return finish("trial budget reached") end
  local task = P.queue[P.qi]
  P.qi = P.qi + 1
  -- A resumed queue can hold trials that the current rules now skip.
  if not allowed_button(task.node, task.button) then
    P.skipped = (P.skipped or 0) + 1
    return start_trial()
  end
  P.trials = P.trials + 1
  local node = task.node
  savestate.load(task.alt and task.alt.state or node.state, true)
  P.walk_frame, P.sounds = nil, {}
  P.cur = {task = task, id = P.trials, transit = {}, new_steps = {}, last = nil, stable = 0, n = 0}
  P.phase, P.n = "warm", 0
end

local function end_trial(parts, key, settled)
  local cur, task = P.cur, P.cur.task
  local node = task.node
  local path = {}
  for i, b in ipairs(task.alt and task.alt.path or node.path) do path[i] = b end
  path[#path + 1] = task.button
  local sh = settled and shadow(cur.snap, snapshot()) or nil
  local to = P.by_key[key]
  local new = false
  if settled and not to and #P.nodes < MAX_NODES then
    to = add_node(parts, key, path, node.depth + 1, node.id, sh)
    new = true
  elseif settled and to and not to.root and not task.alt and sh and #to.alts < MAX_ALTS then
    local seen = sh == to.shadow
    for _, a in ipairs(to.alts) do if a.shadow == sh then seen = true end end
    if not seen then add_alt(to, path, sh) end
  end
  local edge = {trial = cur.id, from = node.id, button = task.button,
    alt = task.alt and task.alt.n or nil, shadow = sh,
    to = to and to.id or nil, to_key_id = key_id(key), new = new, settled = settled,
    restore_ok = cur.restore_ok, restore_diff = cur.restore_diff,
    first_change = cur.first_change, settle_frame = cur.settle_frame, frames = cur.n,
    transit = cur.transit, sounds = P.sounds, new_steps = cur.new_steps, sound_gap = cur.sound_gap}
  if not settled then
    P.unsettled = P.unsettled + 1
    edge.moving = cur.moving
  end
  -- The coarse check: the same key and button from the alternate moment must
  -- land where the first moment landed.
  if task.alt then
    P.alt_checks = P.alt_checks + 1
    local first = node.results and node.results[task.button]
    edge.primary_to_key_id = first
    edge.coarse = first ~= nil and first ~= edge.to_key_id
    if edge.coarse then P.coarse = P.coarse + 1 end
  else
    node.results = node.results or {}
    node.results[task.button] = edge.to_key_id
  end
  P.edges = P.edges + 1
  append("edges.jsonl", edge)
  P.cur = nil
  P.phase = "next"
end

-- Speed bench (CFG.bench = seconds per phase): no key, no trials. Each phase adds
-- one part of the robot's per-frame work and counts the frames it gets through, so
-- the summary shows which part holds the frame rate down.
local BENCH = {"bare", "walk", "walk+sound hook", "walk+sound hook+load every 50 frames"}
local function bench_step()
  local b = P.bench
  if not b then
    b = {i = 1, t0 = os.time(), f0 = P.frame, out = {}}
    P.bench = b
    savestate.save(STATES .. "/bench.State", true)
  end
  if b.i >= 2 then walk() end
  if b.i >= 4 and (P.frame - b.f0) % 50 == 0 then savestate.load(STATES .. "/bench.State", true) end
  local dt = os.time() - b.t0
  if dt >= CFG.bench then
    b.out[#b.out + 1] = {phase = BENCH[b.i], frames = P.frame - b.f0, seconds = dt,
                         fps = math.floor((P.frame - b.f0) / dt)}
    b.i = b.i + 1
    if b.i > #BENCH then P.bench_result = b.out return finish("bench done") end
    if b.i == 3 then sound_hook() end
    b.t0, b.f0 = os.time(), P.frame
  end
end

-- Trace mode (CFG.trace = a Lua file returning {fns = {addr...}, cases = {{id, state,
-- button}...}}): no search. For each case: load the saved moment, idle WARM frames,
-- press the button, and record which listed functions run on each frame, which
-- words of each live page object change, which save bytes change, and the sounds.
-- Every function gets an exec hook, which is slow (116 hooks: 2.4 fps), so the
-- hooks are on only from TRACE_BASE frames before the press until TRACE_TAIL
-- frames after the last change (at most TRACE_MAX frames); the frames before the
-- press are the page's idle baseline.
local TRACE_BASE, TRACE_TAIL, TRACE_MAX = CFG.trace_base or 2, CFG.trace_tail or 3, CFG.trace_max or 150
local function trace_hook()
  if P.thooked then return end
  P.thooked = true
  P.tguids = {}
  for _, a in ipairs(T.fns) do
    local addr = a
    P.tguids[#P.tguids + 1] = event.on_bus_exec(function()
      local c = P.cur
      if not c then return end
      local row = c.calls[addr]
      local n = c.n + 1
      if not row then row = {first = n, frames = {}, calls = 0} c.calls[addr] = row end
      row.calls = row.calls + 1
      if row.frames[#row.frames] ~= n then row.frames[#row.frames + 1] = n end
    end, addr, "pxt_" .. hex(addr), "System Bus")
  end
end
local function trace_unhook()
  for _, g in ipairs(P.tguids or {}) do pcall(event.unregisterbyid, g) end
  P.tguids, P.thooked = {}, false
end
-- The boxes: every object under a live page (its widgets, two levels down), with
-- BOX_BYTES of each. A screen object keeps its own routine pointers inside itself,
-- so an action "target + slot" is the routine whose pointer sits at target + slot.
local BOX_BYTES = CFG.box_bytes or 0x200
local function is_code(v) return v >= 0x80010000 and v < 0x800c0000 and v % 4 == 0 end
local function boxes()
  local out, seen = {}, {}
  local function visit(obj, depth, page)
    if depth > 2 or seen[obj] or not ram_ptr(obj) then return end
    seen[obj] = true
    if depth > 0 then
      local words = {}
      for off = 0, BOX_BYTES - 4, 4 do words[#words + 1] = rd32(obj + off) end
      out[#out + 1] = {obj = obj, page = page, depth = depth, words = words}
    end
    local n, arr = rd32(obj + OBJ.child_count), rd32(obj + OBJ.child_array)
    if n > 0 and n <= 64 and ram_ptr(arr) then
      for i = 0, n - 1 do visit(rd32(arr + 4 * i), depth + 1, page) end
    end
  end
  for _, l in ipairs(walk()) do visit(l.obj, 0, l.page.name) end
  return out
end
-- Hook every routine that a box or a page holds at one of T.slots; each call
-- records its object and first three arguments.
local function action_hook(c)
  if not T.slots then return end
  local fns = {}
  local targets = {}
  for _, b in ipairs(c.boxes0 or {}) do targets[#targets + 1] = b.obj end
  for _, l in ipairs(walk()) do targets[#targets + 1] = l.obj end
  for _, obj in ipairs(targets) do
    for _, slot in ipairs(T.slots) do
      local f = rd32(obj + slot)
      if is_code(f) then fns[f] = true end
    end
  end
  -- Shared service tables (T.services = {{base, deref, slots}}): the routine at
  -- base + slot (or at [base] + slot when deref is set); its calls are logged with
  -- the label "svc<slot>".
  local svc = {}
  for _, s in ipairs(T.services or {}) do
    local base = s.deref and rd32(s.base) or s.base
    if ram_ptr(base) then
      -- map_only: record which routine sits in each slot, without a hook.
      local slots = s.slots
      if s.range then
        slots = {}
        for slot = s.range[1], s.range[2], 4 do slots[#slots + 1] = slot end
      end
      for _, slot in ipairs(slots) do
        local f = rd32(base + slot)
        if s.map_only then
          P.svcmap = P.svcmap or {}
          P.svcmap[hex(s.base) .. "+" .. hex(slot)] = hex(f)
        elseif is_code(f) then fns[f] = true; svc[f] = "svc" .. hex(slot) end
      end
    end
  end
  local own = {}
  for _, a in ipairs(T.fns) do own[a] = true end
  c.action_fns = 0
  for f in pairs(fns) do
    if not own[f] then
      c.action_fns = c.action_fns + 1
      P.tguids[#P.tguids + 1] = event.on_bus_exec(function()
        local cur = P.cur
        if not cur or #cur.acts >= (CFG.max_acts or 4000) then return end
        local ok, r = pcall(emu.getregisters)
        if not ok or type(r) ~= "table" then return end
        local a0 = r.a0 or r["a0"] or 0
        local slots = {}
        if svc[f] then slots[1] = svc[f] end
        for _, slot in ipairs(T.slots) do if ram_ptr(a0) and rd32(a0 + slot) == f then slots[#slots + 1] = hex(slot) end end
        cur.acts[#cur.acts + 1] = {cur.n + 1, hex(f), hex(a0), hex(r.a1 or 0), hex(r.a2 or 0), hex(r.a3 or 0), slots, hex(r.ra or 0)}
      end, f, "pxa_" .. hex(f), "System Bus")
    end
  end
end
local function world_bytes()
  local out = {}
  for _, w in ipairs(SPEC.world) do
    local b = {}
    for i = 0, w.size - 1 do b[i + 1] = memory.read_u8((w.addr + i) & MASK, "MainRAM") end
    out[w.name] = b
  end
  return out
end
local function objects()
  local out = {}
  for i, l in ipairs(walk()) do
    local words = {}
    for off = 0, SHADOW - 4, 4 do words[#words + 1] = rd32(l.obj + off) end
    out[#out + 1] = {name = l.page.name, obj = l.obj, words = words}
  end
  return out
end
local function trace_finish_case(settled)
  local c = P.cur
  trace_unhook()
  local after, wafter = objects(), world_bytes()
  local objs = {}
  for _, b in ipairs(after) do
    local a
    for _, x in ipairs(c.objs) do if x.obj == b.obj and x.name == b.name then a = x end end
    local changes = {}
    if a then
      for i = 1, #b.words do
        if a.words[i] ~= b.words[i] then changes[#changes + 1] = {hex((i - 1) * 4), hex(a.words[i]), hex(b.words[i])} end
      end
    end
    objs[#objs + 1] = {page = b.name, obj = hex(b.obj), new = a == nil, changes = changes}
  end
  for _, a in ipairs(c.objs) do
    local kept = false
    for _, b in ipairs(after) do if a.obj == b.obj and a.name == b.name then kept = true end end
    if not kept then objs[#objs + 1] = {page = a.name, obj = hex(a.obj), closed = true} end
  end
  local bx = {}
  local before = {}
  for _, b in ipairs(c.boxes0 or {}) do before[b.obj] = b end
  for _, b in ipairs(boxes()) do
    local a = before[b.obj]
    local changes = {}
    if a then
      for i = 1, #b.words do
        if a.words[i] ~= b.words[i] then changes[#changes + 1] = {hex((i - 1) * 4), hex(a.words[i]), hex(b.words[i])} end
      end
      before[b.obj] = nil
    end
    if not a or #changes > 0 then
      bx[#bx + 1] = {obj = hex(b.obj), page = b.page, depth = b.depth, routine = hex(b.words[OBJ.handler // 4 + 1]),
                     new = a == nil, changes = changes}
    end
  end
  for obj, a in pairs(before) do bx[#bx + 1] = {obj = hex(obj), page = a.page, closed = true} end
  local world = {}
  for _, w in ipairs(SPEC.world) do
    local a, b = c.world[w.name], wafter[w.name]
    for i = 1, #b do
      if a[i] ~= b[i] then world[#world + 1] = {w.name, hex(w.addr + i - 1), a[i], b[i]} end
    end
  end
  local calls = {}
  for addr, row in pairs(c.calls) do
    calls[#calls + 1] = {fn = hex(addr), first = row.first, calls = row.calls, frames = row.frames}
  end
  table.sort(calls, function(x, y) return x.first < y.first or (x.first == y.first and x.fn < y.fn) end)
  append("trace.jsonl", {case = c.case.id, node = c.case.node, button = c.case.button, pre = c.case.pre,
    key_before = c.key0, key_after = c.last, settled = settled, last_change = c.last_change,
    hooked_frames = c.hooked_until, press_frame = 1, sounds = P.sounds, calls = calls,
    objects = objs, world = world, boxes = bx, acts = c.acts, action_fns = c.action_fns})
  P.traced = (P.traced or 0) + 1
  P.cur = nil
end
-- A case's state or save path: absolute when it names a drive, else in this run's
-- state folder.
local function state_path(p)
  if string.find(p, ":", 1, true) then return p end
  return STATES .. "/" .. p
end
local function trace_step()
  -- The save bytes are diffed byte by byte, so the settle watch keys the pages only.
  for _, w in ipairs(SPEC.world) do P.volatile[w.name] = true end
  local c = P.cur
  if not c then
    P.ti = (P.ti or 0) + 1
    local case = T.cases[P.ti]
    if not case then return finish("trace done") end
    savestate.load(state_path(case.state), true)
    P.walk_frame, P.sounds = nil, {}
    P.cur = {case = case, calls = {}, acts = {}, n = -WARM, stable = 0, pi = 1, pt = 0}
    return
  end
  -- case.pre: presses played before the traced one, each {button, wait} (or a
  -- bare button name, which waits case.pre_wait or 90 frames). case.save keeps
  -- the moment after them, so later cases can start there.
  local pre = c.case.pre
  if pre and c.pi <= #pre then
    local p = pre[c.pi]
    local b = type(p) == "table" and p[1] or p
    local wait = type(p) == "table" and p[2] or (c.case.pre_wait or 90)
    if c.pt < HOLD then joypad.set({[b] = true}, 1) end
    c.pt = c.pt + 1
    if c.pt >= HOLD + wait then
      c.pi, c.pt = c.pi + 1, 0
      if c.pi > #pre and c.case.save then savestate.save(state_path(c.case.save), true) end
    end
    return
  end
  -- Step n runs at the end of frame n; a hook fires inside frame n + 1, so it
  -- records n + 1. The press is set at step 0 and is live from frame 1.
  c.n = c.n + 1
  if c.n == -TRACE_BASE then
    c.boxes0 = boxes()
    trace_hook()
    action_hook(c)
  end
  if c.n < 0 then return end
  if c.n == 0 then
    local parts = components()
    c.key0, c.last = keytext(parts), keytext(parts)
    c.objs, c.world, c.boxes0 = objects(), world_bytes(), boxes()
    P.sounds = {}
    sound_hook()
  end
  if c.n < HOLD then joypad.set({[c.case.button] = true}, 1) end
  if c.n == 0 then return end
  local key = keytext(components())
  if key ~= c.last then
    c.last, c.last_change, c.stable = key, c.n, 0
  elseif in_transit() then
    c.stable = 0
  else
    c.stable = c.stable + 1
  end
  if P.thooked and c.n > HOLD and (c.stable >= TRACE_TAIL or c.n >= TRACE_MAX) then
    c.hooked_until = c.n
    trace_unhook()
  end
  if c.n > HOLD and c.stable >= SETTLE then return trace_finish_case(true) end
  if c.n >= MAXF then return trace_finish_case(false) end
end

local function step()
  P.frame = P.frame + 1
  -- Checked every 60 frames, and at least every 5 s of wall time (a heavily
  -- hooked trace can run below one frame a second).
  local now = os.time()
  if (P.frame % 60 == 0 or now - (P.stop_checked or 0) >= 5) then
    P.stop_checked = now
    if exists(OUT .. "/STOP") then return finish("STOP file") end
  end
  if RIG_PLAYER_CONTROL and rig_control() ~= "agent" then return finish("human took control") end
  if CFG.bench then return bench_step() end
  if T then return trace_step() end

  if P.phase == "calibrate" then
    -- Idle at the starting moment: any save-data region that moves on its own
    -- is dropped from the key and reported.
    local parts = components()
    P.cal = P.cal or {}
    for _, p in ipairs(parts) do
      local prev = P.cal[p[1]]
      if prev and prev ~= p[2] then
        for _, w in ipairs(SPEC.world) do if w.name == p[1] then P.volatile[p[1]] = true end end
      end
      P.cal[p[1]] = p[2]
    end
    record_steps(0)
    P.n = P.n + 1
    if P.n < CALIBRATE then return end
    parts = components()
    local key = keytext(parts)
    add_node(parts, key, {}, 0, nil)
    append("calibration.jsonl", {volatile = P.volatile, frames = CALIBRATE, root_key = key})
    P.phase = "next"
    return
  end

  if P.phase == "next" then return start_trial() end

  local cur = P.cur
  if P.phase == "warm" then
    P.n = P.n + 1
    record_steps(cur.id)
    if P.n < WARM then return end
    local parts = components()
    local key = keytext(parts)
    local node = cur.task.node
    cur.restore_ok = (key == node.key)
    if not cur.restore_ok then
      local want = {}
      for part in string.gmatch(node.key, "[^|]+") do
        local name, value = string.match(part, "^([^=]+)=(.*)$")
        want[#want + 1] = {name, value}
      end
      cur.restore_diff = diff(want, parts)
    end
    P.sounds = {}
    sound_hook()
    -- The watch compares against the screen as it stood before the press, so a
    -- change on the first held frame counts as that edge's first change.
    cur.last, cur.last_parts, cur.stable = key, parts, 0
    P.phase, P.n = "hold", 0
    joypad.set({[cur.task.button] = true}, 1)
    return
  end

  -- hold and watch share one frame clock, counted from the first held frame.
  cur.n = cur.n + 1
  record_steps(cur.id)
  if P.phase == "hold" then
    P.n = P.n + 1
    if P.n < HOLD then joypad.set({[cur.task.button] = true}, 1) else P.phase = "watch" end
  end
  local parts = components()
  local key = keytext(parts)
  if key ~= cur.last then
    if not cur.first_change then cur.first_change = cur.n end
    cur.last_change = cur.n
    cur.transit[#cur.transit + 1] = {cur.n, key_id(key)}
    if not P.hooked then sound_hook(); cur.sound_gap = true; P.sound_gaps = P.sound_gaps + 1 end
    if cur.last_parts then cur.moving = diff(cur.last_parts, parts) end
    cur.last, cur.last_parts, cur.stable, cur.snap = key, parts, 0, nil
  elseif in_transit() then
    cur.stable = 0
  else
    cur.stable = cur.stable + 1
    if cur.stable == 1 then cur.snap = snapshot() end
  end
  cur.quiet = P.phase == "watch" and cur.stable >= SOUND_TAIL
  if cur.quiet and P.hooked and P.trials > SOUND_AUDIT then sound_unhook() end
  if P.phase == "watch" and cur.stable >= SETTLE then
    -- The wait is the frame of the last change: when the new screen was reached.
    cur.settle_frame = cur.last_change
    return end_trial(parts, key, true)
  end
  if cur.n >= MAXF then return end_trial(parts, key, false) end
end

-- ----------------------------------------------------------------- start ----

do
  local pad = joypad.get(1) or {}
  P.buttons = {}
  local dropped = {}
  for _, b in ipairs(BUTTONS) do
    if pad[b] ~= nil then P.buttons[#P.buttons + 1] = b else dropped[#dropped + 1] = b end
  end
  assert(#P.buttons > 0, "no known pad buttons; joypad.get(1) returned none")
  P.dropped_buttons = dropped
end

-- Optional memory writes on the robot's own copy of the moment (GameShark lines
-- expanded by game_driver.py --codes into address, width, value triples). They run
-- once, before calibration, so the root state already holds them.
local poked, poke_bad = 0, 0
if CFG.pokes and not CFG.resume then
  local t = CFG.pokes
  for i = 1, #t, 3 do
    local a, w, v = t[i] & MASK, t[i + 1], t[i + 2]
    if w == 1 then memory.write_u8(a, v, "MainRAM") else memory.write_u16_le(a, v, "MainRAM") end
    local back = (w == 1) and memory.read_u8(a, "MainRAM") or memory.read_u16_le(a, "MainRAM")
    if back ~= v then poke_bad = poke_bad + 1 end
    poked = poked + 1
  end
end
P.poked = poked

if CFG.resume then
  -- Every saved moment already holds the first run's writes; no pokes, no calibration.
  local R = dofile(CFG.resume)
  P.keys, P.key_ids, P.steps = R.keys, R.key_ids, R.steps
  P.trials, P.edges, P.alt_checks, P.coarse, P.unsettled = R.trials, R.edges, R.alt_checks, R.coarse, R.unsettled
  P.root_world, P.volatile, P.poked = R.root_world, R.volatile, R.poked
  for _, n in ipairs(R.nodes) do
    n.alts = n.alts or {}
    P.nodes[n.id] = n
    P.by_key[n.key] = n
  end
  for _, t in ipairs(R.queue) do
    local node = P.nodes[t.node]
    P.queue[#P.queue + 1] = {node = node, button = t.button, alt = t.alt > 0 and node.alts[t.alt] or nil}
  end
  P.phase = "next"
end

P.started = os.time()
append("run.jsonl", {run = RUN, started_frame = emu.framecount(), buttons = P.buttons,
  dropped_buttons = P.dropped_buttons, pages = #pages, label = CFG.label,
  pokes = poked, pokes_failed = poke_bad})
if CFG.speed then client.speedmode(CFG.speed) end
-- speedmode alone kept 46 fps on 2026-09-29; the frame limit is its own switch.
-- Neither lifted it, so the sound output (which can pace the emulator) and
-- display vsync are switched off too, and restored at the stop.
if CFG.unthrottle ~= false then
  pcall(emu.limitframerate, false)
  pcall(emu.displayvsync, false)
  P.sound_was = nil
  local ok, on = pcall(client.GetSoundOn)
  if ok then P.sound_was = on end
  pcall(client.SetSoundOn, false)
end
event.onframeend(function()
  if P.stopped then return end
  local ok, err = pcall(step)
  if not ok then finish("error: " .. tostring(err)) end
end, "pxp_frame")
print("PXP ARMED run=" .. RUN .. " buttons=" .. table.concat(P.buttons, ",") ..
  " dropped=" .. table.concat(P.dropped_buttons, ","))
