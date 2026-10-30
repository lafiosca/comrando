import { describe, expect, it } from 'vitest';
import { ESCAPE_RADIOS, JOE_HERE } from '../src/core/bosses.ts';
import { generate } from '../src/core/generate.ts';
import { BOSS_21 } from '../src/core/patches/locks.ts';
import { ALT_Y, BOSS_TYPE } from '../src/core/roomtalk.ts';
import { decodeText, RADIO_PAGE, wrap } from '../src/core/text.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { dialogueTexts } from './spoil.ts';
import type { Said } from '../src/core/spoiler.ts';

// Dialogue and the ending in the emulator: the final time, boss lines and replies, the message printer, the final
// scene and screen.

describe.skipIf(!HAVE_ROM)('final time in the emulator', () => {
  const count = (emu: Emu) => emu.peek(0x1d5) | (emu.peek(0x1d6) << 8) | (emu.peek(0x1d7) << 16);
  const gameOver = (emu: Emu) => {
    emu.poke(0xcb, 0);
    emu.poke(0xcc, 1);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    emu.run(400);
  };
  const toLevel = (emu: Emu) => {
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 3); i++) emu.press(i % 2 ? 'A' : 'START');
  };

  it('counts every frame from START, through screen loads (when vanilla switches NMI off)', () => {
    const emu = new Emu(generate(loadRom(), seedCode(3)).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    const offset = emu.frame - count(emu);
    expect(count(emu), 'reset by START: the count is the time since then').toBeLessThan(emu.frame);
    emu.poke(0x4c, 0x28);
    emu.poke(0x4be, 0);
    emu.poke(0x536, 0x81);
    emu.poke(0x65a, 0x11);
    emu.poke(0x66d, 0); // a room change
    emu.run(300);
    emu.press('START', 3, 60);
    emu.press('START', 3, 60); // pause in and out
    expect(emu.frame - count(emu), 'no frame lost').toBe(offset);
  }, 120_000);

  it('a CONTINUE keeps the clock; START after a game over restarts it', () => {
    for (const [continues, kept] of [
      ['1', true],
      ['0', false],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(3, { continues })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(600);
      const before = count(emu);
      gameOver(emu);
      emu.press('START', 4, 60); // CONTINUE when offered, else a new game
      toLevel(emu);
      if (kept) expect(count(emu), 'continued').toBeGreaterThan(before + 400);
      else expect(count(emu), 'new game').toBeLessThan(before);
    }
  }, 120_000);

  it("the ending shows the time after Ladd's message", () => {
    const emu = new Emu(generate(loadRom(), seedCode(3)).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    const frames = 216356 + 3606 * 5 + 60 * 9 + 7; // 1 h 05 min 09.1 s
    emu.poke(0xcb, 4);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 1);
    emu.poke(0xce, 0);
    emu.poke(0xcf, 0); // the escape is over
    emu.poke(0x1d5, frames & 0xff);
    emu.poke(0x1d6, (frames >> 8) & 0xff);
    emu.poke(0x1d7, frames >> 16);
    emu.run(1);
    const decode = (codes: number[]) =>
      codes
        .map(
          (c) =>
            (({ 0: ' ', 5: 'H', 0xf: 'M', 0x1b: 'S', 0x30: '.' }) as Record<number, string>)[c] ?? String((c - 2) / 2),
        )
        .join('');
    const msg = emu.ram(0x490, 2 + 32);
    expect(msg[0]).toBe(0xb0);
    expect(decode(msg.slice(2 + 16, 2 + msg[1])), '(one frame counted before the conversion)').toBe('1H 05M 09.128S');
    // scene 3 prints Ladd's message, waits, then the time
    let printed = false;
    for (let f = 0; f < 4000 && !printed; f++) {
      emu.run(1);
      printed = emu.peek(0xce) === 3 && emu.peek(0xcf) === 6;
    }
    expect(printed).toBe(true);
    emu.run(300);
    expect([emu.peek(0x7a), emu.peek(0x7b)], 'the printer reads the time message').toEqual([0x90, 0x04]);
  }, 120_000);

  it('the attract-mode intro leaves the time alone: CONTINUE after it reaches the map (it used to crash)', () => {
    const emu = new Emu(generate(loadRom(), seedCode(3)).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    const msg = emu.ram(0x490, 4);
    gameOver(emu);
    emu.run(3000); // the game-over screen times out into the attract mode's intro (the ending's scene code)
    expect(emu.peek(0xcc), 'attract mode').toBe(2);
    expect(emu.ram(0x490, 4), "the map's object tables untouched").toEqual(msg);
    emu.press('START', 4, 4); // to the title
    for (let f = 0; f < 600 && emu.peek(0xcd) !== 4; f++) emu.run(1); // its menu (cursor on CONTINUE)
    expect([emu.peek(0xcb), emu.peek(0xcc), emu.peek(0xcd)], 'title menu').toEqual([0, 3, 4]);
    emu.press('START', 4, 4); // CONTINUE
    emu.run(800);
    expect([emu.peek(0xcb), emu.peek(0xcc), emu.peek(0xcd)], 'the map, running').toEqual([1, 1, 1]);
  }, 120_000);

  it('Story Dialogue Comedic: the escape radio plays every line of its conversation, speakers alternating, then the ending', () => {
    const out = generate(loadRom(), seedCode(3, { story: 'comedic' }));
    const emu = new Emu(out.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0xcb, 4);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0);
    emu.poke(0xcf, 0); // the radio after the escape
    const shown: { header: number; text: string }[] = [];
    let line = -1;
    for (let f = 0; f < 8000 && emu.peek(0xcd) === 0; f++) {
      emu.run(1);
      if (emu.peek(0xcf) === 3 && emu.peek(0xce) !== line) {
        line = emu.peek(0xce);
        const at = 0x10 + 0x0b * 0x4000 + (emu.peek(0x7a) | (emu.peek(0x7b) << 8)) - 0x8000;
        if (emu.peek(0x74))
          shown.push({ header: out.rom[at], text: decodeText(out.rom.subarray(at + 2, at + 2 + out.rom[at + 1])) });
      }
    }
    expect(emu.peek(0xcd), 'the ending follows').toBe(1);
    expect([emu.peek(0xce), emu.peek(0xcf)]).toEqual([0, 0]);
    const talk = ESCAPE_RADIOS.find((c) => wrap(c[0], undefined, RADIO_PAGE) === shown[0]?.text);
    expect(talk).toBeDefined();
    expect(shown).toEqual(talk!.map((l, i) => ({ header: i % 2 ? 0x76 : 0x78, text: wrap(l, undefined, RADIO_PAGE) })));
  }, 120_000);

  it('the final screen shows the time, the run style, the seed code and version, a heart and Joe', () => {
    const code = seedCode(3);
    const emu = new Emu(generate(loadRom(), code, { date: new Date(2026, 9, 28) }).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0xcb, 4);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 1);
    emu.poke(0xce, 0);
    emu.poke(0xcf, 0); // the escape is over
    let f = 0;
    for (; f < 12000 && !(emu.peek(0xce) === 5 && emu.peek(0xcf) === 7); f++) emu.run(1);
    expect(f).toBeLessThan(12000);
    emu.run(120);
    const row = (r: number, c: number, n: number) =>
      decodeText(Array.from({ length: n }, (_, i) => emu.vram(0x2400 + r * 32 + c + i) - 0x20));
    expect(row(3, 1, 15)).toBe('MISSION TIME- 0');
    expect(row(3, 15, 16)).toMatch(/^\d+M \d\d\.\d{3}S +$/);
    expect(row(7, 1, 6 + code.length)).toBe(`SEED- ${code}`);
    expect(row(12, 10, 12)).toBe('GENERATED AT');
    expect(row(13, 10, 12)).toBe('COMRANDO.COM');
    expect(row(14, 11, 10)).toBe('2026-10-28');
    expect(row(17, 5, 22)).toBe('THANK YOU FOR PLAYING!');
    expect(emu.paletteByte(1), 'the text: white').toBe(0x30);
    expect([emu.paletteByte(16 + 14), emu.paletteByte(16 + 15)], 'the heart: pink').toEqual([0x25, 0x15]);
    const oam: number[] = (emu.nes as unknown as { ppu: { spriteMem: number[] } }).ppu.spriteMem;
    // (the game writes every sprite twice: count each tile and position once)
    const shown = new Set(
      Array.from({ length: 64 }, (_, i) => oam.slice(4 * i, 4 * i + 4))
        .filter(([y]) => y < 0xef)
        .map(([y, t, , x]) => `${t},${x},${y}`),
    );
    const tiles = [...shown].map((k) => Number(k.split(',')[0]));
    expect(tiles.filter((t) => t === 0x40 || t === 0x41).length, 'the heart (4 sprites)').toBe(4);
    expect(tiles.filter((t) => t >= 0x51).length, "Joe's 15").toBe(15);
  }, 120_000);

  it('off: no NMI or title change', () => {
    const rom = loadRom();
    const out = generate(rom, seedCode(3, { timer: 'off' })).rom;
    expect([out[0x4000a], out[0x4000b]], 'NMI vector').toEqual([0x58, 0xc0]);
    expect([...out.slice(0x3c8b2, 0x3c8b9)]).toEqual([...rom.slice(0x3c8b2, 0x3c8b9)]);
  });
});

