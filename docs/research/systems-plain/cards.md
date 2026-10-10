---
reach: Explaining plainly how collecting, building, buying and duelling with cards fit together.
status: canonical
---

# The card game

## The short version

There are **314 cards**. You collect them, build decks of them, buy them in
packs of six, and duel with them. Four separate screens plus the duel itself.
(The raw CARDPAK0..4 catalog holds 316 records, but the album's own loops stop
at `id < 315`, so the collection you can hold is ids 1..314 — 314 cards. Ids 315
and 316 are named out-of-collection specials.)

## Collecting

- **314 cards exist.** Every loop that walks the collection stops there — the
  album and the deck editor agree on the number, which is a good sign they are
  reading the same list.
- **How many of each card you own is a single number per card**, and the album
  only asks "is it more than zero". There is no separate "seen but not owned"
  state — a card is either yours or a silhouette.

### The album

- **12 cards to a page**, laid out 6 across and 2 down, so 27 pages.
- Cards you own show their picture; the rest are blank silhouettes.
- **Highlighting a card you do not own leaves the detail panel unchanged** — it
  does not blank out, it just keeps showing the last card you looked at.
- Paging can **skip a page you own nothing on**.

Confidence: **high** on all of these. Not verified.

## Deck building

- A deck holds **40 cards**.
- The editor works from a **"how many can I still add"** figure, not from the
  deck directly: it takes your owned count for each card and subtracts one for
  every copy already in the deck. So a card you own three of shows as exhausted
  once three are in the deck.
- Decks can be named, on a keyboard screen built into the deck editor itself.

Confidence: **high**. Not verified.

## Packs

- **A pack contains six cards.**
- **Packs are ordinary inventory items.** The shop does not keep a separate pack
  stock — it filters your item list for entries of the pack type and shows those.
  So the packs you can open are the packs you are carrying.
- Opening one turns the six cards over one after another. Each slot keeps its
  previous face while the next one arrives, so the cards cross-fade rather than
  pop.
- **What the six cards are is decided before this screen.** The reveal screen is
  handed them already chosen, so I cannot tell you the odds — that logic is
  somewhere else.

Confidence: **high** on the six and on the inventory filtering. The pack
contents rule is **not established at all**.

## The duel

Covered in much more detail in the card battle document, but the parts worth
validating:

- **The opponent has no lookahead.** It walks its hand in order and asks three
  questions of each card: does this effect's precondition hold, is there a legal
  target, and is the board worth enough to justify it. **It plays the first card
  that answers yes to all three** — it does not compare candidates.
- Where it *does* compare (choosing which of its own cards to give up), it keeps
  the **lowest**-scoring one. It sacrifices its cheapest option.
- Its "thinking" pause is real work: it charges itself **four frames per card it
  looks at**.
- The opponent's scoring is a small sum of five bonuses: does this match the
  side resolving, is the board full, is it empty, is anything on it, is the hand
  not yet full.

Confidence: **high**. Not verified.

---

## Check this

1. **The card count.** Fill the album completely, or check the album's own
   "out of" figure. It should say 314.
2. **The silhouette panel.** Move onto a card you have not collected. The detail
   panel should keep showing the previous card rather than going blank.
3. **Page skipping.** Early in the game, page through the album. Pages where you
   own nothing should be passed over.
4. **The deck limit.** Own exactly two of a card, put both in a deck. The card
   should then be unselectable in the collection list, and become available
   again if you remove one.
5. **Pack size.** Open a pack. Six cards, every time.
6. **Packs as items.** Check whether card packs appear in your ordinary item
   inventory. They should — and buying one should increase that item's count.
7. **The opponent's first-fit choice.** This is the interesting one. Give the
   opponent a hand where a later card is obviously much stronger than an earlier
   playable one. It should play the *earlier* one anyway. If it plays the
   stronger card, my "first fit, no comparison" reading is wrong.
8. **The thinking pause.** The opponent should visibly take longer to decide
   when it has more cards on the board, in rough proportion.

(7) is the claim I would most like tested — it is the difference between "the AI
is simple" and "the AI is smarter than I read it as".

---

Source: `docs/research/card/cardgame-plain-descriptions.md`,
`docs/research/overlays/stcrdabm.md`, `docs/research/overlays/stcrddek.md`,
`docs/research/overlays/stcrdshp.md`
