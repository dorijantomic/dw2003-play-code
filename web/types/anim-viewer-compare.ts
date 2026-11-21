
/** The bone each retarget role sits on (a role the map does not carry is absent from the row). */
export interface AnimRoleBones {
  torso?: number;
  head?: number;
  footL?: number;
  footR?: number;
  wingL?: number;
  wingR?: number;
}

/** The deep link of a compare view: the bake id it compares and the tick it opens on. */
export interface CompareQuery {
  id?: string;
  tick?: number | null;
}
