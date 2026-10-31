import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCosmetics } from '../src/core/cosmetics.ts';
import { applyNoMusic } from '../src/core/patches/music.ts';
import { CREDITS_HEADER, creditsText } from '../src/core/credits.ts';
import { JOE_LETTERS, MISSION_REPORTS, SELF_DESTRUCTS, STILL_INSIDES } from '../src/core/bosses.ts';
import { generate, logicDepth, planSeed } from '../src/core/generate.ts';
import { fill, isCompletable, sweep } from '../src/core/logic.ts';
import { ENEMY_COLORS, HAIR_COLORS, playerPaletteBlocks, UNIFORM_COLORS } from '../src/core/palette.ts';
import { applyDoorLocks } from '../src/core/patches/locks.ts';
import { Rng } from '../src/core/rng.ts';
import { crc32, identifyPrg, verifyRom } from '../src/core/rom.ts';
import {
  BRUTE_SETTINGS,
  DEFAULT_SETTINGS,
  GAMEPLAY_SCHEMA,
  chaosSettings,
  conflicts,
  makeSeedCode,
  newSeedCode,
  normalizeSettings,
  parseSeedCode,
  IRON_SETTINGS,
  VANILLA_SETTINGS,
} from '../src/core/settings.ts';
import { applyTitleLogo, renderLogo } from '../src/core/title.ts';
import { joinHyphens, oxfordCommas, singleSpaces, spaceCommas, spaceTitles } from '../src/core/typos.ts';
import { readMessage, wrap } from '../src/core/text.ts';
import { buildLocations, GATE_PRESETS, ITEMS, reachableMap, ROADS } from '../src/core/world.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf } from './spoil.ts';

/** The reward of map number n's area clear (spoiler keys name the layout too: "Area 3 clear (O10)"). */

const code = (n: number, settings = {}) => makeSeedCode({ areas: 'vanilla', ...settings }, BigInt(n)); // map numbers = layouts

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng('abc'),
      b = new Rng('abc'),
      c = new Rng('abd');
    const seqA = Array.from({ length: 8 }, () => a.nextU32());
    expect(Array.from({ length: 8 }, () => b.nextU32())).toEqual(seqA);
    expect(Array.from({ length: 8 }, () => c.nextU32())).not.toEqual(seqA);
  });
  it('int stays in range', () => {
    const r = new Rng('x');
    for (let i = 0; i < 1000; i++) expect(r.int(7)).toBeLessThan(7);
  });
});

describe('seed codes', () => {
  it('are a version char + base 32 (uppercase, no I/O/0/1) and round-trip, case-insensitively', () => {
    // every option set to its last value (non-default)
    const s = Object.fromEntries(GAMEPLAY_SCHEMA.map((o) => [o.key, o.values[o.values.length - 1]]));
    const c = makeSeedCode(s, 123456789n);
    expect(c).toMatch(/^[CVSRB][A-HJ-NP-Z2-9]+$/);
    expect(parseSeedCode(c)).toEqual({ settings: s, seed: 123456789n });
    expect(parseSeedCode(` ${c.toLowerCase()} `)).toEqual({ settings: s, seed: 123456789n });
    const fresh = newSeedCode();
    expect(parseSeedCode(fresh).settings).toEqual(DEFAULT_SETTINGS);
  });
  it('defaults encode as zero bits, so a shorter (older) code still decodes', () => {
    const c = code(42);
    expect(parseSeedCode(c.slice(0, 12)).settings).toEqual(DEFAULT_SETTINGS); // custom's C and 54 seed bits only (11 characters)
  });
  it('a preset is a short code (its letter and the seed, no options; Vanilla just VANILLA); anything else is custom (C) with every option', () => {
    for (const [letter, settings] of [
      ['S', DEFAULT_SETTINGS],
      ['R', IRON_SETTINGS],
      ['B', BRUTE_SETTINGS],
    ] as const) {
      const c = makeSeedCode(settings, 12345n);
      expect(c).toMatch(new RegExp(`^${letter}[A-HJ-NP-Z2-9]{11}$`));
      expect(parseSeedCode(c)).toEqual({ settings: normalizeSettings(settings), seed: 12345n });
      expect(parseSeedCode(c.toLowerCase()).seed).toBe(12345n);
    }
    // (Vanilla has nothing random: one code, and the V + seed form still reads)
    expect(makeSeedCode(VANILLA_SETTINGS, 12345n)).toBe('VANILLA');
    expect(parseSeedCode('vanilla')).toEqual({ settings: normalizeSettings(VANILLA_SETTINGS), seed: 0n });
    expect(parseSeedCode('VAAAAAAAAAAC').settings).toEqual(normalizeSettings(VANILLA_SETTINGS));
    const custom = makeSeedCode({ ...BRUTE_SETTINGS, mapSpeed: '2' }, 12345n);
    expect(custom).toMatch(/^C/);
    expect(custom.length).toBeGreaterThan(12);
    expect(parseSeedCode(custom).settings.mapSpeed).toBe('2');
    expect(() => parseSeedCode(`X${custom.slice(1)}`), 'no such first char').toThrow(/valid/);
  });
  it('rejects malformed or future codes', () => {
    expect(() => parseSeedCode('A-K7QX2')).toThrow();
    expect(() => parseSeedCode('B')).toThrow();
    expect(() => parseSeedCode('B!!!!!!!!!!')).toThrow();
    expect(() => parseSeedCode(`${code(1)}AZ`)).toThrow(/newer/);
    expect(() => parseSeedCode(`${code(1).slice(0, -1)}I`)).toThrow(/valid/);
  });
});

