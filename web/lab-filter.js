// Type-to-filter for the long <select> lists in the developer harnesses.
//
// The model picker carries 245 entries and the tech picker 210, which is a lot of scrolling to
// reach one Digimon. This narrows a native <select> in place instead of replacing it with a custom
// widget: the element, its id, its value and its change event all stay exactly as they were, so
// every existing caller — and the Playwright scripts that drive these pages with
// page.selectOption() — keeps working untouched.
//
// Behaviour: space-separated terms, all of which must match (case-insensitive) somewhere in an
// option's label or value, so "gar ice" or "rena" both work. Enter takes the first match, Escape
// clears, ArrowDown moves into the list. The selected option is never filtered away, so the closed
// select never goes blank.

const norm = (s) => (s || "").toLowerCase();

/** Does this option match every term? */
function matches(opt, terms) {
  if (!terms.length) return true;
  const hay = norm(opt.textContent) + " " + norm(opt.value);
  return terms.every((t) => hay.includes(t));
}

/**
 * Attach a filter box to one <select>. Returns a handle with refresh()/detach(), or null if the
 * element already has one.
 */
export function makeFilterable(select, { placeholder = "filter…", width = "112px" } = {}) {
  if (!select || select.__labFilter) return null;

  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.className = "lab-filter";
  input.style.width = width;
  if (select.id) input.id = `${select.id}__filter`;
  input.setAttribute("aria-label", `filter ${select.id || "list"}`);

  const count = document.createElement("span");
  count.className = "lab-filter-count";

  select.parentNode.insertBefore(input, select);
  select.parentNode.insertBefore(count, select.nextSibling);

  let terms = [];

  function apply() {
    const opts = Array.from(select.options);
    let shown = 0;
    for (const o of opts) {
      // Never hide what is currently selected, or the closed select renders empty.
      const keep = o.selected || matches(o, terms);
      o.hidden = !keep;
      if (keep) shown++;
    }
    count.textContent = terms.length ? ` ${shown}/${opts.length}` : "";
    count.title = terms.length ? `${shown} of ${opts.length} shown` : "";
    input.classList.toggle("lab-filter-none", terms.length > 0 && shown <= 1);
  }

  function firstVisible() {
    return Array.from(select.options).find((o) => !o.hidden && matches(o, terms)) || null;
  }

  input.addEventListener("input", () => {
    terms = norm(input.value).split(/\s+/).filter(Boolean);
    apply();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = ""; terms = []; apply(); e.preventDefault();
    } else if (e.key === "Enter") {
      const o = firstVisible();
      // Only fire change when the value really moves — these handlers reload a whole model.
      if (o && select.value !== o.value) {
        select.value = o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        apply();
      }
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      select.focus(); e.preventDefault();
    }
  });

  // Options are rebuilt at runtime on some pages (battle-test's form list), so re-apply whenever
  // the list changes rather than making every caller remember to.
  const obs = new MutationObserver(() => apply());
  obs.observe(select, { childList: true });
  select.addEventListener("change", apply);

  apply();
  const handle = { input, count, refresh: apply, detach() { obs.disconnect(); input.remove(); count.remove(); delete select.__labFilter; } };
  select.__labFilter = handle;
  return handle;
}

/** Attach to every <select> under `root` that is long enough to be worth filtering. */
export function autoFilterable(root = document, minOptions = 12) {
  const out = [];
  for (const sel of root.querySelectorAll("select")) {
    if (sel.options.length >= minOptions) {
      const h = makeFilterable(sel);
      if (h) out.push(h);
    }
  }
  return out;
}

/** The small amount of CSS the boxes need, injected once so a page need not carry it. */
export function injectFilterStyles(doc = document) {
  if (doc.getElementById("lab-filter-style")) return;
  const st = doc.createElement("style");
  st.id = "lab-filter-style";
  st.textContent = `
    option[hidden] { display: none; }
    .lab-filter { margin-right: 4px; }
    .lab-filter.lab-filter-none { border-color: #a55 !important; }
    .lab-filter-count { font-size: 10px; opacity: .65; margin-left: 4px; }
  `;
  doc.head.appendChild(st);
}
