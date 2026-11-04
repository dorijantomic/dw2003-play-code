// web/bit-ledger-page.js — the page half of the BIT Ledger. It reads the five
// shipped tables and draws the pure module's own numbers; nothing here is typed
// by hand. No live balance is read: this page sits outside the game.
import {
    MONEY_CAP,
    payoutStats,
    grants,
    shopPrices,
    innTariffs,
    sellShelf,
    afford,
    capAdd,
} from "./bit-ledger.js";

const $ = (id) => document.getElementById(id);
const load = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));
const bit = (n) => Number(n).toLocaleString("en-US");

const [progression, grantFile, shopFile, innFile, effectFile] = await Promise.all([
    load("assets/data/progression.json"),
    load("assets/data/bank70_money_grants.json"),
    load("assets/data/shops.json"),
    load("assets/data/inn_ui.json"),
    load("assets/data/item_effects.json"),
]);

const countEl = $("count");
const failed = [];
if (!progression || !Array.isArray(progression.battle_rewards)) failed.push("progression.json");
if (!grantFile || !Array.isArray(grantFile.grants)) failed.push("bank70_money_grants.json");
if (!shopFile || !Array.isArray(shopFile.shops)) failed.push("shops.json");
if (!innFile || !Array.isArray(innFile.inns)) failed.push("inn_ui.json");
if (!effectFile || !Array.isArray(effectFile.items)) failed.push("item_effects.json");

if (failed.length) {
    countEl.textContent = `the data did not load: ${failed.join(", ")}`;
    $("cap").innerHTML = `<div class="cap"><b>no data</b><span>run the launcher's data step, then reload this page</span></div>`;
} else {
    const stats = payoutStats(progression.battle_rewards);
    const given = grants(grantFile.grants);
    const shops = shopPrices(shopFile.shops, effectFile);
    const inns = innTariffs(innFile.inns);
    const shelf = sellShelf(effectFile);
    const dearestShop = shops.reduce((a, b) => (b.price > a.price ? b : a), shops[0]);
    const cheapestBed = inns[0];
    const dearestBed = inns[inns.length - 1];
    const capAddBits = 20;

    countEl.textContent =
        `${stats.count} paying fights · ${given.count} money grants · ${shops.length} shops · ${inns.length} inns · ${shelf.length} sell-only pieces`;

    // ------------------------------------------------------------------ the cap
    $("capmax").textContent = `${bit(MONEY_CAP)} BIT`;
    $("capnear").textContent = `${bit(MONEY_CAP - 10)} + ${capAddBits} → ${bit(capAdd(MONEY_CAP - 10, capAddBits))}`;
    $("capbuy").textContent = dearestShop
        ? `${bit(dearestShop.price)} BIT ${afford(MONEY_CAP, dearestShop.price) ? "buys" : "does not buy"} ${dearestShop.name}`
        : "no priced stock";

    // --------------------------------------------------------------- the fights
    $("fightcount").textContent = `(${stats.count} that pay)`;
    $("fightspread").innerHTML =
        `<div><b>${bit(stats.min)}</b><span>the lowest payout</span></div>` +
        `<div><b>${bit(stats.median)}</b><span>the middle payout</span></div>` +
        `<div><b>${bit(stats.max)}</b><span>the highest payout</span></div>`;
    $("fightrows").innerHTML = stats.top20.map((r) =>
        `<tr><td>screen ${r.screen}</td><td class="num">${bit(r.bits)}</td></tr>`).join("");

    // --------------------------------------------------------------- the grants
    $("grantcount").textContent = `(${given.count} grants, ${bit(given.total)} BIT in all)`;
    $("grantrows").innerHTML = given.list.map((r) =>
        `<tr><td>${r.stage}</td><td>NPC ${r.npcId}</td><td class="num">${bit(r.amount)}</td></tr>`).join("");

    // ----------------------------------------------------------------- the inns
    $("inncount").textContent = `(${inns.length} inns, ${bit(cheapestBed.price)} to ${bit(dearestBed.price)} BIT a Digimon)`;
    $("innrows").innerHTML = inns.map((r) =>
        `<tr><td class="name">${r.name}</td><td>${r.map}</td><td class="num">${bit(r.price)}</td></tr>`).join("");

    // ---------------------------------------------------------------- the shops
    $("shopcount").textContent = `(${shops.length} shops, dearest ${bit(dearestShop.price)} BIT)`;
    $("shoprows").innerHTML = shops.map((r) => {
        const shop = r.shop || `shop ${r.shopId} (unnamed)`;
        if (!r.priced) {
            return `<tr><td class="name">${shop}</td><td class="unpriced">no price listed</td><td class="num">—</td></tr>`;
        }
        return `<tr><td class="name">${shop}</td><td>${r.name}</td><td class="num">${bit(r.price)}</td></tr>`;
    }).join("");

    // ---------------------------------------------------------------- the shelf
    $("shelfcount").textContent = `(${shelf.length} pieces)`;
    $("shelfrows").innerHTML = shelf.map((r) =>
        `<tr><td class="id">#${r.id}</td><td class="name">${r.name}</td><td class="num">${bit(r.sell)}</td></tr>`).join("");
}