describe.skipIf(!HAVE_ROM)('comedic boss dialogue in the emulator', () => {
  const ROOMS: Record<number, number> = {
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
  };
  it("every boss says its own line (both talk paths), Joe's captor his portrait's Joe line", () => {
    const { rom, spoiler } = generate(loadRom(), seedCode(5));
    const lines = spoiler.dialogue!.bosses.filter((b) => b.layout !== 12).map((b) => b.line); // (Areas 1-11's taunts)
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(new Set(lines).size, 'no two bosses share a line').toBe(lines.length);
    const said = new Map<number, string>();
    for (let layout = 1; layout <= 11; layout++) {
      const emu = new Emu(rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      emu.poke(0x4d, layout);
      emu.poke(0x4c, ROOMS[layout]);
      emu.poke(0x4be, 0);
      emu.poke(0x536, 0x81);
      emu.poke(0x65a, 0x11);
      emu.poke(0x66d, 0);
      emu.run(300);
      emu.poke(0x8f, rom[0x3e6fd + ROOMS[layout] - 0x16]);
      emu.poke(0x88, 0);
      emu.poke(0xcc, 4);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0); // talk
      let ptr = 0;
      for (let f = 0; f < 120 && !ptr; f++) {
        emu.run(1);
        if (emu.peek(0x74)) ptr = emu.peek(0x7a) | (emu.peek(0x7b) << 8);
      }
      const at = 0x2c010 + ptr - 0x8000;
      said.set(layout, readTextAt(rom, at));
    }
    const comedic = [...said.values()].filter((t) =>
      lines.some((l) => l.replace(/\s+/g, '') === t.replace(/\s+/g, '')),
    );
    expect(comedic.length, [...said].join('\n')).toBe(lines.length);
    const joeHere = Object.values(JOE_HERE)
      .flat()
      .map((l) => l.replace(/\s+/g, ''));
    expect(
      [...said.values()].some((t) => joeHere.includes(t.replace(/\s+/g, ''))),
      "Joe's captor's line",
    ).toBe(true);
  }, 300_000);

  it("hint mode Nonsense: Area 1's first COMMUNICATE and its wiretap are one message each (the comm still opens the door)", () => {
    const opened = (hints: string, wire: number) => {
      const e = new Emu(generate(loadRom(), seedCode(1, { hints, areas: 'vanilla' })).rom);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      e.poke(0x4d, 1);
      e.poke(0x4c, 0x28);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      e.run(300);
      e.poke(0x4e0, 1);
      e.poke(0x4df, 0);
      e.poke(0xcc, 5);
      e.poke(0xcd, 0);
      e.poke(0xce, 0);
      let opens = 0,
        last = -1;
      for (let f = 0; f < 3000; f++) {
        if (f % 40 === 0 && e.peek(0x82) !== 9) e.press('A', 2, 0);
        if (e.peek(0xcd) < 5) e.poke(0x80, wire); // (the menu's choice, 0D:$AC11: 1 = WIRE-TAPPING)
        e.run(1);
        if (e.peek(0x82) === 1 && last !== 1) opens++;
        last = e.peek(0x82);
      }
      return [opens, e.peek(0x4bf)];
    };
    expect(opened('nonsense', 0)).toEqual([1, 1]);
    expect(opened('nonsense', 1)).toEqual([1, 0]);
    expect(opened('normal', 0)).toEqual([2, 1]); // (vanilla: $14 then $16)
    expect(opened('normal', 1)).toEqual([2, 0]); // (line, reply)
  }, 300_000);

  it('hint mode Nonsense with vanilla boss dialogue: the bosses say talker lines', () => {
    const { rom, spoiler } = generate(loadRom(), seedCode(5, { hints: 'nonsense', story: 'vanilla' }));
    const lines = dialogueTexts(spoiler).map((l) => l.replace(/\s+/g, ''));
    let found = 0;
    for (const layout of [1, 4, 7]) {
      const emu = new Emu(rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      emu.poke(0x4d, layout);
      emu.poke(0x4c, ROOMS[layout]);
      emu.poke(0x4be, 0);
      emu.poke(0x536, 0x81);
      emu.poke(0x65a, 0x11);
      emu.poke(0x66d, 0);
      emu.run(300);
      emu.poke(0x8f, rom[0x3e6fd + ROOMS[layout] - 0x16]);
      emu.poke(0x88, 0);
      emu.poke(0xcc, 4);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0); // talk
      let ptr = 0;
      for (let f = 0; f < 120 && !ptr; f++) {
        emu.run(1);
        if (emu.peek(0x74)) ptr = emu.peek(0x7a) | (emu.peek(0x7b) << 8);
      }
      if (lines.includes(readTextAt(rom, 0x2c010 + ptr - 0x8000).replace(/\s+/g, ''))) found++;
    }
    expect(found).toBe(3);
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('the reply when a boss dies, in the emulator', () => {
  const ROOM: Record<number, number> = {
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
    12: 0x21,
  };
  /** A seed with a reply in a room (one of `rooms`) and the reply, as the spoiler gives it. */
  const seedWithReply = (rooms: number[], settings = {}) => {
    for (let n = 1; n < 300; n++) {
      const gen = generate(loadRom(), seedCode(n, settings));
      for (const { area, layout, reply } of gen.spoiler.dialogue?.bosses ?? []) {
        if (reply && rooms.includes(ROOM[layout]))
          return { rom: gen.rom, layout: area, room: ROOM[layout], reply: reply.text };
      }
    }
    throw new Error('no seed');
  };
  /**
   * Enter `room`, shoot its boss until it goes (or, `dying`, put it into its death after its taunt); the lines shown,
   * and whether a talk had $8F = ALT_Y.
   */
  const killBoss = (rom: Uint8Array, layout: number, room: number, dying?: number[]) => {
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    emu.poke(0x4d, layout);
    emu.poke(0x4c, room);
    emu.poke(0x4be, 0);
    emu.poke(0x536, 0x81);
    emu.poke(0x65a, 0x11);
    emu.poke(0x66d, 0);
    emu.run(300);
    const boss = () => {
      for (let s = 3; s < 19; s++) if (emu.peek(0x536 + s) && emu.peek(0x549 + s) === BOSS_TYPE[room]) return s;
      return -1;
    };
    const said: string[] = [];
    let slot = -1,
      gone = false,
      alt = false;
    for (let f = 0; f < 4000 && !gone; f++) {
      emu.poke(0x779, 8); // (no damage)
      if (emu.peek(0xcc) === 4) {
        alt ||= emu.peek(0x8f) === ALT_Y;
        if (emu.peek(0x74) === 1)
          said.push(readTextAt(rom, 0x2c010 + (emu.peek(0x7a) | (emu.peek(0x7b) << 8)) - 0x8000));
        if (f % 30 === 0) emu.press('A', 2, 2);
        else emu.run(1);
        continue;
      }
      const s = boss();
      if (s >= 0) slot = s;
      else if (slot >= 0) gone = true;
      if (dying && s >= 0 && f === 600) [0x647, 0x65a, 0x66d].forEach((a, i) => emu.poke(a + s, dying[i]));
      emu.nes.buttonDown(1, f < 250 ? 7 : 1);
      if (f >= 250 && f % 16 >= 8) emu.nes.buttonUp(1, 1);
      if (f === 250) emu.nes.buttonUp(1, 7);
      // (bosses stand out of a straight shot: Ladd's bullets move onto it)
      if (s >= 0)
        for (const b of [1, 2, 3])
          if (emu.peek(0x536 + b) && emu.peek(0x549 + b) === 0)
            for (const a of [0x55c, 0x56f, 0x5a9]) emu.poke(a + b, emu.peek(a + s));
      emu.run(1);
    }
    return { said: [...new Set(said)], gone, alt, emu };
  };

  for (const [name, rooms, settings, dying] of [
    ['a commander ($6B)', [0x16, 0x17, 0x1c, 0x1e, 0x20], {}, undefined],
    // (the robot too, with its portrait: the longer talk shifts the fight, and Ladd ends up against the wall unable to land
    // the last hit; its death, state 2, 0E:$8287)
    ['a robot ($67)', [0x19, 0x1d, 0x1f], {}, [2, 0, 0]],
    ['a cyborg ($5A)', [0x1a, 0x1b], {}, undefined],
    // (the officer, Area 4's and 12's mustache, often stops taking the moved bullets at 1 HP: put into its death, state
    // 2.2, 0E:$8A5C)
    ["Area 4's officer ($03)", [0x18], {}, [2, 2, 0]],
    [
      "Area 12's officer ($03), with the boss-room lock (area12CommLock's own death end)",
      [0x21],
      { area12Comm: 'boss' },
      [2, 2, 0],
    ],
  ] as const) {
    it(`${name} falls, its reply shows, then it goes`, () => {
      const { rom, layout, room, reply } = seedWithReply([...rooms], settings);
      const { said, gone, alt, emu } = killBoss(rom, layout, room, dying ? [...dying] : undefined);
      expect(gone, `the boss went (room $${room.toString(16)})`).toBe(true);
      expect(alt).toBe(true);
      expect(said.at(-1)!.replace(/\s+/g, ''), said.join(' | ')).toBe(reply.replace(/\s+/g, ''));
      if ('area12Comm' in settings) expect(emu.peek(BOSS_21), "the lock's flag").toBe(0x21);
    }, 300_000);
  }

  it("not the escape's cyborg (Area 12, room $61: the same object type, put straight into its death)", () => {
    const emu = new Emu(seedWithReply([0x1a, 0x1b]).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    emu.poke(0x4d, 12);
    emu.poke(0x4c, 0x61);
    emu.poke(0x4be, 0);
    emu.poke(0x536, 0x81);
    emu.poke(0x65a, 0x11);
    emu.poke(0x66d, 0);
    emu.run(300);
    const slot = Array.from({ length: 16 }, (_, i) => i + 3).find(
      (s) => emu.peek(0x536 + s) && emu.peek(0x549 + s) === 0x5a,
    )!;
    expect(slot).toBeDefined();
    emu.poke(0x647 + slot, 2);
    emu.poke(0x65a + slot, 0); // dying (0E:$B8BB, ending at the hooked $B900)
    let alt = false;
    for (let f = 0; f < 1200 && emu.peek(0x536 + slot); f++) {
      emu.poke(0x779, 8);
      alt ||= emu.peek(0xcc) === 4 && emu.peek(0x8f) === ALT_Y;
      if (emu.peek(0xcc) === 4 && f % 30 === 0) emu.press('A', 2, 2);
      else emu.run(1); // (the escape's own talk)
    }
    expect(emu.peek(0x536 + slot), 'the cyborg went').toBe(0);
    expect(alt, 'no reply').toBe(false);
  });
});

describe.skipIf(!HAVE_ROM)('the message printer in the emulator', () => {
  it("skips a run of spaces to its last cell, but not a single space, the message's last cell or the page's (64-cell pages, the radio's 96)", () => {
    const rom = generate(loadRom(), seedCode(1)).rom;
    const call = 0x10 + 0x0f * 0x4000 + 0x458;
    expect(rom[call]).toBe(0x20); // JSR hook
    const hook = rom[call + 1] | (rom[call + 2] << 8);
    const emu = new Emu(rom);
    emu.run(5);
    // a message's bytes (header, length, then cells): "AB C     D  " and, at cell 58, a run past the page's end (cell 63)
    const text = [
      0x03,
      70,
      0x16,
      0x18,
      0,
      0x1a,
      0,
      0,
      0,
      0,
      0,
      0x1c,
      0,
      0,
      ...new Array(46).fill(0x16),
      ...new Array(12).fill(0),
    ];
    text.forEach((b, i) => emu.poke(0x600 + i, b));
    const fetch = (y: number, style = 0) => {
      emu.poke(0x7a, 0x00);
      emu.poke(0x7b, 0x06);
      emu.poke(0x79, y);
      emu.poke(0x78, text.length - y);
      emu.poke(0x75, style);
      emu.poke(0x7c, 0x00);
      emu.poke(0x7d, 0x1c);
      const { a } = emu.callSub(0x0b, hook);
      return [a, emu.peek(0x79), emu.peek(0x78), emu.peek(0x7c) | (emu.peek(0x7d) << 8)];
    };
    expect(fetch(3)).toEqual([0x18, 3, 69, 0x1c00]); // a letter
    expect(fetch(4)).toEqual([0, 4, 68, 0x1c00]); // a single space
    expect(fetch(6)).toEqual([0, 10, 62, 0x1c40]); // a run: on to its last space
    expect(fetch(6, 1)).toEqual([0, 10, 62, 0x1c40]); // ... in the radio box (style 1) too
    expect(fetch(6, 3)).toEqual([0, 6, 66, 0x1c00]); // ... not in style 3 (other page sizes)
    expect(fetch(12)).toEqual([0, 13, 59, 0x1c10]); // ... up to the run's last cell
    expect(fetch(60)).toEqual([0, 65, 7, 0x1c50]); // ... or the page's last cell (cell 63: byte 65)
    expect(fetch(66)).toEqual([0, 71, 1, 0x1c50]); // ... or the message's
    // the radio's 96-cell pages: a run from cell 90 stops at the page's last cell (cell 95: byte 97), not at byte 65
    text.splice(0, text.length, 0x46, 120, ...new Array(90).fill(0x16), ...new Array(30).fill(0));
    text.forEach((b, i) => emu.poke(0x600 + i, b));
    expect(fetch(92, 1)).toEqual([0, 97, 25, 0x1c50]);
    expect(fetch(60 + 2, 1)[0]).toBe(0x16); // (a letter)
  });
});

describe.skipIf(!HAVE_ROM)('the final scene in the emulator', () => {
  it("each ending's lines play in order with their speakers' portraits: Killt's up to his death, Master-D's, the cockpit's", () => {
    const seen = new Set<string>();
    for (let n = 1n; seen.size < 3 && n < 60n; n++) {
      const { rom, spoiler } = generate(loadRom(), seedCode(Number(n)));
      const NAME: Record<string, string> = { killt: 'KILLT', masterD: 'MASTER-D', ladd: 'LADD', hal: 'HAL' };
      const show = (said: Said[]) => said.map((l) => `${NAME[l.speaker!]}: ${l.text}`);
      const lines = show(spoiler.dialogue!.scenes.ending!),
        cockpit = show(spoiler.dialogue!.scenes.cockpit!),
        ending = lines.join('\n\n');
      const first = lines[0];
      if (seen.has(first)) continue;
      seen.add(first);
      const emu = new Emu(rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      const said: string[] = [];
      const said5: string[] = [];
      for (const script of [8, 9, 5]) {
        emu.poke(0x88, script);
        emu.poke(0xcc, 4);
        emu.poke(0xcd, 0);
        emu.poke(0xce, script === 5 ? 1 : 0); // talk (script 5: past its setup)
        let step = script === 5 ? 1 : 0;
        const out = script === 5 ? said5 : said;
        for (let f = 0; f < 4000 && emu.peek(0xcc) === 4 && out.length < (script === 5 ? cockpit.length : 99); f++) {
          emu.run(1);
          if (emu.peek(0xce) > step) {
            // (a new line; $CE drops back to 0 when the talk mode ends)
            step = emu.peek(0xce);
            const at = 0x2c010 + (emu.peek(0x7a) | (emu.peek(0x7b) << 8)) - 0x8000;
            out.push(
              `${({ 0x0a: 'KILLT', 0x0e: 'MASTER-D', 0x03: 'LADD', 0x06: 'HAL' } as Record<number, string>)[rom[at]]}: ${readTextAt(rom, at)}`,
            );
          }
          if (f % 60 === 30) emu.press('A', 2, 0);
        }
      }
      const squash = (t: string) => t.replace(/\s+/g, ''); // (wrapping drops the spaces at line ends)
      expect(said.map(squash), ending).toEqual(lines.map(squash));
      expect(said5.map(squash), 'the cockpit').toEqual(cockpit.map(squash));
    }
    expect(seen.size, 'all three endings found').toBe(3);
  }, 300_000);
});

function readTextAt(rom: Uint8Array, at: number): string {
  const DEC: Record<number, string> = {
    0x00: ' ',
    0x01: 'F',
    0x02: '0',
    0x03: 'G',
    0x04: '1',
    0x05: 'H',
    0x06: '2',
    0x07: 'I',
    0x08: '3',
    0x09: 'J',
    0x0a: '4',
    0x0b: 'K',
    0x0c: '5',
    0x0d: 'L',
    0x0e: '6',
    0x0f: 'M',
    0x10: '7',
    0x11: 'N',
    0x12: '8',
    0x13: 'O',
    0x14: '9',
    0x15: 'P',
    0x16: 'A',
    0x17: 'Q',
    0x18: 'B',
    0x19: 'R',
    0x1a: 'C',
    0x1b: 'S',
    0x1c: 'D',
    0x1d: 'T',
    0x1e: 'E',
    0x1f: 'U',
    0x20: 'V',
    0x22: 'W',
    0x24: 'X',
    0x26: 'Y',
    0x28: 'Z',
    0x2a: ',',
    0x2c: "'",
    0x2e: '*',
    0x30: '.',
    0x32: '?',
    0x34: '!',
    0x3e: '-',
  };
  return [...rom.slice(at + 2, at + 2 + rom[at + 1])]
    .map((c) => DEC[c] ?? '?')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
