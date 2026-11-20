// System Status page. Reads web/system-status.json, which
// tools/build_system_status.mjs generates from the research records.
const data = await (await fetch("system-status.json")).json();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CLAIM_KEYS = ["verified", "partially_verified", "candidate", "contradicted"];
const CLAIM_WORDS = { verified: "proven", partially_verified: "partly proven", candidate: "unproven reading", contradicted: "disproved" };
const WIRED_WORDS = { implemented: "In the game", partial: "Partly in the game", not_applicable: "Not a game feature", unknown: "Unknown" };
const pretty = (id) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const views = [
  { id: "systems", label: "Systems" },
  { id: "files", label: "Original code files" },
  { id: "screens", label: "Screens" },
  { id: "gaps", label: "Records gaps" },
];
let view = "systems";
let selected = null;
let sortKey = "name";

function bar(parts, total) {
  if (!total) return `<div class="bar"></div>`;
  return `<div class="bar">${parts.filter(([, n]) => n > 0).map(([cls, n]) => `<span class="c-${cls}" style="width:${(100 * n) / total}%"></span>`).join("")}</div>`;
}

function gapCount(s) {
  return s.gaps.frontiers.length + s.gaps.missingFiles.length;
}

function totals() {
  const t = data.totals;
  const files = data.codeFiles;
  const sum = (k) => files.reduce((a, f) => a + f[k], 0);
  $("totals").innerHTML = [
    [t.systems, "systems"],
    [t.claims, "facts recorded"],
    [t.verified, "proven"],
    [t.contradicted, "disproved"],
    [sum("routines"), "original routines known"],
    [sum("translated"), "translated"],
    [sum("wired"), "running ours"],
    [sum("oracle"), "with an oracle test"],
    [data.totals.routinesAssigned, "routines under a system"],
    [data.totals.routinesUnassigned, "routines under no system"],
    [data.totals.routinesUnlabeled, "routines not read yet"],
    [data.totals.codeFilesOwned, "our files owned"],
    [data.totals.codeFilesUnowned, "our files owned by no system"],
  ].map(([n, w]) => `<span class="total"><b>${n}</b>${w}</span>`).join("");
}

function matches(text) {
  const q = $("search").value.trim().toLowerCase();
  return !q || text.toLowerCase().includes(q);
}

