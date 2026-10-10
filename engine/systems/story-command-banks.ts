/** Command arms of get_flag/set_flag, exe/fns.s:6824-6838, 6842-6968,
 * 7088-7173. See docs/research/scripting/get-flag-banked-predicate-system.md.
 * These calls discard the written value and never store a flag. */
export const STORY_COMMAND_BANKS = [0x74, 0x76, 0x78, 0x7a, 0x7c, 0x90, 0x94] as const;
export type StoryCommand = {
  kind: 'battle' | 'card_duel' | 'item_shop' | 'card_shop' | 'inn' | 'digimon_lab' | 'name' | 'talk_event' | 'gym';
  index: number;
  screen?: number;
  parameter?: number;
};
export function isStoryCommandBank(bank: number): boolean {
  return (STORY_COMMAND_BANKS as readonly number[]).includes(bank);
}

/** null means this bank has no command arm, or the desk index is inert.
 * Index decoding is nine bits, including ids in the odd upper-byte half. */
export function storyCommand(id: number): StoryCommand | null {
  const bank = (id >>> 8) & 0xfe;
  const index = id & 0x1ff;
  switch (bank) {
    case 0x74: return { kind: 'battle', index };
    case 0x76: case 0x78:
      return { kind: 'card_duel', index, screen: 0x700, parameter: index * 2 + (bank === 0x78 ? 1 : 0) + 1 };
    case 0x7a:
      if (index < 0x1e) return { kind: 'item_shop', index, screen: 0xf00, parameter: index };
      if ((index >= 0x31 && index < 0x44) || (index >= 0x46 && index < 0x4b))
        return { kind: 'card_shop', index, screen: 0x1300, parameter: index };
      return { kind: 'inn', index }; // fieldstg's inn launcher takes no argument
    case 0x7c:
      if (index === 0) return { kind: 'digimon_lab', index, screen: 0xd00, parameter: 0 };
      if (index === 1) return { kind: 'name', index, screen: 0xb00, parameter: 0 };
      return null;
    case 0x90: return { kind: 'talk_event', index };
    case 0x94: return { kind: 'gym', index, screen: 0xa00, parameter: index };
    default: return null;
  }
}

/** The getter's fallthrough returns success even for expected=0. It is not
 * a value that the caller may negate. Keep tri-state behavior for other banks. */
export function flagConditionPasses(
  read: (id: number) => number | boolean | null, id: number, expected: number,
): boolean {
  return isStoryCommandBank((id >>> 8) & 0xfe) || read(id) === expected;
}