describe('presets', () => {
  it('Vanilla names a value of every option and plans a beatable seed', () => {
    for (const o of GAMEPLAY_SCHEMA) expect(o.values).toContain(VANILLA_SETTINGS[o.key]);
    expect(() => planSeed(makeSeedCode(VANILLA_SETTINGS, 1n))).not.toThrow();
  });
  it('Iron and Brute name valid values, have no conflict and plan seeds', () => {
    for (const preset of [IRON_SETTINGS, BRUTE_SETTINGS]) {
      for (const o of GAMEPLAY_SCHEMA) expect(o.values).toContain(preset[o.key]);
      expect(conflicts(preset)).toEqual([]);
      for (const n of [1n, 2n, 3n]) expect(() => planSeed(makeSeedCode(preset, n))).not.toThrow();
    }
  });
  const plans = (settings: Record<string, string>, tries = 6) =>
    Array.from({ length: tries }, (_, i) => BigInt(i + 1) * 1_000_003n).some((n) => {
      try {
        planSeed(makeSeedCode(settings, n), true);
        return true;
      } catch {
        return false;
      }
    });
  it('conflicting options: each rule makes no seed, and the same options minus one of its keys do', () => {
    const iff = { ...DEFAULT_SETTINGS, rewards: 'vanilla', gate: 'iff' };
    // (the rule covers every vanilla-rewards IFF combination; these two never plan at all)
    const cases = [
      { ...iff, areas: 'vanilla' },
      { ...iff, barrier: 'machine', zones: 'vanilla', buildings: 'vanilla', comms: 'vanilla' },
    ];
    expect(conflicts({ ...iff, areas: 'shuffled' }).length, 'shuffled layouts too').toBe(1);
    for (const s of cases) {
      expect(conflicts(s).length).toBe(1);
      expect(plans(s)).toBe(false);
      expect(() => planSeed(makeSeedCode(s, 1n))).toThrow(/conflict/);
      expect(plans({ ...s, gate: 'vanilla' })).toBe(true);
    }
    expect(conflicts(DEFAULT_SETTINGS)).toEqual([]);
    expect(conflicts(VANILLA_SETTINGS)).toEqual([]);
  });
  it('the depth rule: those options never reach depth 3, and planning anyway settles for less (best effort)', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      depth: '3',
      area12: 'vanilla',
      area12Comm: 'none',
      gate: 'open',
      flak: 'open',
      areas: 'vanilla',
      commLocks: 'vanilla',
    };
    expect(conflicts(s).length).toBe(1);
    expect(conflicts({ ...s, depth: '0' })).toEqual([]);
    expect(() => planSeed(makeSeedCode(s, 1n))).toThrow(/conflict/);
    for (const n of [1n, 2n, 3n])
      expect(planSeed(makeSeedCode(s, n), true).mustHave.filter((i) => i !== 'joe').length).toBeLessThan(3);
  });
  it("the spoiler's logic depth notes a best-effort shortfall", () => {
    const s = { ...DEFAULT_SETTINGS, depth: '6', pathComm: 'on' };
    expect(logicDepth(s, ['joe', 'alpha', 'beta', 'rocket', 'flare', 'wide', 'iff'])).toEqual({ depth: 6, short: [] });
    expect(logicDepth(s, ['joe', 'alpha', 'rocket', 'flare'])).toEqual({ depth: 3, short: ['depth', 'pathComm'] });
    expect(logicDepth({ ...s, rewards: 'vanilla' }, ['joe', 'rocket'])).toEqual({ depth: 1, short: [] });
  });
  it('Chaos never picks conflicting options', () => {
    for (let i = 0; i < 200; i++) expect(conflicts(chaosSettings())).toEqual([]);
  });
});

describe('cosmetics', () => {
  it('rejects unknown values', () => {
    expect(() => normalizeCosmetics({ uniformColor: 'plaid' })).toThrow();
  });
});

