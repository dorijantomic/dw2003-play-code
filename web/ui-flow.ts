import { UI_FLOWS, classifyFlowNode } from "./ui-flow-data.js";

const tabs = document.getElementById("tabs");
const search = document.getElementById("search");
const intro = document.getElementById("flowIntro");
const graph = document.getElementById("graph");
const columns = document.getElementById("columns");
const wires = document.getElementById("wires");
const details = document.getElementById("details");
const empty = document.getElementById("empty");
const graphScroller = document.getElementById("graphScroller");
const query = new URLSearchParams(location.search);
let flow = UI_FLOWS.find((item) => item.id === query.get("flow")) ?? UI_FLOWS[0];
let selected = flow.nodes.find((item) => item.id === query.get("screen"))?.id ?? flow.nodes[0].id;

const nodeById = (id) => flow.nodes.find((node) => node.id === id);
const labels = {
  runtime: { ours: "Our code", mixed: "MIPS + ours" },
  research: { compared: "Original captured", mapped: "Research mapped", partial: "Gaps remain" },
};
const researchText = {
  compared: "An original-game capture exists for this step, and the browser route was exercised. This does not certify every variant or a visual match.",
  mapped: "Research notes describe this route; this step has not been fully checked in the browser.",
  partial: "Some behavior is documented, but gaps remain for this step or its route.",
};
const nodeElement = (id) => [...columns.querySelectorAll(".node")].find((el) => el.dataset.node === id);
const incoming = (id) => flow.edges.filter((edge) => edge[1] === id);
const outgoing = (id) => flow.edges.filter((edge) => edge[0] === id);
const el = (tag, className, value) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value != null) result.textContent = value;
  return result;
};

function levels() {
  const depth = new Map([[flow.nodes[0].id, 0]]);
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of flow.edges) {
      if (!depth.has(from) || depth.has(to)) continue;
      depth.set(to, depth.get(from) + 1);
      changed = true;
    }
    if (!changed) break;
  }
  // A missing connection stays visible in a last column, making bad map data
  // visible instead of silently losing a screen.
  const last = Math.max(0, ...depth.values()) + 1;
  return flow.nodes.reduce((groups, node) => {
    const level = depth.get(node.id) ?? last;
    (groups[level] ??= []).push(node);
    return groups;
  }, []);
}

function drawWires() {
  const bounds = graph.getBoundingClientRect();
  const width = graph.scrollWidth;
  const height = Math.max(graph.scrollHeight, 430);
  wires.setAttribute("viewBox", `0 0 ${width} ${height}`);
  wires.setAttribute("width", width);
  wires.setAttribute("height", height);
  wires.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  for (const [id, color] of [["forward", "#77a8de"], ["back", "#eea566"]]) {
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("markerWidth", "8"); marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "7"); marker.setAttribute("refY", "4");
    marker.setAttribute("orient", "auto");
    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
    arrow.setAttribute("fill", color);
    marker.append(arrow); defs.append(marker);
  }
  wires.append(defs);
  const point = (node, side) => {
    const box = node.getBoundingClientRect();
    return { x: (side === "right" ? box.right : box.left) - bounds.left,
      y: box.top + box.height / 2 - bounds.top };
  };
  const path = (from, to, isBack = false) => {
    const left = nodeElement(from), right = nodeElement(to);
    if (!left || !right) return;
    const a = point(left, isBack ? "left" : "right");
    const b = point(right, isBack ? "right" : "left");
    const bend = Math.max(24, Math.abs(b.x - a.x) * .45);
    const curve = document.createElementNS(ns, "path");
    curve.setAttribute("d", `M ${a.x} ${a.y} C ${a.x + (isBack ? -bend : bend)} ${a.y}, ${b.x + (isBack ? bend : -bend)} ${b.y}, ${b.x} ${b.y}`);
    curve.setAttribute("fill", "none");
    curve.setAttribute("stroke", isBack ? "#eea566" : "#77a8de");
    curve.setAttribute("stroke-width", isBack ? "2.5" : "2");
    if (isBack) curve.setAttribute("stroke-dasharray", "7 6");
    curve.setAttribute("marker-end", `url(#${isBack ? "back" : "forward"})`);
    wires.append(curve);
  };
  for (const [from, to] of flow.edges) path(from, to);
  const target = nodeById(selected)?.back;
  if (target && target !== "—" && nodeById(target)) path(selected, target, true);
}

