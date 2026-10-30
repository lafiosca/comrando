import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { BOSS_21 } from '../src/core/patches/locks.ts';
import { doorwayGroups, PANEL_BANK, PANEL_DATA } from '../src/core/doorpanels.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

// The side-scrolling areas in the emulator: weapons, darkness, turrets, door locks and their panels.

describe.skipIf(!HAVE_ROM)('gameplay patches in the emulator: the areas', () => {
  it('rapid fire: every tap fires at once (vanilla: 1 in 4 two-frame taps), holding B repeats every 8 frames', () => {
    const rom = generate(loadRom(), seedCode(1)).rom;
    const base = new Emu(rom);
    expect(base.bootToFirstArea()).toBe(true);
    base.run(120);
    const snap = base.nes.toJSON();
    const armed = () => {
      const e = new Emu(rom);
      e.nes.fromJSON(snap);
      e.poke(0x4ca, 0);
      e.poke(0x4dd, 1);
      e.poke(0x4d8, 4); // normal gun, rapid-fire device selected
      return e;
    };
    const bullets = (e: Emu) => [1, 2, 3].filter((i) => e.peek(0x536 + i) !== 0).length;
    for (let phase = 0; phase < 8; phase++) {
      const e = armed();
      e.run(30 + phase);
      const before = bullets(e);
      e.nes.buttonDown(1, 1);
      e.run(1); // (B)
      expect(bullets(e), `tap at phase ${phase}`).toBe(before + 1);
      e.nes.buttonUp(1, 1);
    }
    const e = armed();
    e.run(30);
    const shots: number[] = [];
    e.nes.buttonDown(1, 1);
    for (let f = 0, prev = bullets(e); f < 24; f++) {
      e.run(1);
      const b = bullets(e);
      if (b > prev) shots.push(f);
      prev = b;
    }
    expect(shots).toEqual([0, 8, 16]);
  }, 60_000);

  it('full-auto Machine Gun: holding B keeps firing a round every 8 frames (vanilla: one 3-round burst per press)', () => {
    for (const [machineGun, rounds] of [
      ['off', 3],
      ['on', 12],
    ] as const) {
      // (96 frames held)
      const e = new Emu(generate(loadRom(), seedCode(1, { machineGun })).rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(120);
      e.poke(0x4ce, 1);
      e.poke(0x4ca, 3); // the Machine Gun, selected
      e.run(30);
      const bullets = () => [1, 2, 3].filter((i) => e.peek(0x536 + i) !== 0 && e.peek(0x549 + i) === 3).length;
      const shots: number[] = [];
      e.nes.buttonDown(1, 1);
      for (let f = 0, prev = bullets(); f < 96; f++) {
        e.run(1);
        const b = bullets();
        if (b > prev) shots.push(...new Array(b - prev).fill(f));
        prev = b;
      }
      e.nes.buttonUp(1, 1);
      expect(shots, `machineGun ${machineGun}`).toEqual(Array.from({ length: rounds }, (_, i) => 8 * i));
    }
    // the other weapons and the Rapid-Fire Device keep their reads (tested above / by the rapid-fire test)
    // Hal's bazooka (`$07EB` set, the final boss): holding B starts no machine-gun burst (playtest)
    const e = new Emu(generate(loadRom(), seedCode(1, { machineGun: 'on' })).rom);
    expect(e.bootToFirstArea()).toBe(true);
    e.run(120);
    e.poke(0x4ce, 1);
    e.poke(0x4ca, 3);
    e.run(30);
    e.nes.buttonDown(1, 1);
    e.run(1); // (the press: vanilla's own path)
    e.poke(0x7eb, 1);
    e.poke(0x7e9, 0); // (the bazooka from here on)
    let bursts = 0;
    for (let f = 0; f < 60; f++) {
      e.poke(0x7eb, 1);
      e.run(1);
      if (e.peek(0x7e9)) bursts++;
    }
    e.nes.buttonUp(1, 1);
    expect(bursts, 'no machine-gun burst under the bazooka').toBe(0);
  }, 60_000);

  it('true dark: the dark part of Area 4 goes pitch black (vanilla keeps the sky, trees and blue outlines); the Flare still lights it', () => {
    for (const dark of ['vanilla', 'true'] as const) {
      const e = new Emu(generate(loadRom(), seedCode(1, { dark })).rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 4);
      e.poke(0x4c, 3);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0); // Area 4
      e.run(300);
      e.nes.buttonDown(1, 7);
      e.run(150);
      e.nes.buttonUp(1, 7);
      e.run(250); // (RIGHT) into the dark, and wait
      const bg = e.ram(0xd0, 16);
      if (dark === 'true') expect(bg, 'all black').toEqual(new Array(16).fill(0x0f));
      else expect([bg[1], bg[6], bg[10], bg[13]], 'sky, blue outlines, trees').toEqual([0x31, 0x0c, 0x0c, 0x19]);
      expect(e.ram(0xd0 + 0x11, 2), "Ladd's colors").toEqual([0x36, 0x06]);
      e.poke(0x4d9, 1);
      e.poke(0x4d8, 0); // the Flare, selected
      e.press('START', 3, 150);
      expect(e.peek(0x4c1), 'Flare used').toBe(1);
      expect(e.ram(0xd0, 4), 'lit').toEqual([0x0f, 0x31, 0x1c, 0x01]);
    }
  }, 60_000);

  it("destructible turrets: ducking shots from the top platform destroy the Area 7 boss room's turret, which turns grey; vanilla takes none", () => {
    for (const turrets of ['vanilla', 'destructible'] as const) {
      const e = new Emu(generate(loadRom(), seedCode(1, { turrets })).rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 7);
      e.poke(0x4c, 0x1b);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0); // Area 7's boss room
      e.run(300);
      const slot = 11,
        tiles = () => Array.from({ length: 64 }, (_, i) => e.vram(0x1000 + i));
      expect(e.peek(0x549 + slot), 'the turret').toBe(0x69);
      const vanillaTiles = tiles();
      for (let f = 0; f < 1100; f++) {
        e.poke(0x779, 8); // Ladd's health
        if (e.peek(0xcc) === 4 && e.peek(0x74) & 0x80) {
          e.press('A', 2, 2);
          continue;
        } // the boss's lines
        if (f < 400) e.nes.buttonDown(1, 7);
        else e.nes.buttonUp(1, 7); // (RIGHT) to the core
        if (f === 400) {
          e.poke(0x56f, 0x90);
          e.poke(0x5a9, 0x20);
        } // onto the top platform, facing the turret
        if (f === 425) e.nes.buttonDown(1, 5); // (DOWN) duck: standing shots fly over the gun
        if (f > 430) {
          if (f % 12 < 6) e.nes.buttonDown(1, 1);
          else e.nes.buttonUp(1, 1);
        } // (B)
        e.run(1);
      }
      if (turrets === 'vanilla') {
        expect([e.peek(0x647 + slot), e.peek(0x779 + slot)], 'still firing, unhurt').toEqual([1, 14]);
        expect(e.vram(0x23cd)).toBe(0x00);
      } else {
        expect(e.peek(0x647 + slot), 'destroyed (watching its attribute)').toBe(4);
        expect(e.vram(0x23cd), 'palette 3 for the gun').toBe(0x30);
        expect(tiles(), 'recolored gun tiles').not.toEqual(vanillaTiles);
        expect(e.peek(0x6a6 + slot) & 0x08, 'explosion hidden').toBe(0);
      }
    }
  }, 60_000);

  it("destructible turrets: Area 12's power rooms' turrets turn grey too (their gun is tiles $F8-$FB, attribute $23CE)", () => {
    const rom = generate(loadRom(), seedCode(1, { turrets: 'destructible' })).rom;
    const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
    for (const room of [0x58, 0x59]) {
      const e = new Emu(rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 12);
      e.poke(0x4c, room);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      e.run(300);
      const slot = [...Array(19).keys()].find((s) => e.peek(0x536 + s) && e.peek(0x549 + s) === 0x69)!;
      expect(slot, 'the turret').toBeDefined();
      e.poke(0x647 + slot, 2);
      e.poke(0x65a + slot, 0); // destroyed
      e.run(120);
      expect(e.vram(0x23ce), `room $${room.toString(16)}: palette 3 for the gun`).toBe(0x75);
      expect(
        Array.from({ length: 64 }, (_, i) => e.vram(0x1f80 + i)),
        'the gun recolored',
      ).toEqual([...rom.subarray(off(2, 0xaf80), off(2, 0xaf80) + 64)]);
    }
  }, 60_000);

  it("Area 12's miniboss room: once the officer falls, its exit door opens like the power rooms' (the shutter tiles $48-$4B: the talk box types into $B8-$F7, its frame $F8-$FF)", () => {
    const e = new Emu(generate(loadRom(), seedCode(1, { area12Comm: 'both' })).rom); // (with the Area 12 Door Locks option)
    expect(e.bootToFirstArea()).toBe(true);
    e.run(60);
    e.poke(0x4d, 12);
    e.poke(0x4c, 0x21);
    e.poke(0x4be, 0);
    e.poke(0x536, 0x81);
    e.poke(0x65a, 0x11);
    e.poke(0x66d, 0);
    e.run(300);
    const shutter = () => Array.from({ length: 64 }, (_, i) => e.vram(0x1480 + i)).reduce((a, b) => a + b, 0);
    expect(shutter(), 'the door drawn').toBeGreaterThan(0);
    e.poke(0x40, 1); // (the officer's death: the room's event count)
    for (let f = 0; f < 120; f++) {
      e.poke(0x56f, 0x68);
      e.run(1);
    } // (Ladd walks up to it)
    expect(shutter(), 'opened').toBe(0);
  }, 60_000);

  it("a boss's talk box draws its frame ($F8-$FF) and text tiles as vanilla, with the door option on", () => {
    const talk = (rom: Uint8Array) => {
      const e = new Emu(rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 7);
      e.poke(0x4c, 0x16);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      let f = 0;
      for (; f < 900 && !(e.peek(0xcc) === 4 && e.peek(0x74) & 0x80); f++) {
        e.poke(0x779, 8);
        e.nes.buttonDown(1, 7);
        e.run(1);
      }
      expect(f, 'he talks').toBeLessThan(900);
      e.run(60);
      return Array.from({ length: 0x80 }, (_, i) => e.vram(0x1f80 + i));
    };
    expect(talk(generate(loadRom(), seedCode(1, { area12Comm: 'both' })).rom)).toEqual(talk(loadRom()));
  }, 60_000);

  it("the shutter redraw outside rooms $20-$2F still draws tiles $D8-$DB (Area 1's doors of type $29, the power rooms), with the door option on", () => {
    const { rom } = generate(loadRom(), seedCode(1, { area12Comm: 'both' }));
    const e = new Emu(rom);
    expect(e.bootToFirstArea()).toBe(true);
    e.run(60);
    expect(e.peek(0x4c) & 0xf0, 'a level room, not $2x').not.toBe(0x20);
    const art = Array.from(rom.subarray(0x10 + 5 * 0x4000 + 0x1f40, 0x10 + 5 * 0x4000 + 0x1f80));
    const tiles = (at: number) => Array.from({ length: 64 }, (_, i) => e.vram(at + i));
    const was = tiles(0x1d80),
      high = tiles(0x1480);
    e.poke(0x43b, 1);
    e.poke(0x43c, 0); // (the redraw started, as a door object does)
    e.run(6);
    const now = tiles(0x1d80);
    expect(now, 'drawn at $1D80').not.toEqual(was);
    expect(
      now.every((b, i) => (b & ~art[i]) === 0),
      'the shutter art, masked',
    ).toBe(true);
    expect(tiles(0x1480), '$1480 untouched').toEqual(high);
    // ...then on to its end, as types $29/$5B/$5C let it (the exits stop it at state 2): open, wait, close again
    for (let f = 0; f < 240 && e.peek(0x43b); f++) e.run(1);
    e.run(2);
    expect([e.peek(0x43b), e.peek(0x43c)], 'finished').toEqual([0, 0]);
    expect(tiles(0x1d80), 'closed again: the whole shutter').toEqual(art);
  }, 60_000);

  it("door locks: the exit object (power rooms, Area 12's mini-boss room) keeps door index 0 (it jumps into the door setup at $A7BF), as vanilla", () => {
    // (playtest: with index 4, leaving power system 1 came out of tower $5F's door 2)
    // (and Area 12's mini-boss room $21: with index 4 its exit warped to O1)
    for (const [rom, room] of [
      loadRom(),
      generate(loadRom(), seedCode(1, { area12Comm: 'both', commLocks: 'all' })).rom,
    ].flatMap(
      (r) =>
        [
          [r, 0x58],
          [r, 0x21],
        ] as const,
    )) {
      const e = new Emu(rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 12);
      e.poke(0x4c, room);
      e.poke(0x4be, 1);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      e.run(300);
      const exit = [...Array(13)].map((_, i) => i + 6).find((s) => e.peek(0x536 + s) && e.peek(0x549 + s) === 0x2e)!;
      expect(exit, 'the exit object').toBeDefined();
      expect([e.peek(0x647 + exit), e.peek(0x680 + exit)], 'state 1, door index 0').toEqual([1, 0]);
    }
  }, 60_000);

  it('comm locks: each lockable boss door stays shut until its comm room is answered (O5: both), vanilla leaves it open', () => {
    const roms = {
      vanilla: generate(loadRom(), seedCode(1, { commLocks: 'vanilla' })).rom,
      all: generate(loadRom(), seedCode(1, { commLocks: 'all', comms: 'vanilla' })).rom,
    };
    const enter = (rom: Uint8Array, node: number, room: number, flags = false) => {
      const e = new Emu(rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, node);
      e.poke(0x4c, room);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      for (let f = 0; f < 300; f++) {
        if (flags) {
          e.poke(0x4bf, 1);
          e.poke(0x4c0, 1);
        }
        e.run(1);
      }
      return e;
    };
    const doorState = (e: Emu, type: number) => {
      for (let s = 6; s < 19; s++) if (e.peek(0x536 + s) && e.peek(0x549 + s) === type) return e.peek(0x647 + s);
      return -1;
    };
    // (layout = map number here) the boss door's room and object type ($2A + door index)
    for (const [node, room, type] of [
      [2, 0x48, 0x2c],
      [3, 0x49, 0x2c],
      [5, 0x4b, 0x2a],
      [9, 0x08, 0x2b],
      [10, 0x09, 0x2b],
    ]) {
      expect(doorState(enter(roms.all, node, room), type), `O${node} locked`).toBe(2);
      expect(doorState(enter(roms.all, node, room, true), type), `O${node} opened`).toBe(1);
    }
    expect(doorState(enter(roms.vanilla, 2, 0x48), 0x2c), 'vanilla: O2 open').toBe(1);
    expect(doorState(enter(roms.all, 11, 0x0a), 0x2b), 'O11 never locked: no room for its panel').toBe(1);
    expect(doorState(enter(roms.all, 4, 0x03), 0x2b), "O4's vanilla lock as before").toBe(2);
    // COMMUNICATE (α, O5's comm) in O5's comm rooms: $2C sets $04BF, $2D $04C0
    for (const [room, flag] of [
      [0x2c, 0x4bf],
      [0x2d, 0x4c0],
    ]) {
      const e = enter(roms.all, 5, room);
      e.poke(0x4e0, 1);
      e.poke(0x4df, 0); // α, selected
      e.poke(0xcc, 5);
      e.poke(0xcd, 0);
      e.poke(0xce, 0); // the COMMUNICATE / WIRE-TAPPING menu
      for (let i = 0; i < 60 && !e.peek(flag); i++) e.press('A', 3, 20);
      expect(e.peek(flag), `room $${room.toString(16)}`).toBe(1);
    }
  }, 120_000);

  it('door panels: a locked door is drawn sealed in the background (its own tile groups, closed by CHR), an open one as vanilla', () => {
    const rom = generate(loadRom(), seedCode(1, { commLocks: 'all', comms: 'vanilla', area12Comm: 'both' })).rom,
      vanilla = loadRom();
    const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
    const closed = PANEL_DATA.flatMap((a) => [...rom.subarray(off(PANEL_BANK, a), off(PANEL_BANK, a) + 64)]);
    // O1 (vanilla lock), O9 (comm lock), tower $5F's door 2 (Area 12)
    for (const [node, room, door] of [
      [1, 0x00, 0x2b],
      [9, 0x08, 0x2b],
      [12, 0x5f, 0x2c],
    ]) {
      const groups = doorwayGroups(rom, room, door),
        was = doorwayGroups(vanilla, room, door);
      expect(
        groups.some((g, i) => g === was[i]),
        'its own groups',
      ).toBe(false);
      for (const open of [false, true]) {
        const e = new Emu(rom);
        expect(e.bootToFirstArea()).toBe(true);
        e.run(60);
        e.poke(0x4d, node);
        e.poke(0x4c, room);
        e.poke(0x4be, 0);
        e.poke(0x536, 0x81);
        e.poke(0x65a, 0x11);
        e.poke(0x66d, 0);
        for (let f = 0; f < 300; f++) {
          if (open) for (const a of [0x4bf, 0x4c0, 0x4c9, BOSS_21]) e.poke(a, 1);
          e.run(1);
        }
        const chr = (gs: number[]) =>
          gs.flatMap((g) => Array.from({ length: 64 }, (_, i) => e.vram(0x1000 + 64 * g + i)));
        // (tile $20 is the blank the level draws in over: a panel there stripes the screen while it loads)
        expect(groups, "not the blank tile's group").not.toContain(0x20 >> 2);
        expect(
          chr([0x20 >> 2]).every((b) => b === 0),
          `room $${room.toString(16)}: tiles $20-$23 blank`,
        ).toBe(true);
        if (open) expect(chr(groups), `room $${room.toString(16)} open`).toEqual(chr(was));
        else expect(chr(groups), `room $${room.toString(16)} sealed`).toEqual(closed);
      }
    }
  }, 60_000);

  it('more dark areas: the Area 9 and 11 layouts go dark past the start like Area 4, the Flare lights them; others stay lit', () => {
    let both: ReturnType<typeof generate> | undefined;
    for (let n = 1; !both && n <= 200; n++) {
      const g = generate(loadRom(), seedCode(n, { darkAreas: 'more' }));
      if (g.spoiler.dark.map((p) => p.layout).join() === '4,9,11') both = g;
    }
    if (!both) throw new Error('no seed darkens Areas 4, 9 and 11');
    for (const [area, darkens] of [
      [9, true],
      [11, true],
      [10, false],
      [5, false],
    ] as const) {
      const e = new Emu(both.rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, area);
      e.poke(0x4c, area - 1);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      e.run(300);
      const lit = e.ram(0xd4, 8);
      expect(e.ram(0x549, 19).filter((t) => t === 0x80).length, `O${area}: the darkness object`).toBe(darkens ? 1 : 0);
      expect(e.peek(0x549 + 7) === 0x80 ? e.ram(0x549 + 11, 8) : [], 'the list loaded as before').not.toContain(0x80);
      for (let f = 0; f < 600 && ((e.peek(0xb6) << 8) | e.peek(0xb7)) < 0x190; f++) {
        e.poke(0x779, 8);
        e.nes.buttonDown(1, 7);
        if (f % 40 === 0) e.press('A', 2, 2);
        e.run(1);
      }
      e.nes.buttonUp(1, 7);
      e.run(250);
      expect(((e.peek(0xb6) << 8) | e.peek(0xb7)) >= 0x170 || !darkens, `O${area}: scrolled past $170`).toBe(true);
      if (!darkens) {
        expect(e.ram(0xd4, 8), `O${area} stays lit`).toEqual(lit);
        continue;
      }
      expect([e.peek(0xd6), e.peek(0xda)], `O${area}: dark (blue outlines)`).toEqual([0x0c, 0x0c]);
      e.poke(0x4d9, 1);
      e.poke(0x4d8, 0); // the Flare, selected
      e.press('START', 3, 150);
      expect(e.peek(0x4c1), `O${area}: Flare used`).toBe(1);
      expect(e.ram(0xd4, 8), `O${area}: lit`).toEqual(lit);
    }
    // (Dark Areas: Vanilla: the Flare doesn't fire outside Area 4)
    const e = new Emu(generate(loadRom(), seedCode(1)).rom);
    expect(e.bootToFirstArea()).toBe(true);
    e.run(60);
    e.poke(0x4d, 9);
    e.poke(0x4c, 8);
    e.poke(0x4be, 0);
    e.poke(0x536, 0x81);
    e.poke(0x65a, 0x11);
    e.poke(0x66d, 0);
    e.run(300);
    e.poke(0x4d9, 1);
    e.poke(0x4d8, 0);
    e.press('START', 3, 150);
    expect(e.peek(0x4c1)).toBe(0);
  }, 120_000);
});
