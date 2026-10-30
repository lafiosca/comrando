import { describe, expect, it } from 'vitest';
import { shuffleBuildings, vanillaBuildings } from '../src/core/buildings.ts';
import { generate } from '../src/core/generate.ts';
import { isCompletable } from '../src/core/logic.ts';
import { BUILDING_ROOMS } from '../src/core/patches/buildingdoors.ts';
import { Rng } from '../src/core/rng.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { readMessage } from '../src/core/text.ts';
import { buildLocations, ITEMS } from '../src/core/world.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

const key = (d: { zone: number; slot: number }) => d.zone * 2 + d.slot;

describe('building shuffle', () => {
  it('is a permutation of the doors with the Destroyer rooms fixed behind NZ18', () => {
    for (let i = 0; i < 50; i++) {
      const east = [
        [17, 18, 19],
        [13, 18, 15],
        [15, 16, 18],
      ][i % 3]; // zone layouts at map numbers 17-19
      const doors = shuffleBuildings(new Rng(`b${i}`), east);
      expect([...doors.keys()].sort()).toEqual(BUILDING_ROOMS);
      expect(new Set([...doors.values()].map(key)).size).toBe(14);
      expect(doors.get(0x41)).toEqual({ zone: 0x11, slot: 0 });
      expect(doors.get(0x42)).toEqual({ zone: 0x11, slot: 1 });
      // balanced: one item room (or the interrogation room) per zone; a real item behind NZ15's barrier; passage east
      for (const zone of [0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x12]) {
        expect([0x38, 0x39, 0x3c, 0x3d, 0x44, 0x3f].filter((b) => doors.get(b)!.zone === zone)).toHaveLength(1);
      }
      expect([0x38, 0x39, 0x3c, 0x3d].some((b) => key(doors.get(b)!) === key({ zone: 0x0e, slot: 1 }))).toBe(true);
      expect(east).toContain(doors.get(0x3f)!.zone + 1);
    }
  });

  it('logic follows the door: whatever is behind NZ14 needs the Permit', () => {
    const doors = vanillaBuildings();
    // swap the γ room (vanilla NZ14 A) with the Flare room (vanilla NZ13 B)
    doors.set(0x39, { zone: 0x0c, slot: 1 });
    doors.set(0x38, { zone: 0x0d, slot: 0 });
    const locs = buildLocations(doors);
    const has = (items: string[]) => ({ has: (i: string) => items.includes(i) }) as never;
    expect(locs.find((l) => l.id === 'room39')!.requires(has([]))).toBe(true);
    expect(locs.find((l) => l.id === 'room38')!.requires(has([]))).toBe(false);
    expect(locs.find((l) => l.id === 'room38')!.requires(has(['permit']))).toBe(true);
    const vanillaPlacement = new Map(locs.map((l) => [l.id, l.vanilla]));
    expect(isCompletable(locs, vanillaPlacement, 'joe')).toBe(true);
  });
});

const code = (n: number, settings = {}) => makeSeedCode({ areas: 'vanilla', ...settings }, BigInt(n)); // map numbers = layouts

describe.skipIf(!HAVE_ROM)('building shuffle in the ROM', () => {
  it("every door leads to the spoiler's building and every exit returns in front of that door (game's own lookup)", () => {
    const { rom, spoiler } = generate(loadRom(), code(4, { buildings: 'shuffled' }));
    const emu = new Emu(rom);
    emu.run(30); // let the game's reset code set up the mapper before calling routines directly
    const seen = new Set<number>();
    for (let zone = 0x0c; zone <= 0x12; zone++) {
      for (const slot of [0, 1]) {
        emu.poke(0x4c, zone);
        emu.poke(0x4be, slot);
        emu.callSub(0x0b, 0xe5b4); // 0F:$E5B4 door lookup: ($4C, $04BE) -> destination room, entry
        const room = emu.peek(0x4c);
        expect(room).toBeGreaterThanOrEqual(0x37);
        expect(room).toBeLessThanOrEqual(0x44);
        seen.add(room);
        emu.poke(0x4be, 0); // leave through the building's door
        emu.callSub(0x0b, 0xe5b4);
        expect([emu.peek(0x4c), emu.peek(0x4be)], `exit of room ${room.toString(16)}`).toEqual([zone, slot + 1]);
      }
    }
    expect(seen.size).toBe(14);
    expect(spoiler.buildings).toHaveLength(14);
  });

  it('inside talkers speak by room, outdoor talkers by zone', () => {
    const emu = new Emu(generate(loadRom(), code(4, { buildings: 'shuffled' })).rom);
    emu.run(30);
    const line = (room: number, node: number) => {
      emu.poke(0x4c, room);
      emu.poke(0x4d, node);
      return emu.callSub(0x0e, 0xbf40).a;
    };
    expect(line(0x40, 13)).toBe(0x32); // room $40's P.O.W. line, whatever zone it now sits in
    expect(line(0x3e, 17)).toBe(0x4c); // room $3E's "DON'T BE HASTY"
    expect(line(0x0d, 14)).toBe(0x76); // outside NZ14: its door-A talker's line (#61)
    expect(line(0x0c, 13)).toBe(0x24); // outside NZ13: #20
  });

  it('door people describe what is behind their door', () => {
    const { rom, spoiler } = generate(loadRom(), code(4, { buildings: 'shuffled' }));
    const text = (n: number) => readMessage(rom, n)!.text.replace(/ +/g, ' ');
    // (each line is the zone's: by layout, wherever it sits)
    const expectMentions = (n: number, layout: number, door: 'A' | 'B') => {
      const t = text(n),
        { item } = spoiler.buildings.find((b) => b.layout === layout && b.door === door)!;
      if (item && ['alpha', 'beta', 'gamma', 'delta', 'flare'].includes(item))
        expect(t, `#${n}`).toContain(
          ITEMS[item].name.toUpperCase().replace('Β', 'β').replace('Γ', 'γ').replace('Δ', 'δ'),
        );
    };
    expectMentions(21, 13, 'B');
    expectMentions(61, 14, 'A');
    expectMentions(39, 16, 'A');
    expectMentions(73, 17, 'A');
  });

  it('vanilla buildings and items leave the door tables and door lines alone', () => {
    const rom = loadRom();
    const out = generate(
      rom,
      code(4, { buildings: 'vanilla', pickups: 'vanilla', hints: 'vanilla', flak: 'open' }),
    ).rom;
    for (let i = 0x2ebb3; i < 0x2ebb3 + 0x45 * 4; i++) expect(out[i]).toBe(rom[i]);
    for (const n of [21, 61, 39, 73]) expect(readMessage(out, n)).toEqual(readMessage(rom, n));
  });
});
