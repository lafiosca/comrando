import { expect } from './rom.ts';

// A new game's starting state: items, lives, continues.

/**
 * New-game setup. Vanilla (0F:$CA4C) gives the normal gun ($04CB) and α ($04E0); we call a routine in free space
 * (0C:$B6D0; bank $0C is mapped there, new game and continue alike) that does the same and can also set the starting rank ($04EA, 0-8: rank r = r+1 health pips) with the
 * bullet counter at that rank's threshold (the game's own 0F:$E928), and the continue count ($04F9:$04FA, tens:ones;
 * vanilla 0). Area entry sets HP from the rank as usual. $CA4C also runs when continuing after a game over (state
 * $CB=1/$CC=0 is re-entered); `$73` = 1 there (CONTINUE chosen, 0F:$C88C), so the routine leaves rank, bullets and
 * continues alone in that case.
 */
export function setNewGameState(
  rom: Uint8Array,
  { rank = 0, continues = 0, clear = [] }: { rank?: number; continues?: number; clear?: number[] },
) {
  if (!Number.isInteger(rank) || rank < 0 || rank > 8) throw new Error(`starting rank ${rank} out of range`);
  if (!Number.isInteger(continues) || continues < 0 || continues > 9) throw new Error(`continues ${continues} out of range`);
  const SITE = 0x3ca5c; // 0F:$CA4C
  const ROUTINE = 0x336e0; // 0C:$B6D0 (free $FF space 0C:$B6D0-$B900; the fixed bank's $FFB6 gap went to the timer)
  // New game only (skipped on CONTINUE): rank + bullets, continues, and RAM bytes to zero (e.g. map-marker flags,
  // which live outside the range the game itself clears).
  const fresh = [
    ...(rank ? [0xa9, rank, 0x8d, 0xea, 0x04, 0x20, 0x28, 0xe9] : []), // LDA #rank / STA $04EA / JSR $E928 (bullets)
    ...(continues ? [0xa9, continues, 0x8d, 0xfa, 0x04] : []), //        LDA #n / STA $04FA (continues, ones)
    ...(clear.length ? [0xa9, 0x00, ...clear.flatMap((a) => [0x8d, a & 0xff, a >> 8])] : []), // LDA #0 / STA a...
  ];
  const routine = [
    0xa9, 0x01, //           LDA #1
    0x8d, 0xcb, 0x04, //     STA $04CB      normal gun
    0x8d, 0xe0, 0x04, //     STA $04E0      α communicator
    0xa5, 0x73, //           LDA $73        continuing after a game over?
    0xd0, fresh.length, //   BNE done
    ...fresh,
    0x60, //                 done: RTS
  ];
  if (routine.length > 0x40) throw new Error('new-game routine too big');
  expect(rom, SITE, [0xa9, 0x01, 0x8d, 0xcb, 0x04, 0x8d, 0xe0, 0x04], 'new-game setup');
  expect(rom, ROUTINE, new Array(routine.length).fill(0xff), 'free space 0C:$B6D0');
  rom.set([0x20, 0xd0, 0xb6, 0xea, 0xea, 0xea, 0xea, 0xea], SITE); // JSR $B6D0 / NOP x5
  rom.set(routine, ROUTINE);
}

/**
 * Lives per game and per continue. State $CB=1/$CC=0 (0F:$CA34, new game and continue) sets the spare-life count
 * `$4A` to 2 (= 3 lives); a death decrements it and the game is over when it goes negative (0D:$B77D). The HUD shows
 * one digit and 1UPs cap it at 9 (0F:$E0DA), so 1-10 lives.
 */
export function setLives(rom: Uint8Array, lives: number) {
  if (!Number.isInteger(lives) || lives < 1 || lives > 10) throw new Error(`lives ${lives} out of range`);
  const SITE = 0x3ca44; // 0F:$CA34: LDA #2 / STA $4A
  expect(rom, SITE, [0xa9, 0x02, 0x85, 0x4a], 'starting lives');
  rom[SITE + 1] = lives - 1;
}

/**
 * Unlimited continues: choosing CONTINUE after a game over (0F:$C8A9) restores the inventory and then decrements the
 * continue count at $C8B6; jump straight to its RTS instead. Pair with a nonzero starting count (setNewGameState),
 * since CONTINUE is only offered while the count is nonzero.
 */
export function unlimitedContinues(rom: Uint8Array) {
  const DEC = 0x3c8c6; // 0F:$C8B6: DEC $04FA
  expect(rom, DEC, [0xce, 0xfa, 0x04, 0x10, 0x12], 'continue decrement');
  rom.set([0x4c, 0xcd, 0xc8], DEC); // JMP $C8CD (RTS)
}
