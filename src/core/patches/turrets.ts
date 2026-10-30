import { assemble } from '../asm.ts';
import { TURRET_CODE } from './locks.ts';
import { expect } from './rom.ts';

// Destructible boss-room turrets.

/** The turret's hit sound: $2D (0F:$C453's: lighter than the core's $3E). */
export const TURRET_HIT_SOUND = 0x2d;
/** Vanilla HP of a boss-room turret (its init, 0E:$BC5D); the normal gun takes one per shot, so 15 shots. */
export const TURRET_HP = 14;

/**
 * Destructible boss-room turrets. The turret above the core (type $69, handler 0E:$BC4E; Areas 3, 7, 8, 9, 10 and 11)
 * is an invisible object that fires the 3-shot spreads; its gun is background (tiles $00-$03 at NT $20D4, palette 0).
 * Vanilla gives it HP 14 but never checks hits (and its hitbox, 0F:$ED1E + 2·$69, is 0×0).
 *
 * Bank 0E has no room, so its dispatcher and init (0E:$BC4E-$BC65, 24 bytes) become a far call: when the PPU queue
 * is idle, 0F:$E65C (the tile-animation copier) copies a trampoline from bank 0C (TURRET_CODE) into the queue buffer $03FB (Y=$A7
 * aims it at CHR $1A00, tiles $A0-$A3, which these rooms never show, should an NMI flush it), then `JMP $03FB`:
 * `LDA #$0C / JSR $DCBE` (keeps the current bank $65 right for the sound and animation calls) / `JMP main`.
 * main (0C, after it) cancels the copy and runs the turret's states, ending `LDA #$0E / JMP $DCBE`:
 * - 0 init: as vanilla.
 * - 1 alive: the standard hit check 0F:$EB62 (bullet gone, damage, death → state 2) plus a hit sound ($2D); then
 *   a pushed return runs the vanilla firing code (0E:$BC66).
 * - 2 grey: queue the gun's 4 tiles recolored for palette 3 (purples → dark grey with light-grey highlights, the
 *   darkest → black) to CHR $1000 (the room's tiles reload on entry), then the attribute ($23CD = $30: palette 3 for
 *   that 16×16 block; the rest of the byte is palette 0 in every turret room).
 * - 3 boom: the robots' explosion (0E:$8287's animation $96C4 for 16 frames, sounds $1B and $1C), then the object
 *   hides (`$06A6` bit 3) instead of being deleted.
 * - 4 watch: rewrite the attribute every 16 frames, in case the column is redrawn.
 * Area 12's power rooms ($58, $59; playtest: their turrets stayed purple) have the turret at x $1C0 and the
 * same gun art as tiles $F8-$FB in palette 1: there the tiles go to CHR $1F80 and the attribute is $23CE = $75 (its
 * byte is $55, palette 1 throughout; the gun's bottom-left quarter becomes palette 3, grey there too).
 */
