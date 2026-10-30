import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { fill } from '../src/core/logic.ts';
import { clearName, passageTileSources, pickupLine, placeBuildingItems, PICKUP_ROOMS } from '../src/core/pickups.ts';
import { Rng } from '../src/core/rng.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { decodeText, encodeText } from '../src/core/text.ts';
import { buildLocations, ITEMS, PICKUP_ITEMS, type Item } from '../src/core/world.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf, rewardOf } from './spoil.ts';

/** The reward of map number n's area clear (spoiler keys name the layout too: "Area 3 clear (O10)"). */

const NODE: Record<number, number> = { 0x38: 13, 0x39: 14, 0x3c: 15, 0x3d: 16, 0x44: 19 };

describe('building item fill', () => {
  it('Joe only at area clears; buildings only get items with a pickup icon (1UP only where it was one)', () => {
    const locations = buildLocations(undefined, undefined, 'iff', true);
    for (let i = 0; i < 200; i++) {
      const p = fill(locations, 'joe', new Rng(`b${i}`));
      for (const l of locations.filter((x) => x.id.startsWith('room'))) {
        const item = p.get(l.id)!;
        expect(item === 'oneup' ? l.id === 'room44' : PICKUP_ITEMS.has(item), `${l.id}: ${item}`).toBe(true);
      }
      for (const l of locations.filter((x) => x.areaClear))
        expect(ITEMS[p.get(l.id)!].clearText !== undefined || p.get(l.id) === 'joe').toBe(true);
    }
  });
});

