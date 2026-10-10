// The shared DDW3 UI object layer.
//
// The original game builds every screen from a small set of classes that all
// live in the main program, not in any screen's own overlay — so a screen is
// not a bespoke design, it is a short script that constructs these and
// positions them. See docs/research/ui/ui-inventory-and-review-2026-08-13.md.
//
// This layer exists so the walker does the same. Before it, web/shop.js,
// web/gym.js and web/dri.js each carried a private reimplementation of the one
// window-fold routine — three copies of something the original has once.
//
// REFERENCE IMPLEMENTATIONS: web/shop.js and web/gym.js, both confirmed correct
// against the real game by the operator. Where a decoded claim and those two
// disagree, the confirmed behaviour wins and the disagreement is written down
// rather than silently resolved (see the note in cursor.ts).

export * from "./task-object.ts";
export * from "./roster-form-state.ts";
export * from "./window-fold.ts";
export * from "./int-to-decimal.ts";
export * from "./text-element-setters.ts";
export * from "./text-measure.ts";
export * from "./text-window.ts";
export * from "./folder-list-colours.ts";
export * from "./text-widget-line.ts";
export * from "./text-widget-resource.ts";
export * from "./create-text-element.ts";
export * from "./spawn-ui-icon.ts";
export * from "./cursor-handler.ts";
export * from "./shop-list-build.ts";
export * from "./shop-list-create.ts";
export * from "./shop-list-slots.ts";
export * from "./shop-list-machine.ts";
export * from "./shop-buy-branches.ts";
export * from "./band-highlight.ts";
export * from "./band-label-build.ts";
export * from "./band-tick.ts";
export * from "./band-fill.ts";
export * from "./shop-sell-build.ts";
export * from "./shop-actor-build.ts";
export * from "./shop-stock.ts";
export * from "./shop-actor.ts";
export * from "./shop-actor-draw.ts";
export * from "./folder-list-create.ts";
export * from "./item-list-draw.ts";
export * from "./shop-effects-draw.ts";
export * from "./shop-window-buy.ts";
export * from "./shop-window-sell.ts";
export * from "./shop-readout.ts";
export * from "./fold-tween.ts";
export * from "./cursor.ts";
export * from "./screen-dim.ts";
export * from "./draw-bucket.ts";
export * from "./pause-items-text.ts";
export * from "./effects-card-helpers.ts";
export * from "./effects-card-fill.ts";
export * from "./digimon-picture.ts";
export * from "./stat-panel.ts";
export * from "./gym-hud.ts";
export * from "./gym-screen.ts";
export * from "./gym-flow.ts";
export * from "./gym-partner-draw.ts";
export * from "./home-menu-draw.ts";
export * from "./native/pause-list.ts";
export * from "./memcard-save-card.ts";
export * from "./memcard-block-grid.ts";
export * from "./memcard-message-window.ts";
export * from "./tween-linear.ts";
export * from "./memcard-root.ts";
export * from "./lab-root.ts";
export * from "./wizard-root.ts";
export * from "./wizard-headers.ts";
export * from "./wizard-anim.ts";
export * from "./wizard-sequence.ts";
export * from "./wizard-panels.ts";
export * from "./wizard-methods.ts";
export * from "./wizard-name-field.ts";
export * from "./wizard-name-init.ts";
export * from "./wizard-name-save.ts";
export * from "./task-registration.ts";
export * from "./sound-test.ts";
export * from "./shock-test.ts";
export * from "./title-tasks.ts";
export * from "./title-session.ts";
export * from "./title-sequence-session.ts";
export * from "./title-background-session.ts";
export * from "./title-draw.ts";
export * from "./title-menu.ts";
export * from "./title-menu-session.ts";
export * from "./title-fade-session.ts";
export * from "./title-visual-session.ts";
export * from "./title-japanese.ts";
export * from "./title-background-tick.ts";
export * from "./title-boot.ts";
export * from "./title-ticks.ts";
export * from "./title-sequence-tick.ts";
export * from "./float-numbers.ts";
export * from "./cardgame-draw.ts";
export * from "./card-layers.ts";
export * from "./pile-badges.ts";
export * from "./turn-marker.ts";
export * from "./card-sprites.ts";
export * from "./card-shop-root-fill.ts";
export * from "./country-palette.ts";
export * from "./country-screen.ts";
export * from "./country-startup.ts";
export * from "./animation-script.ts";
export * from "./pad-words.ts";
export * from "./hud-banners.ts";
export * from "./message-box.ts";
export * from "./player-hud.ts";
export * from "./duel-view.ts";
export * from "./duel-board-view.ts";
export * from "./duel-pile-service.ts";
export * from "./duel-effect-commit.ts";
export * from "./duel-counter-service.ts";
export * from "./duel-ai.ts";
export * from "./duel-mode-updates.ts";
export * from "./duel-view-window.ts";
export * from "./card-battle-context.ts";
export * from "./duel-session.ts";
export * from "./report-row.ts";
export * from "./gym-rank-pack.ts";
export * from "./shop-buy-machine.ts";
export * from "./shop-buy-lines.ts";
export * from "./shop-text-banks.ts";
export * from "./shop-widget-services.ts";
export * from "./shop-font.ts";
export * from "./shop-root-session.ts";
export * from "./shop-pad-input.ts";
export * from "./shop-save-state.ts";
export * from "./shop-close-commit.ts";
export * from "./shop-draw-intents.ts";
export * from "./shop-catalog.ts";
export * from "./shop-inventory.ts";
export * from "./shop-task-allocation.ts";
export * from "./shop-root-machine.ts";
export * from "./shop-root-handler.ts";
export * from "./shop-root-draw.ts";
export * from "./shop-sell-machine.ts";
export * from "./message-box-b.ts";
export * from "./title-fade.ts";
export * from "./fight-report-row.ts";
export * from "./party-card-fill.ts";
export * from "./partner-select-move.ts";
export * from "./album-residue.ts";
export * from "./album-session.ts";
export * from "./folder-session.ts";
export * from "./text-decode.ts";
export * from "./memcard-machine.ts";
export * from "./card-view.ts";
export * from "./effect-vm.ts";
export * from "./text-drawer.ts";
export * from "./native/index.ts";
export * from "./name-root-session.ts";
export * from "./fight-command-session.ts";
export * from "./battle-message-session.ts";
export * from "./battle-loss-session.ts";
export * from "./fight-tech-session.ts";
export * from "./fight-item-session.ts";
export * from "./fight-tag-session.ts";
export * from "./fight-form-session.ts";
export * from "./fight-dna-session.ts";
export * from "./form-panel-host.ts";
export * from "./native/battle-tech-menu.ts";
export * from "./native/battle-tag-menu.ts";
export * from "./native/battle-dna-menu.ts";
export * from "./wfight-loader-session.ts";
export * from "./fight-report-session.ts";
export * from "./wizard-root-session.ts";
export * from "./pause-root-session.ts";
export * from "./memcard-session.ts";
export * from "./gym-session.ts";
export * from "./lab-session.ts";
export * from "./resident-text-host.ts";
export * from "./dialogue-session.ts";
export * from "./yesno-session.ts";
export * from "./help-menu-session.ts";
export * from "./inn-session.ts";
export * from "./native/resident-fade.ts";
export * from "./native/inn-screen.ts";
export * from "./native/place-card.ts";
export * from "./place-card-session.ts";
export * from "./end-card-session.ts";
// The display service's two published words. Every screen in this layer reads
// them through one host method, so the host that drives a screen frame by frame
// has to be able to advance them: engine/systems/frame-clock.ts, whose cells are
// the original's [0x8004DE20] and [0x8004DE28].
export * from "../../systems/frame-clock.ts";

export * from "./card-shop-session.ts";
export * from "./card-shop-reveal.ts";

export { bindCardPacks, cardPackInventory } from "./card-pack-store.ts";