describe('logic', () => {
  const locations = buildLocations();
  it('vanilla placement is completable', () => {
    const vanilla = new Map(locations.map((l) => [l.id, l.vanilla]));
    expect(isCompletable(locations, vanilla, 'joe')).toBe(true);
    expect(isCompletable(locations, vanilla, 'joe+10+11')).toBe(true);
  });
  it('a placement that locks the Rocket Launcher behind its own barrier is rejected', () => {
    const bad = new Map(locations.map((l) => [l.id, l.vanilla]));
    bad.set('clear5', 'permit');
    bad.set('clear6', 'rocket');
    expect(isCompletable(locations, bad, 'joe')).toBe(false);
  });
  it('every filled seed is completable and items move around', () => {
    const where = new Map<string, Set<string>>();
    for (let i = 0; i < 300; i++) {
      const p = fill(locations, i % 2 ? 'joe' : 'joe+10+11', new Rng(`fill-${i}`));
      expect(isCompletable(locations, p, 'joe')).toBe(true);
      expect(p.get('clear6')).not.toBe('rocket');
      expect(p.get('clear8')).not.toBe('permit');
      expect([...p].filter(([, item]) => item === 'joe')).toHaveLength(1);
      for (const [loc, item] of p) {
        if (!where.has(item)) where.set(item, new Set());
        where.get(item)!.add(loc);
      }
    }
    for (const item of ['rocket', 'threeway', 'permit', 'pills', 'joe'])
      expect(where.get(item)!.size).toBeGreaterThan(3);
  });
  it('the dark area needs the Flare only with True Dark; the route expects it either way', () => {
    const area4 = (opts: { fair?: boolean; trueDark?: boolean }) =>
      buildLocations(undefined, undefined, undefined, false, undefined, undefined, opts).find((l) => l.areaClear === 4)!
        .requires;
    const has = (...items: string[]) => ({ has: (i: string) => items.includes(i) }) as never;
    expect(area4({ fair: false })(has('alpha')), 'vanilla darkness: dim but playable').toBe(true);
    expect(area4({ fair: false, trueDark: true })(has('alpha')), 'True Dark').toBe(false);
    expect(area4({ fair: false, trueDark: true })(has('alpha', 'flare'))).toBe(true);
    expect(area4({ fair: true })(has('alpha')), 'the route waits for it').toBe(false);
    expect(area4({ fair: true })(has('alpha', 'flare'))).toBe(true);
    // Dark Areas: More (here O9 dark too; O11 not)
    const area = (n: number, opts: { fair?: boolean; trueDark?: boolean }) =>
      buildLocations(undefined, undefined, undefined, false, undefined, undefined, { ...opts, dark: [4, 9] }).find(
        (l) => l.areaClear === n,
      )!.requires;
    expect(area(9, { fair: false })(has()), 'O9 dim: playable').toBe(true);
    expect(area(9, { fair: false, trueDark: true })(has())).toBe(false);
    expect(area(9, { fair: false, trueDark: true })(has('flare'))).toBe(true);
    expect(area(9, { fair: true })(has('gamma'))).toBe(false);
    expect(area(9, { fair: true })(has('gamma', 'flare'))).toBe(true);
    expect(area(11, { fair: false, trueDark: true })(has())).toBe(true);
  });
  it("a comm-locked layout truly needs its comm (Comm Locks: here O2 and O5 too); others only on the route's rule", () => {
    const area = (n: number, fair: boolean) =>
      buildLocations(undefined, undefined, undefined, false, undefined, undefined, {
        fair,
        locked: [1, 2, 4, 5, 8],
      }).find((l) => l.areaClear === n)!.requires;
    const has = (...items: string[]) => ({ has: (i: string) => items.includes(i) }) as never;
    expect(area(2, false)(has()), 'O2 locked').toBe(false);
    expect(area(2, false)(has('beta'))).toBe(true);
    expect(area(5, false)(has()), 'O5 locked').toBe(false);
    expect(area(5, false)(has('alpha'))).toBe(true);
    expect(area(3, false)(has()), 'O3 not locked: free').toBe(true);
    expect(area(3, true)(has()), "the route's rule: its comm in hand").toBe(false);
  });
  it('sweep spheres start with what is free', () => {
    const vanilla = new Map(locations.map((l) => [l.id, l.vanilla]));
    const s = sweep(locations, vanilla, 'joe');
    expect(s.spheres[0].map((g) => g.location)).toContain('clear1'); // α is a starting item
    expect(s.canFinish).toBe(true);
  });
});

