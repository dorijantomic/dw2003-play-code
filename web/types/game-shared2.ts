// Types only (my own shared file for web/game/*): nothing here is emitted.

/** A typed object that is also read and written by a property name only known at run time (the textbox Proxy in web/game/vars.ts). */
export type WithAnyKey<T> = T & Record<PropertyKey, unknown>;
