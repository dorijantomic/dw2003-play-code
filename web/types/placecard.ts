import type { LocationBarTemplate, LocationCardState } from "../../engine/systems/location-card.js";

/** The stage-entry location title card (web/placecard.ts). */
export interface PlaceCard {
  /** typewriter accumulator, in 60Hz frames */
  _acc: number;
  /** when set the card stays up instead of closing after its hold */
  _held: boolean;
  /** ui-c scope key, allocated on the first draw */
  _key?: string;
  /** the engine's location card state; null when nothing is showing */
  _st: LocationCardState | null;
  /** show the card for a walker map id; false when the map has no names */
  begin?: (mapId: number) => boolean;
  /** show the card with the given two names (the `placecard` quest scene) */
  beginText?: (area: string, place: string) => boolean;
  cancel?: () => void;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number) => void;
  hold?: (on: boolean) => void;
  isActive?: () => boolean;
  state?: () => LocationCardState | null;
  step?: (dt: number) => void;
}

/** assets/data/place_card.json: the bar templates, and the two names per stage id. */
export interface PlaceCardData {
  bars: LocationBarTemplate[];
  stages: Record<string, { area: string; place: string; }>;
}
