import { assemble } from '../asm.ts';
import { expect } from './rom.ts';

// Darkness: pitch-black dark areas, and darkness in more layouts.

/**
 * True dark: the Area 4 layout's darkness goes pitch black. The darkness object (0E:$B2FD, docs/rom-notes.md#darkness)
 * dims the palettes listed at 0E:$B368 (`04 08 18 1C FF`: BG 1-2 and sprite 2-3, the enemies) one step
 * ($10) every 8 frames down to black, then sets one color of BG 1 and 2 ($D6, $DA) to dark blue $0C, which outlines the
 * whole level; BG 0 and 3 (sky, trees) stay lit. Here the list (moved to free 0E:$BF20) adds BG 0 and 3, and the dark
 * blue becomes black: only Ladd (sprite palettes 0-1) shows. The Flare's light (reloading the room palette) is as before.
 */
export function trueDark(rom: Uint8Array) {
  const LOAD = 0x3b343; // 0E:$B333 LDA $B368,Y
  const TABLE = 0x3bf30; // 0E:$BF20 (zero fill)
  const BLUE = 0x3b36c; // 0E:$B35C LDA #$0C / STA $D6 / STA $DA
  expect(rom, LOAD, [0xb9, 0x68, 0xb3], 'darkness palette list');
  expect(rom, BLUE, [0xa9, 0x0c, 0x85, 0xd6, 0x85, 0xda], 'darkness outline color');
  expect(rom, TABLE, new Array(8).fill(0x00), 'free space 0E:$BF20');
  rom.set([0x00, 0x04, 0x08, 0x0c, 0x18, 0x1c, 0xff], TABLE);
  rom.set([0x20, 0xbf], LOAD + 1);
  rom[BLUE + 1] = 0x0f;
}

/** Layouts option "Dark Areas: More" can darken: indoors throughout. */
export const EXTRA_DARK_LAYOUTS = [9, 11] as const;

/**
 * More dark areas: the darkness object (type $80, docs/rom-notes.md#darkness) runs in the level rooms of
 * `layouts` (from EXTRA_DARK_LAYOUTS) too, as in O4: lit at the start, dark once the screen scrolls past $170, and the
 * Flare works there.
 * - The object lists can't take it: they load into slots 11-18 then 8-10 (03:$AC10), 11 at most, and O11's is full
 *   (O9's three $81s, deleted on their first frame, keep slots 11-13 free for its spawns). So the loader's entry
 *   (03:$AC00 `JSR $AC10`) calls a helper in free 03:$AA20 that loads the list and then, in these levels, puts the
 *   darkness in slot 7, set up as the loader would. The object loop (0E:$8000) deletes objects in slots 6-7 once
 *   off screen (0F:$DC80: x or y high byte set), so it sits on screen at 0,0 and doesn't follow the scroll (`$06A6`
 *   bit 2, 0F:$DC90); at x 0 it counts as invisible (0F:$DF87), and it draws nothing anyway. Slots 6-7 are a pool the
 *   game fills only through 0F:$DE04, which takes free slots (`$0536` = 0), so it just has one slot fewer there
 *   (slot 7 never held anything in a playtest of O4, O9 and O11).
 * - The Flare (0D:$BA70 `LDA $4C / CMP #$03 / BNE`) asks a helper in free 0D:$BFE9 (in bank 0D past the ending's
 *   hop, whose $BFE9 is bank 0B's): Z set in O4 and the added layouts' level rooms (layout - 1).
 */
export function darkAreas(rom: Uint8Array, layouts: readonly number[]) {
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  for (const l of layouts) if (!(EXTRA_DARK_LAYOUTS as readonly number[]).includes(l)) throw new Error(`dark areas: layout ${l} can't be dark`);
  const ENTRY = off(0x03, 0xac00), LOADER = 0xaa20, LOADER_END = 0xab00; // 03 free (zero fill; the comm-lock lists from $AB00)
  const FLARE = off(0x0d, 0xba70), HELPER = 0xbfe9;
  const rooms = layouts.map((l) => l - 1);
  expect(rom, ENTRY, [0x20, 0x10, 0xac], 'object list loader call');
  expect(rom, FLARE, [0xa5, 0x4c, 0xc9, 0x03, 0xd0, 0xf4], 'Flare level check');
  const SLOT = 7;
  const loader = assemble(LOADER, [
    0x20, 0x10, 0xac, //                     JSR $AC10 (the object list)
    0xa5, 0x4c, //                           LDA $4C (level room)
    ...rooms.flatMap((r) => [0xc9, r, { rel: 0xf0, to: 'dark' }]), // CMP #room / BEQ dark
    0x60,
    { label: 'dark' }, 0xa2, SLOT, //        LDX #7
    0xa9, 0x80, 0x9d, 0x49, 0x05, //         LDA #$80 / STA $0549,X (the darkness)
    0xa9, 0x01, 0x9d, 0x36, 0x05, //         LDA #1 / STA $0536,X (active)
    0xa9, 0x00, //                           LDA #0: on screen at 0,0 (x, y), and as the loader
    ...[0x056f, 0x055c, 0x05a9, 0x0596, 0x0583, 0x05bd, 0x0647, 0x065a, 0x066d].flatMap((a) => [0x9d, a & 0xff, a >> 8]),
    0xa9, 0x04, 0x9d, 0xa6, 0x06, //         LDA #4 / STA $06A6,X (stays put on screen)
    0x60,
  ]);
  if (LOADER + loader.length > LOADER_END) throw new Error('dark areas: loader helper too big');
  expect(rom, off(0x03, LOADER), new Array(loader.length).fill(0x00), 'free space 03:$AA20');
  rom.set(loader, off(0x03, LOADER));
  rom.set([0x20, LOADER & 0xff, LOADER >> 8], ENTRY);

  // the Flare: LDA $4C / CMP #3 / BEQ r / CMP #room ... / r: RTS (Z: a dark level)
  const ids = [3, ...rooms];
  const helper: number[] = [0xa5, 0x4c];
  ids.forEach((id, i) => helper.push(0xc9, id, ...(i < ids.length - 1 ? [0xf0, 4 * (ids.length - 1 - i) - 2] : [])));
  helper.push(0x60);
  expect(rom, off(0x0d, HELPER), new Array(helper.length).fill(0x00), 'free space 0D:$BFE9');
  rom.set(helper, off(0x0d, HELPER));
  rom.set([0x20, HELPER & 0xff, HELPER >> 8, 0xd0, 0xf5, 0xea], FLARE); // JSR helper / BNE (RTS at $BA6A) / NOP
}
