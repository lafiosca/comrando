// Option "Music": Off silences the background music and keeps every sound effect (docs/rom-notes.md#sound).

import { expect } from './rom.ts';

/** 0C:$8044 `LDA $00 / AND #$0F`: the sound engine's start of a song (a sound whose header has a low nibble, the music
 * priority; sound effects branch off to $80BB just before). */
const MUSIC_START = 0x10 + 0x0c * 0x4000 + (0x8044 - 0x8000);

export function applyNoMusic(rom: Uint8Array) {
  expect(rom, MUSIC_START, [0xa5, 0x00, 0x29, 0x0f], 'music start');
  rom[MUSIC_START] = 0x60; // RTS: every song request is dropped, so none ever starts
}
