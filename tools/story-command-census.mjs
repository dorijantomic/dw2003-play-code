// Census of the shipped converted flag readers/writers, with JSON pointers.
// Does not write assets or read RAM. Original dispatch members come from the
// bounded set_flag assembly, not from the implementation's list.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function commandBanksFromAssembly() {
  const text = readFileSync(`${process.env.DDW3_DIR ?? `${process.env.HOME}/ddw3`}/asm/dw2003/exe/fns.s`, 'utf8');
  const body = text.slice(text.indexOf('F0x800165ac:'), text.indexOf('.section "fns2.0x80016924"'));
  const banks = new Set();
  let constant;
  for (const line of body.split('\n')) {
    const load = line.match(/: li \$v0, (0x[0-9a-f]+)/);
    if (load) constant = Number(load[1]);
    else if (/: bne \$s[13], \$v0,/.test(line) && constant >= 0x74 && constant !== 0x92) banks.add(constant);
    // The comparison ladder carries v0 through the branch delay slot. Other
    // writes invalidate it; the duplicated li after a call restores it.
    else if (/: (?:\w+) \$v0,/.test(line)) constant = undefined;
  }
  return [...banks].sort((a, b) => a - b);
}
export function convertedCommandUses(banks) {
  const uses = [];
  const member = id => Number.isInteger(id) && banks.includes((id >>> 8) & 0xfe);
  const add = (source, pointer, id, value, access) => {
    if (member(id)) uses.push({ source, pointer, id, value, access });
  };
  const walk = (o, source, pointer = '') => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'number' && typeof o.expected === 'number')
      add(source, pointer, o.id, o.expected, pointer.includes('/on_close/') ? 'write' : 'read');
    if (Array.isArray(o.sets)) for (const [i, pair] of o.sets.entries()) {
      if (Array.isArray(pair) && pair.length === 2) add(source, `${pointer}/sets/${i}`, pair[0], pair[1], 'completion_copy');
    }
    if (o.op === 'set_flag') add(source, pointer, o.flag, o.value, 'write');
    if (o.op === 'SetFlag' || o.op === 'ClearFlag') add(source, pointer, o.args[0].v, o.op === 'ClearFlag' ? 0 : o.args[1].v, 'write');
    if (o.kind === 'leaf' && (o.leaf === 'flag' || o.leaf === 'hasFlag'))
      add(source, pointer, o.args[0], o.args[1] ?? 1, pointer.includes('.sb.') ? 'converted_battle_queue' : 'read');
    if (typeof o.cond_a === 'number') {
      add(source, `${pointer}/cond_a`, o.cond_a, o.arg_a, 'read');
      add(source, `${pointer}/cond_b`, o.cond_b, o.arg_b, 'read');
    }
    if (typeof o.flag === 'number' && typeof o.eq === 'number') {
      add(source, `${pointer}/flag`, o.flag, o.eq, 'read');
      add(source, `${pointer}/flag_b`, o.flag_b, o.eq_b, 'read');
    }
    for (const [key, value] of Object.entries(o)) walk(value, source, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  };
  const sources = ['web/assets/engine-content.json', 'web/assets/data/story_steps.json',
    ...readdirSync('web/assets/scenes').filter(n => /^s\d+\.json$/.test(n)).sort().map(n => `web/assets/scenes/${n}`)];
  for (const source of sources) {
    const o = JSON.parse(readFileSync(source, 'utf8'));
    if (source.endsWith('engine-content.json')) {
      // Annotate converter-owned battle queue conditions separately from original gates.
      for (const [i, stage] of o.stages.entries()) {
        for (const [j, event] of stage.events.entries()) {
          const before = uses.length;
          walk(event, source, `/stages/${i}/events/${j}`);
          if (event.id.includes('.sb.')) for (const use of uses.slice(before)) if (use.access === 'read' && ((use.id >>> 8) & 0xfe) === 0x74) use.access = 'converted_battle_queue';
        }
        for (const [j, script] of stage.scripts.entries()) walk(script, source, `/stages/${i}/scripts/${j}`);
        walk(stage.completions, source, `/stages/${i}/completions`);
      }
    } else walk(o, source);
  }
  return uses;
}
export function commandCensus() {
  const banks = commandBanksFromAssembly();
  const uses = convertedCommandUses(banks);
  return { banks, uses };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const census = commandCensus();
  if (process.argv.includes('--write')) writeFileSync('data/story-command-uses.json', JSON.stringify(census, null, 2) + '\n');
  console.log(JSON.stringify({ banks: census.banks.map(b => b.toString(16)), uses: census.uses.length,
    counts: census.banks.map(bank => ({ bank: bank.toString(16), reads: census.uses.filter(u => ((u.id >>> 8) & 0xfe) === bank && u.access === 'read').length,
      writes: census.uses.filter(u => ((u.id >>> 8) & 0xfe) === bank && u.access === 'write').length,
      copies: census.uses.filter(u => ((u.id >>> 8) & 0xfe) === bank && u.access === 'completion_copy').length,
      queue: census.uses.filter(u => ((u.id >>> 8) & 0xfe) === bank && u.access === 'converted_battle_queue').length })) }));
}
