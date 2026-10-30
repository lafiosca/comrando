import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import {
  NONSENSE,
  NONSENSE_BOMBER,
  NONSENSE_BRIEFINGS,
  NONSENSE_QUESTIONS,
  NONSENSE_STATIC,
} from '../src/core/nonsense.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { applyStory } from '../src/core/story.ts';
import { encodeText, messageForY, RADIO_PAGE, readMessage, wrap, writeMessages } from '../src/core/text.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { hintTexts, whereIs } from './spoil.ts';
import type { Item } from '../src/core/world.ts';

describe('text codec', () => {
  it('wraps to 16 columns, honoring forced breaks', () => {
    expect(wrap('THIS IS MA-1.\nINTEL REPORTS THE γ COMMUNICATOR IS READY.')).toBe(
      'THIS IS MA-1.   INTEL REPORTS   THE γ           COMMUNICATOR IS READY.',
    );
  });
  it('rejects characters the font lacks', () => {
    expect(() => encodeText('HELLO:')).toThrow(/no tile/);
    expect(encodeText('ok')).toEqual(encodeText('OK'));
  });
});

const BANK0B = 0x2c010;
const allMessages = (rom: Uint8Array) => Array.from({ length: 128 }, (_, i) => readMessage(rom, i + 2));

describe.skipIf(!HAVE_ROM)('text in the real ROM', () => {
  it('every message re-encodes to its original bytes', () => {
    const rom = loadRom();
    for (let n = 2; n <= 129; n++) {
      const m = readMessage(rom, n);
      if (!m || m.text.includes('{')) continue; // non-text data some pointers lead to
      const p = rom[BANK0B + 4 + 2 * (n - 2)] | (rom[BANK0B + 5 + 2 * (n - 2)] << 8);
      const at = BANK0B + p - 0x8000;
      expect(Array.from(encodeText(m.text)), `message ${n}`).toEqual(
        Array.from(rom.subarray(at + 2, at + 2 + rom[at + 1])),
      );
    }
  });

  it('a repack with no replacements keeps every message and every non-message byte', () => {
    const rom = loadRom(),
      out = loadRom();
    writeMessages(out, new Map());
    expect(allMessages(out)).toEqual(allMessages(rom));
    const outside = [];
    for (let i = 0; i < out.length; i++) {
      const cpu = 0x8000 + i - BANK0B;
      const inText =
        i >= BANK0B &&
        ((cpu >= 0x8004 && cpu < 0xa68f) || (cpu >= 0xa780 && cpu < 0xa800) || (cpu >= 0xb700 && cpu < 0xb800));
      if (!inText && out[i] !== rom[i]) outside.push(i);
    }
    expect(outside).toEqual([]);
  });

  it('replacing messages changes exactly those, even when they grow', () => {
    const out = loadRom();
    const long = wrap(
      'THIS MESSAGE IS QUITE A BIT LONGER THAN THE ORIGINAL ONE WAS, TO PROVE THAT REPACKING MOVES IT SOMEWHERE WITH ENOUGH ROOM.',
    );
    writeMessages(
      out,
      new Map([
        [messageForY(0x64), long],
        [27, 'SHORT.'],
      ]),
    );
    const before = allMessages(loadRom()),
      after = allMessages(out);
    const changed = after.flatMap((m, i) => (JSON.stringify(m) === JSON.stringify(before[i]) ? [] : [i + 2]));
    expect(changed).toEqual([27, 52]);
    expect(readMessage(out, 52)!.text).toBe(long);
    expect(readMessage(out, 52)!.header).toBe(readMessage(loadRom(), 52)!.header); // speaker kept
  });

  it("seed story text names Joe's real area and the Area 12 condition", () => {
    for (const area12 of ['joe', 'joe+10+11', 'vanilla']) {
      const { rom, spoiler } = generate(
        loadRom(),
        makeSeedCode({ area12, areas: 'vanilla', hints: 'vanilla', story: 'vanilla' }, 2n),
      );
      const host = whereIs(spoiler, 'joe')!.area!;
      const text = (n: number) => readMessage(rom, n)!.text.replace(/ +/g, ' ');
      expect(text(115).includes('SUPER JOE')).toBe(area12 !== 'vanilla'); // Area 12's own refusal
      expect(text(69)).toBe("IT'S TOO EARLY TO FEEL SAFE. I'LL KILL YOU HERE."); // the escape cyborg keeps his line
      expect(text(107)).toContain('WILL EXPLODE IN 60');
      expect(text(115).includes('AREAS 10 AND 11')).toBe(area12 !== 'joe');
      // map refusals (Area 12 #115, road gate #52) must fit the map's 4-line text box: it doesn't page
      for (const gate of ['iff', 'vanilla']) {
        const r = generate(loadRom(), makeSeedCode({ area12, gate, areas: 'vanilla' }, 2n)).rom;
        for (const n of [52, 115])
          expect(readMessage(r, n)!.text.length, `message ${n} (${area12}, ${gate})`).toBeLessThanOrEqual(64);
      }
      expect(text(93).includes('UNTIL SUPER JOE IS RESCUED')).toBe(area12 !== 'vanilla'); // Hal (vanilla: his vanilla line)
      for (const n of [27, 33, 44, 65]) expect(text(n), `message ${n}`).toContain(`AREA ${host}`);
      // Joe's captor says "JOE IS HERE" in its own portrait; Area 7's boss (unless Joe is there) takes Area 6's line
      const BOSS = {
        1: 0x16,
        2: 0x17,
        3: 0x1f,
        4: 0x18,
        5: 0x19,
        6: 0x1a,
        7: 0x1b,
        8: 0x20,
        9: 0x1c,
        10: 0x1d,
        11: 0x1e,
      } as Record<number, number>;
      const line = (area: number, r = rom) => readMessage(r, messageForY(r[0x3e6fd + BOSS[area] - 0x16]))!;
      expect(line(host).text.replace(/ +/g, ' ')).toContain('JOE IS HERE');
      expect(line(host).header).toBe(line(host, loadRom()).header);
      if (host !== 7) expect(line(7)).toEqual(line(6, loadRom()));
    }
  });

  it("hints Vanilla: #23 and #63 name their communicator's real areas, #70 the interrogation room's zone with Fix Typos", () => {
    const say = (o: Partial<Parameters<typeof applyStory>[1]>) => {
      const rom = loadRom();
      writeMessages(rom, applyStory(rom, { joeArea: 9, area12: 'joe', spot: (id) => id, ...o }));
      return (n: number) => readMessage(rom, n)!.text.replace(/ +/g, ' ');
    };
    const vanilla = say({});
    expect(vanilla(23)).toMatch(/IN AREAS 1,4 AND 5\./);
    expect(vanilla(63)).toMatch(/IN AREAS 7 AND 9\./);
    expect(vanilla(70)).toMatch(/COME TO AREA 7\?/);
    // O4 takes β (also 2 and 9), γ is O8's, O6's and O12's, the interrogation room is in NZ15; the map swaps layouts 2 and 3
    const comm: Record<number, Item> = {
      1: 'alpha',
      2: 'beta',
      3: 'delta',
      4: 'beta',
      5: 'alpha',
      6: 'gamma',
      7: 'delta',
      8: 'gamma',
      9: 'beta',
      10: 'delta',
      11: 'alpha',
      12: 'gamma',
    };
    const spot = (id: number) => (id === 2 ? 3 : id === 3 ? 2 : id);
    const seed = say({ commOf: (id) => comm[id], spot, interrogation: 15 });
    expect(seed(23)).toMatch(/IN AREAS 3,4 AND 9\./);
    expect(seed(63)).toMatch(/IN AREA 12\./);
    expect(seed(70)).toMatch(/COME TO AREA 7\?/);
    expect(say({ typos: true, interrogation: 15 })(70)).toMatch(/COME TO AREA 15\?/);
    expect(say({ typos: true })(70)).toMatch(/COME TO AREA 17\?/);
  });

  it("every possible captor says the Joe line with its own portrait; Area 7's boss keeps its portrait", () => {
    const BOSS = [0, 0x16, 0x17, 0x1f, 0x18, 0x19, 0x1a, 0x1b, 0x20, 0x1c, 0x1d, 0x1e];
    const line = (r: Uint8Array, area: number) => readMessage(r, messageForY(r[0x3e6fd + BOSS[area] - 0x16]))!;
    const vanilla = loadRom();
    for (let host = 1; host <= 11; host++) {
      const rom = loadRom();
      writeMessages(rom, applyStory(rom, { joeArea: host, area12: 'joe', spot: (id) => id }));
      for (let a = 1; a <= 11; a++) {
        expect(line(rom, a).header, `area ${a} portrait (Joe in ${host})`).toBe(line(vanilla, a).header);
        expect(line(rom, a).text.includes('JOE IS HERE'), `area ${a} (Joe in ${host})`).toBe(a === host);
      }
      if (host === 5) expect(line(rom, 5).text.replace(/ +/g, ' ')).toMatch(/^PI PI PI/);
    }
  });

  it('any boss can say Joe was transferred, in its own portrait; generated seeds put that boss past the first region', () => {
    const BOSS = [0, 0x16, 0x17, 0x1f, 0x18, 0x19, 0x1a, 0x1b, 0x20, 0x1c, 0x1d, 0x1e];
    const line = (r: Uint8Array, area: number) => readMessage(r, messageForY(r[0x3e6fd + BOSS[area] - 0x16]))!;
    const vanilla = loadRom();
    for (let host = 1; host <= 11; host++) {
      for (let moved = 1; moved <= 11; moved++) {
        if (moved === host) continue;
        const rom = loadRom();
        writeMessages(rom, applyStory(rom, { joeArea: host, transferArea: moved, area12: 'joe', spot: (id) => id }));
        for (let a = 1; a <= 11; a++) {
          const t = line(rom, a).text.replace(/ +/g, ' ');
          expect(line(rom, a).header, `area ${a} portrait (Joe ${host}, moved ${moved})`).toBe(line(vanilla, a).header);
          expect(/TRANSFERR?ED/.test(t), `area ${a} (Joe ${host}, moved ${moved})`).toBe(a === moved);
          expect(t.includes('JOE IS HERE'), `area ${a} (Joe ${host}, moved ${moved})`).toBe(a === host);
        }
      }
    }
    for (let n = 1n; n <= 40n; n++) {
      const { spoiler } = generate(loadRom(), makeSeedCode({}, n));
      const joe = String(whereIs(spoiler, 'joe')!.area);
      if (!spoiler.joeTransferBoss) continue; // no clue on Joe's trail
      const moved = spoiler.joeTransferBoss.area;
      expect(
        hintTexts(spoiler).some((h) => /JOE/.test(h) && new RegExp(`AREA ${moved}\\b`).test(h)),
        'a line names the decoy',
      ).toBe(true);
      // only O9, the game's disposal area, is called that
      for (const h of hintTexts(spoiler)) if (/DISPOSAL/.test(h)) expect(spoiler.joeTransferBoss.layout).toBe(9);
      expect(Number(moved)).toBeGreaterThanOrEqual(7);
      expect(Number(moved)).toBeLessThanOrEqual(11);
      expect(moved).not.toBe(joe);
    }
  }, 60_000);

  it('one repack per ROM; generated seeds (building chaos included) have no overlapping messages (identical ones may share a copy)', () => {
    const once = loadRom();
    writeMessages(
      once,
      new Map([[messageForY(0x64), wrap('A LONGER LINE THAN BEFORE, SO THE GAP GETS USED FOR IT.')]]),
    );
    expect(() => writeMessages(once, new Map())).toThrow(/already repacked/);
    for (let n = 1n; n <= 4n; n++) {
      const { rom } = generate(loadRom(), makeSeedCode({ buildings: 'shuffled' }, n));
      const ext: [number, number][] = [];
      for (let m = 2; m <= 129; m++) {
        const p = rom[0x2c014 + 2 * (m - 2)] | (rom[0x2c015 + 2 * (m - 2)] << 8);
        if (p >= 0x8000 && p < 0xb800) ext.push([p, p + 2 + rom[0x2c010 + p - 0x8000 + 1]]);
      }
      ext.sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < ext.length; k++)
        if (ext[k].join() !== ext[k - 1].join()) expect(ext[k][0], `seed ${n}`).toBeGreaterThanOrEqual(ext[k - 1][1]);
    }
  });
});