describe('map graph', () => {
  const none = { has: () => false };
  it('the second half (7-12, NZ17-19) is behind the 6<->8 gate or the passages', () => {
    const gate = GATE_PRESETS.vanilla;
    const first = reachableMap(none, new Set(), gate);
    expect([...first].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 13, 14, 15, 16]);
    expect(reachableMap(none, new Set(), undefined).size).toBe(20); // gate open: every map number, passages not needed
    expect(reachableMap({ has: (i) => i === 'gamma' }, new Set([3, 6]), gate).has(12)).toBe(true);
    expect(reachableMap({ has: (i) => i === 'passage' }, new Set(), gate).has(9)).toBe(true); // 14->17->9
  });
  it('vanilla placement with the gate is completable', () => {
    const locations = buildLocations();
    const vanilla = new Map(locations.map((l) => [l.id, l.vanilla]));
    expect(isCompletable(locations, vanilla, { area12: 'joe', gate: GATE_PRESETS.vanilla })).toBe(true);
  });
});

describe('rom', () => {
  it('rejects wrong files', () => {
    expect(verifyRom(new Uint8Array(1000)).ok).toBe(false);
    expect(verifyRom(new Uint8Array(262160)).ok).toBe(false);
  });
  it('names known-but-unsupported dumps', () => {
    expect(identifyPrg(0xd2574720)?.supported).toBe(true);
    expect(identifyPrg(0xbe4c6e42)?.supported).toBe(false);
    expect(identifyPrg(0x12345678)).toBeUndefined();
  });
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

const GOODNES_PATH = resolve(import.meta.dirname, '../../source-roms/Bionic Commando (U).nes');
describe.skipIf(!existsSync(GOODNES_PATH))('the old GoodNES dump', () => {
  it('is rejected with a message naming it and the No-Intro dump', () => {
    const check = verifyRom(new Uint8Array(readFileSync(GOODNES_PATH)));
    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toMatch(/GoodNES.*No-Intro/s);
  });
});

describe.skipIf(!HAVE_ROM)('with the real ROM', () => {
  it('verifies the No-Intro USA ROM, headered and headerless', () => {
    const rom = loadRom();
    expect(verifyRom(rom).ok).toBe(true);
    const headerless = verifyRom(rom.subarray(16));
    expect(headerless.ok && headerless.rom).toEqual(rom);
  });

  it('the road table matches the ROM road lists', () => {
    const rom = loadRom();
    const o = (a: number) => 0x10 + 0x0d * 0x4000 + a - 0x8000;
    const edges = new Set<string>();
    for (let n = 0; n < 20; n++) {
      const p = rom[o(0xa760 + 2 * n)] | (rom[o(0xa761 + 2 * n)] << 8);
      for (let off = 2; off <= rom[o(p)]; off += 2) {
        const to = Number(rom[o(p) + off + 1].toString(16));
        edges.add([n, to].sort((a, b) => a - b).join('-'));
      }
    }
    expect([...edges].sort()).toEqual(ROADS.map(([a, b]) => `${a}-${b}`).sort());
  });

  it('vanilla rewards change only the logo, road gates, comm page boxes, passage gate, Area 12 check, Joe routine, printer, text and the sealed doors', () => {
    const rom = loadRom();
    const locks = loadRom();
    applyDoorLocks(locks, []); // the vanilla locks' doors, drawn sealed in the background (doorpanels.ts)
    const out = generate(
      rom,
      code(7, {
        rewards: 'vanilla',
        buildings: 'vanilla',
        zones: 'vanilla',
        markers: 'off',
        gateDisplay: 'off',
        gate: 'open',
        trucks: 'on',
        continues: '0',
        mapSpeed: '1',
        comms: 'vanilla',
        hints: 'vanilla',
        flak: 'open',
        barrier: 'vanilla',
        destroyer: 'vanilla',
        rapidFire: 'off',
        machineGun: 'off',
        topDownDrops: 'off',
        eagles: 'vanilla',
        d1Portrait: 'off',
        area12Comm: 'none',
        timer: 'off',
        story: 'vanilla',
        pickupText: 'off',
        turrets: 'vanilla',
        commLocks: 'vanilla',
      }),
    ).rom;
    const changed = [...out.keys()].filter((i) => out[i] !== rom[i]);
    const allowed = (i: number) =>
      (i >= 0x1c010 + 0x70 * 16 && i < 0x1c010 + 0x90 * 16) || // COMRANDO logo tiles
      (i >= 0x1c010 + 0xcd * 16 && i < 0x1c010 + 0xcd * 16 + 8) || // the title font's O (option, default fixed)
      i === 0x365e1 ||
      i === 0x365fc || // road gates
      (i >= 0x364fd && i < 0x364fd + 10) || // Area 12 call site
      (i >= 0x35c50 && i < 0x35c50 + 0x22) || // Area 12 routine + flag table
      (i >= 0x3652a && i < 0x3652a + 5) ||
      (i >= 0x35c90 && i < 0x35c90 + 10) || // refusal returns to the menu
      (i >= 0x3531c && i < 0x3531c + 3) ||
      (i >= 0x35cb0 && i < 0x35cb0 + 17) || // Joe's flag routine
      (i >= 0x0ec00 && i < 0x0ec00 + 10) ||
      i === 0x0f8f7 + 0xd8 ||
      i === 0x0f8f7 + 0xd9 || // Joe's rescue room CHR list
      (i >= 0x2c014 && i < 0x2c010 + 0x268f) ||
      (i >= 0x2e790 && i < 0x2e810) ||
      (i >= 0x2f710 && i < 0x2f810) || // text: pointers, messages, free gaps
      (i >= 0x2fcd0 && i < 0x2ff90) ||
      (i >= 0x2ffd3 && i < 0x2fff0) || // (the gaps lent to text: 0B:$BCC0-$BF7F, $BFC3-$BFDF)
      (i >= 0x36ad6 && i < 0x36ad6 + 5) ||
      (i >= 0x3660f && i < 0x3660f + 39) || // passage gate fix
      (i >= 0x35ca0 && i < 0x35ca0 + 10) || // comm page box fix
      (i >= 0x3e6fd && i < 0x3e6fd + 12) || // boss lines (swapped when Joe isn't in Area 7)
      (i >= 0x3c468 && i < 0x3c468 + 4) || // the printer's space-skipping hook call (printer.ts)
      (i >= 0x5df0 && i < 0x6010) ||
      (i >= 0x7f8a && i < 0x7fcb) ||
      (i >= 0x7fd0 && i < 0x7ff0) ||
      (i >= 0x7ef8 && i < 0x7ef8 + 3) ||
      i === 0x7ee5 ||
      i === 0x7eea || // final screen (finalscreen.ts): bank 1 code and lines, step 5's tail
      (i >= 0x2bb05 && i < 0x2bb05 + 1 + 22 * 4) || // and the signature's metasprite (0A:$BAF5)
      locks[i] !== rom[i];
    expect(changed.filter((i) => !allowed(i))).toEqual([]);
  });

  it('writes each shuffled reward (item + clear text) into the ROM tables', () => {
    const rom = loadRom();
    const { rom: out, spoiler } = generate(rom, code(99));
    let joeHost = 0;
    for (let n = 1; n <= 11; n++) {
      const id = clearOf(spoiler, n)!;
      if (id === 'joe') {
        joeHost = n;
        continue;
      }
      const item = ITEMS[id];
      expect(out[0x2b17e + n]).toBe(item.inventory);
      expect(out[0x2b18a + n]).toBe(item.clearText);
    }
    expect(joeHost).toBeGreaterThan(0);
    expect(out[0x3ca20]).toBe(joeHost); // the special clear (rescue scene) runs for Joe's area
  });

  it('Fix Typos: a space after each comma where its row has room (the vanilla lines and the rewritten ones)', () => {
    expect(spaceCommas("HEY,IF YOU'RE   GOING")).toBe("HEY, IF YOU'RE  GOING"); // (into the row's padding)
    expect(spaceCommas('THIS IS LADD,OURCOMMANDER.')).toBe('THIS IS LADD,   OUR COMMANDER.'); // (a full row pushes a word down)
    const page = 'THIS IS M-8.    USE THIS        COMMUNICATOR IN AREAS 1,4 AND 5.';
    expect(spaceCommas(page)).toBe(page); // (but never into a page the message doesn't have)
    // (a pushed-down word can overflow the next row by more than one word: it hands down as many as it takes)
    const rows = (...r: string[]) => r.map((x, i) => (i < r.length - 1 ? x.padEnd(16) : x)).join('');
    expect(spaceCommas(rows('A,BCDEFGHIJKLMNO', 'XX YY ZZ'))).toBe(rows('A,', 'BCDEFGHIJKLMNO', 'XX YY ZZ'));
    expect(spaceCommas('HURRY,TAKE IT.')).toBe('HURRY, TAKE IT.'); // (a last row grows)
    expect(spaceTitles(rows('MR.JOE.', "I'VE COME TO"))).toBe(rows('MR. JOE.', "I'VE COME TO")); // (and after MR.)
    expect(spaceTitles(rows('MAKE WAY FOR', 'MR.KILLT.'))).toBe(rows('MAKE WAY FOR', 'MR. KILLT.'));
    // broken words whole again where the page has room (joinHyphens), else as they were
    expect(joinHyphens(rows('I CANNOT LET YOU', 'GO THROUGH WITH-', 'OUT A PERMIT.'))).toBe(
      rows('I CANNOT LET YOU', 'GO THROUGH', 'WITHOUT A', 'PERMIT.'),
    );
    expect(singleSpaces(rows('MATION.  IGNORE', ' CATE    TAPPING'))).toBe(rows('MATION. IGNORE', ' CATE    TAPPING')); // (not a menu's gap)
    // (a full page carries words onto the next when the message keeps its pages: #76)
    expect(
      spaceCommas(
        rows("OK,OK,I'LL TALK.", 'UNDERGROUND', 'PATHS RUN', 'BETWEEN AREAS 14', 'AND 17, AND 15', 'AND 18.'),
      ),
    ).toBe(rows("OK, OK, I'LL", 'TALK.', 'UNDERGROUND', 'PATHS RUN', 'BETWEEN AREAS 14', 'AND 17, AND 15', 'AND 18.'));
    expect(oxfordCommas(rows('USE THIS', 'AREAS 1,4 AND 5.', 'WE HAD TO HIDE'))).toBe(
      rows('USE THIS', 'AREAS 1,4, AND', '5. WE HAD TO', 'HIDE'),
    );
    const end = rows('A', 'B', 'C', 'CANNOT SEE ANY-', 'THING.');
    expect(joinHyphens(end)).toBe(end);
    const rom = loadRom();
    for (const [typos, briefing, ok] of [
      ['fixed', 'FIRST, GO SEE', 'YEAH, IT'],
      ['vanilla', 'FIRST,GO SEE', 'YEAH,IT'],
    ] as const) {
      const out = generate(rom, code(3, { typos, hints: 'vanilla', story: 'vanilla' })).rom; // (#35 a vanilla line)
      expect(readMessage(out, 126)!.text, typos).toContain(briefing);
      expect(readMessage(out, 35)!.text, typos).toContain(ok);
    }
  });

  it("the title font's O is redrawn by default and kept as the vanilla zero on request", () => {
    const rom = loadRom();
    const at = 0x1c010 + 0xcd * 16;
    const fixed = generate(rom, code(3)).rom;
    const vanilla = generate(rom, code(3, { titleO: 'vanilla' })).rom;
    expect([...fixed.slice(at, at + 8)]).toEqual([0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c, 0x00]);
    expect([...vanilla.slice(at, at + 16)]).toEqual([...rom.slice(at, at + 16)]);
  });

  it('Top-Down Eagles Nothing: the elite enemies die without becoming the eagle', () => {
    const rom = loadRom();
    const at = 0x10 + 0x0d * 0x4000 + 0x91f2 - 0x8000,
      end = (r: Uint8Array) => [...r.slice(at, at + 3)];
    expect(end(generate(rom, code(3, { topDownDrops: 'off', eagles: 'none' })).rom)).toEqual([0x4c, 0xca, 0xd6]); // JMP $D6CA
    expect(end(generate(rom, code(3, { topDownDrops: 'off', eagles: 'vanilla' })).rom)).toEqual([0xa9, 0x0d, 0x9d]);
    // (with drops: no type 7/9 check before the bullet roll)
    const conv = (eagles: string) => [
      ...generate(rom, code(3, { topDownDrops: 'on', eagles })).rom.slice(
        0x10 + 0x0d * 0x4000 + 0x9db0 - 0x8000,
        0x10 + 0x0d * 0x4000 + 0x9db0 - 0x8000 + 4,
      ),
    ];
    expect(conv('vanilla')).toEqual([0xbd, 0x49, 0x05, 0xc9]);
    expect(conv('none')).toEqual([0xa5, 0x36, 0xc9, 0x55]);
  });

  it('gives Comedic seeds a comedic self-destruct warning and outside line for Ladd', () => {
    const rom = loadRom();
    const lines = SELF_DESTRUCTS.map((l) => wrap(l));
    const letters = JOE_LETTERS.map((l) => ({ header: 0xb0, text: wrap(l) }));
    const reports = MISSION_REPORTS.map((l) => ({ header: 0xb0, text: wrap(l) }));
    const insides = STILL_INSIDES.map((l) => ({ header: 0x03, text: wrap(l) })); // (Ladd's portrait)
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = generate(rom, code(seed, { story: 'comedic' }));
      expect(lines).toContain(readMessage(out.rom, 0xd2 / 2 + 2)!.text);
      expect(insides).toContainEqual(readMessage(out.rom, 0xf4 / 2 + 2));
      expect(reports).toContainEqual(readMessage(out.rom, 0x0a / 2 + 2));
      expect(letters).toContainEqual(readMessage(out.rom, 0x46 / 2 + 2));
    }
  });

  it('puts our credits in #36 unless every option is vanilla', () => {
    const rom = loadRom();
    expect(readMessage(rom, 36)!.header).toBe(CREDITS_HEADER);
    expect(readMessage(generate(rom, code(3)).rom, 36)).toEqual({ header: CREDITS_HEADER, text: creditsText() });
    expect(readMessage(generate(rom, makeSeedCode(VANILLA_SETTINGS, 3n)).rom, 36)).toEqual(readMessage(rom, 36));
  });

  it('fixes the vanilla dialogue typos by default, keeps them on request', () => {
    const rom = loadRom();
    const read = (out: Uint8Array, y: number) => readMessage(out, y / 2 + 2)!.text.replace(/\s+/g, ' ');
    const fixed = generate(rom, code(3, { story: 'vanilla' })).rom; // (Comedic replaces the escape cyborg's #69 and the self-destruct #107)
    const vanilla = generate(rom, code(3, { typos: 'vanilla', story: 'vanilla' })).rom;
    expect(read(fixed, 0xd2)).toContain('WILL EXPLODE IN 60');
    expect(read(vanilla, 0xd2)).toContain('WILL EXPLOD IN 60');
    expect(read(fixed, 0x86)).toBe("IT'S TOO EARLY TO FEEL SAFE. I'LL KILL YOU HERE.");
    expect(read(fixed, 0x38)).toMatch(/^FF BATTALION,/);
    expect(read(fixed, 0x72)).toBe("IS THAT SO, THAT'S VERY DISAPPOINTING.");
    expect(read(fixed, 0xec)).toContain('A SPECIAL MISSION*** TO RESCUE');
    expect(read(fixed, 0xd6)).toContain("BADDS' SE- CRET DOCUMENTS ABOUT"); // (hyphenated across lines)
  });

  it("music off is one byte, RTS at the sound engine's song start (0C:$8044); on leaves it", () => {
    const rom = loadRom();
    const patched = rom.slice();
    applyNoMusic(patched);
    expect([...patched.keys()].filter((i) => patched[i] !== rom[i])).toEqual([0x30054]);
    expect(patched[0x30054]).toBe(0x60);
    expect(generate(rom, code(3, { music: 'off' })).rom[0x30054]).toBe(0x60);
    expect(generate(rom, code(3)).rom[0x30054]).toBe(0xa5);
  });

  it('enemy uniforms recolor only the enemy red in enemy sprite palettes and enemy close-ups', () => {
    const rom = loadRom();
    const base = generate(rom, code(3)).rom;
    const out = generate(rom, code(3), { cosmetics: { enemyColor: 'blue' } }).rom;
    const changed = [...out.keys()].filter((i) => out[i] !== base[i]);
    expect(changed.length).toBeGreaterThan(20);
    for (const i of changed) {
      expect(base[i], `0x${i.toString(16)}`).toBe(0x15);
      expect(out[i]).toBe(UNIFORM_COLORS.blue);
      const inBlock = i >= 0x0727a && i < 0x07910 && [0x1a, 0x1e].includes((i - 0x0727a) % 32);
      const inPortrait = (i >= 0x2e69f && i < 0x2e6cf) || [1, 9, 13].some((o) => i === 0x2e69f + 0x70 + o); // (the robot's at $70)
      expect(inBlock || inPortrait, `0x${i.toString(16)}`).toBe(true);
    }
  });

  it('no early Rocket Launcher: never obtainable without entering the second region (unless the option is off)', () => {
    let early = 0;
    for (let n = 1; n <= 40; n++) {
      expect(generate(loadRom(), code(n, { areas: 'shuffled' })).firstRegion, `seed ${n}`).not.toContain('rocket');
      if (generate(loadRom(), code(n, { areas: 'shuffled', rocket: 'any' })).firstRegion.includes('rocket')) early++;
    }
    expect(early, 'off: it can come early').toBeGreaterThan(5);
  });

  it('the logo patch refuses to apply twice (guards against wrong bytes)', () => {
    const rom = loadRom();
    applyTitleLogo(rom);
    expect(() => applyTitleLogo(rom)).toThrow(/title/);
  });

  it('renders the logo from the ROM tiles, cropped with even padding on black', () => {
    const { width, height, rgba } = renderLogo(loadRom(), 4);
    expect([width, height]).toEqual([162 + 8, 103 + 8]);
    let colored = 0;
    for (let i = 0; i < rgba.length; i += 4) colored += rgba[i] + rgba[i + 1] + rgba[i + 2] ? 1 : 0;
    expect(colored).toBeGreaterThan(width * height * 0.3);
    expect(colored).toBeLessThan(width * height);
  });

  it('finds the 49 player palette blocks', () => {
    expect(playerPaletteBlocks(loadRom())).toHaveLength(49);
  });

  it('same seed code => identical ROM and spoiler (with fixed cosmetics)', () => {
    const rom = loadRom();
    const opts = { cosmetics: { uniformColor: 'blue', hairColor: 'blond' } };
    const a = generate(rom, code(1), opts),
      b = generate(rom, code(1), opts);
    expect(a.rom).toEqual(b.rom);
    expect(a.spoiler).toEqual(b.spoiler);
    expect(generate(rom, code(2), opts).spoiler.rewards).not.toEqual(a.spoiler.rewards);
  });

  it('random cosmetics come from their own RNG, not the seed', () => {
    const rom = loadRom();
    const cosmetics = { uniformColor: 'random', hairColor: 'random' };
    const runs = ['1', '2', '3', '4', '5', '6', '7', '8'].map(
      (k) => generate(rom, code(5), { cosmetics, cosmeticSeed: k }).spoiler,
    );
    expect(new Set(runs.map((r) => r.cosmetics.uniform)).size).toBeGreaterThan(1);
    expect(new Set(runs.map((r) => JSON.stringify(r.rewards))).size).toBe(1); // gameplay unaffected
  });

  // (the draw-again on a full text bank is a safety net: no seed needed it in 1500 random-settings Comedic seeds with
  // Nonsense or Verbose hints)
  it('Comedic seeds with the heaviest text (Nonsense, Verbose hints) generate', () => {
    for (const [n, hints] of [
      [1, 'nonsense'],
      [2, 'verbose'],
      [3, 'nonsense'],
    ] as const) {
      expect(() => generate(loadRom(), code(n, { story: 'comedic', hints })), `${n} ${hints}`).not.toThrow();
    }
  });

  it("random uniforms never match the other side's (the enemies' vanilla raspberry too)", () => {
    const rom = loadRom();
    for (const [uniformColor, enemyColor] of [
      ['random', 'random'],
      ['random', 'vanilla'],
      ['blue', 'random'],
    ]) {
      for (let k = 0; k < 40; k++) {
        const { cosmetics: c } = generate(rom, code(5), {
          cosmetics: { uniformColor, enemyColor },
          cosmeticSeed: String(k),
        }).spoiler;
        expect(UNIFORM_COLORS[c.uniform], `${uniformColor}/${enemyColor} ${k}: ${c.uniform} vs ${c.enemy}`).not.toBe(
          ENEMY_COLORS[c.enemy],
        );
      }
    }
  });

  it('recolors only the uniform/hair bytes of player palette blocks', () => {
    const rom = loadRom();
    const base = generate(rom, code(3)).rom; // same gameplay, vanilla cosmetics
    const out = generate(rom, code(3), { cosmetics: { uniformColor: 'blue', hairColor: 'blond' } }).rom;
    const changed = [...out.keys()].filter((i) => out[i] !== base[i]);
    const blocks = playerPaletteBlocks(base).length; // the 49 room blocks + room copies made for building pickups
    expect(blocks).toBeGreaterThanOrEqual(49);
    // + hardcoded copies (restore, transition, bank 0D, area clear) + dialogue portraits: allies' and Ladd's uniform,
    // Ladd's hair, Joe's own palette group (12 bytes besides its $0F) and its table entry + the ending scenes (7 uniform
    // bytes, the hanging Ladd's hair twice)
    expect(changed).toHaveLength(blocks * 2 + 9 + 3 + 12 + 1 + 9);
    // the ending: hanging Ladd (scenes 1, 2), the rope ($19 / $09: one and two rows darker), the photo ($1A, $1B)
    expect([out[0x076da + 0x15], out[0x076da + 0x16], out[0x076fa + 0x16]]).toEqual([HAIR_COLORS.blond, 0x12, 0x12]);
    expect([out[0x077fa + 5], out[0x077fa + 10], out[0x077fa + 11], out[0x077da + 1], out[0x077da + 10]]).toEqual([
      0x02, 0x02, 0x02, 0x02, 0x02,
    ]);
    for (const b of playerPaletteBlocks(rom)) expect(out[b + 0x16]).toBe(UNIFORM_COLORS.blue);
    expect([out[0x2e6aa], out[0x2e6de], out[0x2e6d2]]).toEqual([0x12, 0x12, HAIR_COLORS.blond]); // (blue's shade: itself)
    expect(out[0x2e726]).toBe(0x60); // Joe's portrait: his own group, hair-independent
    expect(out[0x2e6ff + 3]).toBe(0x06);
  });

  it('black hair is true black in game, blue-black on the portraits (their black background swallowed it)', () => {
    const out = generate(loadRom(), code(3), { cosmetics: { hairColor: 'black' } }).rom;
    for (const b of playerPaletteBlocks(out)) expect(out[b + 0x12]).toBe(0x0f);
    expect(out[0x2e6d2], "Ladd's dialogue portrait").toBe(0x0c);
    expect([out[0x3d928 + 2], out[0x3d928 + 14]], 'area-clear portrait').toEqual([0x0c, 0x0c]);
  });
});