function renderSystems() {
  const rows = data.systems.filter((s) => matches(`${s.id} ${s.aliases.join(" ")} ${s.summary} ${s.wired.modules.join(" ")} ${s.claimList.map((c) => c.id).join(" ")}`));
  const by = {
    name: (a, b) => a.id.localeCompare(b.id),
    learned: (a, b) => b.learned.verified / (b.learned.claims || 1) - a.learned.verified / (a.learned.claims || 1),
    gaps: (a, b) => gapCount(b) - gapCount(a),
    wired: (a, b) => a.wired.status.localeCompare(b.wired.status),
    routines: (a, b) => b.routines.decoded - a.routines.decoded,
    owns: (a, b) => b.ownedFiles.length - a.ownedFiles.length,
  }[sortKey];
  rows.sort(by);
  $("list").innerHTML = `
    <p class="legend"><strong>Understood</strong> counts the facts recorded about the original game: green is proven against the original code, amber is partly proven, grey is a reading not yet proven, red was disproved. <strong>Open questions</strong> are the research questions still unanswered. <strong>Original routines</strong> counts the decoded routines of the original that this system claims by its own label in the function table. <strong>In the game</strong> and <strong>Our files</strong> come from the catalog mark and the file globs it owns, which a check tool keeps honest: it fails when a named file is missing. <strong>Checked by</strong> counts test files the catalog names; whether they pass is proven by running them, not by this page. Pick a row for the details.</p>
    <div class="keys"><span><i class="c-verified"></i>proven</span><span><i class="c-partially_verified"></i>partly proven</span><span><i class="c-candidate"></i>unproven</span><span><i class="c-contradicted"></i>disproved</span></div>
    <table><thead><tr>
      <th data-sort="name">System</th><th data-sort="learned">Understood</th><th class="hideNarrow" data-sort="routines">Original routines</th><th class="hideNarrow">Open questions</th><th data-sort="wired">In the game</th><th class="hideNarrow" data-sort="owns">Our files</th><th class="hideNarrow">Checked by</th><th data-sort="gaps">Gaps</th>
    </tr></thead><tbody>${rows.map((s) => {
      const l = s.learned;
      const g = gapCount(s);
      return `<tr class="row${selected === s.id ? " active" : ""}" data-id="${s.id}">
        <td><div class="name">${esc(pretty(s.id))}</div><div class="sub">${esc(s.aliases.slice(0, 3).join(", "))}</div></td>
        <td>${bar(CLAIM_KEYS.map((k) => [k, l[k]]), l.claims)}<div class="sub">${l.verified} proven of ${l.claims}</div></td>
        <td class="hideNarrow">${s.routines.decoded ? s.routines.decoded : `<span class="pill muted">0</span>`}<div class="sub">${s.routines.labels.length} label${s.routines.labels.length === 1 ? "" : "s"}</div></td>
        <td class="hideNarrow">${l.frontiersOpen ? `<span class="pill gap">${l.frontiersOpen} open</span>` : `<span class="pill ok">none open</span>`}<div class="sub">${l.frontiers - l.frontiersOpen} answered${l.exhaustive ? " · fully covered" : ""}</div></td>
        <td><span class="pill ${s.wired.status}">${WIRED_WORDS[s.wired.status] ?? s.wired.status}</span><div class="sub">${s.wired.modules.length} files named</div></td>
        <td class="hideNarrow"><div class="sub">${s.ownedFiles.length} owned of ${data.totals.codeFilesOwned + data.totals.codeFilesUnowned}</div><div class="sub">${s.owns.length} globs</div></td>
        <td class="hideNarrow"><div class="sub">${s.checked.tests.length} test${s.checked.tests.length === 1 ? "" : "s"} named</div><div class="sub">mark checked ${esc(s.checked.markVerified ?? "never")}</div></td>
        <td>${g ? `<span class="pill gap">${g}</span>` : `<span class="pill ok">0</span>`}</td>
      </tr>`;
    }).join("")}</tbody></table>
    <p class="note">“Fully covered” means the system's whole scope has been listed routine by routine. Only one system has reached that so far. The finish line for research is <code>./dw3-research completion-check</code>.</p>`;
  for (const th of $("list").querySelectorAll("th[data-sort]")) th.onclick = () => { sortKey = th.dataset.sort; render(); };
  for (const tr of $("list").querySelectorAll("tr.row")) tr.onclick = () => { selected = tr.dataset.id; render(); };
  renderSystemDetails(data.systems.find((s) => s.id === selected) ?? null);
}

