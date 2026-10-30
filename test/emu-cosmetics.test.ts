import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { HAIR_COLORS, UNIFORM_COLORS } from '../src/core/palette.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf } from './spoil.ts';

// Cosmetics in the emulator: player colors, the title screen, the robot portrait.

const uniformNow = (emu: Emu) => emu.paletteByte(0x16);

function bootWithColors(uniformColor: string, hairColor: string): Emu {
  // a seed whose first area (map number 1) isn't Joe's: clearing his area plays the rescue scene, not the portrait
  let n = 1n;
  const joeFirst = (c: string) => clearOf(generate(loadRom(), c).spoiler, 1) === 'joe';
  while (joeFirst(makeSeedCode({}, n))) if (++n > 200n) throw new Error('every seed starts at Joe');
  const { rom } = generate(loadRom(), makeSeedCode({}, n), { cosmetics: { uniformColor, hairColor } });
  const emu = new Emu(rom);
  expect(emu.bootToFirstArea()).toBe(true);
  emu.run(200);
  return emu;
}

describe.skipIf(!HAVE_ROM)('player palette in the emulator', () => {
  it('loads the chosen colors into PPU sprite palettes in the first area', () => {
    const emu = bootWithColors('red', 'blond');
    // sprite palette 0 = $3F10-13 (head), sprite palette 1 = $3F14-17 (body)
    expect(emu.paletteByte(0x12)).toBe(HAIR_COLORS.blond);
    expect(uniformNow(emu)).toBe(UNIFORM_COLORS.red);
  }, 60_000);

  it('keeps the uniform color through door transitions', () => {
    const emu = bootWithColors('blue', 'vanilla');
    const seen = new Set<number>();
    for (const room of [0x28, 0x00]) {
      // the same RAM writes the game's door code makes: target room, then start the transition
      emu.poke(0x4c, room);
      emu.poke(0x4be, 0);
      emu.poke(0x536, 0x81);
      emu.poke(0x65a, 0x11);
      emu.poke(0x66d, 0);
      for (let f = 0; f < 300; f++) {
        emu.run(1);
        seen.add(uniformNow(emu));
      }
    }
    expect(seen.has(UNIFORM_COLORS.green)).toBe(false);
    expect(seen.has(UNIFORM_COLORS.blue)).toBe(true);
  }, 60_000);

  it('restores the chosen uniform (not vanilla green) after the damage flash', () => {
    const emu = bootWithColors('blue', 'vanilla');
    emu.poke(0x7e0, 0x60);
    emu.poke(0x7e1, 0); // post-damage flash timer, as set when the player is hit
    const seen = new Set<number>();
    for (let f = 0; f < 1000 && emu.peek(0x7e0); f++) {
      emu.run(1);
      seen.add(uniformNow(emu));
    }
    emu.run(120);
    expect(seen.has(UNIFORM_COLORS.green)).toBe(false);
    expect(uniformNow(emu)).toBe(UNIFORM_COLORS.blue);
  }, 60_000);

  it('recolors the area-clear portrait', () => {
    const emu = bootWithColors('blue', 'blond');
    // force the area-clear screen for the current area (the game's own mode switch: $CB=2 runs the clear sequence)
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    emu.run(150);
    const spr = Array.from({ length: 16 }, (_, i) => emu.paletteByte(0x10 + i));
    expect(spr[3]).toBe(UNIFORM_COLORS.blue);
    expect(spr[6]).toBe(UNIFORM_COLORS.blue);
    expect(spr[2]).toBe(HAIR_COLORS.blond);
    expect(spr[14]).toBe(HAIR_COLORS.blond);
    expect(spr).not.toContain(UNIFORM_COLORS.green);
  }, 60_000);
});

describe.skipIf(!HAVE_ROM)('title screen in the emulator', () => {
  it('shows the COMRANDO R tiles on the title screen', () => {
    const { rom } = generate(loadRom(), makeSeedCode({}, 2n));
    const emu = new Emu(rom);
    emu.run(700);
    // the logo uses the $1000 pattern table; tile $71 is part of the R (title CHR at file 0x1C010)
    const tile71 = Array.from({ length: 16 }, (_, i) => emu.vram(0x1000 + 0x71 * 16 + i));
    const patched = Array.from(rom.subarray(0x1c010 + 0x71 * 16, 0x1c010 + 0x72 * 16));
    const vanilla = Array.from(loadRom().subarray(0x1c010 + 0x71 * 16, 0x1c010 + 0x72 * 16));
    expect(tile71).toEqual(patched);
    expect(tile71).not.toEqual(vanilla);
    // and it is placed where the second M of COMMANDO is (row 13, col 14 of the nametable)
    expect(emu.vram(0x2000 + 13 * 32 + 14)).toBe(0x71);
  }, 60_000);
});

describe.skipIf(!HAVE_ROM)('robot portrait in the emulator', () => {
  // a boss's talk in room `room` (layout `layout`), `frames` in: the portrait index and the sprite palettes
  const talk = (settings: Record<string, string>, room: number, layout: number, cosmetics = {}) => {
    const rom = generate(loadRom(), seedCode(5, { areas: 'vanilla', zones: 'vanilla', ...settings }), {
      cosmetics,
      cosmeticSeed: 'x',
    }).rom;
    const e = new Emu(rom);
    expect(e.bootToFirstArea()).toBe(true); // (the intro's radio portraits too: state 1 runs from bank 0B now)
    e.run(60);
    e.poke(0x4d, layout);
    e.poke(0x4c, room);
    e.poke(0x4be, 0);
    e.poke(0x536, 0x81);
    e.poke(0x65a, 0x11);
    e.poke(0x66d, 0);
    e.run(300);
    e.poke(0x8f, rom[0x3e6fd + room - 0x16]);
    e.poke(0x88, 0);
    e.poke(0xcc, 4);
    e.poke(0xcd, 0);
    e.poke(0xce, 0);
    e.run(150);
    return { index: e.peek(0x76), pal: Array.from({ length: 16 }, (_, i) => e.paletteByte(16 + i)) };
  };
  it("the robot portrait stays out of the area clear and the map after a robot boss's room (their boxes keep no portrait)", () => {
    const chrAfterClear = (d1Portrait: string) => {
      const emu = new Emu(generate(loadRom(), seedCode(1, { d1Portrait })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      emu.poke(0x4c, 0x19);
      emu.poke(0x4d, 5); // (the last room: Area 5's robot boss)
      emu.poke(0xcb, 2);
      emu.poke(0xcc, 0);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0);
      emu.run(200);
      return Array.from({ length: 0x400 }, (_, i) => emu.vram(i)); // (the clear screen's Ladd art)
    };
    expect(chrAfterClear('on')).toEqual(chrAfterClear('off'));
  }, 120_000);

  it('a robot boss shows the robot (its red the enemy color); the cyborg keeps his; off: no portrait', () => {
    expect(talk({ d1Portrait: 'on' }, 0x19, 5, { enemyColor: 'orange' })).toEqual({
      index: 15,
      pal: [0x0f, 0x27, 0x30, 0x00, 0x0f, 0x21, 0x11, 0x30, 0x0f, 0x27, 0x05, 0x30, 0x0f, 0x27, 0x30, 0x11],
    });
    expect(talk({ d1Portrait: 'on' }, 0x1a, 6).index).toBe(1);
    expect(talk({ d1Portrait: 'off' }, 0x19, 5).index).toBe(0xff);
  }, 300_000);
});