describe.skipIf(!HAVE_ROM)('the Nonsense pool', () => {
  it('the Destroyers each ask a different question of their pool, no name; the route names the real one by where he stands', () => {
    const { rom, spoiler } = generate(loadRom(), makeSeedCode({ hints: 'nonsense' }, 5n), { cosmeticSeed: 'x' }); // (a route through the Destroyer)
    const asked = [0x9c, 0xa0, 0xa2].map((y) => readMessage(rom, messageForY(y))!.text);
    expect(new Set(asked).size).toBe(3);
    for (const t of asked) expect(NONSENSE_QUESTIONS.map((q) => wrap(q))).toContain(t);
    // (no names: the real one by where he stands)
    const yes = spoiler.route.flatMap((r) => r.steps).find((s) => s.act === 'destroyer');
    expect(yes).toMatchObject({
      act: 'destroyer',
      position: expect.stringMatching(/^(right of door B|by door A|left of door B)$/),
    });
    expect(yes).not.toHaveProperty('name');
  });

  const key = (l: string) => l.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  it('has tiles for every line, each fits its message (radio pages are 6 rows), and no line twice, in any pool (ignoring spacing and punctuation)', () => {
    const radio = [...NONSENSE.radio, ...NONSENSE_BRIEFINGS.flat().map(([, l]) => l), NONSENSE_STATIC],
      all = [...NONSENSE.talker, ...NONSENSE_BOMBER, ...NONSENSE_QUESTIONS, ...radio];
    for (const l of NONSENSE_QUESTIONS)
      expect(wrap(l).length, `${l}: one page, before the YES/NO`).toBeLessThanOrEqual(64);
    for (const l of all) encodeText(l.replace(/[\n\f]/g, ''));
    for (const l of NONSENSE.talker) expect(wrap(l).length, l).toBeLessThanOrEqual(255);
    for (const l of radio) expect(wrap(l, undefined, RADIO_PAGE).length, l).toBeLessThanOrEqual(255);
    const seen = new Map<string, string>();
    for (const l of all) {
      expect(seen.get(key(l)), l).toBeUndefined();
      seen.set(key(l), l);
    }
  });
});