describe.skipIf(!HAVE_ROM)('building pickups in the emulator', () => {
  it('every pickup item spawns in every item room and touching it gives that item', () => {
    const items = [...PICKUP_ITEMS];
    // each round fills all five rooms; rotate so every item visits several rooms
    for (let round = 0; round < items.length; round += PICKUP_ROOMS.length) {
      const map = new Map<number, Item>(PICKUP_ROOMS.map((room, k) => [room, items[(round + k) % items.length]]));
      const rom = loadRom();
      placeBuildingItems(rom, map);
      for (const [room, item] of map) {
        const emu = new Emu(rom);
        expect(emu.bootToFirstArea()).toBe(true);
        const flag = 0x4ca + ITEMS[item].inventory;
        emu.poke(flag, 0);
        const slot = emu.enterRoom(room, NODE[room]);
        expect(slot, `${item} in room ${room.toString(16)}`).toBeGreaterThanOrEqual(0);
        expect(emu.peek(0x536 + slot), `${item} spawned in room ${room.toString(16)}`).not.toBe(0);
        emu.touch(slot);
        expect(emu.peek(flag), `${item} given in room ${room.toString(16)}`).toBe(1);
      }
    }
  }, 600_000);

  it('in NZ19 B (red palette 3) δ is drawn orange via palette 2, not red', () => {
    const rom = loadRom();
    placeBuildingItems(rom, new Map([[0x44, 'delta']]));
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0x4e3, 0);
    expect(emu.enterRoom(0x44, 19)).toBeGreaterThanOrEqual(0);
    const nes = emu.nes as unknown as { ppu: { spriteMem: number[]; vramMem: number[] } };
    const oam = nes.ppu.spriteMem,
      pals = new Set<number>();
    for (let i = 0; i < 64; i++)
      if ([0xc5, 0xc6, 0xc7, 0xc8].includes(oam[i * 4 + 1]) && oam[i * 4] < 0xef) pals.add(oam[i * 4 + 2] & 3);
    expect([...pals]).toEqual([2]);
    expect(nes.ppu.vramMem[0x3f1a]).toBe(0x27);
  }, 60_000);

  it('a communicator won at an area clear is named on the clear screen', () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla' }, n));
      if (clearOf(gen.spoiler, 1) === 'beta') break;
    }
    const emu = new Emu(gen.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0x4e1, 0);
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0); // the game's clear sequence
    let named = false;
    const want = [...encodeText('β COMMUNICATOR')].join(',');
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      if (emu.ram(0x132, 14).join(',') === want) named = true;
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    expect(named).toBe(true);
    expect(emu.peek(0x4e1)).toBe(1);
  }, 120_000);

  it("a generated seed's NZ19 B item spawns and is given", () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla', zones: 'vanilla', buildings: 'vanilla' }, n));
      if (rewardOf(gen.spoiler, 'room44') !== 'oneup') break;
    }
    const item = rewardOf(gen.spoiler, 'room44')!;
    const emu = new Emu(gen.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    const flag = item === 'flak' ? 0x1d3 : 0x4ca + ITEMS[item].inventory; // (the Flak Map is a flag)
    emu.poke(flag, 0);
    const slot = emu.enterRoom(0x44, 19);
    expect(slot).toBeGreaterThanOrEqual(0);
    emu.touch(slot);
    expect(emu.peek(flag), item).toBe(1);
  }, 120_000);

  it("the underground-passage stage spawns the seed's item and touching it gives that item", () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla' }, n));
      if (!['helmet', 'flak'].includes(rewardOf(gen.spoiler, 'passage')!)) break;
    }
    const item = rewardOf(gen.spoiler, 'passage')!;
    const flag = 0x4ca + ITEMS[item].inventory;
    const emu = new Emu(gen.rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    // take off and pick the stage as the next room (as the encounter would), then play it: hold UP and fire, full HP,
    // sidestep when the scroll stalls
    for (let i = 0; i < 80 && !(emu.peek(0xcc) === 3 && emu.peek(0xcd) >= 2); i++) {
      if (emu.peek(0xcc) === 2) {
        emu.poke(0x4d, 1);
        emu.poke(0x4c, 0x15);
      }
      emu.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
    }
    expect(emu.peek(0x4c)).toBe(0x15);
    const scroll = () => (emu.peek(0xb9) << 8) | emu.peek(0xba);
    let last = scroll(),
      stall = 0,
      side = 0,
      dir: 'LEFT' | 'RIGHT' = 'LEFT',
      slot = -1;
    for (let f = 0; f < 3000 && slot < 0; f++) {
      emu.poke(0x779, 8);
      if (side > 0) {
        emu.nes.buttonUp(1, 4);
        emu.nes.buttonDown(1, dir === 'LEFT' ? 6 : 7);
        if (!--side) emu.nes.buttonUp(1, dir === 'LEFT' ? 6 : 7);
      } else emu.nes.buttonDown(1, 4);
      if (f % 8 === 0) emu.nes.buttonDown(1, 1);
      else if (f % 8 === 4) emu.nes.buttonUp(1, 1);
      emu.run(1);
      const s = scroll();
      if (s === last) stall++;
      else {
        stall = 0;
        last = s;
      }
      if (stall > 90 && !side) {
        dir = dir === 'LEFT' ? 'RIGHT' : 'LEFT';
        side = 30 + (f % 50);
        stall = 0;
      }
      slot = emu.ram(0x549, 19).findIndex((t, i) => t === 0x0e && emu.peek(0x536 + i));
    }
    expect(slot, 'the pickup spawned').toBeGreaterThan(0);
    for (const b of [1, 4, 6, 7]) emu.nes.buttonUp(1, b as never);
    emu.run(2);
    // drawn from the icon tiles ($F2-$F5, loaded non-blank), not the helmet's $B8
    expect(emu.ram(0x200, 256).filter((_, i) => i % 4 === 1)).toContain(0xf2);
    // the icon's tiles in column order for the stage's 8x16 sprites (icons are stored row by row)
    const rom = gen.rom;
    passageTileSources(item).forEach((src, i) =>
      expect(
        Array.from({ length: 16 }, (_, b) => emu.vram(0x0f20 + 16 * i + b)),
        `tile $F${2 + i}`,
      ).toEqual([...rom.slice(src, src + 16)]),
    );
    // drawn the right way round: the stage mirrors this object, so the left column (TL/BL, $F2) ends up on the left
    const oam = Array.from({ length: 64 }, (_, i) => emu.ram(0x200 + 4 * i, 4)).filter(
      ([y, t]) => y < 0xef && (t === 0xf2 || t === 0xf4),
    );
    const [left, right] = [oam.find(([, t]) => t === 0xf2)!, oam.find(([, t]) => t === 0xf4)!];
    expect(left[3] < right[3] && !(left[2] & 0x40) && !(right[2] & 0x40), JSON.stringify(oam)).toBe(true);
    expect(emu.peek(flag)).toBe(0);
    emu.touch(slot);
    expect(emu.peek(flag), item).toBe(1);
    expect(emu.peek(0x4d3), 'no Helmet').toBe(0);
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('sprite CHR records', () => {
  it("records any vanilla list uses keep their bytes (the passage's and truck drops' tiles use spare and extra ids)", () => {
    const rom = loadRom();
    const off03 = (cpu: number) => 0x10 + 3 * 0x4000 + cpu - 0x8000;
    const word = (r: Uint8Array, a: number) => r[a] | (r[a + 1] << 8);
    const used = new Set<number>();
    for (let list = 0; list < 0x72; list++)
      for (let a = off03(word(rom, off03(0xb8e7 + 2 * list))); rom[a] < 0x80; a++) used.add(rom[a]);
    expect(used.has(0x47) && used.has(0x57), 'the area-clear portrait ($47), list $71 ($57)').toBe(true);
    let permitShaped = 0;
    for (let n = 1n; n <= 150n && permitShaped < 2; n++) {
      const gen = generate(rom, makeSeedCode({ topDownDrops: 'on', trucks: 'on' }, n));
      const passage = rewardOf(gen.spoiler, 'passage')!;
      if (['permit', 'iff', 'flak'].includes(passage)) permitShaped++;
      for (const id of used) {
        const at = off03(0xbbb5 + 5 * id);
        expect([...gen.rom.slice(at, at + 5)], `seed ${n}: record $${id.toString(16)}`).toEqual([
          ...rom.slice(at, at + 5),
        ]);
      }
    }
    expect(permitShaped, 'seeds with a Permit-shaped passage item (its second half from the Permit)').toBeGreaterThan(
      0,
    );
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('pickup messages in the emulator', () => {
  const ROOM_KEYS: [number, number, string][] = [
    [0x38, 13, 'room38'],
    [0x39, 14, 'room39'],
    [0x3c, 15, 'room3c'],
    [0x3d, 16, 'room3d'],
    [0x44, 19, 'room44'],
    [0x41, 18, 'destroyer'],
    [0x42, 18, 'destroyer'],
  ];
  const flagOf = (item: Item) => (item === 'flak' ? 0x1d3 : 0x4ca + ITEMS[item].inventory);
  /** Touch the room's pickup; the talk box's message (from the printer's pointer $7A), or undefined if none opened. */
  function touchAndRead(rom: Uint8Array, room: number, node: number, flag: number, destroyerYes = 1) {
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(flag, 0);
    emu.poke(0x4c5, destroyerYes);
    const slot = emu.enterRoom(room, node);
    expect(slot, `pickup in room ${room.toString(16)}`).toBeGreaterThanOrEqual(0);
    emu.touch(slot);
    let text: string | undefined;
    if (emu.peek(0xcc) === 4) {
      const at = 0x10 + 0x0b * 0x4000 + ((emu.peek(0x7b) << 8) | emu.peek(0x7a)) - 0x8000;
      text = decodeText(rom.subarray(at + 2, at + 2 + rom[at + 1]));
      for (let i = 0; i < 10 && emu.peek(0xcc) === 4; i++) emu.press('A', 4, 40);
    }
    return { given: emu.peek(flag), text, playing: emu.peek(0xcc) === 3 };
  }

  it("taking a building item shows Ladd's WE'VE OBTAINED line, then play goes on", () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({ zones: 'vanilla', buildings: 'vanilla' }, n));
      if (rewardOf(gen.spoiler, 'room44') !== 'oneup') break;
    }
    for (const [room, node, key] of ROOM_KEYS) {
      const item = rewardOf(gen.spoiler, key)!;
      const got = touchAndRead(gen.rom, room, node, flagOf(item));
      expect(got.given, `${item} given`).toBe(1);
      expect(got.text, `room ${room.toString(16)}`).toBe(pickupLine(gen.rom, item).text);
      expect(got.text).toMatch(/^WE'VE OBTAINED/);
      expect(got.playing).toBe(true);
    }
  }, 300_000);

  it("in a pickup room the talkers keep their own lines (only the pickup's talk says WE'VE OBTAINED)", () => {
    const rom = generate(loadRom(), makeSeedCode({ zones: 'vanilla', buildings: 'vanilla' }, 1n)).rom;
    const bank0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
    for (const [room, node] of ROOM_KEYS) {
      for (const y of [0x76, 0xfa]) {
        const emu = new Emu(rom);
        expect(emu.bootToFirstArea()).toBe(true);
        emu.enterRoom(room, node);
        emu.poke(0x8f, y);
        emu.poke(0x88, 0);
        emu.poke(0xcc, 4);
        emu.poke(0xcd, 0);
        emu.poke(0xce, 0); // talk
        let ptr = 0;
        for (let f = 0; f < 120 && !ptr; f++) {
          emu.run(1);
          if (emu.peek(0x74)) ptr = emu.peek(0x7a) | (emu.peek(0x7b) << 8);
        }
        const text = decodeText(rom.subarray(bank0B(ptr) + 2, bank0B(ptr) + 2 + rom[bank0B(ptr) + 1]));
        if (y === 0xfa) expect(text, `room ${room.toString(16)}: the pickup`).toMatch(/^WE'VE OBTAINED/);
        else
          expect(ptr, `room ${room.toString(16)}: a talker`).toBe(
            rom[bank0B(0x8004 + y)] | (rom[bank0B(0x8005 + y)] << 8),
          );
      }
    }
  }, 300_000);

  it("vanilla Destroyers: the real one's Machine Gun gets the line; after an impostor's YES nothing is given or said", () => {
    const rom = generate(loadRom(), makeSeedCode({ rewards: 'vanilla', gate: 'open', destroyer: 'vanilla' }, 1n)).rom;
    const real = touchAndRead(rom, 0x41, 18, 0x4ce, 1);
    expect(real).toEqual({ given: 1, text: "WE'VE OBTAINED  MACHINE GUN", playing: true });
    const impostor = touchAndRead(rom, 0x42, 18, 0x4ce, 2);
    expect(impostor).toEqual({ given: 0, text: undefined, playing: true });
    const flare = touchAndRead(rom, 0x38, 13, 0x4d9);
    expect(flare).toEqual({ given: 1, text: "WE'VE OBTAINED  FLARE", playing: true });
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('the underground passage clear screen', () => {
  /** Fly NZ17 -> NZ14 through the passage, play the stage (taking its item or not), and follow it back to the map. */
  function flyPassage(rom: Uint8Array, take: boolean) {
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0x4d, 17); // back to the map at NZ17 through the clear sequence
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    emu.run(300);
    emu.poke(0x452, 0xa8);
    emu.poke(0x464, 0x98);
    emu.poke(0x4f7, 1);
    emu.poke(0x491, 0);
    for (let i = 0; i < 200 && emu.peek(0x491) !== 2; i++) emu.press('A', 4, 10);
    emu.run(200);
    emu.press('RIGHT', 4, 30);
    for (let i = 0; i < 100 && emu.peek(0x491) !== 3; i++) emu.press('A', 4, 10);
    emu.run(60);
    for (let i = 0; i < 6 && emu.peek(0x49a) !== 4; i++) emu.press('RIGHT', 4, 40); // road 4: NZ14, via the passage
    emu.press('A', 4, 10);
    for (let f = 0; f < 3000 && emu.peek(0x4c) !== 0x15; f++) {
      emu.run(1);
      if (f % 30 === 0) emu.press('A', 4, 4);
    }
    expect(emu.peek(0x4c)).toBe(0x15);
    const before = emu.ram(0x4ca, 0x30);
    // play: hold UP and fire, full HP, sidestep when the scroll stalls; touch the item, then walk to the exit
    let played = false,
      side = 0,
      stall = 0,
      dir: 6 | 7 = 6,
      last = -1,
      taken = -1,
      clear: number[] | undefined;
    const scroll = () => (emu.peek(0xb9) << 8) | emu.peek(0xba);
    for (let f = 0; f < 9000; f++) {
      if (emu.peek(0xcb) === 1 && emu.peek(0xcc) === 3) {
        played = true;
        emu.poke(0x779, 8);
        if (side > 0) {
          emu.nes.buttonUp(1, 4);
          emu.nes.buttonDown(1, dir);
          if (!--side) emu.nes.buttonUp(1, dir);
        } else emu.nes.buttonDown(1, 4);
        if (f % 8 === 0) emu.nes.buttonDown(1, 1);
        else if (f % 8 === 4) emu.nes.buttonUp(1, 1);
        const slot = emu.ram(0x549, 19).findIndex((t, i) => t === 0x0e && emu.peek(0x536 + i));
        if (slot >= 0 && take && taken < 0) {
          for (const b of [1, 4, 6, 7] as const) emu.nes.buttonUp(1, b);
          emu.touch(slot);
          taken = f;
        }
        if (taken >= 0 && f > taken + 200 && f < taken + 260) {
          emu.poke(0x56f, 128);
          emu.poke(0x5a9, 40);
        } // the exit
      } else {
        for (const b of [1, 4, 6, 7] as const) emu.nes.buttonUp(1, b);
        if (emu.peek(0xcb) === 2 && emu.peek(0xcc) === 1 && !clear) clear = emu.ram(0x102, 0x48);
        if (f % 40 === 0 && (emu.peek(0x74) || emu.peek(0xcc) === 2) && emu.peek(0xcc) !== 1) emu.press('A', 4, 4);
      }
      emu.run(1);
      const s = scroll();
      if (s === last) stall++;
      else {
        stall = 0;
        last = s;
      }
      if (stall > 90 && !side) {
        dir = dir === 6 ? 7 : 6;
        side = 30 + (f % 50);
        stall = 0;
      }
      if (played && emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1) break;
    }
    expect(
      emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1,
      `back on the map: ${['cb', 'cc', 'cd', '4c', '4d'].map((a) => emu.peek(parseInt(a, 16)).toString(16))} pos ${emu.peek(0x56f)},${emu.peek(0x5a9)} taken ${taken} clear ${!!clear}`,
    ).toBe(true);
    emu.run(400); // (the helicopter flies on)
    return { emu, before, after: emu.ram(0x4ca, 0x30), clear };
  }

  it("taking the passage's item ends the stage on a PASSAGE CLEAR screen naming it, with the bonus bullets; no area flag; the flight goes on", () => {
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla', zones: 'vanilla', topDownDrops: 'off' }, n)); // (no random bullet drops)
      if (!['helmet', 'flak'].includes(rewardOf(gen.spoiler, 'passage')!)) break;
    }
    const item = rewardOf(gen.spoiler, 'passage')!;
    const { emu, before, after, clear } = flyPassage(gen.rom, true);
    expect(clear, 'the clear screen').toBeDefined();
    const text = decodeText(clear!);
    expect(text.slice(0, 14)).toBe('PASSAGE  CLEAR');
    expect(text.slice(16, 32).trim(), 'the bonus line').toBe('BONUS    ^X10');
    expect(text.slice(32, 48).trim()).toBe("WE'VE OBTAINED");
    expect(text.slice(48).trim().replace(/\s+/g, ' '), 'the name (may wrap)').toBe(
      clearName(gen.rom, item).replace(/\s+/g, ' '),
    );
    // the item, then 10 bullets (BCD $04E7-$04E9, maybe a rank up at $04EA); no area flag, no other item
    const changed = before
      .map((v, i) => (v !== after[i] ? 0x4ca + i : -1))
      .filter((a) => a >= 0 && (a < 0x4e7 || a > 0x4ea));
    expect(changed, 'only the item').toEqual([0x4ca + ITEMS[item].inventory]);
    const bullets = (r: number[]) => Number(r.slice(0x1d, 0x20).join(''));
    expect(bullets(after) - bullets(before), 'the bonus').toBe(10);
    expect(emu.peek(0x4d), 'the helicopter went on to NZ14').toBe(14);
    expect(emu.peek(0x4c7), 'the mark is cleared').toBe(0);
  }, 300_000);

  it('without the item the stage ends on the map as before', () => {
    const gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla', zones: 'vanilla', topDownDrops: 'off' }, 1n)); // (no random bullet drops)
    const { emu, before, after, clear } = flyPassage(gen.rom, false);
    expect(clear).toBeUndefined();
    expect(after).toEqual(before);
    expect(emu.peek(0x4d)).toBe(14);
  }, 300_000);
});
