// Command-line generator:
//   node src/cli.ts --rom path/to/rom.(zip|nes) [--seed CODE | --set key=value ...] [--uniform COLOR] [--hair COLOR]
//                   [--out file.(zip|nes)]
// --set picks gameplay options for a fresh seed, e.g. --set trucks=on --set health=4 (see GAMEPLAY_SCHEMA).
// Output is a .zip containing the .nes unless --out ends in .nes.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generate } from './core/generate.ts';
import { GAMEPLAY_SCHEMA, newSeedCode } from './core/settings.ts';
import { makeZip, unzipRom } from './core/zip.ts';

const { values } = parseArgs({
  options: {
    rom: { type: 'string' },
    seed: { type: 'string' },
    uniform: { type: 'string' },
    hair: { type: 'string' },
    enemy: { type: 'string' },
    out: { type: 'string' },
    set: { type: 'string', multiple: true },
  },
});

if (!values.rom) {
  console.error(
    'usage: node src/cli.ts --rom ROM [--seed CODE | --set key=value ...] [--uniform COLOR] [--hair COLOR] [--enemy COLOR] [--out FILE]',
  );
  process.exit(2);
}

const cosmetics = {
  ...(values.uniform && { uniformColor: values.uniform }),
  ...(values.hair && { hairColor: values.hair }),
  ...(values.enemy && { enemyColor: values.enemy }),
};
const settings = Object.fromEntries((values.set ?? []).map((kv) => kv.split('=') as [string, string]));
if (values.seed && values.set)
  throw new Error('--set only applies to a fresh seed; a seed code already holds its options');
if (values.set && !values.set.every((kv) => GAMEPLAY_SCHEMA.some((o) => o.key === kv.split('=')[0]))) {
  throw new Error(
    `unknown option in --set; options: ${GAMEPLAY_SCHEMA.map((o) => `${o.key}=${o.values.join('|')}`).join(', ')}`,
  );
}
const { data } = await unzipRom(new Uint8Array(readFileSync(values.rom)));
const { rom, spoiler } = generate(data, values.seed ?? newSeedCode(settings), { cosmetics });
const base = `BC-rando-${spoiler.seedCode}`;
const out = values.out ?? `${base}.zip`;
writeFileSync(out, /\.nes$/i.test(out) ? rom : await makeZip([{ name: `${base}.nes`, data: rom }]));
writeFileSync(`${out.replace(/\.(nes|zip)$/i, '')}.spoiler.json`, `${JSON.stringify(spoiler, null, 2)}\n`);
console.log(`wrote ${out}`);
console.log(JSON.stringify(spoiler, null, 2));
