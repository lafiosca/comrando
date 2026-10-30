import { describe, expect, it } from 'vitest';
import { JOE_RESCUES, radioMessages } from '../src/core/bosses.ts';
import { assignComms } from '../src/core/comms.ts';
import { generate } from '../src/core/generate.ts';
import { Rng } from '../src/core/rng.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { readMessage } from '../src/core/text.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { dialogueTexts, whereIs } from './spoil.ts';

describe('communicator assignment', () => {
  it('3 layouts per comm, O1 keeps α, O6/O7 split, α partners have rooms and one is near the start', () => {
    for (let i = 0; i < 500; i++) {
      const near = new Rng(`near${i}`).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).slice(0, 6);
      const c = assignComms(new Rng(`comms${i}`), near);
      expect(c[1]).toBe('alpha');
      for (const comm of ['alpha', 'beta', 'gamma', 'delta'])
        expect(c.slice(1).filter((x) => x === comm)).toHaveLength(3);
      expect(c[6]).not.toBe(c[7]);
      const partners = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((n) => c[n] === 'alpha');
      expect(partners.some((n) => [6, 7, 12].includes(n))).toBe(false);
      expect(partners.some((n) => near.includes(n))).toBe(true);
    }
  });
});

describe.skipIf(!HAVE_ROM)('hints in the real ROM', () => {
  // generate() checks every hint against the placement and that the guided player can follow them to the end
  it('every seed gets a followable chain of true hints, across settings', () => {
    const variants: Record<string, string>[] = [
      {},
      { area12: 'joe+10+11' },
      { gate: 'vanilla' },
      { buildings: 'vanilla', area12: 'joe+10+11', gate: 'vanilla' },
      { comms: 'vanilla' },
      { areas: 'vanilla', zones: 'vanilla' },
      { hints: 'terse' },
      { barrier: 'fixed' },
      { area12: 'vanilla' },
      { area12: 'vanilla', rewards: 'vanilla', gate: 'vanilla', flak: 'vanilla' },
      { hints: 'verbose', area12: 'joe+10+11' },
      { flak: 'vanilla' },
      { area12Comm: 'comms' },
      { area12Comm: 'both', area12: 'joe+10+11' },
      { darkAreas: 'more' },
      { darkAreas: 'more', dark: 'true', areas: 'vanilla' },
      { commLocks: 'more' },
      { commLocks: 'all', comms: 'vanilla' },
    ];
    for (const v of variants) {
      for (let n = 1n; n <= 25n; n++) {
        const { rom, spoiler, circularHints } = generate(loadRom(), makeSeedCode(v, n), { cosmeticSeed: 'x' });
        expect(circularHints, 'no line only helps get what its own room needs to be read').toEqual([]);
        // room $3E's man (#40, "DON'T BE HASTY…") always gives a clue in his voice
        const hasty = spoiler.hints.find((h) => h.kind === 'talker' && h.inside)!.lines[0].text;
        expect(hasty).toMatch(/^DON'T BE HASTY\.\n./);
        expect(readMessage(rom, 0x4c / 2 + 2)!.text.replace(/\s+/g, '')).toBe(hasty.replace(/\s+/g, '')); // (rows of 16, no gaps)
        expect(spoiler.hints.find((h) => h.kind === 'comm' && h.layout === 1 && h.room === 'B')!.lines[0].text).toMatch(
          /^YOUR α COMMUNICATOR/,
        );
        // the oracle route: a short way through knowing every placement, ending in Area 12, never longer than the full route
        expect(spoiler.oracle.at(-1)!.place).toEqual({ kind: 'area', area: 12, layout: 12 });
        expect(spoiler.oracle.length).toBeLessThanOrEqual(spoiler.route.length);
        // ...a comm-locked area's door opened by COMMUNICATE before its clear
        const lockedLayouts = spoiler.locked.map((p) => p.layout);
        for (const e of spoiler.oracle) {
          const k = e.steps.findIndex((x) => x.act === 'clear');
          if (k >= 0 && 'layout' in e.place && lockedLayouts.includes(e.place.layout))
            expect(e.steps[k - 1], JSON.stringify(e.place)).toMatchObject({
              act: 'comm',
              opens: expect.stringMatching(/^(door|bossDoor)$/),
            });
        }
        const end = spoiler.route.at(-1)!;
        expect(end.place, 'the intended route ends in Area 12').toEqual({ kind: 'area', area: 12, layout: 12 });
        expect(end.steps.at(-1)!.act).toBe('escape');
        expect(end.needs.map((q) => q.need)).toEqual(
          expect.arrayContaining(v.area12 === 'vanilla' ? [{ cleared: 10 }, { cleared: 11 }] : [{ item: 'joe' }]),
        );
        expect(spoiler.route[0].place, 'step 0').toEqual({ kind: 'briefing' });
        expect(spoiler.route[1].why[0]).toMatchObject(
          spoiler.route[1].why[0].kind === 'suggested'
            ? { clues: [{ by: [{ kind: 'step', entry: 0, step: 1 }] }] }
            : { kind: 'onTheWay' },
        );
        // every source is a route step ("per 1c", "suggested by 2a") or a named one; no step label past the route
        const sources = (x: unknown): { kind: string; entry?: number; step?: number }[] =>
          Array.isArray(x)
            ? x.flatMap(sources)
            : x && typeof x === 'object'
              ? (x as { kind?: string }).kind === 'step' && 'entry' in x
                ? [x as unknown as { kind: string }]
                : Object.values(x).flatMap(sources)
              : [];
        for (const src of sources(spoiler.route))
          expect(spoiler.route[src.entry!]?.steps[src.step!], JSON.stringify(src)).toBeDefined();
        // (Area 12's door locks: the route gets its comm)
        if (v.area12Comm === 'comms' || v.area12Comm === 'both')
          expect(end.steps[0]).toEqual({ act: 'comm', room: 'A', opens: 'powerA' });
        if (v.area12Comm === 'both')
          expect(end.steps).toContainEqual({ act: 'defeat', target: 'miniboss', opens: 'powerB' });
        // an enemy area's requirements start with its communicator, or that it needs none (or, a trial that failed, it's unknown)
        for (const r of spoiler.route) {
          const first = r.needs[0]?.need;
          if (r.place.kind === 'area')
            expect(
              first &&
                ('item' in first
                  ? ['alpha', 'beta', 'gamma', 'delta'].includes(first.item)
                  : 'special' in first && ['noComm', 'commUnknown'].includes(first.special)),
              JSON.stringify(r.place),
            ).toBe(true);
        }
        // every dark area is named by the Flare's lines, and the route lights its comm rooms
        if (v.darkAreas === 'more') {
          const dark = spoiler.dark.map((p) => p.area);
          expect(dark.length).toBeGreaterThanOrEqual(2);
          for (const y of [0x20, 0x26]) {
            // (unless a hint took the line)
            const line = readMessage(rom, y / 2 + 2)!.text.replace(/\s+/g, ''); // (rows of 16, no gaps)
            const sorted = [...dark].sort((a, b) => a - b);
            if (/FLARE(GUN|BOMBS)/.test(line))
              expect(line).toContain(
                `AREAS${sorted.slice(0, -1).join(',')}${sorted.length > 2 ? ',' : ''}AND${sorted.at(-1)}`,
              ); // (Oxford comma)
          }
        }
        // Comm Locks: All locks every layout with a comm room (12 aside); More, 2 or 3 more than O1, O4, O8
        if (v.commLocks === 'all') expect(spoiler.locked).toHaveLength(8); // (O1, O4, O8 and five: not O11)
        if (v.commLocks === 'more') expect([5, 6]).toContain(spoiler.locked.length);
        // the route only goes into an area with a comm room holding its communicator
        spoiler.route.forEach((r, i) => {
          const first = r.needs[0]?.need,
            c =
              r.place.kind === 'area' && first && 'item' in first && ['beta', 'gamma', 'delta'].includes(first.item)
                ? first.item
                : undefined;
          if (c)
            expect(
              spoiler.route.slice(0, i).some((x) => x.steps.some((t) => 'item' in t && t.item === c)),
              JSON.stringify(r.place),
            ).toBe(true);
        });
        // Joe's area never comes straight from a neutral zone (a talker may pass on his trail's rumor); the informer
        // line points at the hint that has it
        const joeArea = whereIs(spoiler, 'joe')!.area!;
        for (const h of spoiler.hints)
          if (h.kind === 'talker')
            for (const { text } of h.lines)
              if (/JOE/.test(text)) expect(text.replace(/\n/g, ' ')).not.toContain(`AREA ${joeArea}.`);
        expect(spoiler.hints.find((h) => h.kind === 'joePointer')?.lines[0].text.replace(/\n/g, ' ') ?? '').not.toMatch(
          /P\.O\.W\. CAMP IN AREA/,
        );
        // the Flak Map waits beyond the 6<->8 crossing (an area or zone at map numbers 7-9 or 17-19)
        const flak = whereIs(spoiler, 'flak');
        if (flak) expect([7, 8, 9, 17, 18, 19]).toContain(flak.area);
        // so does Joe (vanilla rewards: wherever the Area 7 layout went)
        if (v.rewards !== 'vanilla') expect([7, 8, 9, 10, 11]).toContain(joeArea);
      }
    }
  }, 120_000);

  it('hints off with vanilla comms leaves the comm rooms alone', () => {
    const rom = loadRom();
    const { rom: out, spoiler } = generate(
      rom,
      makeSeedCode({ hints: 'vanilla', comms: 'vanilla', areas: 'vanilla' }, 5n),
    );
    expect(spoiler.hints).toEqual([]);
    for (const y of [0x50, 0x68, 0x3a, 0x7a, 0xb0])
      expect(readMessage(out, y / 2 + 2)).toEqual(readMessage(rom, y / 2 + 2));
  });

  it("hints Vanilla: the route quotes the ROM's lines and follows the communicator areas they name", () => {
    let followed = 0;
    for (let n = 1n; n <= 12n; n++) {
      const { rom, spoiler } = generate(loadRom(), makeSeedCode({ hints: 'vanilla', typos: 'fixed' }, n), {
        cosmeticSeed: 'x',
      });
      const route = JSON.stringify(spoiler.route);
      expect(route, `seed ${n}`).not.toMatch(/⟪/);
      expect(spoiler.route.length, `seed ${n}`).toBeGreaterThan(2);
      // (a step quoting O4A's line says it as the ROM does)
      const o4a = spoiler.route
        .flatMap((r) => r.steps)
        .find((s) => 'quote' in s && s.quote?.includes('THIS IS M-8. USE THIS COMMUNICATOR'));
      if (o4a && 'quote' in o4a)
        expect(o4a.quote).toContain(
          readMessage(rom, 23)!
            .text.match(/.{1,16}/g)!
            .map((r) => r.trim())
            .filter(Boolean)
            .join(' '),
        );
      // (an area whose comm a comm room's line told: "γ Communicator (per 17a)")
      if (
        spoiler.route.some((r) =>
          r.needs.some(
            (q) =>
              'item' in q.need &&
              ['beta', 'gamma', 'delta'].includes(q.need.item) &&
              q.basis.kind === 'per' &&
              q.basis.by.length === 1 &&
              q.basis.by[0].kind === 'step' &&
              q.basis.by[0].entry > 0,
          ),
        )
      )
        followed++;
    }
    expect(followed).toBeGreaterThan(0);
  });

  it('a comm room answers its assigned communicator and gives static to the vanilla one', () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({}, n), { cosmeticSeed: 'x' });
      if (!gen.spoiler.comms.gamma!.some((p) => p.layout === 9)) break; // O9 (vanilla γ) moved off γ
    }
    const comm = (['alpha', 'beta', 'gamma', 'delta'] as const).findIndex((c) =>
      gen.spoiler.comms[c]!.some((p) => p.layout === 9),
    );
    expect(comm).toBeGreaterThan(-1);
    const shown = (index: number) => {
      const emu = new Emu(gen.rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      const cpu = (emu.nes as unknown as { cpu: { REG_PC: number; REG_Y: number; emulate(): number } }).cpu;
      const step = cpu.emulate.bind(cpu),
        ys: number[] = [];
      cpu.emulate = () => {
        if (((cpu.REG_PC + 1) & 0xffff) === 0xe09f) ys.push(cpu.REG_Y);
        return step();
      };
      emu.enterRoom(0x2f, 9); // O9's comm room
      emu.poke(0x4df, index);
      emu.poke(0xcc, 5);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0); // COMMUNICATE with this comm
      for (let f = 0; f < 400; f++) {
        emu.run(1);
        if (f === 100 || f === 160) emu.press('A', 4, 4);
      }
      return ys;
    };
    expect(shown(comm)).toContain(0x88); // O9's message
    expect(shown(2)).toContain(0x62); // GA*GA*GA
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('hint mode Nonsense', () => {
  it("every hint slot, the briefings and Area 12's comm rooms say pool lines; with vanilla boss dialogue the bosses too", async () => {
    const { NONSENSE, NONSENSE_BOMBER, NONSENSE_BRIEFINGS } = await import('../src/core/nonsense.ts');
    const { wrap, RADIO_PAGE } = await import('../src/core/text.ts');
    const radio = new Set(NONSENSE.radio.map((l) => wrap(l, undefined, RADIO_PAGE)));
    const briefing = new Set(NONSENSE_BRIEFINGS.flat().map(([, l]) => wrap(l, undefined, RADIO_PAGE)));
    const talker = new Set(NONSENSE.talker.map((l) => wrap(l)));
    const vanilla = loadRom();
    for (let i = 0; i < 12; i++) {
      for (const bosses of ['vanilla', 'comedic']) {
        const settings = {
          hints: 'nonsense',
          story: bosses,
          buildings: i % 2 ? 'shuffled' : 'vanilla',
          zones: i % 3 ? 'shuffled' : 'vanilla',
        };
        const { rom, spoiler } = generate(vanilla, makeSeedCode(settings, BigInt(i + 1)), { cosmeticSeed: 'x' });
        // comm rooms (COMMUNICATE, wiretaps): O1-O5, O8-O11, O12; Joe's rescue
        // (one message each: the wiretaps' replies and O1A's second message are no longer shown)
        const table = 0x2f004;
        for (let r = 0; r < 15; r++) expect(rom[table + 3 * r + 2], 'no wiretap replies').toBe(0);
        for (const y of [
          0x14, 0x1c, 0x18, 0x1e, 0x50, 0x52, 0x68, 0x6a, 0x2a, 0x2c, 0x3a, 0x3e, 0x40, 0x7a, 0x7e, 0x80, 0x88, 0xb0,
          0xb2, 0xb6, 0xb8, 0xbc, 0xbe, 0xc2, 0xc4, 0xd6, 0x3c, 0x7c, 0x8a,
        ]) {
          // (Joe's answer, $D6: Story Dialogue Comedic's wins)
          const pool =
            y === 0xd6 && bosses === 'comedic' ? new Set(JOE_RESCUES.map((l) => radioMessages(l)[0])) : radio;
          expect(pool.has(readMessage(rom, y / 2 + 2)!.text), `$${y.toString(16)}`).toBe(true);
        }
        // the NZ talkers (NZ13, 14, 16, 17 door talkers, NZ15 B / the informer, room $3E's man), the NZ guards
        for (const y of [0x26, 0x76, 0x4a, 0x8e, 0x32, 0x4c, 0x5e, 0x60, 0x24, 0x38, 0x28, 0x4e, 0xa8, 0x90, 0x94])
          expect(talker.has(readMessage(rom, y / 2 + 2)!.text), `$${y.toString(16)}`).toBe(true);
        expect(
          NONSENSE_BOMBER.map((l) => wrap(l)),
          'the NZ19 bombardier',
        ).toContain(readMessage(rom, 0x78 / 2 + 2)!.text);
        for (const y of [0xf6, 0xf8])
          expect(briefing.has(readMessage(rom, y / 2 + 2)!.text), `briefing $${y.toString(16)}`).toBe(true);
        // (a route with no leads: the briefing names no area, so nothing is "suggested by" it)
        expect(spoiler.route.length, 'a route').toBeGreaterThan(1);
        expect(spoiler.route[0].steps, 'no briefing line').toEqual([{ act: 'start', item: 'alpha' }]);
        expect(JSON.stringify(spoiler.route), 'nothing cites it').not.toContain('{"kind":"step","entry":0,"step":1}');
        const said = dialogueTexts(spoiler);
        if (bosses === 'vanilla') {
          expect(said.length, 'every boss and the escape cyborg').toBe(13);
          for (const l of said)
            expect(
              NONSENSE.talker.map((t) => t.replaceAll('\f', '\n')),
              l,
            ).toContain(l);
          expect(spoiler.dialogue!.scenes.ending, 'the vanilla ending').toBeUndefined();
        } else
          expect(
            said.some((l) => NONSENSE.talker.includes(l)),
            'comedic boss lines',
          ).toBe(false);
      }
    }
  }, 120_000);
});