export function destructibleTurrets(rom: Uint8Array, hp = TURRET_HP, hitSound = TURRET_HIT_SOUND) {
  if (!Number.isInteger(hp) || hp < 0 || hp > 0x7f) throw new Error(`turret HP ${hp} out of range`);
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - (bank === 0x0f ? 0xc000 : 0x8000);
  const STUB = 0xbc4e, FIRE = 0xbc66, TRAMP = TURRET_CODE, END = 0xb900;
  const BOX = off(0x0f, 0xed1e + 2 * 0x69), TILES = 0x1d650; // the boss rooms' BG CHR, tiles $00-$03
  const TILES_02 = 0xaf80; // the recolored tiles: 02's zero fill after the metatile table at $AC00 (its rooms stop at $7F)
  expect(rom, off(0x0e, STUB), [
    0xbd, 0x47, 0x06, 0x20, 0xa0, 0xd6, 0x58, 0xbc, 0x66, 0xbc, // LDA $0647,X / JSR $D6A0 / .dw $BC58, $BC66
    0xa9, 0x02, 0x9d, 0x66, 0x07, 0xa9, 0x0e, 0x9d, 0x79, 0x07, 0xfe, 0x47, 0x06, 0x60, // init
  ], 'turret handler');
  expect(rom, off(0x0e, FIRE), [0xbd, 0x5a, 0x06, 0x20, 0xa0, 0xd6], 'turret firing');
  expect(rom, BOX, [0x00, 0x00], 'turret hitbox');
  expect(rom, TILES, [0x53, 0x50, 0x43, 0x44, 0x0b, 0x17, 0x2f, 0x7e], 'turret tiles');
  // Recolor: index 1, 2 (the lighter purples) → 2, 3 (light, dark grey); 3 (darkest) → 0 (black)
  const MAP = [0, 2, 3, 0];
  const tiles: number[] = [];
  for (let t = 0; t < 4; t++) {
    const lo = [], hi = [];
    for (let r = 0; r < 8; r++) {
      let p0 = 0, p1 = 0;
      for (let b = 0; b < 8; b++) {
        const c = MAP[((rom[TILES + t * 16 + r] >> b) & 1) | (((rom[TILES + t * 16 + 8 + r] >> b) & 1) << 1)];
        p0 |= (c & 1) << b; p1 |= (c >> 1) << b;
      }
      lo.push(p0); hi.push(p1);
    }
    tiles.push(...lo, ...hi);
  }
  const sound = (id: number) => [0xa0, id, 0x20, 0x54, 0xd7]; // LDY #id / JSR $D754
  const code = assemble(TRAMP, [
    0xa9, 0x0c, 0x20, 0xbe, 0xdc, { abs: 0x4c, to: 'main' }, //   (copied to $03FB) LDA #$0C / JSR $DCBE / JMP main
    { label: 'main' }, 0xa9, 0x00, 0x8d, 0xfa, 0x03, //           LDA #0 / STA $03FA: cancel the copy
    0xbd, 0x47, 0x06, 0x20, 0xa0, 0xd6, //                         LDA $0647,X / JSR $D6A0
    { word: 'init' }, { word: 'alive' }, { word: 'grey' }, { word: 'boom' }, { word: 'watch' },
    { label: 'init' }, 0xa9, 0x02, 0x9d, 0x66, 0x07, 0xa9, hp, 0x9d, 0x79, 0x07, // $0766 = 2, HP
    0xfe, 0x47, 0x06, { abs: 0x4c, to: 'back' }, //                INC $0647,X / JMP back
    { label: 'alive' }, 0x20, 0x62, 0xeb, //                       JSR $EB62 (hit check)
    0xbd, 0x8c, 0x07, 0xc9, 0x1f, { rel: 0xd0, to: 'nohit' }, //   LDA $078C,X / CMP #$1F (just hit) / BNE
    ...sound(hitSound), //                                         the hit sound
    { label: 'nohit' }, 0xbd, 0x47, 0x06, 0xc9, 0x01, { rel: 0xf0, to: 'fire' }, // dead: no firing
    { abs: 0x4c, to: 'back' },
    { label: 'fire' }, 0xa9, (FIRE - 1) >> 8, 0x48, 0xa9, (FIRE - 1) & 0xff, 0x48, // push $BC65: return into the firing code
    { abs: 0x4c, to: 'back' },
    { label: 'grey' }, 0xbd, 0x5a, 0x06, { rel: 0xd0, to: 'attr' }, // LDA $065A,X / BNE attr
    // (the recolored tiles from bank 02 (TILES_02), by 0F:$E65C: Y = $A7 aims a stray flush at the unused $1A00)
    0xa9, (TILES_02 - 1) & 0xff, 0x85, 0x17, 0xa9, (TILES_02 - 1) >> 8, 0x85, 0x18, 0xa9, 0x02, 0xa0, 0xa7, 0x20, 0x5c, 0xe6,
    { abs: 0x20, to: 'which' }, //                                  JSR which (Y: 0 boss room, 1 Area 12's power rooms)
    { abs: 0xb9, to: 'chrHi' }, 0x8d, 0xf8, 0x03, { abs: 0xb9, to: 'chrLo' }, 0x8d, 0xf9, 0x03, // PPU $1000 / $1F80
    0xa9, 0x40, 0x8d, 0xfa, 0x03, //                               64 bytes (again: in case an NMI took the first)
    0xfe, 0x5a, 0x06, { abs: 0x4c, to: 'back' }, //                INC $065A,X / JMP back
    { label: 'attr' }, { abs: 0x20, to: 'putAttr' }, 0xfe, 0x47, 0x06, // JSR putAttr / INC $0647,X
    0xa9, 0x00, 0x9d, 0x5a, 0x06, { abs: 0x4c, to: 'back' }, //    LDA #0 / STA $065A,X / JMP back
    { label: 'boom' }, 0xbd, 0x5a, 0x06, { rel: 0xd0, to: 'anim' }, // LDA $065A,X / BNE anim
    ...sound(0x1b),
    0x18, 0xbd, 0x6f, 0x05, 0x69, 0x08, 0x9d, 0x6f, 0x05, //       centered on the gun: x + 8
    { rel: 0x90, to: 'xok' }, 0xfe, 0x5c, 0x05, { label: 'xok' },
    0x38, 0xbd, 0xa9, 0x05, 0xe9, 0x0a, 0x9d, 0xa9, 0x05, //       y - 10
    { rel: 0xb0, to: 'yok' }, 0xde, 0x96, 0x05, { label: 'yok' },
    0xa9, 0x96, 0xa0, 0xc4, 0x20, 0xc7, 0xd6, //                   LDA #$96 / LDY #$C4 / JSR $D6C7 (explosion)
    0xa9, 0x10, 0x9d, 0x80, 0x06, 0xfe, 0x5a, 0x06, //             16 frames / INC $065A,X
    0xbd, 0xa6, 0x06, 0x29, 0xef, 0x9d, 0xa6, 0x06, //             no hit flash
    ...sound(0x1c), { abs: 0x4c, to: 'back' },
    { label: 'anim' }, 0x20, 0xc4, 0xd6, 0xde, 0x80, 0x06, { rel: 0xd0, to: 'back' }, // JSR $D6C4 / DEC $0680,X / BNE
    0xbd, 0xa6, 0x06, 0x29, 0xf7, 0x9d, 0xa6, 0x06, //             hide
    0xfe, 0x47, 0x06, { abs: 0x4c, to: 'back' }, //                INC $0647,X / JMP back
    { label: 'watch' }, 0xa5, 0x37, 0x29, 0x0f, { rel: 0xd0, to: 'back' }, // every 16 frames
    { abs: 0x20, to: 'putAttr' },
    { label: 'back' }, 0xa9, 0x0e, 0x4c, 0xbe, 0xdc, //            LDA #$0E / JMP $DCBE
    { label: 'putAttr' }, { abs: 0x20, to: 'which' }, 0xa9, 0x23, 0x8d, 0xf8, 0x03, // PPU $23CD / $23CE
    { abs: 0xb9, to: 'attrLo' }, 0x8d, 0xf9, 0x03, { abs: 0xb9, to: 'attrVal' }, 0x8d, 0xfb, 0x03, // = $30 / $75
    0xa9, 0x01, 0x8d, 0xfa, 0x03, 0x60, //                          1 byte / RTS
    { label: 'which' }, 0xa0, 0x00, 0xa5, 0x4c, 0xc9, 0x58, { rel: 0x90, to: 'boss' }, 0xc8, { label: 'boss' }, 0x60, // LDY #0 / LDA $4C / CMP #$58 / BCC / INY
    { label: 'chrHi' }, 0x10, 0x1f, { label: 'chrLo' }, 0x00, 0x80, { label: 'attrLo' }, 0xcd, 0xce, { label: 'attrVal' }, 0x30, 0x75,
  ]);
  expect(rom, off(0x02, TILES_02), new Array(64).fill(0x00), 'free space 02:$AF80');
  rom.set(tiles, off(0x02, TILES_02));
  if (TRAMP + code.length > END) throw new Error('turret code too big');
  expect(rom, off(0x0c, TRAMP), new Array(code.length).fill(0xff), 'free space 0C:$B7C0');
  rom.set(code, off(0x0c, TRAMP));
  const src = TRAMP - 1;
  rom.set([
    0xad, 0xfa, 0x03, 0xd0, 0x12, //                     LDA $03FA / BNE rts (the queue is busy)
    0xa9, src & 0xff, 0x85, 0x17, 0xa9, src >> 8, 0x85, 0x18, // the trampoline's address - 1
    0xa9, 0x0c, 0xa0, 0xa7, 0x20, 0x5c, 0xe6, //         LDA #$0C / LDY #$A7 / JSR $E65C
    0x4c, 0xfb, 0x03, 0x60, //                           JMP $03FB / rts: RTS
  ], off(0x0e, STUB));
  rom.set([0x08, 0x10], BOX); // half-width 8, half-height 16: Ladd ducking on the top platform shoots at y $32
}
