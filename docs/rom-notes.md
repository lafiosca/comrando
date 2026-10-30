# Bionic Commando (USA) ROM notes

What the randomizer knows about the NES game: where things are in the ROM and RAM, how the routines it patches work,
and why the patches are shaped the way they are. The code's comments point here by section.

- **ROM:** the No-Intro dump `Bionic Commando (USA)`, PRG CRC32 `D2574720` (the only one the randomizer accepts;
  `src/core/rom.ts`). MMC1, 16 PRG banks of 16 KB (`00`-`0F`, `0F` fixed at `$C000`), CHR RAM: every graphic is
  copied from PRG banks at run time. The GoodNES `(U) [!]` dump (`BE4C6E42`) differs in 4 graphics bits only, so
  everything here applies to it too, but it is rejected by name.
- **Addresses** are written `bank:$cpu`, e.g. `0D:$A5CE`. File offset = `0x10 + bank * 0x4000 + (cpu - $8000)`
  for banks `00`-`0E`, and `0x10 + 0x3C000 + (cpu - $C000)` for `0F` (the same formula with base `$C000`).
- **Verified** means observed in an emulator (the tests run the patched ROM in jsnes, `test/emu.ts`); everything
  else is read from the code.
- **Vocabulary:** a *map number* (0-19) is a box on the overworld map and never moves. A *layout* (written O1-O19,
  the game's own internal "identity") is the level that a map number leads to; the randomizer can shuffle layouts
  between map numbers. A *room* (`$4C`) is one screen set: level rooms `$00`-`$12` (layout − 1), the overhead stages
  `$13`-`$15`, then boss rooms, comm rooms, buildings and so on.

Contents: [Memory map](#memory-map) · [Banks and free space](#banks-and-free-space) · [Text and messages](#text-and-messages) ·
[Talk and scripts](#talk-and-scripts) · [Comm rooms](#comm-rooms) · [Map screen](#map-screen) ·
[Gates and roads](#gates-and-roads) · [Items and rewards](#items-and-rewards) · [Area clear screen](#area-clear-screen) ·
[Buildings](#buildings) · [Building people](#building-people) · [Building pickups](#building-pickups) ·
[Sprite CHR loading](#sprite-chr-loading) · [Destroyers](#destroyers) · [Barriers](#barriers) · [Darkness](#darkness) ·
[Door locks](#door-locks) · [Door panels](#door-panels) · [Shutter doors](#shutter-doors) · [Area 12](#area-12) ·
[Super Joe](#super-joe) · [Weapons and fire](#weapons-and-fire) · [Top-down stages](#top-down-stages) ·
[Turrets](#turrets) · [Bosses](#bosses) · [Ending](#ending) · [Timer](#timer) · [New game, lives and continues](#new-game-lives-and-continues) ·
[Palettes and cosmetics](#palettes-and-cosmetics) · [Portraits](#portraits) · [Title screen](#title-screen) ·
[Shared routines](#shared-routines)

## Memory map

### Zero page and game state

| RAM | Meaning |
|---|---|
| `$32` | palette upload pending: the NMI uploads the palette instead of the PPU queue that frame |
| `$36`, `$37` | frame counters (`$37` is incremented by the NMI; `$36` is the one gameplay code reads) |
| `$3F` | per-level entry flag, from 0D:`$A51F` + `$4C` |
| `$40` | the room's event count: a boss's death increments it; boss-room exits wait on it |
| `$4A` | spare lives |
| `$4C` | current room |
| `$4D` | current layout ("identity") on the map; every system outside the map module keys on it |
| `$65` | the bank currently meant to be at `$8000` (restored by 0F:`$DCA8`) |
| `$73` | title-screen choice: 0 = new game, 1 = CONTINUE |
| `$74` | a message is printing |
| `$75`-`$77` | the message header, split (box style, timing bits, portrait) |
| `$79`, `$7A/$7B` | printer: cell index, text pointer |
| `$88` | talk script number |
| `$8F` | message Y for talk mode |
| `$B6`/`$B7`, `$B9`/`$BA` | camera scroll (screen, fine) |
| `$CB`, `$CC`, `$CD`, `$CE`, `$CF` | main state, sub-state and steps (`$CB`: 0 title, 1 game, 2 area clear, 3, 4 escape/ending; `$CC` within the game: 1 map, 3 SELECT screen, 4 talk, 5 comm room) |
| `$D0`-`$EF` | palette buffer (sprites `$E0`-`$EF`) |
| `$F8`, `$FA` | buttons newly pressed, held (B = bit 6) |
| `$FE` | PPUCTRL shadow |

### Objects

Object slots are indexed by X; slot 0 is Ladd, 1-4 player bullets (4 is also the bionic arm, type 5), 6-7 a pool,
8-10 and 11-18 level objects. Per-slot tables: `$0536` active, `$0549` type, `$055C`/`$056F` x, `$0583`/`$0596`
y (with screen bytes), `$0647` state, `$065A` substate/step, `$066D`, `$0680`, `$06A6` flags (bit 1 visible, bit 2
doesn't scroll, bit 3 drawn, bit 4 flash), `$0779` HP, `$078C` flash timer. `$0779` for slot 0 is Ladd's current
health.

### Page 4: inventory and progress

| RAM | Meaning |
|---|---|
| `$0440`-`$04BD` | map objects (helicopter, trucks, the two hidden-passage objects): x `$0452,X`, y `$0464,X`, state `$0488,X`, script `$0449,X` |
| `$0488` | helicopter phase (0 init, 1 at a node, 2 flying) |
| `$0491` | map menu state (0 arrive, 1 prompt "PLEASE INSTRUCT US", 2 DESCEND/TRANSFER, 3 route select) |
| `$049A` | selected route offset (2, 4, 6, …) |
| `$04A3` | the truck encountered |
| `$04B5` | the node the flight left from |
| `$04BE`-`$04C9` | **per-visit flags**, cleared on every map entry (0D:`$A413`): `$04BE` door slot used, `$04BF`/`$04C0` door unlocks, `$04C1` Flare used, `$04C2` pills used, `$04C4` alert (wiretap alarm, a shot in a neutral zone), `$04C5` Destroyer answer, `$04C7` passage pickup taken, `$04C8`/`$04C9` free (the randomizer's Area 12 comm flags) |
| `$04CA`-`$04E5` | inventory (see [Items and rewards](#items-and-rewards)) |
| `$04E6` | equipment cursor |
| `$04E7`-`$04E9` | bullet count (BCD digits) |
| `$04EA` | player rank (max health: pips = rank) |
| `$04EB`-`$04F6` | area cleared, `$04EA` + map number 1-12; only ever written by index (0A:`$B140`) and read directly at the road gates and Area 12's check, so `$04F6` (Area 12) is free during play: the randomizer's "Joe rescued" flag |
| `$04F7` | underground passage found |
| `$04F8` | free: the randomizer's IFF Code |
| `$04F9`:`$04FA` | continues (tens:ones) |
| `$04FB`-`$050E` | the one-time 1UP drop per node (`$04FA` + node) |
| `$050F` | NZ15's leader event done |
| `$0510`-`$0513` | barriers destroyed |
| `$0514` | Area 12's final boss beaten (Area 12 then resumes in room `$60`) |
| `$0516`-`$0525` | the ending's target palette |

`$04CA`-`$04EA` is copied to `$0100` on entering an area and restored by CONTINUE (0F:`$C717`, `$C8A9`). A new game
clears `$0440`-`$04BD` and `$04BE`-`$0515` (0F:`$C890`); CONTINUE doesn't.

### Page 3 and the stack-page gap

- `$03F8`/`$03F9` PPU address, `$03FA` byte count (0 = idle), `$03FB`-`$043A` data: the PPU queue, one transfer per
  frame, flushed by the NMI (0F:`$C0F4`) unless `$32` is set. The randomizer also runs code from `$03FB` (see
  [Shared routines](#shared-routines)).
- **`$01CE`-`$01E8` is unused.** The sound engine (bank 0C) owns RAM up to `$01CD`, the stack never went below
  `$01E9`, and nothing references the gap. Power-on clears it; the new-game routine clears it on START, not on
  CONTINUE. The randomizer's flags live here:

| RAM | Use |
|---|---|
| `$01CE` | timer: the PPUCTRL value the game last wrote |
| `$01D0`-`$01D2` | map markers: visited, bit (layout & 7) of `$01D0` + (layout >> 3) |
| `$01D3` | Flak Map owned |
| `$01D4` | rapid-fire repeat counter |
| `$01D5`-`$01D7` | timer: frame count (24-bit) |
| `$01D8`-`$01DC` | building pickups: a CHR record built in RAM |
| `$01DD` | Area 12's miniboss beaten |

## Banks and free space

| Bank | Contents |
|---|---|
| `00`-`02` | level maps, metatiles, background CHR lists (`01:$A002`), palettes (`01:$B82A`…) |
| `03` | object lists (pointers at file 0x0ED7B + 2·room), sprite CHR lists and records |
| `04`-`09` | graphics (CHR) |
| `0A` | metasprites/animations, the area-clear screen |
| `0B` | **all dialogue** (`$8000`-`$A77F`), door tables, map screen tiles, comm-room logic |
| `0C` | sound engine; portrait layouts (`$B900`-`$BE6D`) |
| `0D` | map, equipment screen, talk scripts, player fire, overhead stages |
| `0E` | object handlers (type table `0E:$803A` + 2·type) |
| `0F` | fixed: NMI, printer, loaders, shared routines |

Every bank 0-14 ends with the same reset stub (`$BFE0` on); don't overwrite it. Unused EPROM fill is alternating
32-byte runs of `$00` and `$FF`. The free space the randomizer uses (each patch checks the fill before writing):

| Range | Used for |
|---|---|
| `01:$9D00`-`$9DDF` | building pickups' room palette copies |
| `02:$8F80`, `$8FC0`, `$9F80`, `$9FC0` | the sealed-door CHR blocks ([Door panels](#door-panels)) |
| `02:$AF80` | the grey Area 12 turret tiles |
| `03:$AA20`-`$AAFF` | darkness loader helper |
| `03:$AB00`-`$AB66` | comm-lock lists (free again) |
| `03:$AB67`-`$AB7F` | extra sprite CHR records `$59`-`$5D` |
| `03:$AB80`-`$ABFF` | the CHR loader helper (building pickups) |
| `03:$B6C6`-`$B6CF` | the passage stage's CHR list |
| `03:$B84B`-`$B86B` | building pickup CHR lists |
| `0A:$BB4E` | area-clear digit table |
| `0A:$BF84`-`$BFDF` | clear-screen name hop and extra name offsets; `$BF90` room `$44`'s pickup metasprite; `$BFD8` the truck drop's metasprite |
| `0B:$A780`-`$A7FF` | text (vanilla slack) |
| `0B:$B4A0`-`$B5BF` | map markers |
| `0B:$B5C0`-`$B6FF` | gate display |
| `0B:$B700`-`$B7FF` | text (lent) |
| `0B:$BCC0`-`$BE3F` | text (lent) |
| `0B:$BE40`-`$BF7F` | clear screen names |
| `0B:$BF85`-`$BFDF` | trampolines (room lines, ending, printer), the comm-flag table at `$BFA4`-`$BFBF` |
| `0C:$B710`-`$B8FF` | door locks (from `$B710`), turrets (from `$B7C0`) |
| `0C:$BF68`-`$BFDF` | door panel upload |
| `0D:$9C1F`-`$9CFF` | Area 12 condition (`$9C40`, table `$9C60`), road gates (`$9C1F`, `$9C71`), refusal (`$9C80`), comm page boxes (`$9C90`), Joe (`$9CA0`), map visit (`$9CC0`), rapid fire (`$9CEC`) |
| `0D:$9D00`-`$9DFF` | gate display; truck drops (`$9DB0`) |
| `0D:$9F00`-`$9FDF` | gate display; top-down arm (`$9F60`), top-down fire (`$9F78`), Machine Gun (`$9FAC`) |
| `0D:$BF7F`-`$BFDF` | room-line hop (`$BF80`), mole hit-back (`$BFC2`), ending hop (`$BFE4`), Flare check (`$BFE9`) |
| `0E:$BF20`-`$BFDF` | true-dark palette list (`$BF20`), boss flag (`$BF28`), death replies (`$BF38`, `$BF57`, `$BF8E`, `$BFE4`), barrier rule (`$BFC0`) |
| `0F:$C694`-`$C69F` | Flak Map store |
| `0F:$FFB6`-`$FFDF` | new-game hook and timer |

The 0D/0E/0B zero runs above had no reference in their bank and were never read in a 250k-frame random-input trace.
Banks 6-9 have no usable free space: unread regions are level graphics.

## Text and messages

- **All dialogue is in bank 0B**, `$8000`-`$A77F`; the printer maps 0B itself (0F:`$C2E0`), so text must stay there.
- **Pointers:** `$8004` + y, so **message n = y / 2 + 2** (y even). Messages 2-129 (128 pointers, `$8004`-`$8103`);
  the first text starts at `$8104`. `$8000`/`$8002` point at two non-text blobs (`$A68F`-`$A77F`: portrait tables);
  don't move them. Messages fill `$8104`-`$A68F` without overlap, so the bank can be repacked
  (`src/core/text.ts`).
- **Format:** `[header][length][characters]`, at most 255 characters. Header bits 7-6 = box style, 5-4 = timing
  (3: pages advance on a timer, silent), low nibble − 1 = the portrait (0: none). Keep a line's header to keep its
  speaker. Box style 0 is the side-scroll talkers' box; style 1 the radio (comm rooms, the briefing). A style-1
  message shown through the side-scroll talk mode draws its text into the room's wall tiles: use style 0 there.
- **Layout:** 16 columns, no newline code (pad with spaces). Pages: styles 0 and 2 have 64 cells (4 rows), style 1
  96 (6 rows); A starts the next page. A radio box opens (connection sound, portrait drawn in) at every new message,
  not at a page.
- **Display:** `LDY #y / JSR $D730` (→ 0F:`$E09F`: map bank 0B, read the pointer into `$7A/$7B`, continue at
  `$E0AE`, which parses the header; end `JMP $DCA8`). Entering at `$E0AE` with `$7A/$7B` set prints text from
  anywhere in bank 0B. Other entry points: `LDA #y / JSR $D78A` (talk mode, automatic), `LDY #y / JSR $D7D2` (talk
  button), the room table 0F:`$E6ED`, the talker tables (0E:`$B565`, 0E:`$B5FF`, 0E:`$BAFA`), the comm table, and
  the 0D talk scripts (whose `LDY #y` often reach `JMP $D730` through a branch). `LDY #y / JSR $D754` is a sound,
  not a message.
- **Printer:** 0F:`$C441` types one cell every other frame, spaces included: glyph `($7A),$79` → 16 bytes from
  0B:`$B800` + 16·code, into the box's next pattern tile (`$7C/$7D`, +`$10` per cell); page tile ranges by style
  start at 0F:`$C32A` and end at `$C332`. The randomizer hooks the fetch at 0F:`$C458` so a run of spaces costs one
  cell.
- **Charset** (`src/core/text.ts`): `A`-`Z`, `0`-`9`, space, `. , ' ? ! - + * ^ α β γ δ`. No lowercase, colon or
  slash. Characters are 2 tiles tall.
- **Unused messages:** #28 (no display reference; the randomizer's Joe-captor line), #75, #77, #84, #88, #113-#115
  (a leftover number entry screen; #115 is the randomizer's Area 12 refusal, #114 the 8-10 gate's), and Captain
  Mack's #57-#60 (object type `$66`, placed in no room). #69 is not spare: it's the escape cyborg's line (0E:`$B74B`
  `LDA #$86 / JSR $D78A`). The one-space messages #68, #78, #87, #111 are cutscene pauses; #81 sits among the
  Destroyer lines.

## Talk and scripts

- Talk mode is `$CC` = 4 with message `$8F` and script `$88`. Entry points (fixed bank): `$D7D2` → 0F:`$E6BD` (needs
  the talk button; script 0), `$D78A` → 0F:`$E6C4` (on contact; script 0), `$D7B4` → 0F:`$E6D5` (boss rooms: `$8F` =
  0F:`$E6ED` + (room − `$16`); script 1), `$D7A5` → 0F:`$E6C8` (run script A).
- Scripts: 0D:`$A27F` runs script `$88` from the table at 0D:`$A28D` whenever nothing is printing; each script is a
  list of steps on `$CE`: a step loads Y and jumps to 0D:`$A2FD` (`INC $CE / JMP $D730`), the last `INC $CD`.
  Scripts: 2 NZ15's leader event, 3 Captain Mack (unused), 4/6/7 the Destroyers, 5 the cockpit scene, 8 Killt, 9
  Master-D.
- The boss-room talk prints at 0D:`$A2AA` (`LDY $8F / BNE $A2FD`) or `$A2BF` (the same after a sound). The
  randomizer hooks both (`src/core/roomtalk.ts`): a hop into bank 0B looks `$4C` up in a room table and prints that
  room's own line, else `$8F`.
- Boss rooms by area (from the door tables): 1 `$16`, 2 `$17`, 3 `$1F`, 4 `$18`, 5 `$19`, 6 `$1A`, 7 `$1B`, 8 `$20`,
  9 `$1C`, 10 `$1D`, 11 `$1E`, 12 `$21`. Vanilla lines at 0F:`$E6ED`: `22 56 30 48 70 9A 8C 48 BA 48 22 BA`. The
  header picks the portrait, so moving a line to another boss shows the wrong face.

## Comm rooms

- The terminal object (0E:`$BA2A`) sets `$CC` = 5, `$CD` = `$CE` = 0; mode 5 runs 0D:`$AB97`.
- **Which communicator:** 0D:`$AC2E` `LDY $4D / LDA $AC83,Y / CMP $04DF`: table 0D:`$AC83` (file 0x36C93), 13 bytes by
  layout 0-12, vanilla `00 00 01 01 00 00 01 02 02 02 03 03 03` (α α β β α α β γ γ γ δ δ δ). The *selected*
  communicator must match; otherwise message Y `$62` (static) and nothing else.
- **Messages:** 0B:`$AFAF`: `y = $AFF4[(room − $28) · 3 + $CE]` (file 0x2F004, 45 bytes): slot 0 COMMUNICATE, slots
  1-2 the wiretap's line and reply; 0 = none.
- **Flags** (0B:`$AFC9`): after y `$14` (Area 1) the game continues with `$16`; y `$14`, `$2A`, `$7E` set `$04BF`,
  `$7A` sets `$04C0`. They key on the message id, so rewriting the text keeps them. (The vanilla chain compares
  `$2A` twice.) The randomizer replaces the chain with a table (`commFlagSetter`, rows at 0B:`$BFA4`).
- **Wiretap alarm:** a 1-in-4 chance, except at node 1 (0D:`$AC19`); it sets `$04C4`.

| Room | Layout | COMMUNICATE | Wiretap line / reply |
|---|---|---|---|
| `$28` | O1 (A) | `$14` + `$16`, opens the door | `$18` / `$1A` |
| `$29` | O1 (B, behind `$47`) | `$1C` | `$1E` / `$20` |
| `$2A` | O2 (behind `$48`) | `$50` | `$52` / `$54` |
| `$2B` | O4 | `$2A`, opens the door | `$2C` / `$2E` |
| `$2C` | O5 (A) | `$3A` | `$3C` / — |
| `$2D` | O5 (B) | `$3E` | `$40` / `$42` |
| `$2E` | O7 | — (no door leads there) | — |
| `$2F` | O9 | `$88` | `$8A` / — |
| `$30` | O10 | `$B0` | `$B2` / `$B4` |
| `$31` | O11 | `$B6` | `$B8` / `$F0` |
| `$32` | O3 (behind `$49`) | `$68` | `$6A` / `$6C` |
| `$33` | O8 complex | `$7A`, opens door 2 | `$7C` / — |
| `$34` | O8 complex | `$7E`, opens door 1 | `$80` / `$82` |
| `$35` | O12 (A) | `$BC` | `$BE` / `$C0` |
| `$36` | O12 (B, behind `$64`) | `$C2` | `$C4` / `$C6` |

O6 and the neutral zones have no comm room. Most wiretaps are enemy soldiers; O4A, O10A and O11A are ally chatter
(headers `$46`/`$48`). O3A's COMMUNICATE promises to open a boss door Area 3 doesn't have.

## Map screen

### Layouts and travel (bank 0D)

| What | Address | File | Format |
|---|---|---|---|
| Road list pointers | `$A760` | 0x36770 | 20 words by layout |
| Road lists | `$A788`-`$A813` | 0x36798 | `[max offset][FF]` then `{dir << 4 | segment, destination BCD}`; offsets 2, 4, … |
| Arrival points | `$A814` | 0x36824 | 20 × (x, y) screen pixels by layout (also the number boxes' centers) |
| Truck starts | `$A99F` | 0x369AF | `script << 4 | start node`, `$FF` end |
| Truck scripts | `$A8ED` | 0x368FD | 8 index bytes, then direction lists (bit 7: loop) |
| Direction steps | 0F:`$FEE2` (pointer at 0F:`$FCD6`) | 0x3FEF2 | 8 directions × (x, y) 8.8 steps |
| Per-level flag | `$A51F` | 0x3652F | by room |
| Map tiles | 0B:`$B2CC` | 0x2F2DC | 26 × 18, drawn at PPU `$2063` (rows of 32) |

- **Arrival is geometric:** the helicopter flies along its direction until within 2 px of some layout's arrival point
  (0D:`$A718`, layouts 19..0, skipping the origin `$04B5`), then `$4D` = that layout (`$A653`). Destination bytes are
  display only. So moving a layout between map numbers = giving it that spot's road-list pointer and arrival point;
  the map tiles and road text keep showing the map number.
- **Descend** (0D:`$A4DC`): node 0 can't (`$A4BC`); node 12 checks Area 12's condition (`$A4E7`); otherwise
  0D:`$A504` `DEY / STY $4C / LDA $A51F,Y` (room = layout − 1), `$CC`++ → the equipment screen.
- **Equipment screen exit** into the level: 0D:`$AACB` `INC $CC / LDA #0 / STA $CD`, its only exit (cancelling with B
  returns to the map without passing here). The overhead stages also pass here with `$4C` ≥ `$13`.
- **Speed:** 0D:`$A6E2` moves the helicopter (called from `$A64B`) and the trucks (`$A893`) one table step per frame;
  trucks only move while the helicopter flies and change direction only on arrival. The randomizer's double speed
  rewrites the routine to read the table directly and calls it twice for the helicopter only.
- **Trucks:** map init 0D:`$A94A` spawns from `$A99F` in a do-while loop (the first entry is spawned before the `$FF`
  check), then at `$A97F` the two hidden-passage objects (slots 7-8, script `$0F`, at the middles of the hidden
  roads). No trucks = `JMP $A97F` at `$A94A`.
- **Encounters:** 0D:`$A68B` `LDX $04A3 / LDA $0449,X / AND #$0F`: script `$0F` → room `$15` (the underground
  passage), any truck → `$13` + (`$38` & 1).
- **Area-clear digits:** 0A:`$B0D9` turns `$4D` into the "xxAREA CLEAR" number; with shuffled layouts it reads a
  map-number table instead.

### Graph (vanilla)

0-1, 1-13, 1-4, 2-16, 2-5, 2-3, 3-6, 4-15, 4-5, 5-6, 5-16, 5-15, 6-8, 6-14, 7-8, 7-18, 8-10, 8-19, 8-9, 9-17,
10-12, 10-11, 11-12; hidden until `$04F7`: 14-17, 15-18. A new game starts at node 0.

### Drawing

- Number boxes are 2×2 tiles in the nametable, on even rows and columns (one attribute quadrant each): n < 10 →
  `$40` + 4n (TL, TL+2 / TL+1, TL+3); 10-12 → (`$68`, R / `$69`, R+1), R = `$6A`/`$6E`/`$70`; 13-19 → (`$6C`, R /
  `$6D`, R+1), R = `$72` + 2(n − 13). A box's top-left tile in the 26 × 18 grid is (x / 8 − 4, y / 8 − 4) from the
  arrival point.
- Build order (rendering off): clear (0F:`$D838`), attributes (0F:`$E1D2` uploader: 0F:`$E3BD` = `23 C0 30` and 48
  attribute bytes, used only by the map), tiles (0B:`$B229`), then the hidden roads (0B:`$B276` `LDA $04F7`, 4 tiles
  at PPU `$2252/$2272`, `$210E/$212E`). The SELECT screen in a level (`$CC` = 3) runs the same build.
- **Palettes:** BG 0 `0F 20 15 10` (the boxes: 1 white fill, 2 pink border and digit), 1 `0F 20 16 1C`, 2 `0F 20 1C 1A`,
  3 `0F 20 1A 16` (land: one land colour per grid cell; every land palette's colours are all used). Switching a box's
  quadrant to palette 2 draws it blue, 3 green (the map markers). Background tiles `$80`-`$B7` and `$F8`-`$FF` are free
  on the map; sprite tiles `$9D`-`$A5` are empty there.
- **Sprites:** OAM buffer `$0200`, next free entry `$3A` (step `$3B` = 4). The map frame (0D:`$A400`) draws the
  helicopter, the route highlight (tiles `$B4`-`$B6`) and trucks via 0F:`$D55F`, then `JMP $D6C1` (0F:`$DA21` hides the
  entries from `$3A` on); appending sprites before that keeps the game's own in front.
- **Corner** (rows 22-27, columns 20-31) is blank on the map; the SELECT screen draws L=/P= there.

## Gates and roads

### Vanilla checks (bank 0D; they check ownership, not the selected item; one direction only)

| Gate | Code | Condition | Refusal |
|---|---|---|---|
| 6 → 8 | `$A5CE` (`CMP #$06` operand file 0x365E1) | `$04ED` (Area 3), `$04F0` (Area 6), `$04E2` (γ) | message `$64` (#52) |
| 8 → 10 | `$A5E9` (operand 0x365FC) | `$04E3` (δ), `$04F1` (Area 7) | `$64` |
| hidden roads | `$A5FF` (operands `$A602`, `$A606`, `$A60A`) | without `$04F7`, skip 14→17, 18→15, 15→18 | — |
| descend 12 | `$A4E7` (flags loaded at `$A4ED`) | `$04F4`, `$04F5` (Areas 10, 11) | `$64` |

- **Both callers** (route select `$A56D`, flight start `$A5B5`) use the gate routines, which return Z set = blocked
  and **must keep Y** (the caller holds the message Y for `$D730`).
- **The passage check forgets 17→14:** NZ17's TRANSFER menu offers "AREA14" with no road drawn, and flying it enters
  the passage stage before `$04F7` is set. The randomizer rewrites the routine in place with 17 added (operand at
  `$A60E`).
- `$A5FE` must stay an RTS: the passage check at `$A5FF` branches to it.
- **Refusing Area 12** leaves the map in TRANSFER, because `$0491` is advanced before the check; the randomizer's
  refusal path (0D:`$A51A` → `$9C80`) sets `$0491` = 1 first, so the prompt comes back.
- The randomizer's gates key on the layouts at map 6/8/10 and both directions (map 6's road to 8 = offset 6, map 8's
  to 6 = 10; map 8's to 10 = offset 4, map 10's to 8 = 6), and test flag lists in 0D free space.

### The passage flag

`$04F7` is set by object `$7C` (0F:`$F7DF`) in room `$3F` (behind NZ17's door A) when Ladd's x (`$056F`) ≥ `$D0` and
`$065A` = 0, with message #76 naming the hidden roads. It's stored in a building room's object list, so it travels
with the building.

## Items and rewards

### Inventory (`$04CA`-`$04E5`)

Four pages of 7 bytes, `[selected index][6 slots]` (offsets per page at 0B:`$B171`: `00 07 0E 15`). A slot is owned
when nonzero; items are never consumed. Offsets below are from `$04CA` (what reward tables store).

| Offset | RAM | Item | | Offset | RAM | Item |
|---|---|---|---|---|---|---|
| `00` | `$04CA` | selected weapon | | `0E` | `$04D8` | selected item |
| `01` | `$04CB` | normal gun | | `0F` | `$04D9` | Flare |
| `02` | `$04CC` | Rocket Launcher | | `10` | `$04DA` | Pills |
| `03` | `$04CD` | Wide Cannon | | `11` | `$04DB` | Permit |
| `04` | `$04CE` | Machine Gun | | `12` | `$04DC` | Iron Boots |
| `05` | `$04CF` | 3-Way Gun | | `13` | `$04DD` | Rapid-Fire Device |
| `07` | `$04D1` | selected protector | | `15` | `$04DF` | selected communicator |
| `08` | `$04D2` | Pendant | | `16`-`19` | `$04E0`-`$04E3` | α β γ δ |
| `09` | `$04D3` | Helmet | | `1A` | `$04E4` | (Flak Map's nominal slot) |
| `0A` | `$04D4` | Bulletproof Vest | | `2E` | `$04F8` | (IFF Code) |

- Level checks use the **selected** item (the equipment screen before each descent, neutral zones included; a page
  shows only if something on it is owned, 0D:`$A9D7`); map gates check ownership.
- New game: 0F:`$CA4C` stores the normal gun and α.
- Equipment icons: 0B:`$B199`, 8 bytes per icon `[tile, attr] × 4` (TL, TR, BL, BR; icon = slot + base: protectors
  +0, weapons +3, items +9, communicators +`$0E`). Menu sprite palettes `30 15 0F`, `30 2A 0F`, `30 21 0F`, `30 26 0F`.
  Icon tiles are stored TL, BL, TR, BR: menu tile t in `$D5`-`$FF` at file 0x20D60 + (t − `$D5`)·16, in `$50`-`$64` at
  0x245D0 + (t − `$50`)·16 (the Permit's lower half is `$50`/`$51`).
- **Equipment screen bug:** the pages share six boxes and redraw the second row with 0F:`$D742` blocks (`$0A`/`$0C` draw
  box 5/4, `$0E` erases 5-6, `$10` erases 4); the communicator page (0D:`$AAC6`) only erases 5-6, so with a protector,
  no items and four communicators the 4th has no box. Fixed by drawing `$0C` first.
- **IFF Code and Flak Map** (randomizer items) have no menu slot. The reward and pickup stores `LDA #1 / STA $04CA,Y`
  (0A:`$B151`, 0F:`$F63E`) call 0F:`$C694`, which stores offset `$1A` to `$01D3` instead (a store into page 4 would be
  undone by a continue or sit on an equipment page). Offsets ≥ `$80` mean "no item" to the pickup spawn.

### Area-clear rewards

0A:`$B13C`: `LDY $4D / LDA #1 / STA $04EA,Y` (cleared flag), then `LDA $B16E,Y` (offset; 0 = a 1UP via `JSR $D7C3`)
and `STA $04CA,Y`, then 10 bullets (0A:`$B154`: 10 × `JSR $D7BA`, +1 bullet each with rank-ups at the thresholds
0F:`$E947`; the count is the immediate at 0A:`$B155`), then the map (0A:`$B15F`).

| Map number | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Item table 0A:`$B16E`+n (file 0x2B17E+n) | `10` | `08` | `13` | `03` | `02` | `11` | `00` | `12` | `05` | `00` | `0A` | `00` |
| Vanilla | Pills | Pendant | Rapid-Fire | Wide | Rocket | Permit | (Joe) | Boots | 3-Way | 1UP | Vest | — |

The byte at n = 0 is the preceding routine's RTS: never write it. Names: offset table 0A:`$B17A`+n into the strings
from 0A:`$B17B` (file 0x2B18A + n; 0 = no text); the vanilla string block is full, so new names come from bank 0B.
Areas can be re-entered and cleared again (no check on descent).

### Other sources

- Building pickups (type `$79`): see [Building pickups](#building-pickups).
- The passage stage's Helmet: see [Top-down stages](#top-down-stages).
- The Machine Gun: the Destroyer rooms (see [Destroyers](#destroyers)).
- Side-scroll drops (types `$73`-`$76`, 0F:`$F450`, table `$F475`): `$73` a 1UP once per node (`$04FA` + node),
  `$74` health, `$75` a bullet.

## Area clear screen

- Setup (0A:`$B08C`, `$CC` = 0) copies a 72-character template to `$0100` (from 0F:`$E715`): `F0 48`, then four
  16-character lines ("xxAREA   CLEAR", the bonus, "WE'VE OBTAINED", the name at `$0132`). The digits go to
  `$0102`/`$0103` (0A:`$B0D9`), the name from 0A:`$B17B` + (`$B17A` + node) (0A:`$B0FA`), then `LDY #$F2 / JSR $D730`
  prints #123, whose pointer is `$0100`.
- **Each character has its own tile slot**, placed by the screen's tile map: text can't move between lines, and slot
  32 (the 3rd line's first character, a space) is also the screen's blank background: anything else there fills the
  screen. The 4th line shows one column right of the 3rd.
- Its sprite palettes come from 0F:`$D918` (`$D8A8` + `$60`, loaded by 0A:`$B116`): the portrait shares the uniform
  green.
- The overhead stages end at 0D:`$8281` (`$CD` = `$CE` = 0, `$CC` = 1, the map), with `$4D` still the zone flown from.
  The randomizer's passage clear screen keys on `$04C7` (set by its pickup) and returns Y = 0, so 0A:`$B13C` skips to
  the bonus: no area flag, no reward.

## Buildings

Each neutral zone (rooms `$0C`-`$12`) has two doors: slot 0 (door A) at x `$290`, y `$1B0`; slot 1 (door B) at x
`$3D0`, y `$160`, in every zone. Door object type = `$2A` + slot.

| Pointer (0B) | Table | File | Index | Meaning |
|---|---|---|---|---|
| `$A813` | `$ABA3` | 0x2EBB3 | room · 4 + slot | destination room |
| `$A815` | `$AD63` | 0x2ED73 | room · 4 + slot | entry in the destination |
| `$A80D` | `$A823` | 0x2E833 | room · 4 + entry | spawn screen (hi → `$B6`, lo → `$B9`) |
| `$A80F` | `$A9E3` | 0x2E9F3 | room · 4 + entry | spawn x (hi nibble), y (lo nibble × 16) |

- Entering (door object 0E:`$A803` on UP): `$04BE` = slot, then 0F:`$E5B4` sets `$04BE` = `$AD63[...]`, `$4C` =
  `$ABA3[...]`; the room load (0F:`$D3D0`) places Ladd. A building's exit is its own door slot 0.
- Vanilla: zone `$0C` + k → buildings `$37` + 2k (A) and `$38` + 2k (B), entry 0; buildings return to their zone at
  entry 1 (A) or 2 (B), the spots in front of each door, identical in every zone. So moving building B behind door
  (R, s): `ABA3[R·4+s]` = B, `ABA3[B·4]` = R, `AD63[B·4]` = s + 1.
- `$4D` is untouched by building travel. Keyed by the building room (travels with it): its pickup, its CHR, palette
  and objects (the passage trigger in `$3F`), its inside talker (once re-keyed, below). Keyed by the zone (stays):
  NZ14's Permit guard, NZ15's barriers, the door talkers outside, the Destroyers (NZ18).

| Zone | Door A → contents | Door B → contents |
|---|---|---|
| NZ13 `$0C` | `$37`: a bullet | `$38`: Flare |
| NZ14 `$0D` | `$39`: γ, a soldier | `$3A`: 11 bullets |
| NZ15 `$0E` | `$3B`: a 1UP, an empty pickup slot | `$3C`: δ, a soldier (behind the barriers) |
| NZ16 `$0F` | `$3D`: β | `$3E`: a talker, an enemy |
| NZ17 `$10` | `$3F`: the passage trigger | `$40`: a talker |
| NZ18 `$11` | `$41`: Destroyer pickup | `$42`: Destroyer pickup |
| NZ19 `$12` | `$43`: 4 bullets | `$44`: a 1UP, the bombardier (type `$02`) |

Object lists: bank 03, pointers at file 0x0ED7B + 2·room, 5-byte entries `[type][x lo][x hi][y lo][y hi]`, `$FF` end.
Types in buildings: `$79` pickup, `$75` bullet, `$73` 1UP, `$7C` passage trigger, `$2A` exit, `$12` a 2-HP soldier.

## Building people

| Type | Handler | Line | Notes |
|---|---|---|---|
| `$50` Permit guard | 0E:`$B50B` | in room `$0D` without the Permit selected: `$60` (#50) and a push back (0F:`$EFD3`), else `$5E` (#49); immediates at 0E:`$B52C`/`$B53B` | every zone at x `$1C0`; needs the talk button; the check is `$4C` = `$0D` (file 0x3B540) and `$04D8` = 2 (0x3B547, 0x3B55B) |
| `$51` door talker | 0E:`$B551` | 0E:`$B565` + (room − `$0C`) (file 0x3B575) | on contact; by zone |
| `$52`/`$53`/`$54` talker | 0E:`$B59A` | 0E:`$B5FF` + (`$4D` − 13) (file 0x3B60F; the lookup at 0E:`$B5E5`) | used outside (NZ13/14 door A) and inside rooms `$3E`/`$40`; by zone, so the randomizer re-keys the inside ones by room |
| `$65` wanderer | 0E:`$BAB4` | 0E:`$BAFA` + (`$4D` − 13) (file 0x3BB0A) | NZ13, NZ16 |
| `$63` ambusher | 0F:`$FA84` | `LDA #$A8` at 0F:`$FAB4` (operand 0x3FAC5): #86 | NZ19; becomes a fighter (`$3A`) |
| `$02` bombardier | 0E:`$86EC` | 0E:`$8739` `LDA #$78 / JMP $D78A`: #62 | room `$44` |
| `$58`/`$59` | 0E:`$B641`/`$B6B5` | script 2 (#29/#30), once (`$050F`) | NZ15's leader |
| `$7E` Destroyers | 0F:`$F843` | scripts by slot, 0F:`$F884` | NZ18 |

Door talkers by zone (vanilla): NZ13 A `$52` #20, B `$51` #21 (the Flare); NZ14 A `$53` #61 (γ); NZ15 B `$51` #27 (Joe's
camp); NZ16 A `$51` #39 (β); NZ17 A `$51` #73. Inside: room `$3E` #40, room `$40` #27. Non-talkers: `$55`-`$57`
civilians, `$86` a decoration, `$64` the level-exit controller, `$77` NZ14's leaping spikeballs, `$33` NZ16's rolling
robot, `$3B` an enemy. **No neutral-zone person grants items**; items come only from `$79` pickups.

## Building pickups

- **Object `$79`** (0F:`$F5B1` spawn, `$F625` touch). Item: 0F:`$F5FA` + (room − `$37`) (file 0x3F60A), 14 bytes,
  vanilla `FF 0F 18 FF FF 19 17 FF FF FF 04 04 FF FF` (offset from `$04CA`; `$FF` none; owned items don't spawn).
- **Animation:** 0F:`$F608` + 2·(room − `$37`) (file 0x3F618), a metasprite in bank 0A (via 0F:`$D6C7`): `$38` →
  `$AAC2`, `$39` → `$AAF5`, `$3C` → `$AAE4`, `$3D` → `$AAD3`, `$41`/`$42` → `$AB06`. Format `[count]` then
  `[tile][dy][dx][attr]` per sprite; a pickup is 2 × 2 8×8 sprites at (−8, 0), (−8, 8), (0, 0), (0, 8).
- **Machine Gun special cases:** spawn `CMP #$04` at 0F:`$F5CC` (file 0x3F5DC: only if `$04C5` > 0), touch `CPY
  #$0A`/`#$0B` at `$F630`/`$F634` (rooms `$41`/`$42`: `INC $04CE` only if `$04C5` = 1, then `$04C5` = `$FF`). The
  spawn test is also a vanilla bug: `CMP #$04 / BEQ / BMI` tests the compare, so items `$00`-`$03` never spawn.
- **Palettes:** room palette pointers at file 0x0719A + 2·room (bank 01). Building rooms share block `$B82A` (file
  0x0783A) or `$B8AA` (0x078BA); sprite palettes pal 0/1 = Ladd's head and body, pal 2 `30 21 0F` (only pickups use
  it), pal 3 `30 27 0F` (people, the 1UP). Room `$44`'s pal 3 is red.
- **Tiles:** building rooms `$37`-`$39`, `$3B`-`$3D`, `$41`-`$43` share CHR list `00 01 04 05 1A 4E 4F`, which already
  holds the Machine Gun, 3-Way, Flare and communicator icons (sprite tiles `$BD`-`$CF`); other icons go into the
  pickup's tiles `$C5`-`$C8`.
- **Randomizer** (`src/core/pickups.ts`): the CHR loader (0F:`$D2CE`) calls 03:`$AB80`, where id `$7F` builds a record
  in RAM (`$01D8`) from a per-room table: the item's 4 menu tiles → `$C5`-`$C8`; spare id `$17` loads the Permit
  shape's lower tiles. Metasprites use pal 3 where the menu does, else pal 2 recoloured per room (palette block
  copies in bank 01).
- **Pickup messages:** the touch code (0F:`$F62D`-`$F65E`) finds the Destroyer rooms by their item mark instead of
  the room compares, freeing bytes for `LDA #$FA / JSR $D78A` (talk) after the give.

## Sprite CHR loading

- Loader 0F:`$D28D` (data in bank 03): list = 03:`$B8E7` + 2·list number (lists `$00`-`$6B` are rooms, `$6C`-`$71`
  other screens: `$70` the area-clear portrait); a list is record ids ending at a byte ≥ `$80`.
- Record = 03:`$BBB5` + 5·id: `[src lo][src hi: bits 7-6 = bank − 6, bits 5-0 | $80 = page][PPU hi][PPU lo][tiles]`,
  16 bytes per tile into sprite pattern table 0. Ids `$00`-`$58`; the table ends at `$BD72` (code follows). Only
  `$17` and `$45` are in no list; `$59`-`$5D` are the randomizer's extra records (03:`$AB67`).
- Background CHR: 0F:`$D1D5` loads all 256 tiles as 64 groups of 4 from the list at 01:`$A002` + 2·room: 64 block ids
  (bank 4 + (n & 3), `$8000` + 64·id) then 64 nibbles (bit 2: mirrored). Each overhead stage rewrites all 64 groups
  after loading its sprites, so a sprite record aimed at `$1000`-`$1FFF` is overwritten.

## Destroyers

- NZ18's three men are type `$7E` in slots `$0B` (x `$3F0`, right of door B), `$0C` (x `$270`, by door A) and `$0D`
  (x `$3B0`, left of door B); 0F:`$F884` + (slot − `$0B`) gives their scripts: 4 (the real one, Destroyer-3: intro #83,
  YES/NO #121, YES sets `$04C5` bit 0 and shows #85), 6 and 7 (Destroyer-1/2: YES sets bit 1, 0D:`$A3BA`).
- The gun needs a YES to the real one and none to the others; `$04C5` is per visit, so leaving and coming back
  resets a wrong answer.
- Randomizer (`src/core/destroyers.ts`): names and the real man shuffled by permuting the script table, both rooms
  pay out an item (item-table mark `$7E` instead of `$04`), and an impostor's YES (0D:`$A3BA` → `JSR $BFC2`) raises
  the alert, takes 2 pips and knocks Ladd away through the enemy-contact routine 0F:`$EF54` (X = the man's slot;
  0F:`$E7C5` takes a third pip).

## Barriers

- Object `$35` (handler 0F:`$F980`). Damage rule 0F:`$EC8B` (file 0x3EC9B) `LDA $4C / CMP #$05`: in room `$05` (O6)
  only shot type 1 (Rocket Launcher) damages it, elsewhere only type 4 (3-Way Gun).
- Placements: room `$05` x `$1A0` (O6's way to the exit), room `$06` y `$4A0` (O7's climb to the boss), room `$0E`
  (NZ15) two at x `$308`, before door B.
- Persistence: 0F:`$F9C1` (file 0x3F9D1) compares `$4D` with 6/7/15 to pick `$0510` + 0/1/2 (else 3). Node-keyed,
  while the damage rule is room-keyed. NZ15's two share one flag.
- **NZ15 bug:** any shot there raises the alert (`$04C4`, 0F:`$F9E4`), and the alert (0F:`$D72A` → `$DFF3`)
  deactivates every object except a keep-list (doors `$2A`/`$2B`, barriers `$35`, `$64`, `$86`, `$6E`, `$2E`). The
  barrier entry is broken: 0F:`$E000` is `00 35` (BRK) instead of `C9 35`, so barriers vanish. The randomizer fixes
  the byte and sends 0F:`$EC8B` to 0E:`$BFC0`: room `$0E` → type 3 (Machine Gun) or 4, `$05` → 1, else 4.
- Shot types (`$0549` of a player bullet), from the fire dispatch 0D:`$82A2` + 2·weapon: normal 0 (`$8D0A`), Rocket 1
  (`$83B0`), Wide 2 (`$82AF`), Machine Gun 3 (`$8322` → `$8361`), 3-Way 4 (`$8399`); the scripted bazooka is 5.

## Darkness

- An object (type `$80`, bank 0E handler `$B2FD`) dims the palette buffer once the screen scrolls past `$170`
  (`$B6:$B7`): every 8 frames `$10` off the palettes listed at 0E:`$B368` (`04 08 18 1C FF`: BG 1-2, sprites 2-3),
  then one colour of BG 1 and 2 (`$D6`, `$DA`) to dark blue `$0C`. BG 0 (sky) and 3 (trees) stay lit. Scrolling back
  restores it (0F:`$D858`).
- **Flare:** 0D:`$BA6B` (owned, selected `$04D8` = 0, START; once per visit `$04C1`); the level check is 0D:`$BA70`
  `LDA $4C / CMP #$03`. It launches object 7, which at y < `$20` sets `$04C1`; the darkness then restores the palette
  and removes itself.
- **True dark:** the list moved to 0E:`$BF20` with BG 0 and 3 added, and the outline colour black.
- **More dark layouts:** the object lists can't take another object (the loader 03:`$AC10` fills slots 11-18 then
  8-10, 11 at most; O11's is full; O9 keeps slots 11-13 free with three `$81`s that delete themselves). So the loader
  entry (03:`$AC00`) calls 03:`$AA20`, which in those levels also puts the darkness in slot 7 at 0,0, not scrolling
  (`$06A6` = 4). Slots 6-7 are culled when off screen (0F:`$DC80`), hence the fixed position; 0F:`$DE04` hands them out
  only when free. The Flare's check calls 0D:`$BFE9`.

## Door locks

Door object type `$2B` (and `$2A` + index generally); the lock check 0E:`$A7C5` (file 0x3A7D5) in the door's state 0
(0E:`$A7B6`-`$A802`, state table `$A7B0`).

| Room | Door | Needs | Set by |
|---|---|---|---|
| `$00` (O1) | → `$47` | `$04BF` | COMMUNICATE in `$28` (`$14`) |
| `$03` (O4) | the boss door | `$04BF` | `$2B` (`$2A`) |
| `$53` (O8 complex) | the boss door | `$04BF` and `$04C0` | `$34` (`$7E`), `$33` (`$7A`) |

- The flags are per visit. Area 12's own barriers use `$04BF`/`$04C0` too, set by its power systems (0E:`$BE03`/`$BE0A`).
- **Randomizer** (`applyDoorLocks`): bank 0E is full, so state 0 becomes a far call: when the PPU queue is idle
  (else retry next frame), `INC $32`, 0F:`$E65C` copies a trampoline from 0C:`$B710` to `$03FB`, which maps bank 0C
  and runs the setup plus a table of (room, door type, flag address) rows. A row whose flag is 0 locks: state 2
  (0E:`$A7B4` repointed) draws the sealed panel. The boss rooms' exit object (type `$2E`, 0E:`$A834`) jumps into the
  setup at `$A7BF`, which must stay "state 1, no lock" with door index 0.
- **Lockable layouts** (option "Comm Locks"): O2 `$48` door 2 (`$50`), O3 `$49` door 2 (`$68`), O5 `$4B` door 0 (`$3A`,
  `$3E`), O9 level `$08` door 1 (`$88`), O10 level `$09` door 1 (`$B0`). O11's level has no room for a panel (below);
  O6 has no comm room, O7's is cut.

## Door panels

A locked door is drawn sealed in the background instead of the vanilla lock sprite (which flickered and clashed with
enemy tiles):

- Every locked doorway is the same 4 × 4-tile art in one palette, its top left at (object x − `$10`, object y − `$10`
  − `$20` · (y div 256)) in map pixels, on the 16-px grid. So the closed doorway is four 64-byte CHR blocks shared by
  all doors, at 02:`$8F80`, `$8FC0`, `$9F80`, `$9FC0`.
- **Level maps:** chunk pointers at bank 0 `$8000` + 2·room (bit 14: bank 1); a chunk is 8 × 8 metatiles, row-major,
  64 bytes (rows are 224 px apart, so a chunk's eighth row is drawn and collides too). Metatiles (bank 2 `$8000` →
  per room, bit 14: bank 3): 7 bytes, the four 16×16 blocks' base tiles in column order (TL, BL, TR, BR; each block
  t, t+1 below, t+2 right, t+3), attribute, collision. Grid: bank 2 `$8002` + 4·room (pointer, width, height).
- Each locked doorway's chunk is used once, so its byte is rewritten to a metatile copy whose doorway blocks point at
  four background groups no map of those rooms places (nor the animated `$04`-`$0B`, `$24`-`$2B`, nor `$20`-`$23`:
  `$20` is the blank a level is drawn over). The list loads them with the doorway's own blocks, so an open door looks
  as before. O11's level has 2 free groups and a panel takes 4.
- Runtime: one step per frame while the queue is idle, four steps: 0C:`$BF68` copies a block (bank 02 via
  0F:`$E65C`) into the queue, sets `$32` = 1 (the NMI runs the queue before the palette) and the PPU address `$1000` +
  64·group. Scrolling redraws the sealed door from the map.

## Shutter doors

The boss rooms' exit (type `$2E`, 0E:`$A834`) waits for `$40` and for Ladd within `$40` px (0F:`$D70F`), then sets
`$043B`: 0F:`$CCA7` redraws BG tiles behind a shrinking mask until they're blank (`$1D80` from bank 05 `$9F40`). Door
objects `$29`/`$5B`/`$5C` (0E:`$A70B`: rooms `$00`, `$47`, `$49`) use the same redraw through state 3 (wait `$2F`
frames, close). The boss rooms' tile set (rooms `$16`-`$25`, `$54`, `$55`) draws its door with other tiles, so Area
12's miniboss door never visibly opened; the randomizer loads the shutter into that set's `$48`-`$4B` (unused there,
outside both talk boxes: the talk box types into BG `$B8`-`$F7`, style 1 `$80`-`$DF`, and its frame is `$F8`-`$FF`)
and picks the tiles by room (`$1480` in rooms `$20`-`$2F`, else `$1D80`).

## Area 12

- Rooms: start `$0B` (doors to tower `$5E`, comm room `$35`), tower `$5E` (door 1 → power system 1, `$58`), hub
  `$64` (comm room `$36`, tower `$5F`, `$63` the capsule), tower `$5F` (door 1 → the miniboss `$21`; door 2 → power
  system 2, `$59`). Door destinations at 0B:`$ABA3` (4 per room).
- Room `$21` holds an officer and no core: skippable in vanilla. Cores (0E:`$BDE0`) set `$04BF`/`$04C0` in `$58`/`$59`
  and start the area clear (`$CB` = 2, 0E:`$BE16`) elsewhere.
- **Entry condition** (0D:`$A4ED`): vanilla needs Areas 10 and 11; the randomizer calls 0D:`$9C40`, which walks a
  0-terminated list of page-4 flag bytes at `$9C60` (A = 1 when all set; keeps X; Y = `$4D`). Refusal: #115.
- Resuming (`$0514`, set at 0A:`$BD80`/`$BD89`) starts in room `$60`, past the boss.
- **Randomizer locks:** COMMUNICATE in `$35` (`$BC`) sets `$04C8`, in `$36` (`$C2`) `$04C9`; a boss's death ends at
  0E:`$8A7A` `INC $40 / JMP $D6CA`, hooked (→ 0E:`$BF28`) to set `$01DD` in room `$21`. Rows in the door-lock table
  key `$5E`'s door 1 and `$5F`'s doors on them.

## Super Joe

- The rescue plays for the area whose number is in the `CMP` at 0F:`$CA0D` (`LDA $4D / CMP #$07`, operand file
  0x3CA20): bank 0D `$8009` → `$92F0`, which sets `$04F1` directly (0D:`$930A`) and gives no reward. The randomizer
  moves the compare, and turns `STA $04F1` (0D:`$930C`) into `JSR $9CA0`: mark the host area cleared and set `$04F6`.
- The scene (0D:`$94E0`) is a step per message: Ladd #108, then Joe #109, #46, #110, #47, then `$9504`.

## Weapons and fire

- **Fire input** (0D:`$B919`): `LDY $04CA / BNE new / LDA $04D8 / CMP #4 / BNE new / LDA $FA` (held) else `LDA $F8`
  (new press), then `AND #$40` at `$B92C`.
- **Rapid-Fire Device** (normal gun + device selected): 0D:`$B943`, with `LDA $36 / AND #7 / BNE skip` at `$B94A`
  (fire only on frames that are multiples of 8, so taps fire late or not at all) and 3 bullet slots instead of 2.
  The randomizer fires on a new press at once and repeats every 8 frames from it (counter `$01D4`).
- **Machine Gun** (weapon 3, 0D:`$B939` → `$B9E9`): a 3-round burst per press: `$B9E9` starts one when `$07E9`
  (rounds left) = 0 with `$07EA` = 0; `$B9F7` counts `$07EA` down and fires as it passes 0 (then 7). Full auto starts
  the next burst itself with `$07EA` = 7, except while `$07EB` is set (the final boss's scripted bazooka).
- The bazooka: a scripted player shot (0D:`$8128` → `$83C7`, type 5) at the final boss; object `$44` in room `$60` is
  hurt only by type 5 (0F:`$EC73`).
- No hard gate: Boots (contact damage, 0F:`$EEEF`), Pendant/Helmet/Vest (hits absorbed), Pills, Wide Cannon.

## Top-down stages

- Rooms `$13`/`$14` (truck convoys) and `$15` (the underground passage), `$34` = 1. Object stream: 0D:`$9B97` (file
  0x35BA7), three back-to-back segments of 5-byte entries `[scroll hi][scroll lo][type][x][y]`; each stage plays its
  own until the scroll runs out. Only the passage's ends with the Helmet (`00 10 0E 58 3A` at file 0x35C25).
- **Helmet:** type `$0E` (table 0D:`$8580`, handler `$8B69`): spawns while `$04D3` = 0 (`LDA $04D3` at 0D:`$8B73`,
  operand file 0x34B84), touch `LDA #1 / STA $04D3` (0D:`$9067`, operand 0x3507A); metasprite 0A:`$BA06`. The two
  passage objects on the map persist, so a missed pickup can be retried. The randomizer points both operands at the
  new item and loads its icon into sprite tiles `$F2`-`$F5` (records `$45`, `$59`, `$5B`, `$5C`, one tile each: the
  stage uses 8×16 sprites, a column = an even tile over the next) and draws them mirrored (the stage mirrors this
  object). Stage sprite palettes: 0 `36 06`, 1 `20 2A`, 2 `36 15`, 3 `36 21`.
- **Fire** (0D:`$8296` `LDA #$40 / BIT $F8 / BEQ`): new presses only, then a jump on the weapon (0D:`$82A2`). The
  Machine Gun here has its own burst (`$07F4` rounds left, `$07F5` spacing, `$07F6` sweep).
- **Enemy deaths:** type table 0D:`$857F`; deaths through 0D:`$9171` (types 0, 1, 4, 6, 11: nothing, `JMP $D6CA`) or
  `$91CA` (types 7, 9: the end at `$91F2` turns the body into type `$0D`, the +1-continue eagle: handler `$8B39`, art
  0A:`$B9F8` via `$8B50`, touch `$9046` → `$9050` `INC $04FA` up to 9). Type 8 (the jeep, 0D:`$96A1`) has its own death
  (`$9753`), also ending in type `$0D` at `$9771`. The five per-type state tables point at `$9171` (`71 91` at
  0D:`$85A8`, `$86B3`, `$8860`, `$89C2`, `$8AAD`).
- **Drops** (randomizer): every death takes `$91CA`; the end drops a bullet 1 time in 3 (`$36` < `$55`), marked by
  `$065A` = 1, drawn as sprite tile `$FC` over a blank `$FD` (the only pair no stage loads or draws), picked up through
  0F:`$D7BA`. The bionic arm picks drops up too: the touch test (`JSR $8EF1`, against Ladd) also tries the arm's sweep
  box, 0D:`$8F4D` (against slot 4).

## Turrets

- Type `$69` (0E:`$BC4E`) at `$2A0,$40` in boss rooms `$1B`-`$20` (Areas 7, 9, 10, 11, 3, 8), and at `$1C0,$40` in
  Area 12's power rooms `$58`/`$59`. It's invisible: the gun is background (tiles `$00`-`$03` at NT
  `$20D4/$20D5/$20F4/$20F5`, palette 0 alone in its quadrant of `$23CD`; in the power rooms tiles `$F8`-`$FB`, palette
  1, attribute `$23CE` = `$55`).
- States: 0 init (`$0766` = 2, HP `$0779` = 14), 1 firing (0E:`$BC66`: waits until visible, then a 3-shot spread of
  type `$6A` every 256 frames through the spawner `$BCB6`). It never checks hits and its hitbox (0F:`$ED1E` +
  2·type) is 0 × 0.
- Randomizer: the dispatcher and init (0E:`$BC4E`-`$BC65`) become a far call to 0C:`$B7C0`; added hit check (0F:`$EB62`)
  with an 8 × 16 box (Ladd hits it ducking on the top platform), a grey recolour of the gun on death, and the robots'
  explosion.

## Bosses

The commanders (Areas 1, 2, 8, 9, 11) are type `$6B` (0E:`$BCE9`; death through `$817B` → `$8156`, ending at `$8178`);
the robots (3, 5, 10) `$67` (`$BB74`; death `$8287` → `$8253`, ending at `$825B`; they fire type `$68`); the cyborgs
(6, 7, and Area 12's escape) `$5A` (`$B6ED`, ending at `$B900`); the officers (4, 12's miniboss) `$03` (`$882F`, death
`$8A5C`, ending at `$8A7A`). Every death ends in `JMP $D6CA` (object gone); a boss's death never clears the area,
only the core does. The robots' header `$00` gives no portrait.

## Ending

- The final scene is Area 12's room `$63`: Killt's object starts script 8 when Ladd's x reaches `$60` (0A:`$BEA6`),
  Master-D's script 9 starts at 0F:`$F6EE`. Headers: Killt `$0A`, Master-D `$0E`, Ladd `$03`.
- **Cockpit scene:** script 5 (0D:`$A303`, step table `$A32B`) in room `$60`, started 256 frames after the cockpit
  (type `$44`, 0E:`$B25C` `LDA #5 / JMP $D7A5`) is hit; Hal is type `$62` there (his line `$CC` at 0E:`$BA8D`).
  Steps: setup `$A342`, Ladd `$CE`, Master-D `$D0`, then the blank messages `$84`, `$98`, `$DA`, `$AA`, whose headers
  drive the melting face and the explosion.
- Ladd's #124 is a scripted walk (0D:`$B710`, player states 0D:`$AD23`) right after Area 12's exit, then `$CB` = 4.
- The ending proper (`$CB` = 4, `$CD` = 1: 0F:`$C6DD` → bank 0D `$8006` → `$928E`; `$CD` 0 the escape `$9297`, 1 the
  ending via 0F:`$C6B5` → `$C70F` → bank 1 `$B903` → `$BB23`): scenes by `$CE` (table 1:`$BB33`), steps by `$CF`. Scene
  0 `$BBBE` runs once; scene 3 (`$BD89`) prints #7; scene 5 (1:`$BE6D`, steps `$BE72`) is the letter and the
  signature object (type `$13`: the date and "Joe", sprite palette 3) at (`$80`, `$A8`).
- The attract mode's intro (after the game-over screen times out; `$CB` = 0, `$CC` = 2) runs the same scene code:
  ending hooks must check `$CB` = 4.

## Timer

- NMI: 0F:`$C058` (`INC $37`, `$49` busy flag); vector 0F:`$FFFA`. `$FE` is the PPUCTRL shadow; 0F:`$D844` enables NMI,
  `$D84E` disables it; thirteen `STA $2000` sites, all in the fixed bank. **The game switches NMI off for 10-14 frames
  on every screen change**, so an NMI frame counter loses time.
- The randomizer's timer: every `STA $2000` but reset's → `JSR $FFB6` (remember the wanted value in `$01CE`, keep NMI
  on); the NMI vector → 0F:`$FFC2`: count frames in `$01D5`-`$01D7`, then run the game's handler only if it wanted
  NMI. Started at title START with a new game (0F:`$C8A2` → `JSR $FFD8`); CONTINUE keeps it.
- Main state dispatch 0F:`$C6CE` (`$CB`): 0 title `$C6E5`, 1 game `$CA23`, 2 area clear `$CA0D`, 3 `$C9C2`, 4 escape and
  ending `$C6DD`. **Bank 0 is not reliably mapped on the title**: hooks there must be in the fixed bank.
- Printing from another bank: set `$7A/$7B`, map 0B (`LDA #$0B / JSR $DCAA`) and enter the printer at 0F:`$E0AE`.
- The time message lives at `$0490` (map object tables, untouched by the ending, rebuilt by the map).

## New game, lives and continues

- State `$CB` = 1 / `$CC` = 0 (0F:`$CA34`) runs for a new game and after CONTINUE (`$73` tells them apart): `LDA #2 /
  STA $4A` (file 0x3CA45 operand: lives − 1), the new-game inventory at `$CA4C`. The randomizer's hook there
  (0F:`$FFB6`-`$FFCF` area) sets rank, bullets and continues when `$73` = 0.
- Death decrements `$4A`; below 0 is game over (0D:`$B77D`, 0D:`$81BA`). +1 life 0F:`$E0DA` (via `$D7C3`) caps at 9; the
  HUD shows one digit (0F:`$E147`).
- Game over: `$CB` = 0, `$CC` = 1 (0F:`$C725`): CONTINUE is offered only with continues left (0F:`$C76E`, `$C789`,
  `$C7F6`; the digit at `$C84A`); choosing it (0F:`$C871` → `$C8A9`) restores the inventory from `$0100` and spends one
  at 0F:`$C8B6`. Unlimited continues: `$C8B6` → `JMP $C8CD`.
- Health: rank `$04EA` (0-8), health `$0779`.

## Palettes and cosmetics

- Palette buffer `$D0`-`$EF`. Ladd: sprite palette 0 (head: `36 06 0F` skin, red hair, black) and 1 (body: `20 2A 0F`
  white, green, black). The life bar and bullet pickups share palette 1.
- Room palettes: bank 01, file 0x0727A-0x0790F, 32-byte blocks (pointers at 0x0719A + 2·room). 49 blocks hold Ladd's
  palettes at +`$11` (palette 0) and +`$15` (palette 1; the uniform colour at +`$16`). Blocks 0x076DA, 0x076FA and
  0x0779A (ending scenes 1, 2, 5) don't.
- **Hard-coded copies** (also patched): 0F:`$D891` (file 0x3D8A1, `36 06 0F 0F 20 2A 0F`, reloaded when the damage
  flash `$07E0` ends: 0F:`$D883`), 0F:`$D8B8` (0x3D8C8, the default full-screen palette's sprite palette 0, used during
  transitions), 0F:`$D918` (0x3D928, the area-clear screen: uniform at +3 and +6, hair at +2 and +14), 0D:`$B68A`
  (0x3769A). The damage flash alternates with 0D:`$ADAE` (no player colours).
- **Ending scenes** (room palette blocks): 1 and 2 (0x076DA, 0x076FA) sprite palette 1 `06 2A 0F` is the hanging
  Ladd; 3 (0x077FA) BG palettes 1 and 2 hold the uniform as `$19`/`$09` (hair and skin share `$27`/`$17`); 4
  (0x077DA) BG palette 0 `1A 07 36` and 2 `07 1B 00` (uniform `$1A`/`$1B`; `$07` is everyone's hair); 5 none.
- Colour limits: the uniform sits beside white `$20` and black, ruling out `$30`/`$0F`; black hair on the portraits
  (black background) is drawn as `$0C`.

## Portraits

- The header's low nibble − 1 (`$76`) picks the close-up; nibble 0 = none (0F:`$E0BA` `AND #$0F / STA $76 / DEC $76`).
- 0F:`$C38C` reads two bank-0B words: `$8000` → `$A68F` (palette groups, 16 bytes each) and `$8002` → `$A70F` (per
  portrait: art index Y, palette offset); it copies the group to the sprite palettes. Offsets `$60`/`$70`
  (0B:`$A6EF`-`$A70E`) are unused padding (the randomizer puts Joe's own group at `$60`).
- Art: 0F:`$C34C` + Y (word: bank 6 + (hi >> 6), address ((hi & `$3F`) | `$80`) << 8 | lo; 0F:`$C5A1` copies 1 KB to PPU
  `$0000`, tiles `$00`-`$3F`). Layout: 0F:`$C368` + Y → bank 0C `$B900`-`$BE6D`: 48 tile bytes (6 × 8 cells of 8×8
  sprites, row by row; `$80`+ = none), 48 attribute bytes (palette, `$40` h-flip, `$80` v-flip), then mouth pairs
  (tile, talking frame) ended by a byte ≥ `$80`. 0F:`$C5DA` draws it each frame; `$85` flips every 8 frames while
  typing (0F:`$C447`).
- The box positions (8 bytes, 0F:`$C384`; read at `$C5EE`/`$C5FA` and as sprite slots at `$C2D3`) sit between the
  tables and code: the fixed bank has no room for a new portrait index, which is why the robot portrait moves the
  layout table into bank 0B (talk state 1, 0F:`$C38C`, runs with 0B mapped).

| Header | Portrait | Palette group |
|---|---|---|
| `$41` | enemy soldier, mustache | 0 |
| `$42` | cyborg | 1 |
| `$43` | Ladd | 3 |
| `$44` | Super Joe | 3 |
| `$45` | enemy soldier | 0 |
| `$46` | ally officer | 0 |
| `$47` | neutral-zone man | 0 |
| `$48` | HQ officer | 0 |
| `$49` | enemy commander | 0 |
| `$4A` | Killt | 2 |
| `$4B`-`$4D` | Master-D's forms | 5 |
| `$4E` | (bare-headed, moustache) | 0 |
| `$4F` | white-uniform guard | 4 (art of `$46`) |

Group 0 = `26 35 06 | 30 35 26 | 26 35 18 | 26 35 15` (`$18` the ally uniform, `$15` the enemy red, `$06` hair and
shading); group 3 = `26 35 06 | 30 35 26 | 26 35 17 | 26 35 18` (`$06` is Ladd's hair and Joe's eye lines).

## Title screen

Screens are drawn by 0F:`$D73F` (→ `$E198`; pointer table 0F:`$E1E1` by Y: `[PPU hi, lo, ctrl, data]`, ctrl bit 6 = a
run). The title font is BG tiles `$C4`-`$E1` (CHR record `$0D`, file 0x1C010, loaded by list `$6E` from the title
0F:`$C75C` and game over 0F:`$C9F2`), 7 px letters, plane 0 only. Its O (tile `$CD`) is a narrow zero.

## Shared routines

| Routine | What |
|---|---|
| 0F:`$D730` | print message Y |
| 0F:`$D754` | sound Y (restores `$65`) |
| 0F:`$D6C7` / `$D6C4` | start / step an animation (A = hi, Y = lo; data in bank 0A) |
| 0F:`$D6CA` | delete the object |
| 0F:`$D7BA` | +1 bullet (rank-ups) |
| 0F:`$D7C3` | +1 life (cap 9) |
| 0F:`$DCAA` | map bank A at `$8000`; `$DCBE` also stores it in `$65`; `$DCA8` maps `$65` back |
| 0F:`$DDF8`, `$DDFE`, `$DE04` | free object slot finders (11-18, 8-10, 6-7) |
| 0F:`$E65C` | with `$17/$18` = source − 1 and A = bank, copy 64 bytes into the PPU queue (PPU address from 0F:`$E684` + Y; Y = `$A7` → `$1A00`) |
| 0F:`$EB62` | standard hit check (finds a player bullet in the type's box, 0F:`$ECB3`; flash; HP down; dies to state 2) |

**Far calls from a full bank.** Banks 0E and 0F have no room for new code, so the door locks and turrets run their
code from bank 0C through a trampoline: when the PPU queue is idle (`$03FA` = 0), `INC $32` (this frame's NMI uploads
the palette, not the queue), 0F:`$E65C` copies a few bytes from bank 0C into `$03FB`, and `JMP $03FB` runs `LDA #$0C /
JSR $DCBE / JMP main`; main cancels the copy (`$03FA` = 0) and ends `LDA #$0E / JMP $DCBE`, back in bank 0E.
