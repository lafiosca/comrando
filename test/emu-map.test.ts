import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { BOSS_21 } from '../src/core/patches/locks.ts';
import { encodeText, readMessage } from '../src/core/text.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf, layoutAt } from './spoil.ts';

// The map in the emulator: Area 12's entry and locks, the road gates, travel, and a new game's state.

describe.skipIf(!HAVE_ROM)('gameplay patches in the emulator: the map', () => {
  const ROAD_GATES = [
    { name: 'road 6->8', fn: 0xa5ce, node: 6, route: 6 },
    { name: 'road 8->10', fn: 0xa5e9, node: 8, route: 4 },
  ];

  it("Area 12 Door Locks: each mode's doors stay locked until their comm room or the boss opens them", () => {
    const rom = (area12Comm: string) => generate(loadRom(), seedCode(1, { area12Comm })).rom;
    const boot = (r: Uint8Array) => {
      const e = new Emu(r);
      expect(e.bootToFirstArea()).toBe(true);
      e.run(60);
      return e;
    };
    const enter = (e: Emu, room: number) => {
      e.poke(0x4d, 12);
      e.poke(0x4c, room);
      e.poke(0x4be, 0);
      e.poke(0x536, 0x81);
      e.poke(0x65a, 0x11);
      e.poke(0x66d, 0);
      e.run(300);
    };
    /** Door object `type` ($2A + door index): its state (1 open, 2 locked). */
    const door = (e: Emu, type: number) => {
      for (let s = 1; s < 19; s++) if (e.peek(0x536 + s) && e.peek(0x549 + s) === type) return e.peek(0x647 + s);
      return -1;
    };
    const C1 = 0x4c8,
      C2 = 0x4c9; // comm rooms $35, $36
    // [room, door type, what opens it] per mode: tower $5E door 1 = power 1; $5F door 1 = the boss room, door 2 = power 2
    const modes: Record<string, [number, number, number | undefined][]> = {
      none: [
        [0x5e, 0x2b, undefined],
        [0x5f, 0x2b, undefined],
        [0x5f, 0x2c, undefined],
      ],
      comms: [
        [0x5e, 0x2b, C1],
        [0x5f, 0x2b, undefined],
        [0x5f, 0x2c, C2],
      ],
      boss: [
        [0x5e, 0x2b, undefined],
        [0x5f, 0x2b, undefined],
        [0x5f, 0x2c, BOSS_21],
      ],
      both: [
        [0x5e, 0x2b, C1],
        [0x5f, 0x2b, C2],
        [0x5f, 0x2c, BOSS_21],
      ],
    };
    for (const [mode, doors] of Object.entries(modes)) {
      const r = rom(mode);
      for (const set of [false, true])
        for (const room of [0x5e, 0x5f]) {
          const e = boot(r);
          if (set) for (const f of [C1, C2, BOSS_21]) e.poke(f, 1);
          enter(e, room);
          for (const [rm, type, flag] of doors.filter(([rm]) => rm === room)) {
            const locked = flag !== undefined && !set;
            expect(
              door(e, type),
              `${mode}: room $${rm.toString(16)} door $${type.toString(16)}, flags ${set ? 'set' : 'clear'}`,
            ).toBe(locked ? 2 : 1);
            // the lock's sprite tiles ($C0-$C4, CHR record $58: the vanilla locked rooms' lock) are loaded, not junk
            if (locked)
              expect(Array.from({ length: 16 }, (_, i) => e.vram(0xc00 + i))).toEqual([...r.slice(0x21d30, 0x21d40)]);
          }
        }
    }
    // COMMUNICATE: each comm room sets its own flag, only with Area 12's comm
    const on = rom('comms');
    const comm12 = on[0x10 + 0xd * 0x4000 + 0xac83 - 0x8000 + 12];
    for (const [room, flag] of [
      [0x35, C1],
      [0x36, C2],
    ] as const) {
      for (const [comm, opens] of [
        [comm12, 1],
        [(comm12 + 1) & 3, 0],
      ] as const) {
        const e = boot(on);
        enter(e, room);
        e.poke(0x4df, comm);
        e.poke(0xcc, 5);
        e.poke(0xcd, 0);
        e.poke(0xce, 0); // COMMUNICATE
        for (let f = 0; f < 600; f++) {
          e.run(1);
          if (f % 60 === 59) e.press('A', 4, 4);
        }
        expect(e.peek(flag), `room $${room.toString(16)}, comm ${comm} (Area 12's: ${comm12})`).toBe(opens);
        expect(e.peek(flag ^ 1), 'not the other flag').toBe(0);
      }
    }
    // the boss room: walk in, take the talk, shoot until the officer falls
    const e = boot(rom('boss'));
    enter(e, 0x21);
    expect(e.peek(BOSS_21)).toBe(0);
    for (let f = 0; f < 4000 && !e.peek(BOSS_21); f++) {
      e.poke(0x779, 8);
      if (f % 40 === 0 && e.peek(0xcc) === 4) {
        e.press('A', 2, 2);
        continue;
      }
      if (f < 300) e.nes.buttonDown(1, 7);
      else e.nes.buttonUp(1, 7);
      if (f % 16 < 8) e.nes.buttonDown(1, 1);
      else e.nes.buttonUp(1, 1);
      e.run(1);
    }
    expect(e.peek(BOSS_21), 'the officer beaten').not.toBe(0);
  }, 600_000);

  it('road gate routines block with no progress in vanilla, never in the randomizer with the gate open', () => {
    const patched = generate(loadRom(), seedCode(1, { gate: 'open', flak: 'open' })).rom;
    for (const g of ROAD_GATES) {
      for (const [rom, blocked] of [
        [loadRom(), true],
        [patched, false],
      ] as const) {
        const emu = new Emu(rom);
        emu.poke(0x4d, g.node);
        emu.poke(0x49a, g.route);
        for (const flag of [0x4ed, 0x4f0, 0x4f1, 0x4e2, 0x4e3]) emu.poke(flag, 0);
        expect(emu.callSub(0x0d, g.fn).zero, `${g.name} ${blocked ? 'vanilla' : 'patched'}`).toBe(blocked);
      }
    }
  });

  it('the Area 12 condition routine requires every listed flag and preserves Y', () => {
    for (const [area12, flags] of [
      ['joe', [0x4f6]],
      ['joe+10+11', [0x4f6, 0x4f4, 0x4f5]],
      ['vanilla', [0x4f4, 0x4f5]],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { area12 })).rom);
      emu.poke(0x4d, 12);
      for (const f of [0x4f6, 0x4f4, 0x4f5]) emu.poke(f, 0);
      expect(emu.callSub(0x0d, 0x9c40)).toEqual({ a: 0, y: 12, zero: true });
      for (const f of flags.slice(0, -1)) emu.poke(f, 1);
      expect(emu.callSub(0x0d, 0x9c40).a).toBe(0); // still missing the last flag
      emu.poke(flags[flags.length - 1], 1);
      expect(emu.callSub(0x0d, 0x9c40)).toEqual({ a: 1, y: 12, zero: false });
    }
  });

  it('Area 12 can be entered with Joe rescued and not without (real map descent)', () => {
    const rom = generate(loadRom(), seedCode(1)).rom;
    for (const [pokes, enters] of [
      [[], false],
      [
        [
          [0x4f4, 1],
          [0x4f5, 1],
        ],
        false,
      ],
      [[[0x4f1, 1]], false],
      [[[0x4f6, 1]], true],
    ] as const) {
      const emu = new Emu(rom);
      expect(emu.bootToMapAtArea1()).toBe(true);
      emu.poke(0x4d, 12);
      for (const [a, v] of pokes) emu.poke(a, v);
      for (let i = 0; i < 6; i++) emu.press('A', 4, 40);
      expect(emu.peek(0x4c) === 0x0b && emu.peek(0xcc) === 2, JSON.stringify(pokes)).toBe(enters);
    }
  }, 120_000);

  it('the Area 12 refusal shows the new message', () => {
    const rom = generate(loadRom(), seedCode(1)).rom;
    const emu = new Emu(rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    emu.poke(0x4d, 12);
    const ptr = rom[0x2c010 + 4 + 2 * 113] | (rom[0x2c010 + 5 + 2 * 113] << 8); // message 115 ($E2), Area 12's own
    let shown = false;
    for (let i = 0; i < 12 && !shown; i++) {
      emu.press('A', 4, 30);
      shown = (emu.peek(0x7a) | (emu.peek(0x7b) << 8)) === ptr; // the printer's current message pointer
    }
    expect(shown).toBe(true);
    expect(readMessage(rom, 115)!.text).toMatch(/^WE CAN'T ATTACK AREA 12/);
    expect(readMessage(rom, 115)!.header).toBe(readMessage(loadRom(), 52)!.header); // the refusal box style
  }, 120_000);

  it('a refused Area 12 descent returns to the DESCEND/TRANSFER prompt (not transfer mode)', () => {
    const emu = new Emu(generate(loadRom(), seedCode(1)).rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    emu.poke(0x4d, 12);
    const states: number[] = [];
    for (let i = 0; i < 12; i++) {
      emu.press('A', 4, 60);
      states.push(emu.peek(0x491));
    }
    expect(states).not.toContain(3); // 3 = TRANSFER mode; vanilla lands there after the refusal
    expect(emu.peek(0xcc)).toBe(1); // still on the map
  }, 120_000);

  it('starting health sets rank, health and bullets at a new game', () => {
    for (const [health, rank, bullets] of [
      ['0', 0, [0, 0, 0]],
      ['4', 4, [0, 6, 0]],
      ['8', 8, [3, 0, 0]],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { health })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      expect(emu.peek(0x4ea), `health ${health} rank`).toBe(rank);
      expect(emu.peek(0x779), `health ${health} HP`).toBe(rank); // HP is filled to the rank on area entry
      expect(emu.ram(0x4e7, 3), `health ${health} bullets`).toEqual(bullets);
      expect([emu.peek(0x4cb), emu.peek(0x4e0)]).toEqual([1, 1]); // still has the gun and α
    }
  }, 120_000);

  it('truck encounters off: no trucks on the map, hidden-passage objects kept', () => {
    for (const [trucks, expected] of [
      ['on', [1, 1, 1, 1, 1]],
      ['off', [0, 0, 0, 0, 0]],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { trucks })).rom);
      expect(emu.bootToMapAtArea1()).toBe(true);
      expect(emu.ram(0x441, 5), `trucks ${trucks}`).toEqual(expected); // map object slots 1-5 = trucks
      expect(emu.ram(0x447, 2), 'passage objects').toEqual([1, 1]); // slots 7-8 = the two passage objects
      expect(emu.ram(0x450, 2)).toEqual([0x0f, 0x0f]); // their script id (overhead stage $15)
    }
  }, 120_000);

  it('continues: vanilla 0, a set count that is spent, or unlimited (9, never spent)', () => {
    for (const [continues, start] of [
      ['0', 0],
      ['3', 3],
      ['unlimited', 9],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { continues, health: '3' })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      expect(emu.ram(0x4f9, 2), `continues ${continues}`).toEqual([0, start]);
      if (continues === '0') continue;
      emu.poke(0x4ea, 6); // rank gained in play must survive continuing (not reset to the starting level)
      emu.run(2);
      emu.ram(0x4ca, 33).forEach((v, i) => emu.poke(0x100 + i, v)); // the game's area-entry inventory snapshot
      for (let round = 0; round < 2; round++) {
        emu.poke(0xcb, 0);
        emu.poke(0xcc, 1);
        emu.poke(0xcd, 0);
        emu.poke(0xce, 0); // game over (0F:$C725)
        emu.run(400);
        expect(emu.peek(0x73), 'CONTINUE offered and selected').toBe(1);
        emu.press('START', 4, 60);
        for (let i = 0; i < 100 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 3); i++)
          emu.press(i % 2 ? 'A' : 'START');
        expect([emu.peek(0xcb), emu.peek(0xcc)], 'back in play').toEqual([1, 3]);
        expect(emu.peek(0x4ea), 'rank kept').toBe(6);
        expect(emu.ram(0x4f9, 2)).toEqual([0, continues === 'unlimited' ? 9 : start - 1 - round]);
      }
    }
  }, 120_000);

  it('lives option sets the spare-life count for a new game and after a continue', () => {
    for (const [lives, spare] of [
      ['3', 2],
      ['1', 0],
      ['10', 9],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { lives, continues: '1' })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      expect(emu.peek(0x4a), `lives ${lives}`).toBe(spare);
      emu.poke(0x4a, 0);
      emu.poke(0xcb, 0);
      emu.poke(0xcc, 1);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0); // game over
      emu.run(400);
      emu.press('START', 4, 60);
      for (let i = 0; i < 100 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 3); i++) emu.press(i % 2 ? 'A' : 'START');
      expect(emu.peek(0x4a), `lives ${lives} after continue`).toBe(spare);
    }
  }, 120_000);

  it('the communicator page boxes the 4th comm even when the protector page came just before it', () => {
    const emu = new Emu(generate(loadRom(), seedCode(1)).rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    emu.poke(0x4d2, 1); // Pendant, no items: protector page (erases box 4), then comm page
    emu.poke(0x4e3, 1); // δ
    for (let i = 0; i < 100 && emu.peek(0xcc) !== 2; i++) emu.press('A', 4, 20);
    emu.run(120);
    for (let i = 0; i < 6 && emu.peek(0xcd) !== 4; i++) emu.press('A', 4, 60);
    expect(emu.peek(0xcd)).toBe(4); // comm page
    expect([0x21a4, 0x21a9, 0x2244, 0x2249].map((a) => emu.vram(a))).toEqual([0x1a, 0x1e, 0x1d, 0x1f]); // box 4's corners
  }, 60_000);

  it('NZ17 offers the road to 14 only once the underground passage is found', () => {
    for (const found of [0, 1]) {
      for (const zones of ['vanilla', 'shuffled']) {
        const emu = new Emu(generate(loadRom(), seedCode(1, { zones })).rom);
        expect(emu.bootToFirstArea()).toBe(true);
        const id = layoutAt(generate(loadRom(), seedCode(1, { zones })).spoiler, 17);
        emu.poke(0x4d, Number(id)); // return to the map at map number 17 via the clear sequence
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
        emu.poke(0x464, 0x98); // helicopter onto map number 17
        emu.poke(0x4f7, found);
        emu.poke(0x491, 0);
        for (let i = 0; i < 200 && emu.peek(0x491) !== 2; i++) emu.press('A', 4, 10);
        emu.run(200);
        emu.press('RIGHT', 4, 30);
        for (let i = 0; i < 100 && emu.peek(0x491) !== 3; i++) emu.press('A', 4, 10);
        emu.run(60);
        const seen = new Set<number>();
        for (let i = 0; i < 4; i++) {
          seen.add(emu.peek(0x49a));
          emu.press('RIGHT', 4, 40);
        }
        expect([...seen].sort(), `passage ${found ? 'found' : 'not found'}, zones ${zones}`).toEqual(
          found ? [2, 4] : [2],
        );
      }
    }
  }, 240_000);

  it('6<->8 gate: both directions refused without the requirements, open with them', () => {
    for (const [gate, flags, line] of [
      ['vanilla', [0x4ed, 0x4f0, 0x4e2], "YOU DON'T HAVE  ENOUGH POWER."], // vanilla text kept
      ['iff', [0x4f8], 'IFF CODE'],
    ] as const) {
      const { rom } = generate(loadRom(), seedCode(1, { gate })); // map numbers = layouts
      expect(readMessage(rom, 52)!.text, gate).toContain(line);
      const blocked = (node: number, route: number, have: readonly number[]) => {
        const emu = new Emu(rom);
        emu.poke(0x4d, node);
        emu.poke(0x49a, route);
        for (const f of [0x4ed, 0x4f0, 0x4e2, 0x4f8]) emu.poke(f, have.includes(f) ? 1 : 0);
        return emu.callSub(0x0d, 0xa5ce).zero;
      };
      for (const [node, route] of [
        [6, 6],
        [8, 10],
      ]) {
        expect(blocked(node, route, []), `${gate}: ${node} road ${route}, nothing`).toBe(true);
        expect(blocked(node, route, flags.slice(1)), `${gate}: ${node} road ${route}, one missing`).toBe(true);
        expect(blocked(node, route, flags), `${gate}: ${node} road ${route}, all`).toBe(false);
      }
      expect(blocked(6, 4, []), 'other roads from 6 stay open').toBe(false);
      expect(blocked(8, 2, []), 'other roads from 8 stay open').toBe(false);
    }
  });

  it('8<->10 gate (Flak Map): both directions refused without it, with its own message; other roads open', () => {
    for (const gate of ['iff', 'open']) {
      const { rom } = generate(loadRom(), seedCode(1, { gate })); // map numbers = layouts
      expect(readMessage(rom, 114)!.text.replace(/ +/g, ' ')).toBe('WE NEED A FLAK MAP TO FLY BETWEEN AREAS 8 AND 10.');
      const run = (node: number, route: number, flak: boolean) => {
        const emu = new Emu(rom);
        emu.poke(0x4d, node);
        emu.poke(0x49a, route);
        emu.poke(0x1d3, flak ? 1 : 0);
        for (const f of [0x4ed, 0x4f0, 0x4e2, 0x4f8]) emu.poke(f, 1); // the 6<->8 gate is passed
        const nes = emu.nes as unknown as { cpu: { REG_Y: number } };
        nes.cpu.REG_Y = 0x64;
        const first = emu.callSub(0x0d, 0xa5ce),
          second = emu.callSub(0x0d, 0xa5e9);
        return { blocked: first.zero || second.zero, y: second.y };
      };
      for (const [node, route] of [
        [8, 4],
        [10, 6],
      ]) {
        expect(run(node, route, false), `${gate}: ${node} road ${route}, no map`).toEqual({ blocked: true, y: 0xe0 });
        expect(run(node, route, true).blocked, `${gate}: ${node} road ${route}, map`).toBe(false);
      }
      for (const [node, route] of [
        [8, 2],
        [8, 6],
        [10, 2],
        [10, 4],
        [6, 4],
      ]) {
        expect(run(node, route, false).blocked, `${gate}: ${node} road ${route} stays open`).toBe(false);
      }
    }
  });

  it('8<->10 gate (vanilla): needs δ and map 7 cleared, both directions, with its own message', () => {
    const { rom } = generate(loadRom(), seedCode(1, { gate: 'open', flak: 'vanilla' })); // map numbers = layouts
    expect(
      readMessage(rom, 114)!
        .text.replace(/ +/g, ' ')
        .replace(/(\d)(AND|DESTROYED)/g, '$1 $2'),
    ).toContain('WE NEED δ AND AREA 7');
    const DELTA = 0x4e3,
      AREA7 = 0x4f1;
    const run = (node: number, route: number, have: number[]) => {
      const emu = new Emu(rom);
      emu.poke(0x4d, node);
      emu.poke(0x49a, route);
      emu.poke(0x1d3, 1); // (a Flak Map flag means nothing here)
      for (const f of [DELTA, AREA7]) emu.poke(f, have.includes(f) ? 1 : 0);
      const r = emu.callSub(0x0d, 0xa5e9);
      return { blocked: r.zero, y: r.y };
    };
    for (const [node, route] of [
      [8, 4],
      [10, 6],
    ]) {
      for (const have of [[], [DELTA], [AREA7]])
        expect(run(node, route, have), `${node} road ${route}, ${have}`).toEqual({ blocked: true, y: 0xe0 });
      expect(run(node, route, [DELTA, AREA7]).blocked, `${node} road ${route}, both`).toBe(false);
    }
    expect(run(8, 2, []).blocked, 'other roads stay open').toBe(false);
  });

  it('the Flak Map: an area clear sets $01D3 (not $04E4) and names it; a new game clears it, a continue keeps it', () => {
    let n = 1;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed puts the Flak Map at Area 8');
      gen = generate(loadRom(), seedCode(n, { pickups: 'shuffled' }));
      if (clearOf(gen.spoiler, 8) === 'flak') break; // (only placed beyond the 6<->8 crossing)
    }
    const emu = new Emu(gen.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    expect(emu.peek(0x1d3)).toBe(0);
    emu.poke(0x4e4, 0);
    emu.poke(0x4d, 8);
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0); // the game's clear sequence
    let named = false;
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      if (emu.ram(0x132, 8).join(',') === [...encodeText('FLAK MAP')].join(',')) named = true;
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    expect(named, 'name copied for "WE\'VE OBTAINED"').toBe(true);
    expect(emu.peek(0x1d3)).toBe(1);
    expect(emu.peek(0x4e4), 'the comm slot it nominally uses').toBe(0);
  }, 120_000);

  it('the Flak Map pickup in NZ19 B sets $01D3', () => {
    const { rom } = generate(loadRom(), seedCode(1, { pickups: 'vanilla' })); // stays in NZ19 B
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(0x1d3, 0);
    emu.poke(0x4e4, 0);
    const slot = emu.enterRoom(0x44, 19);
    expect(slot).toBeGreaterThanOrEqual(0);
    emu.touch(slot);
    expect(emu.peek(0x1d3)).toBe(1);
    expect(emu.peek(0x4e4)).toBe(0);
  }, 120_000);

  it('the IFF Code: an area clear grants it ($04F8) and the clear screen names it', () => {
    let n = 1;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed puts the IFF Code at Area 1');
      gen = generate(loadRom(), seedCode(n));
      if (clearOf(gen.spoiler, 1) === 'iff') break;
    }
    const emu = new Emu(gen.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    expect(emu.peek(0x4f8)).toBe(0);
    emu.poke(0xcb, 2);
    emu.poke(0xcc, 0);
    emu.poke(0xcd, 0);
    emu.poke(0xce, 0); // the game's clear sequence
    let named = false;
    for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
      emu.run(40);
      const buf = emu.ram(0x132, 8);
      if (buf.join(',') === [...encodeText('IFF CODE')].join(',')) named = true;
      if (emu.peek(0x74)) emu.press('A', 4, 4);
    }
    expect(named, 'name copied for "WE\'VE OBTAINED"').toBe(true);
    expect(emu.peek(0x4f8)).toBe(1);
  }, 120_000);

  it('the gate keeps Y (the refusal message id) for its caller', () => {
    const emu = new Emu(generate(loadRom(), seedCode(1)).rom);
    emu.poke(0x4d, 6);
    emu.poke(0x49a, 6);
    for (const f of [0x4ed, 0x4f0, 0x4e2, 0x4f8]) emu.poke(f, 0); // power-on RAM reads $FF // power-on RAM reads $FF
    const nes = emu.nes as unknown as { cpu: { REG_Y: number } };
    nes.cpu.REG_Y = 0x64;
    expect(emu.callSub(0x0d, 0xa5ce)).toMatchObject({ y: 0x64, zero: true });
  });

  it('with the gate, choosing 6->8 without the requirements shows the message and the helicopter stays', () => {
    const rom = generate(loadRom(), seedCode(1)).rom;
    const emu = new Emu(rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    for (const f of [0x4ed, 0x4f0, 0x4e2, 0x4f8]) emu.poke(f, 0);
    emu.poke(0x4d, 6);
    emu.poke(0x491, 0);
    emu.poke(0x452, 104);
    emu.poke(0x464, 152);
    for (let i = 0; i < 200 && emu.peek(0x491) !== 2; i++) emu.press('A', 4, 10);
    emu.run(200);
    emu.press('RIGHT', 4, 30);
    for (let i = 0; i < 100 && emu.peek(0x491) !== 3; i++) emu.press('A', 4, 10);
    emu.run(60);
    const ptr = rom[0x2c010 + 4 + 2 * 50] | (rom[0x2c010 + 5 + 2 * 50] << 8); // message 52 ($64)
    let shown = false;
    for (let i = 0; i < 10 && !shown; i++) {
      emu.press('RIGHT', 4, 40);
      const p = emu.peek(0x7a) | (emu.peek(0x7b) << 8);
      shown = p >= ptr && p < ptr + 260;
    }
    expect(shown, 'refusal message printed when the road to 8 is selected').toBe(true);
    for (let i = 0; i < 20 && emu.peek(0x74); i++) emu.press('A', 2, 8);
    emu.press('A', 4, 10);
    emu.run(600);
    expect(emu.peek(0x4d)).toBe(6);
  }, 120_000);

  it('double map speed: the helicopter covers twice the distance per frame and still lands; the trucks keep their speed', () => {
    /** Start flying map 1's road to 4; returns once the helicopter starts moving (after the departure text). */
    const takeOff = (emu: Emu) => {
      expect(emu.bootToMapAtArea1()).toBe(true);
      emu.poke(0x491, 0);
      for (let i = 0; i < 200 && emu.peek(0x491) !== 2; i++) emu.press('A', 4, 10);
      emu.run(200);
      emu.press('RIGHT', 4, 30);
      for (let i = 0; i < 100 && emu.peek(0x491) !== 3; i++) emu.press('A', 4, 10);
      emu.run(60);
      for (let i = 0; i < 10 && emu.peek(0x49a) !== 4; i++) emu.press('RIGHT', 4, 40);
      for (let i = 0; i < 20 && emu.peek(0x74); i++) emu.press('A', 2, 8);
      emu.press('A', 1, 0);
      const start = emu.peek(0x452) + emu.peek(0x464);
      for (let i = 0; emu.peek(0x452) + emu.peek(0x464) === start && i < 300; i++) emu.run(1);
    };
    /** Distance moved by objects `slots` (x + y) over `frames` frames. */
    const moved = (emu: Emu, slots: number[], frames: number) => {
      const pos = () => slots.map((x) => [emu.peek(0x452 + x), emu.peek(0x464 + x)]);
      const p0 = pos();
      emu.run(frames);
      return pos().reduce((sum, [x, y], i) => sum + Math.abs(x - p0[i][0]) + Math.abs(y - p0[i][1]), 0);
    };
    const run = (mapSpeed: string) => {
      // trucks move while the helicopter flies (slots 1-5); measure early in a flight, before any interception
      const t = new Emu(generate(loadRom(), seedCode(1, { mapSpeed, gate: 'open', trucks: 'on' })).rom);
      takeOff(t);
      const truck = moved(t, [1, 2, 3, 4, 5], 20);
      // helicopter, trucks off so no convoy interrupts the flight: distance in 60 frames, then it must still land
      const emu = new Emu(generate(loadRom(), seedCode(1, { mapSpeed, gate: 'open', trucks: 'off' })).rom);
      takeOff(emu);
      const heli = moved(emu, [0], 60);
      let frames = 0;
      while (emu.peek(0x4d) !== 4 && frames < 3000) {
        emu.run(1);
        frames++;
      }
      return { heli, frames, truck };
    };
    const normal = run('1'),
      fast = run('2');
    expect(normal.frames, 'normal flight lands').toBeLessThan(3000);
    expect(fast.frames, 'fast flight lands').toBeLessThan(normal.frames);
    expect(normal.heli).toBeGreaterThan(0);
    expect(fast.heli / normal.heli).toBeGreaterThan(1.8);
    expect(fast.heli / normal.heli).toBeLessThan(2.2);
    expect(normal.truck).toBeGreaterThan(0);
    expect(fast.truck / normal.truck, 'trucks at the vanilla speed').toBeGreaterThan(0.9); // (±1 px: where the window starts)
    expect(fast.truck / normal.truck).toBeLessThan(1.1);
    // after an encounter the object sleeps for N frames of flight: halved at double speed, so the same distance
    for (const [mapSpeed, frames] of [
      ['1', 0x7e],
      ['2', 0x3f],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { mapSpeed })).rom);
      emu.poke(0x4a3, 7); // the encountered object: hidden-passage slot 7
      emu.callSub(0x0d, 0xa6b1); // the encounter starts
      expect([emu.peek(0x4a3 + 7), emu.peek(0x440 + 7)], `map speed ${mapSpeed}`).toEqual([frames, 0x81]);
    }
  }, 120_000);

  it('road 6->8 can be flown with no progress when the gate is open', () => {
    const emu = new Emu(generate(loadRom(), seedCode(1, { gate: 'open' })).rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    // put the helicopter on node 6 (number and screen position), open its route list and pick the road to 8
    emu.poke(0x4d, 6);
    emu.poke(0x491, 0);
    emu.poke(0x452, 104);
    emu.poke(0x464, 152);
    for (let i = 0; i < 200 && emu.peek(0x491) !== 2; i++) emu.press('A', 4, 10);
    emu.run(200);
    emu.press('RIGHT', 4, 30);
    for (let i = 0; i < 100 && emu.peek(0x491) !== 3; i++) emu.press('A', 4, 10);
    emu.run(60);
    for (let i = 0; i < 10 && emu.peek(0x49a) !== 6; i++) emu.press('RIGHT', 4, 40);
    for (let i = 0; i < 20 && emu.peek(0x74); i++) emu.press('A', 2, 8);
    emu.press('A', 4, 10);
    emu.run(600);
    expect(emu.peek(0x4d)).toBe(8);
  }, 120_000);
});
