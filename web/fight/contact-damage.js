/**
 * Per-contact damage for a multi-contact action (A12).
 *
 * A built combo/volley plays a script with several `op10 98` contacts before its single
 * `op10 99` strike — the disc's own authored shapes: clip 8 = 2x98 + 1x99 (3 contacts),
 * clip 13 = 2x98 + 1x99, a 4-hit basic = 3x98 + 1x99 (`clipContacts` in clip-fallback.js,
 * calibrated over all 249 authored packs). Each contact is one of the technique's hits, so
 * the damage comes off the victim hit by hit instead of the whole total landing on the first
 * contact. Two numbers come out of the resolver and they are not the same: `total` is the
 * damage the action deals overall (`dmgPerHit * landed`, battle-combat.ts:488-535 — the
 * original computes ONE damage value and applies it once per landed attempt) and `perHit`
 * is that one hit's value.
 *
 * The split is exact arithmetic, not a per-contact fraction:
 *
 *   shares[0..h-2] = min(perHit, left, hpLeft - 1)      one hit each, capped so the victim
 *                                                       is still standing for the strike
 *                                                       that carries the death reaction
 *   shares[h-1]    = left                               the final strike takes the remainder
 *
 * so `sum(shares) === total` for every (total, perHit, hits, hp) — never the total per
 * contact, never a lost remainder, and the victim's HP cannot reach 0 on an intermediate
 * contact (the death clip is dispatched by the `op1 [0]` paired with the last 99, so an
 * early death would send the defender's death pose on beat 1 of a 3-beat combo).
 *
 * `hits` is the number of hits that LANDED (resolveMultiHit's `landed`), capped at the
 * technique's attempts by the caller. A script that draws more contacts than there were
 * hits pays the remainder on the strike, exactly as a 1-hit row on a 3-beat clip does.
 */

/**
 * The per-contact payment plan: `hits` entries summing exactly to `total`.
 * `hp` is the victim's HP at the start of the action (only used to keep it above 0 on the
 * intermediates); omit it and the split is the plain per-hit one.
 */
export function contactPlan(total, perHit, hits, hp = null) {
  const t = Math.max(0, total | 0);
  const per = Math.max(0, perHit | 0);
  const n = Math.max(1, hits | 0);
  const finiteHp = hp != null && Number.isFinite(hp);
  let left = t;
  let pool = finiteHp ? Math.max(0, hp | 0) : 0;
  const shares = [];
  for (let i = 0; i < n - 1; i++) {
    if (left <= 0 || (finiteHp && pool <= 1)) { shares.push(0); continue; }
    const cap = finiteHp ? Math.min(per, left, pool - 1) : Math.min(per, left);
    const share = Math.max(0, cap);
    shares.push(share);
    left -= share;
    if (finiteHp) pool -= share;
  }
  shares.push(left);
  return shares;
}

/**
 * The contact-driven payment of one action's damage. `pay(amount)` applies a payment to the
 * victim (the battle subtracts HP); `onHit(rec)` is wired to the attack animation's contact
 * callback and returns true for the damage strike (op10 99) so the caller commits its result
 * page there. `remaining()` is what the final commit still has to subtract (the whole total
 * when the script fires no contact at all, e.g. clip 15's field moves).
 */
export function contactDamager({ total, perHit, hits, hp = null, pay = null } = {}) {
  const t = Math.max(0, total | 0);
  const shares = contactPlan(t, perHit, hits, hp);
  let taken = 0;
  let paid = 0;
  const apply = typeof pay === "function" ? pay : () => {};
  return {
    shares,
    onHit(rec) {
      const type = rec?.type | 0;
      if (type === 99) return true;                 // the strike: the caller commits
      if (type !== 98) return false;                // anything else is not a contact
      if (taken >= shares.length - 1) return false; // more contacts than hits: nothing early
      const share = shares[taken++];
      if (share > 0) { paid += share; apply(share); }
      return false;
    },
    remaining: () => Math.max(0, t - paid),
    paid: () => paid,
  };
}