let claimFilter = "all";
function renderSystemDetails(s) {
  if (!s) {
    $("details").innerHTML = `<div class="eyebrow">Details</div><h2>Pick a system</h2><p>The details show the open questions, the files that run it in the game, the tests that check it, and every recorded fact with its proof level.</p>${generatedNote()}`;
    return;
  }
  const l = s.learned;
  const claims = s.claimList.filter((c) => claimFilter === "all" || c.status === claimFilter);
  $("details").innerHTML = `
    <div class="eyebrow">System</div><h2>${esc(pretty(s.id))}</h2>
    <p>${esc(s.summary || "No summary in the catalog yet.")}</p>
    ${s.labs.length ? `<div>${s.labs.map((x) => `<a class="lablink" href="${esc(x.href)}">${esc(x.label)}</a>`).join("")}</div>` : ""}
    <div class="stage"><b>Understood.</b> ${l.claims} facts: ${CLAIM_KEYS.map((k) => `${l[k]} ${CLAIM_WORDS[k]}`).join(", ")}.${l.scope ? ` <span class="sub">Scope: ${esc(l.scope)}</span>` : ""}</div>
    <div class="stage"><b>In the game.</b> <span class="pill ${s.wired.status}">${WIRED_WORDS[s.wired.status] ?? s.wired.status}</span> <p style="margin-top:6px">${esc(s.wired.note || "No note.")}</p></div>
    ${s.wired.remaining ? `<div class="stage"><b>Remaining work.</b>
      <ul>
        <li><b>Ours, proven.</b> ${esc(s.wired.remaining.translated || "—")}</li>
        <li><b>Depends on the original code or the interpreter.</b> ${esc(s.wired.remaining.depends_on_original || "—")}</li>
        <li><b>Untouched.</b> ${esc(s.wired.remaining.untouched || "—")}</li>
      </ul></div>` : ""}
    <div class="stage"><b>Checked.</b> ${s.checked.tests.length} tests named; the mark was last checked ${esc(s.checked.markVerified ?? "never")}. ${esc(s.checked.proof ?? "")}</div>
    <div class="stage"><b>Original routines.</b> ${s.routines.decoded} decoded routines of the original carry a label this system claims${s.routines.labels.length ? ` (${esc(s.routines.labels.slice(0, 12).join(", "))}${s.routines.labels.length > 12 ? ", …" : ""})` : " (no label claimed yet)"}. Labels come from <code>docs/generated/function-table.json</code>.</div>
    <h3>Gaps</h3>
    ${s.gaps.frontiers.length || s.gaps.missingFiles.length || s.gaps.contradicted.length ? `<ul>
      ${s.gaps.frontiers.map((f) => `<li><b>${esc(f.question)}</b><br><span class="sub">Needs: ${esc(f.needed)}</span></li>`).join("")}
      ${s.gaps.missingFiles.map((p) => `<li>The catalog names <code>${esc(p)}</code>, which no longer exists.</li>`).join("")}
      ${s.gaps.contradicted.length ? `<li>${s.gaps.contradicted.length} earlier readings were disproved and are kept for the record.</li>` : ""}
    </ul>` : `<p>No open question is recorded. That does not mean the system is complete.</p>`}
    ${s.gaps.notExportedFiles?.length ? `<div class="stage"><b>Not part of this export.</b> ${s.gaps.notExportedFiles.length} file${s.gaps.notExportedFiles.length === 1 ? "" : "s"} the catalog names exist in the full project but not in this export by design (walker-only tests); see <code>data/not-exported-files.json</code>.</div>` : ""}
    <h3>Research documents</h3><ul>${s.docs.map((d) => `<li><code>${esc(d)}</code></li>`).join("") || "<li>None named.</li>"}</ul>
    <h3>Our files (${s.ownedFiles.length})</h3>
    <p class="sub">Every file of ours that this system owns, matched from its <code>owns</code> globs: ${esc(s.owns.join(" ")) || "none"}.</p>
    <ul>${s.ownedFiles.map((d) => `<li><code>${esc(d)}</code></li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Modules the catalog names (${s.wired.modules.length})</h3><ul>${s.wired.modules.map((d) => `<li><code>${esc(d)}</code></li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Tests</h3><ul>${s.checked.tests.map((d) => `<li><code>${esc(d)}</code></li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Recorded facts (${s.claimList.length})</h3>
    <div class="claimFilter">${["all", ...CLAIM_KEYS].map((k) => `<button data-f="${k}" aria-pressed="${claimFilter === k}">${k === "all" ? "all" : CLAIM_WORDS[k]}</button>`).join("")}</div>
    ${claims.slice(0, 200).map((c) => `<div class="claim" style="border-color:var(--c)"><span class="mono">${esc(c.id)} · ${esc(CLAIM_WORDS[c.status] ?? c.status)}</span>${esc(c.text)}</div>`).join("")}
    ${claims.length > 200 ? `<p class="sub">${claims.length - 200} more; use the search box to narrow.</p>` : ""}
    ${generatedNote()}`;
  for (const b of $("details").querySelectorAll(".claimFilter button")) b.onclick = () => { claimFilter = b.dataset.f; renderSystemDetails(s); };
  for (const [i, el] of [...$("details").querySelectorAll(".claim")].entries()) {
    const st = claims[i].status;
    el.style.setProperty("--c", { verified: "#47c78b", partially_verified: "#d0a94b", candidate: "#7c88b8", contradicted: "#d0566a" }[st] ?? "#2c405c");
  }
}

function renderFiles() {
  const rows = data.codeFiles.filter((f) => matches(`${f.module} ${f.systems.join(" ")}`));
  $("list").innerHTML = `
    <p class="legend">One row for each code file of the original game. <strong>Read</strong> counts routines with a name or a topic. <strong>Translated</strong> counts routines with a line-by-line port in our code. <strong>Running ours</strong> counts ports that the game uses in place of the original routine. <strong>Oracle</strong> counts ports with a test that runs the original routine and ours side by side. Many systems are rebuilt in our own code instead of translated routine by routine; those show under Systems, not here.</p>
    <div class="keys"><span><i class="c-wired"></i>running ours</span><span><i class="c-translated"></i>translated, not running</span><span><i class="c-read"></i>read only</span><span><i class="c-unread"></i>not read</span></div>
    <table><thead><tr><th>Code file</th><th>Pipeline</th><th>Read</th><th>Translated</th><th>Running ours</th><th>Oracle</th><th class="hideNarrow">Systems</th></tr></thead>
    <tbody>${rows.map((f) => {
      const read = (f.read.named ?? 0) + (f.read.topic ?? 0);
      const game = f.routines - f.library;
      const translatedOnly = Math.max(0, f.translated - f.wired);
      const readOnly = Math.max(0, read - f.translated);
      const parts = [["wired", f.wired], ["translated", translatedOnly], ["read", readOnly], ["unread", Math.max(0, game - f.wired - translatedOnly - readOnly)]];
      return `<tr><td><span class="name mono">${esc(f.module)}</span><div class="sub">${f.dataOnly ? `data only: no routine` : `${f.routines} routine${f.routines === 1 ? "" : "s"}${f.library ? `, ${f.library} library` : ""}`}</div></td>
        <td>${bar(parts, game)}</td><td>${read}</td><td>${f.translated}</td><td>${f.wired}</td><td>${f.oracle}${f.blocked ? ` <span class="pill gap">${f.blocked} blocked</span>` : ""}</td>
        <td class="hideNarrow sub">${esc(f.systems.join(", "))}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="note">Routine reading states come from <code>docs/generated/function-table.json</code> (rebuilt by <code>tools/build_semantic_graph.py build</code>). A routine the ownership report knows but the table does not yet list is counted as not read. A file marked <em>data only</em> holds no routine at all, so it has no table row; it is listed because <code>recovered/ddw3/function-inventory.json</code> knows the file exists and a system names it.</p>`;
  $("details").innerHTML = `<div class="eyebrow">Original code files</div><h2>Translation pipeline</h2><p>The bar shows each file's own routines, without library code. A routine moves from not read, to read, to translated, to running ours. An oracle test is what proves a translation matches the original.</p>${generatedNote()}`;
}

function renderScreens() {
  const s = data.screens;
  const li = (x) => `<li>${esc(typeof x === "string" ? x : `${x.what} — ${x.state}${x.commit ? ` (${x.commit})` : ""}`)}</li>`;
  $("list").innerHTML = `
    <p class="legend">The screen progress list, kept by hand in <code>data/screen_progress.json</code> and updated in every screen commit. The <a href="ui-flow.html">Screen Map</a> shows how the screens connect.</p>
    <h3>Next (${s.next.length})</h3><ul class="screens">${s.next.filter((x) => matches(JSON.stringify(x))).map(li).join("")}</ul>
    <h3>In progress (${s.inProgress.length})</h3><ul class="screens">${s.inProgress.map(li).join("") || "<li>None.</li>"}</ul>
    <h3>Open (${s.open.length})</h3><ul class="screens">${s.open.filter((x) => matches(JSON.stringify(x))).map(li).join("")}</ul>
    <h3>Done (${s.done.length})</h3><ul class="screens">${s.done.filter((x) => matches(JSON.stringify(x))).map(li).join("")}</ul>`;
  $("details").innerHTML = `<div class="eyebrow">Screens</div><h2>Screen progress</h2><p>${s.done.length} screens or fixes are done. ${s.next.length} are next and ${s.open.length} are open.</p>${generatedNote()}`;
}

function renderGaps() {
  const g = data.catalogGaps;
  $("list").innerHTML = `
    <p class="legend">Places where the records themselves are incomplete. Each item here is something the status page cannot place under a system yet.</p>
    <h3>Shared engine files that no system names (${g.unclaimedEngine.length})</h3>
    <ul class="screens">${g.unclaimedEngine.map((p) => `<li><code>${esc(p)}</code> — add it to its system's implementation list in <code>docs/research/systems/catalog.json</code>.</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Our files that no system owns (${g.unownedCode.length})</h3>
    <ul class="screens">${g.unownedCode.map((x) => `<li><code>${esc(x.path)}</code> — ${esc(x.reason)}; add it to a system's <code>owns</code> list, or say why it belongs to none.</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Decoded routines that no system claims (${g.unassignedRoutines.reduce((a, r) => a + r.count, 0)})</h3>
    <ul class="screens">${g.unassignedRoutines.map((x) => `<li><b>${esc(x.label)}</b>: ${x.count} routine${x.count === 1 ? "" : "s"} — no system lists this function-table label in its <code>routine_labels</code>.</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Routines no one has read yet (${data.totals.routinesUnlabeled})</h3>
    <p class="legend">These carry no subsystem or topic label at all, so there is nothing for a system to claim: ${Object.entries(g.unlabeledRoutines ?? {}).map(([k, v]) => `${v} ${esc(k)}`).join(", ")}. Reading state comes from <code>docs/generated/function-table.json</code>.</p>
    <h3>Facts filed under a system the catalog does not have (${g.strayClaims.length})</h3>
    <ul class="screens">${g.strayClaims.map((x) => `<li><b>${esc(x.system)}</b>: ${x.claims.map(esc).join(", ")}</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Catalog marks that name missing files</h3>
    <ul class="screens">${data.systems.filter((s) => s.gaps.missingFiles.length).map((s) => `<li><b>${esc(pretty(s.id))}</b>: ${s.gaps.missingFiles.map(esc).join(", ")}</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>Catalog-named files not part of this export (${data.totals.notExportedFiles ?? 0})</h3>
    <p class="legend">Absent by design, each listed in <code>data/not-exported-files.json</code> (walker-only tests). They are not gaps of this tree; a catalog-named file missing without an entry there still shows above.</p>`;
  $("details").innerHTML = `<div class="eyebrow">Records gaps</div><h2>What the records miss</h2><p>Fix these in the research records, then rebuild this page. A test fails when the page is out of date.</p>${generatedNote()}`;
}

function generatedNote() {
  const i = data.inputs;
  return `<p class="note">Built by <code>${esc(data.generatedBy)}</code> from the evidence ledger (${i.ledgerClaims} facts), the system catalog (updated ${esc(i.catalogUpdated)}), the code ownership report (${esc(String(i.ownershipGeneratedAt).slice(0, 10))}) and the screen progress list.</p>`;
}

function render() {
  $("tabs").innerHTML = views.map((v) => `<button data-v="${v.id}" aria-selected="${v.id === view}">${v.label}</button>`).join("");
  for (const b of $("tabs").querySelectorAll("button")) b.onclick = () => { view = b.dataset.v; location.hash = view; render(); };
  ({ systems: renderSystems, files: renderFiles, screens: renderScreens, gaps: renderGaps })[view]();
}

const fromHash = location.hash.slice(1);
if (views.some((v) => v.id === fromHash)) view = fromHash;
else if (data.systems.some((s) => s.id === fromHash)) selected = fromHash;
$("search").oninput = render;
totals();
render();
