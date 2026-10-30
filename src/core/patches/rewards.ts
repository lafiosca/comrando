import { type Item, ITEMS } from '../world.ts';
import { expect } from './rom.ts';

// Area-clear rewards and the equipment screen.

/** Area-clear reward item table, 0A:$B16E + node (offset from $04CA; 0 = 1UP). Node 0's byte is code, never touched. */
const CLEAR_ITEM_TABLE = 0x2b17e;
/** Area-clear reward text table, 0A:$B17A + node (offset of the name from 0A:$B17B; 0 = no text). */
const CLEAR_TEXT_TABLE = 0x2b18a;
const VANILLA_CLEAR_ITEMS = [0x10, 0x08, 0x13, 0x03, 0x02, 0x11, 0x00, 0x12, 0x05, 0x00, 0x0a]; // nodes 1-11
const VANILLA_CLEAR_TEXT = [0x7b, 0x0c, 0x30, 0x14, 0x20, 0x74, 0x0c, 0x69, 0x47, 0x91, 0x4d];

/**
 * Set the item (and its "WE'VE OBTAINED …" name) granted by clearing area `node` (1-11). Area 7's slot is unused in
 * vanilla (its clear plays Joe's rescue) but works like the others once Joe is moved with `placeJoe`.
 */
export function setAreaClearReward(rom: Uint8Array, node: number, item: Item) {
  if (node < 1 || node > 11) throw new Error(`no area-clear reward slot for area ${node}`);
  const info = ITEMS[item];
  if (info.inventory < 0 || info.clearText === undefined) throw new Error(`${info.name} can't be an area-clear reward yet`);
  expect(rom, CLEAR_ITEM_TABLE + node, [VANILLA_CLEAR_ITEMS[node - 1]], `area ${node} reward`);
  expect(rom, CLEAR_TEXT_TABLE + node, [VANILLA_CLEAR_TEXT[node - 1]], `area ${node} reward text`);
  rom[CLEAR_ITEM_TABLE + node] = info.inventory;
  rom[CLEAR_TEXT_TABLE + node] = info.clearText;
}

/**
 * Vanilla bug: the equipment screen's pages share one set of boxes, each page drawing or erasing second-row boxes. The
 * communicator page (0D:$AAC6) only erases boxes 5-6 and relies on the item page having redrawn box 4, which the
 * protector page erases. Vanilla's item order always gives an item before a protector and a 2nd comm; shuffled, a
 * player with a protector and comms but no items sees the 4th comm without its box. Redraw box 4 first (block $0C,
 * via a routine at free 0D:$9C90). A no-op when the box is already there.
 */
export function fixCommPageBoxes(rom: Uint8Array) {
  const SITE = 0x36ad6; // 0D:$AAC6: LDA #$0E / JMP $D742
  const ROUTINE = 0x35ca0; // 0D:$9C90
  expect(rom, SITE, [0xa9, 0x0e, 0x4c, 0x42, 0xd7], 'comm page boxes');
  expect(rom, ROUTINE, new Array(10).fill(0xff), 'free space 0D:$9C90');
  rom.set([0x4c, 0x90, 0x9c, 0xea, 0xea], SITE); // JMP $9C90
  rom.set([0xa9, 0x0c, 0x20, 0x42, 0xd7, 0xa9, 0x0e, 0x4c, 0x42, 0xd7], ROUTINE); // LDA #$0C JSR $D742 LDA #$0E JMP $D742
}
