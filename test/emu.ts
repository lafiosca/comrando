// Minimal headless jsnes wrapper for ROM-level tests.
import { NES } from 'jsnes';
import { makeSeedCode } from '../src/core/settings.ts';

// jsnes's typings omit the internals we read in tests.
interface NesInternals {
  cpu: {
    mem: number[];
    REG_PC: number;
    REG_ACC: number;
    REG_Y: number;
    F_ZERO: number;
    irqRequested: boolean;
    nmiRaised: boolean;
    nmiPending: boolean;
    nmiImmediate: boolean;
    push(v: number): void;
    emulate(): number;
  };
  ppu: { vramMem: number[] };
  mmap: { loadRomBank(bank: number, address: number): void };
}

const BUTTONS = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 } as const;
type Button = keyof typeof BUTTONS;

export class Emu {
  readonly nes: NES;
  frame = 0;

  constructor(rom: Uint8Array) {
    this.nes = new NES({ onFrame: () => {}, onAudioSample: () => {}, emulateSound: false });
    let bin = '';
    for (const b of rom) bin += String.fromCharCode(b);
    this.nes.loadROM(bin);
  }
  run(frames = 1) {
    for (let i = 0; i < frames; i++, this.frame++) this.nes.frame();
  }
  press(button: Button, hold = 3, after = 27) {
    this.nes.buttonDown(1, BUTTONS[button]);
    this.run(hold);
    this.nes.buttonUp(1, BUTTONS[button]);
    this.run(after);
  }
  poke(addr: number, value: number) {
    (this.nes as unknown as NesInternals).cpu.mem[addr] = value & 0xff;
  }
  ram(addr: number, n: number): number[] {
    return Array.from({ length: n }, (_, i) => this.peek(addr + i));
  }
  peek(addr: number): number {
    return (this.nes as unknown as NesInternals).cpu.mem[addr];
  }
  /** PPU VRAM byte (pattern tables $0000-$1FFF, nametables $2000+). */
  vram(addr: number): number {
    return (this.nes as unknown as NesInternals).ppu.vramMem[addr];
  }
  /** PPU palette RAM byte ($3F00-$3F1F). */
  paletteByte(i: number): number {
    return (this.nes as unknown as NesInternals).ppu.vramMem[0x3f00 + i];
  }
  /**
   * Call a ROM subroutine directly: map `bank` at $8000, run from `addr` until it returns, and report A, Y and the
   * zero flag. Only for side-effect-free helpers (gate checks); nothing else runs meanwhile.
   */
  callSub(bank: number, addr: number, maxSteps = 10000): { a: number; y: number; zero: boolean } {
    const nes = this.nes as unknown as NesInternals;
    const cpu = nes.cpu;
    nes.mmap.loadRomBank(bank, 0x8000);
    const SENTINEL = 0xfff0;
    cpu.push(((SENTINEL - 1) >> 8) & 0xff); // RTS returns to (pulled address + 1)
    cpu.push((SENTINEL - 1) & 0xff);
    cpu.REG_PC = addr - 1; // jsnes keeps PC as address - 1
    const quiet = () => {
      cpu.irqRequested = false;
      cpu.nmiRaised = false;
      cpu.nmiPending = false;
      cpu.nmiImmediate = false;
    };
    for (let i = 0; cpu.REG_PC + 1 !== SENTINEL; i++) {
      if (i >= maxSteps) throw new Error(`callSub $${addr.toString(16)}: did not return`);
      quiet(); // no reset/NMI/IRQ may interrupt the routine under test
      cpu.emulate();
    }
    return { a: cpu.REG_ACC, y: cpu.REG_Y, zero: cpu.F_ZERO === 0 };
  }
  /**
   * Mash through the title and intro until the map is up, then fly to map number 1 and land (map menu ready).
   * `identity` is the layout expected there (differs from 1 under the area layout shuffle).
   */
  bootToMapAtArea1(identity = 1): boolean {
    for (let i = 0; i < 200 && !(this.peek(0xcb) === 1 && this.peek(0xcc) === 1); i++)
      this.press(i % 2 ? 'A' : 'START');
    if (!(this.peek(0xcb) === 1 && this.peek(0xcc) === 1)) return false;
    this.run(400);
    this.press('A', 4, 4);
    this.run(300);
    return this.peek(0x4d) === identity;
  }
  /**
   * From inside a level, jump into building `room` as if through a door (map node `node` for zone-keyed logic) and
   * let it load. Returns the object slot of the item pickup ($79), or -1.
   */
  enterRoom(room: number, node: number): number {
    this.poke(0x4d, node);
    this.poke(0x4c, room);
    this.poke(0x4be, 0);
    this.poke(0x536, 0x81);
    this.poke(0x65a, 0x11);
    this.poke(0x66d, 0);
    this.run(300);
    return this.ram(0x549, 19).indexOf(0x79);
  }
  /** Walk the player onto object `slot` (teleport) for a few frames. */
  touch(slot: number) {
    for (let f = 0; f < 30; f++) {
      this.poke(0x56f, this.peek(0x56f + slot));
      this.poke(0x5a9, this.peek(0x5a9 + slot));
      this.run(1);
    }
    this.run(60);
  }
  /** Mash through title, intro and map until the first area is playing ($CB=1, $CC=3). */
  bootToFirstArea(maxPresses = 200): boolean {
    for (let i = 0; i < maxPresses; i++) {
      this.press(i % 2 ? 'A' : 'START');
      if (this.peek(0xcb) === 1 && this.peek(0xcc) === 3 && this.peek(0xcd) >= 2) return true;
    }
    return false;
  }
}

/** A seed code for the emulator tests: vanilla areas (map numbers = layouts) and normal map speed (input timings assume
 * it), with `settings` on top. */
export const seedCode = (n: number, settings = {}) =>
  makeSeedCode({ areas: 'vanilla', mapSpeed: '1', ...settings }, BigInt(n));
