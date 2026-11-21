// web/system-status.json, written by tools/build_system_status.mjs out of the research records.

/** One research claim about a system (data/claims/*), with the state the ledger gives it. */
export interface StatusClaim {
  id: string;
  status: string;
  text: string;
}

/** What the ledger knows about one system: how many claims, and whether the topic is closed. */
export interface StatusLearned {
  claims: number;
  verified: number;
  partially_verified: number;
  candidate: number;
  contradicted: number;
  unresearched: number;
  frontiers: number;
  frontiersOpen: number;
  exhaustive: boolean;
  /** the question the claims answer, in one line */
  scope: string;
}

/** One open question the records still carry for a system. */
export interface StatusFrontier {
  question: string;
  needed: string;
}

/** Where the system stands in the game, as the catalogue's wiring note says. */
export interface StatusWired {
  status: string;
  /** our modules that carry the system */
  modules: string[];
  note?: string;
  remaining?: {
    translated?: string;
    depends_on_original?: string;
    untouched?: string;
  };
}

/** One system's row on the status page. */
export interface StatusSystem {
  id: string;
  summary: string;
  aliases: string[];
  priority?: number;
  docs: string[];
  learned: StatusLearned;
  /** decoded original routines this system's labels cover */
  routines: { labels: string[]; decoded: number };
  wired: StatusWired;
  checked: { tests: string[]; markVerified?: string | null; proof?: string };
  gaps: {
    frontiers: StatusFrontier[];
    /** files the catalogue names that no longer exist */
    missingFiles: string[];
    contradicted: unknown[];
    notExportedFiles?: string[];
  };
  labs: Array<{ href: string; label: string }>;
  /** the globs this system owns in our code */
  owns: string[];
  ownedFiles: string[];
  claimList: StatusClaim[];
}

/** One of our code files, with how much of the original's routines it covers. */
export interface StatusCodeFile {
  module: string;
  routines: number;
  library?: number;
  read: {
    named?: number;
    topic?: number;
    opaque?: number;
    readable?: number;
    structural?: number;
    not_in_table?: number;
  };
  verification?: Record<string, number>;
  translated: number;
  wired: number;
  oracle?: number;
  blocked?: number;
  systems: string[];
  question?: string;
  needed?: string;
  /** data only: the module holds tables, no routine */
  dataOnly?: boolean;
}

/** One line of the Screen progress tab. */
export interface StatusScreenEntry {
  what: string;
  state?: string;
  commit?: string;
}

/** The status page's data: totals, the systems, the screens, and the catalogue gaps. */
export interface SystemStatusPage {
  generatedBy?: string;
  note?: string;
  inputs?: {
    catalogUpdated?: string;
    ledgerClaims?: number;
    ownershipGeneratedAt?: string;
    functionTableRows?: number;
    inventoryModules?: number;
  };
  /** data/screen_progress.json: the lists the Screen progress tab prints */
  screens?: {
    next: StatusScreenEntry[];
    inProgress: StatusScreenEntry[];
    open: StatusScreenEntry[];
    done: StatusScreenEntry[];
  };
  systems: StatusSystem[];
  /** the places the records themselves leave loose */
  catalogGaps?: {
    unclaimedEngine: string[];
    unownedCode: Array<{ path: string; reason: string }>;
    unassignedRoutines: Array<{ label: string; count: number }>;
    unlabeledRoutines?: Record<string, number>;
    /** facts filed under a system id the catalogue does not have */
    strayClaims: Array<{ system: string; claims: string[] }>;
  };
  codeFiles?: StatusCodeFile[];
  totals: Record<string, number>;
}
