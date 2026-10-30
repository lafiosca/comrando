import { describe, expect, it } from 'vitest';
import { JOE_RESCUES, radioMessages } from '../src/core/bosses.ts';
import { generate } from '../src/core/generate.ts';
import { readMessage } from '../src/core/text.ts';
import { ITEMS } from '../src/core/world.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf, whereIs } from './spoil.ts';

// Area-clear rewards and Super Joe's rescue in the emulator.

describe.skipIf(!HAVE_ROM)('gameplay patches in the emulator: rewards and Joe', () => {
  it("clearing an area grants the seed's shuffled reward", () => {
    const { rom, spoiler } = generate(loadRom(), seedCode(99));
    const area = [2, 3, 5, 9].find((n) => ITEMS[clearOf(spoiler, n)!].inventory > 0)!;
    const item = ITEMS[clearOf(spoiler, area)!];
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    expect(emu.peek(0x4ca + item.inventory)).toBe(0);
    // the game's own clear sequence for that area ($CB=2), then back to the map
    emu.poke(0x4d, area);
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    for (let i = 0; i < 100 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    expect(emu.peek(0x4ea + area)).toBe(1); // area cleared
    expect(emu.peek(0x4ca + item.inventory), `${item.name} from area ${area}`).toBe(1);
  }, 120_000);

  /** Force the game's own clear sequence for `area` ($CB=2) from inside a level and wait until back on the map. */
  function forceClear(emu: Emu, area: number) {
    emu.poke(0x4d, area);
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    return emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1;
  }

  it("Joe's rescue: vanilla is Ladd's line and four of Joe's; a comedic answer (one or two messages) skips his speech to his tip; Nonsense ends after his answer", () => {
    // (a seed whose answer takes one message, and one whose takes two: the seeds depend on the generator version)
    const parts = (hints: string, seed: number) => {
      const g = generate(loadRom(), seedCode(seed, { hints, story: 'comedic' }));
      return radioMessages(JOE_RESCUES.find((l) => radioMessages(l)[0] === readMessage(g.rom, 0xd6 / 2 + 2)!.text)!)
        .length;
    };
    const seedWith = (hints: string, n: number) => {
      for (let seed = 1; seed <= 500; seed++) if (parts(hints, seed) === n) return seed;
      throw new Error(`no ${hints} seed with ${n} rescue parts`);
    };
    for (const [seed, hints, story, shown] of [
      [1, 'nonsense', 'vanilla', 2],
      [1, 'normal', 'vanilla', 5],
      [seedWith('normal', 1), 'normal', 'comedic', 3],
      [seedWith('nonsense', 1), 'nonsense', 'comedic', 2],
      [seedWith('normal', 2), 'normal', 'comedic', 4],
      [seedWith('nonsense', 2), 'nonsense', 'comedic', 3],
    ] as const) {
      const g = generate(loadRom(), seedCode(seed, { hints, story }));
      if (story === 'comedic')
        expect(JOE_RESCUES.map((l) => radioMessages(l)[0])).toContain(readMessage(g.rom, 0xd6 / 2 + 2)!.text);
      const host = whereIs(g.spoiler, 'joe')!.area!;
      const emu = new Emu(g.rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      emu.poke(0x4d, host);
      emu.poke(0xcb, 2);
      emu.poke(0xcc, 0);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0);
      let opens = 0,
        last = -1;
      for (let f = 0; f < 6000 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); f++) {
        if (f % 40 === 0 && emu.peek(0x74)) emu.press('A', 4, 4);
        else emu.run(1);
        if (emu.peek(0x74) && emu.peek(0x82) === 1 && last !== 1) opens++;
        last = emu.peek(0x74) ? emu.peek(0x82) : -1;
      }
      expect(emu.peek(0x4f6), 'Joe rescued').toBe(1);
      expect(opens, `${seed}, ${hints}, ${story}`).toBe(shown);
    }
  }, 300_000);

  it('Joe moved to another area: his area plays the rescue, Area 7 gives a normal item', () => {
    let n = 1,
      rom: Uint8Array | undefined;
    let host = 7,
      area7Item = ITEMS.oneup;
    for (; n < 500; n++) {
      // find a seed with Joe away from Area 7 and an inventory item at Area 7
      const g = generate(loadRom(), seedCode(n));
      host = whereIs(g.spoiler, 'joe')!.area!;
      area7Item = ITEMS[clearOf(g.spoiler, 7)!];
      if (host !== 7 && area7Item.inventory > 0 && area7Item !== ITEMS.flak) {
        rom = g.rom;
        break;
      } // (the Flak Map is a flag, $01D3)
    }
    expect(rom, 'found a suitable seed').toBeDefined();

    const emu = new Emu(rom!);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    const before = emu.ram(0x4ca, 0x21);
    expect(forceClear(emu, host)).toBe(true);
    expect(emu.peek(0x4f6), 'Joe rescued flag').toBe(1);
    expect(emu.peek(0x4ea + host), `area ${host} cleared`).toBe(1);
    expect(emu.peek(0x4f1), 'area 7 not cleared').toBe(0);
    expect(emu.ram(0x4ca, 0x21), 'the rescue grants no item').toEqual(before);

    const emu7 = new Emu(rom!);
    expect(emu7.bootToFirstArea()).toBe(true);
    emu7.run(60);
    expect(forceClear(emu7, 7)).toBe(true);
    expect(emu7.peek(0x4ca + area7Item.inventory), `${area7Item.name} from Area 7`).toBe(1);
    expect(emu7.peek(0x4f6), 'clearing Area 7 does not rescue Joe').toBe(0);
  }, 180_000);
});