function select(id) {
  selected = id;
  for (const button of columns.querySelectorAll(".node")) {
    button.classList.toggle("active", button.dataset.node === id);
    button.setAttribute("aria-pressed", button.dataset.node === id ? "true" : "false");
  }
  const node = nodeById(id);
  const status = classifyFlowNode(flow, node);
  details.replaceChildren();
  details.append(el("div", "eyebrow", flow.title), el("h2", null, node.name), el("p", null, node.detail));
  const statusBlock = el("div", "statusBlock");
  const badges = el("div", "badges");
  badges.append(el("span", `pill ${status.runtime}`, labels.runtime[status.runtime]));
  badges.append(el("span", `pill ${status.research}`, labels.research[status.research]));
  statusBlock.append(badges);
  statusBlock.append(el("p", null, status.runtime === "ours"
    ? "This named UI surface runs our browser implementation."
    : "This named UI surface still runs some original screen instructions beside our replacements."));
  statusBlock.append(el("p", null, researchText[status.research]));
  statusBlock.append(el("p", null, status.note));
  statusBlock.append(el("div", "evidence", `Code: ownership inventory → ${status.surface}`));
  statusBlock.append(el("div", "evidence", `Original behavior: ${status.evidence}`));
  details.append(statusBlock);
  const ins = incoming(id);
  if (ins.length) {
    details.append(el("h3", null, "How you get here"));
    const list = el("ul");
    for (const [from, , action] of ins) list.append(el("li", null, `${nodeById(from)?.name ?? from} → ${action}`));
    details.append(list);
  }
  details.append(el("h3", null, "Back goes to"));
  details.append(el("div", "backline", node.back === "—" ? "No Back path shown"
    : `${node.backAction ?? "Back / Escape"} → ${nodeById(node.back)?.name ?? node.back}`));
  const outs = outgoing(id);
  if (outs.length) {
    details.append(el("h3", null, "Next choices"));
    const list = el("ul");
    for (const [, to, action] of outs) {
      const row = el("li");
      const jump = el("button", null, `${action} → ${nodeById(to)?.name ?? to}`);
      jump.type = "button";
      jump.style.cssText = "color:#9ac7ff;background:none;border:0;padding:0;text-align:left;cursor:pointer";
      jump.addEventListener("click", () => { select(to); nodeElement(to)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); });
      row.append(jump); list.append(row);
    }
    details.append(list);
  }
  if (node.lab) {
    const link = el("a", "lablink", "Open the real screen in UI Lab ↗");
    link.href = `ui-lab.html?screen=${encodeURIComponent(node.lab)}`;
    details.append(link);
    details.append(el("p", "source", "The lab opens the start of this route. Follow the buttons above to reach this step."));
  }
  details.append(el("div", "source", `Route checked against: ${flow.source}`));
  const url = new URL(location.href);
  url.searchParams.set("flow", flow.id);
  url.searchParams.set("screen", id);
  history.replaceState(null, "", url);
  requestAnimationFrame(drawWires);
}

function render() {
  tabs.replaceChildren();
  for (const item of UI_FLOWS) {
    const button = el("button", null, item.title);
    button.type = "button";
    button.setAttribute("aria-selected", item.id === flow.id ? "true" : "false");
    button.addEventListener("click", () => { flow = item; selected = item.nodes[0].id; search.value = ""; graphScroller.scrollLeft = 0; render(); });
    tabs.append(button);
  }
  intro.textContent = flow.intro;
  columns.replaceChildren();
  for (const [index, group] of levels().entries()) {
    if (!group?.length) continue;
    const column = el("div", "column");
    column.append(el("div", "columnTitle", index === 0 ? "Start" : `Step ${index}`));
    for (const node of group) {
      const status = classifyFlowNode(flow, node);
      const button = el("button", "node");
      button.type = "button";
      button.dataset.node = node.id;
      button.append(el("span", "name", node.name));
      const badges = el("span", "badges");
      badges.append(el("span", `pill ${status.runtime}`, labels.runtime[status.runtime]));
      badges.append(el("span", `pill ${status.research}`, labels.research[status.research]));
      button.append(badges);
      const ins = incoming(node.id);
      if (ins.length) button.append(el("span", "from", ins.map((edge) => edge[2]).join(" · ")));
      if (node.back !== "—") button.append(el("span", "back", `↶ ${node.backAction ?? "Back"}: ${nodeById(node.back)?.name ?? node.back}`));
      button.addEventListener("click", () => select(node.id));
      column.append(button);
    }
    columns.append(column);
  }
  select(selected);
  filter();
}

function filter() {
  const needle = search.value.trim().toLowerCase();
  let matches = 0;
  for (const button of columns.querySelectorAll(".node")) {
    const node = nodeById(button.dataset.node);
    const actions = [...incoming(node.id), ...outgoing(node.id)].map((edge) => edge[2]).join(" ");
    const hit = !needle || `${node.name} ${node.detail} ${actions}`.toLowerCase().includes(needle);
    button.classList.toggle("dim", !hit);
    if (hit) matches++;
  }
  empty.style.display = matches ? "none" : "block";
}

search.addEventListener("input", filter);
document.getElementById("earlier").addEventListener("click", () => graphScroller.scrollBy({ left: -520, behavior: "smooth" }));
document.getElementById("later").addEventListener("click", () => graphScroller.scrollBy({ left: 520, behavior: "smooth" }));
new ResizeObserver(() => requestAnimationFrame(drawWires)).observe(columns);
window.addEventListener("resize", drawWires);
render();
