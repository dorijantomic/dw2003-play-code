/** Where each of the fx keys lives: "detail", an OPTIONS row id, "effects:<category>", or "f2". */
export interface OptionsHome {
  [key: string]: string;
}

/** What the settings store holds for one key (web/ambience.ts fx): a switch, a volume, a mode name. */
export type OptionsValue = boolean | number | string | undefined;

/** The settings store the OPTIONS rows read and write: { get(key), setMany({key: value}) }, and which keys the multiplayer host decides. */
export interface OptionsStore {
  get: (key: string) => OptionsValue;
  setMany: (values: Record<string, OptionsValue>) => void;
  locked?: (key: string) => boolean;
}

/** One row of the OPTIONS list: its label, its choices and how it reads and writes the store. */
export interface OptionsRow {
  id: string;
  label: string;
  help: string;
  choices: readonly (string | undefined)[];
  read: (store: OptionsStore) => number;
  write: (store: OptionsStore, value: number) => void;
  keys?: string[];
  back?: boolean;
  menu?: boolean;
  numeric?: boolean;
  customLabel?: () => string;
}

/** One row as the list draws it (createOptionsModel().view()). */
export interface OptionsViewEntry {
  id: string;
  label: string;
  numeric: boolean;
  help: string;
  menu: boolean;
  locked: boolean;
  value: string | undefined;
  custom: boolean;
  canLeft: boolean;
  canRight: boolean;
}

/** The EFFECTS category that is showing its switches: which category, and the row to return the cursor to. */
export interface OptionsOpenCategory {
  index: number;
  cat: number;
}

/** One on/off switch of an EFFECTS category. */
export interface EffectItem {
  key: string;
  label: string;
  help: string;
}

/** One EFFECTS category (the F2 group of the same name). */
export interface EffectCategory {
  id: string;
  label: string;
  help: string;
  items: EffectItem[];
}
