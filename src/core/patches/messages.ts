import { expect } from './rom.ts';

// Shortened scripted messages: the briefing comm, Joe's rescue speech, the wiretaps.

/**
 * O1A's COMMUNICATE is two messages: after $14 the flag setter's $14 path (0B:$AFE5: DEC $CD / LDA #4 / STA $CE) has the
 * comm-room script show $16 next (0B:$AFED), reconnecting the radio. Hint mode Nonsense says one line there (else
 * Area 1's first comm says two): the `BEQ` at 0B:$AFCB goes straight to the path's flag store (`STY $04BF`,
 * wherever commFlagSetter left it), so only $14 shows and Area 1's door still opens. Run after commFlagSetter.
 */
export function oneBriefingMessage(rom: Uint8Array) {
  const off = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
  const BEQ = 0xafcb, PATH14 = 0xafeb;
  expect(rom, off(0xafc9), [0xc9, 0x14, 0xf0, 0x18], 'message $14 test');
  expect(rom, off(PATH14 - 6), [0xc6, 0xcd, 0xa9, 0x04, 0x85, 0xce, 0xd0], "message $14's path");
  const store = PATH14 + 2 + ((rom[off(PATH14 + 1)] ^ 0x80) - 0x80);
  expect(rom, off(store), [0x8c, 0xbf, 0x04, 0x60], "message $14's flag store");
  rom[off(BEQ + 1)] = (store - (BEQ + 2)) & 0xff;
}

/**
 * Joe's rescue scene (0D:$94E0, a step per message: Ladd's #108 $D4, then Joe's #109 $D6, #46 $58, #110 $D8, #47 $5A,
 * then the end at $9504) with Joe saying one line (hint mode Nonsense; a pool line, then the plot):
 * the step after #109 jumps to the end.
 */
export function oneRescueLine(rom: Uint8Array) {
  const at = 0x10 + 0x0d * 0x4000 + 0x94ef - 0x8000;
  expect(rom, at, [0xe6, 0xcd, 0xa0, 0x58, 0x4c, 0x30, 0xd7, 0xe6, 0xcd, 0xa0, 0xd8, 0x4c, 0x30, 0xd7, 0xe6, 0xcd, 0xa0, 0x5a, 0x4c, 0x30, 0xd7, 0xa9, 0x01, 0x85, 0xcb], 'rescue scene');
  rom.set([0x4c, 0x04, 0x95], at); // JMP $9504
}

/**
 * Joe's rescue without his story speech (Story Dialogue Comedic: his answer #109 is a comedic line, `parts` messages
 * long: the second in #46's place). The scene's steps (0D:$94EF #46, $94F6 #110, $94FD the tip #47, $9504 the end; each
 * `INC $CD / LDY #y / JMP $D730`) skip to the tip, or with `tip` false (Routing Hints Nonsense) end after the answer, as
 * oneRescueLine (whose patch this replaces).
 */
export function skipRescueSpeech(rom: Uint8Array, parts: number, tip: boolean) {
  const at = 0x10 + 0x0d * 0x4000 + 0x94ef - 0x8000;
  if (![0xe6, 0x4c].includes(rom[at])) throw new Error('unexpected rescue scene');
  expect(rom, at + 7, [0xe6, 0xcd, 0xa0, 0xd8, 0x4c, 0x30, 0xd7, 0xe6, 0xcd, 0xa0, 0x5a], 'rescue scene');
  const toTip = (skip: number) => [...Array(skip).fill([0xe6, 0xcd]).flat(), 0x4c, 0xfd, 0x94]; // INC $CD (each skipped step) / JMP $94FD
  const end = [0x4c, 0x04, 0x95]; // JMP $9504
  if (parts === 1) rom.set(tip ? toTip(2) : end, at);
  else if (parts === 2) {
    rom.set([0xe6, 0xcd, 0xa0, 0x58, 0x4c, 0x30, 0xd7], at); // (the second part, #46, as vanilla)
    rom.set(tip ? toTip(1) : end, at + 7);
  } else throw new Error("rescue: Joe's answer in 1 or 2 messages");
}

/**
 * Every wiretap one message (hint mode Nonsense; a wiretap said two of its lines): the comm table
 * (0B:$AFF4 + 3·(room − $28): COMMUNICATE, wiretap line, reply; 0 = none, as O5A's, O8A's and O9A's replies) loses
 * its replies. Returns the reply messages no longer shown.
 */
export function oneLineWiretaps(rom: Uint8Array): number[] {
  const at = 0x10 + 0x0b * 0x4000 + 0xaff4 - 0x8000, gone: number[] = [];
  expect(rom, at, [0x14, 0x18, 0x1a, 0x1c, 0x1e, 0x20], 'comm table');
  for (let room = 0x28; room <= 0x36; room++) {
    const reply = at + 3 * (room - 0x28) + 2;
    if (rom[reply]) { gone.push(rom[reply]); rom[reply] = 0; }
  }
  return gone;
}
