# Design

What Bionic Comrando does and why. For how the code is organized see [architecture.md](architecture.md); for how the
game works inside the ROM see [rom-notes.md](rom-notes.md).

## Goals

- **A logic-based randomizer** in the style of the A Link to the Past randomizers: a static web page where players
  bring their own ROM (Bionic Commando, USA) and download a patched copy. No game data is hosted.
- **Every seed is beatable without guessing.** If the player follows what the game tells them, nothing can lock them
  out. Deliberate vanilla traps can stay (the Destroyers), as long as the logic never requires walking into one blind.
- **Information over trial and error.** Comm-room dialogue, wiretaps and neutral-zone talkers are rewritten into hints,
  so a player can plan a route. Every seed has a chain of hints from the opening briefing to the end.
- **The game stays readable.** Map numbers never move on the map, every message names the map numbers the player sees,
  and what an item or door needs is something the game can tell you.
- Secondary: quality-of-life fixes and cosmetics.

## Seed codes

Every gameplay option is part of the seed code, together with 54 random bits. The same generator version and seed code
make the same game. A preset's code is its letter plus the random bits (12 characters, e.g. a Brute seed starts with
`B`); any other combination is a custom code starting with `C`, which also carries each option's value (about 24
characters). Codes use uppercase letters and digits without I, O, 0 and 1, so the game's own font can print them on the
final screen and they're easy to read out. Input is case-insensitive.

The generator version isn't in the code. Share links carry it (`?v=<version>&seed=<code>`), and each released version
stays online so old links keep making the same game.

Cosmetic options are not in the code and never affect gameplay.

## Options

Every option and its values, in the order the page shows them. Defaults are the Standard preset.

| Option | Values | Default |
|---|---|---|
| Area Clear Rewards | Vanilla, Shuffled (Super Joe included) | Shuffled |
| Room/Passage Items | Vanilla, Shuffled (the building and passage items join the reward pool; needs shuffled rewards) | Shuffled |
| Area 12 Entry | Vanilla (Areas 10 and 11 cleared), Super Joe, Joe and Areas 10 and 11 | Super Joe |
| Area 12 Door Locks | Open, Comms, Boss, Both (see [Super Joe and Area 12](#super-joe-and-area-12)) | Comms |
| Path 6↔8 Gate | Vanilla (Areas 3 and 6 cleared, γ owned), IFF Code, Open | IFF Code |
| Path 8↔10 Gate | Vanilla (Area 7 cleared, δ owned), Flak Map, Open | Flak Map |
| NZ15 Barriers | Vanilla (any shot), Fixed (the 3-Way Gun), Machine Gun | Machine Gun |
| Darkness | Vanilla (dim, playable), True Dark (pitch black: the Flare is required) | Vanilla |
| Dark Areas | Vanilla (O4 only), More (one or two of O9 and O11 too) | Vanilla |
| Destroyers | Vanilla, Shuffled (named men, a random real one) | Shuffled |
| No Early Rocket Launcher | Off, On (never found before the second region) | On |
| Minimum Logic Depth | Any, 3, 4, 5, 6 | 4 |
| Communicators Required | Off, On (β, γ or δ is required to finish) | On |
| Truck Encounters | Off, On | Off |
| Starting Health | 0-8 pips | 0 |
| Neutral Zone Rooms | Vanilla, Shuffled | Shuffled |
| Neutral Zones | Vanilla, Shuffled | Shuffled |
| Enemy Areas | Vanilla, Shuffled | Shuffled |
| Starting Continues | 0-9, Unlimited | Unlimited |
| Lives Per Game | 1-10 | 3 |
| Map Travel Speed | 1x, 2x (the helicopter only) | 2x |
| Map Markers | Off, On (visited boxes blue, cleared green) | On |
| Map Gates | Off, On (shut gated roads drawn red, gate items shown) | On |
| Communicator Areas | Vanilla, Shuffled | Shuffled |
| Routing Hints | Vanilla, Nonsense, Terse, Normal, Verbose | Normal |
| Story Dialogue | Vanilla, Comedic | Comedic |
| D-1 Portrait | Off, On | On |
| Pickup Messages | Off, On | On |
| Fix Typos | Off, On | On |
| 0->O on Titles | Off, On | On |
| Run Timer | Off, On | On |
| Fix Rapid Fire | Off, On | On |
| Full-auto Machine Gun | Off, On | On |
| Top-Down Drops | Off, On (other enemies in top-down stages drop bullets) | On |
| Top-Down Eagles | Continue, 1-UP, Nothing | 1-UP |
| Boss Turrets | Vanilla, Destructible | Destructible |
| Comm Locks | Vanilla, More (2-3 more), Most | More |

**Presets:**
- **Vanilla**: every option as the original game plays.
- **Standard**: the defaults.
- **Iron**: Standard with a longer, harder route and fewer safety nets:
  - Area 12 Entry Joe and Areas 10 and 11; Area 12 Door Locks Both
  - True Dark; Dark Areas More
  - Minimum Logic Depth 6; Terse hints
  - Truck Encounters On; 0 continues
  - Top-Down Eagles Continue; Boss Turrets Vanilla
  - Comm Locks Most
- **Brute**: Iron with Nonsense hints, Top-Down Eagles Nothing, Top-Down Drops Off and 1x map speed.
- **Chaos**: every option at random, rerolled until a beatable seed comes out.

A loaded seed code whose options match a preset selects that preset.

**Conflicts** are worked out in advance (`settings.ts` `conflicts`): the page strikes out a value that would conflict
with the rest and names the options in the way, and the generator refuses a conflicting code. For example, the IFF Code
gate needs shuffled rewards, since a vanilla reward would usually sit past the gate it opens. Options the rest make
moot (`inertOptions`, e.g. logic depth with vanilla rewards) are dimmed.

## Logic

### Items and locations

| Kind | Items |
|---|---|
| Weapons | Rocket Launcher, Wide Cannon, Machine Gun, 3-Way Gun (the normal gun is always held) |
| Protectors | Pendant, Helmet, Bulletproof Vest |
| Items | Flare, Pills, Permit, Iron Boots, Rapid-Fire Device |
| Communicators | α (always held at the start), β, γ, δ |
| Gate items | IFF Code, Flak Map (when their gates are on) |
| Story | Super Joe (his rescue is a reward like any other) |
| Filler | 1-UP |

Locations:
- the area-clear rewards of Areas 1-11 (Area 12's clear is the win);
- the neutral-zone building pickups, NZ18's Destroyer rooms (one shared item), NZ19 B (the Flak Map's spot);
- the underground-passage stage's pickup.

Items are never consumed. Building and passage pickups show and give the item they hold (the item's menu icon), and
with Pickup Messages on, Ladd says what he got.

### Requirements

What the game itself checks, wherever the shuffles put things:

| Where | Needs |
|---|---|
| O6's level | Rocket Launcher (its barrier) |
| O7's level | 3-Way Gun (its barrier) |
| NZ15, door B | the NZ15 Barriers option's weapon |
| NZ14 (O14) | Permit (the guard at its doors) |
| Dark layouts | the Flare with True Dark; otherwise only a route rule (the vanilla darkness is dim but playable) |
| Comm-locked layouts (O1, O4, O8, plus Comm Locks) | COMMUNICATE in its comm room(s), so the layout's communicator |
| NZ18's Destroyer rooms | YES to the real Destroyer |
| NZ17 (O17) | the room behind door 2 reveals the underground passage |
| The 6↔8 and 8↔10 roads | their gate option (both directions) |
| Area 12 | its entry condition, then its door locks option |

Requirements belong to a layout and travel with it: whatever map number O6 lands on needs the Rocket Launcher.

### Regions

The roads split the map into three regions: the west (map numbers 0-6 and NZ13-16), the central region (7-9 and
NZ17-19) behind the 6↔8 road, and the enemy compound (10-12) behind the 8↔10 road. The hidden passages (14↔17 and
15↔18), revealed in the interrogation room, are another way between the west and the central region.

To keep the three stages strict:
- the Flak Map is only placed past the 6↔8 crossing;
- Super Joe is never in the west (Areas 7-11);
- the interrogation room stays in the central region (behind a door of a zone at map 17-19), so the passages are a
  shortcut earned after crossing, not a free way east;
- the opening briefing names Area 1's layout, which stays in the west (map numbers 1-6).

### True requirements and the route's rules

The logic keeps two views:
- **True requirements**: what the game enforces. These decide whether a seed is beatable, which items are required,
  Minimum Logic Depth and Communicators Required.
- **The route's rules**: what a fair player needs on top. The player never goes into an area with a comm room without
  its communicator in hand (and knowing which one it takes), and never into a dark area without the Flare. The fill
  satisfies these too, so the hints can lead along them.

### Placement

The fill only produces placements a full reachability sweep proves beatable. A layout that strands a fixed item (e.g.
γ beyond the gate with the passage behind it too) is redrawn from the same random streams. The hints' guided player
runs inside the same loop, so a seed whose hints can't lead all the way is redrawn too.

- **Minimum Logic Depth**: the seed needs at least N items it can't be beaten without, besides Joe (an item counts
  when taking its location away leaves Area 12 out of reach). Weak seeds are deepened by swapping items before the
  layout is given up.
- **Communicators Required**: one of those items is β, γ or δ (only where the game enforces it: a comm lock or a
  vanilla gate).
- Both are best effort: after 60 layouts short of them, the deepest seed so far is used, and the spoiler's
  `logicDepth` says what it fell short of. The page's tooltip says so.
- **No Early Rocket Launcher**: the Rocket Launcher can't be obtained in a game that never enters the central region.

## Map layouts

Every number stays where it is on the map; what moves is the layout behind it. A *layout* (written O1-O19) is the
original level that vanilla has at Area or NZ n: its level, comm rooms, boss, buildings and people. Comm rooms are named
after their layout and the order met: O1A, O1B, and so on.

- **Enemy Areas**: the layouts O1-O11 move between map numbers 1-11. Area 0 (the start) and Area 12 stay.
- **Neutral Zones**: the layouts O13-O19 move between map numbers 13-19.

Everything tied to a layout travels with it: its requirements, reward, comm rooms and their messages, its locks, its
communicator, Joe if he's there. Everything that names or shows a number uses the map number: the area-clear screen,
every message naming an area, the hint lines, and the spoiler (which gives every place both, `{ area, layout }`). The
hidden passages still join map numbers 14↔17 and 15↔18. "Areas 10 and 11" in the Area 12 condition means the map
numbers.

## Communicators

- Each communicator works in three layouts of 1-12, as in vanilla. α always works in O1, the briefing's destination.
- O6 has no comm room and O7's was cut, so they never share a communicator: the working comm rooms split 3-3-2-2.
- α's other two layouts always have a working comm room, and at least one is in the west, so α's rooms can carry the
  first clues.
- COMMUNICATE and WIRETAP both check the communicator. The wrong one gives static. A wiretap's alarm still rolls.
- A communicator is a true requirement only at a comm lock. Elsewhere it gates reading the hints (and the route's
  comm-in-hand rule).

**Comm Locks.** Vanilla locks one door in each of O1, O4 and O8 until you COMMUNICATE there (O8 needs both of its rooms).
Comm Locks More adds 2-3 of these, Most all five: the boss doors of O2, O3, O5 (both comm rooms), O9 and O10, opened by
COMMUNICATE in that layout's comm rooms. O11's level has no room for a sealed door (below), O6 has no comm room and O7's
is cut. Every locked door, vanilla ones included, is drawn sealed in the background (a closed panel with the Imperial
emblem) instead of the vanilla lock sprite ([rom-notes](rom-notes.md#door-panels)).

## Buildings

- **Neutral Zone Rooms**: which building interior sits behind which zone door is shuffled. A room's contents, palette,
  pickup and the people inside travel with it.
- Each of the six zones with doors gets one "big" room (one of the five pickup rooms or the interrogation room) and one
  small one (bullets, a 1-UP, an informer), so no zone has two items while another has none.
- The room behind NZ15's barrier is always one of the item rooms. The interrogation room stays east (above).
- The two Destroyer rooms stay behind NZ18's doors, with the Destroyers outside them.
- **People at the doors** stay with the zone and get new lines about what's now behind their door. People inside travel
  with the room; their item lines are regenerated when the item changes.
- The logic follows the doors: whatever is behind NZ14's doors needs the Permit.
- Neutral zones need no communicator, so a player (and the guided player) can look into any zone they reach.

## Destroyers

Vanilla NZ18 has three men (Destroyer-1 at door A, -2 and -3 by door B); only YES to the real one makes the building's
item pay out, and YES to an impostor spoils it for that visit. With Destroyers Shuffled:

- the men get per-seed names from a list of 18 (MURPHY, RIPLEY, DUTCH, …), and a random one is real;
- each asks "ARE YOU WITH THE FEDERATION?". YES to the real one: the item is in his room. YES to an impostor turns the
  zone hostile and spoils the pickup for that visit (the trap stays; it costs a trip, not the item);
- both rooms hold the same item, which can be anything, progression included;
- hints name moles ("HICKS IN AREA 14 IS A MOLE.", one name per line), and Joe's rescue line names the real one when
  the guided player hadn't already taken the item before rescuing him. The guided player only says YES once Joe has
  vouched or both moles are named.

## Super Joe and Area 12

- Joe is a reward in the area-clear pool: clearing his area plays the rescue scene and marks the area cleared. Area 7
  then gives a normal item.
- With hints on, his rescue line also says which communicator Area 12's agents use.
- **Area 12 Entry**: Vanilla (Areas 10 and 11 cleared, Joe optional), Super Joe, or Joe and Areas 10 and 11. The refusal
  message says what's missing.
- **Area 12 Door Locks**:
  - Comms: COMMUNICATE in each of Area 12's comm rooms opens one power system's door.
  - Boss: beating the otherwise skippable mini-boss opens the second power system.
  - Both: the first comm room opens the first power system, the second the mini-boss's room, and the mini-boss the
    second power system.
  - With comms, finishing needs Area 12's communicator.

## Hints

Hint slots:
- COMMUNICATE in comm rooms: safe and re-readable, but they need the area's communicator;
- wiretaps: line and reply, with the vanilla alarm risk;
- the neutral-zone door talkers;
- Joe's rescue line, the informer room, the P.O.W.-camp line.

Area 12's comm rooms stay story text; O1A stays the vanilla "proceed to the open door".

### The guided player

Hints are written by simulating a player who knows only what they've been told:
- they start knowing the briefing's area and α;
- they go only where a line has pointed them, or into any neutral zone they pass;
- they read a comm room only when they know which communicator it takes and hold it;
- they clear a comm-locked area only when they know its comm.

Each slot is decided when that player first reads it, and it points at the next step of a minimal path to Area 12. If
the player gets stuck, the missing step is added to a slot they've already read. So every seed has a chain of clues
from the briefing to the end, readable in time. Slots left over get communicator chains and item hints at random, in
varied wordings ("a toolbox, not rails").

What lines say:
- **Communicators**: where one is held and where it's used ("THIS AREA HOLDS β. TAKE IT TO AREA 4."). An area with no
  comm room gets a "radio silence" line, so the player knows they need nothing there.
- **Items**: where an item is ("FIND X IN AREA Y"), where it's needed ("YOU'LL NEED A ROCKET LAUNCHER FOR AREA 5").
  Wiretaps (enemy chatter) only name area rewards.
- **Joe**: door talkers never hand over Joe's area; the P.O.W.-camp line points at the comm room or wiretap that has
  the details.
- **The Destroyers**: moles and Joe's tip (above).

### Levels

| Level | What it does |
|---|---|
| Terse | Just the path, one line per room. Item clues about Areas 1-11 are 45% two-area guesses ("AREA 3 OR 6") and 30% region clues ("IN THE WEST") |
| Normal | Up to two lines per room plus random extras; 30% two-area guesses, 10% region clues |
| Verbose | Up to three lines, every slot filled, exact areas |
| Vanilla | The original lines, with only what the shuffles made false corrected: area numbers follow their layouts, door talkers name what's really inside, communicator lists name the right areas. Not built to lead a full path |
| Nonsense | No hints at all: every hint slot, the briefings and Area 12's comm rooms say silly lines from the randomizer's own pools instead (memes and quotes). Wiretaps, Area 1's briefing and Joe's rescue are cut to one message each |

### Joe's trail

As in vanilla, the trail to Joe can lead somewhere first. A line read early names a decoy area past the west (never
Joe's, always one whose communicator the clues state), and that area's boss says Joe was just moved. The real clue
("THEY'VE MOVED JOE TO AREA X") is told late: when nothing else is left to go on, or in one of the last lines read. No
spare line, no trail, and no boss says the transfer line. The spoiler's `joeTransferBoss` names the decoy.

## Story dialogue

- **Vanilla**: the original story, with what the shuffles made false corrected (story.ts): Joe's whereabouts, Area 12's
  condition (Hal's line), the briefing's area, and every message naming an area.
- **Comedic**: every boss gets its own line from pools by portrait, so no two say the same thing; some bosses reply when
  they die. Joe's rescue speech, the escape radio, the self-destruct warnings, Joe's letter and the final scene get
  comedic versions too (one per seed).
- With Nonsense hints and Vanilla story, the bosses say lines from the talkers' Nonsense pool.
- **Fix Typos**: spelling and grammar fixes to the vanilla text, a space after commas where the page has room, the
  Oxford comma in lists of areas, broken words whole again. Each fix keeps the message's page count.

## The spoiler

The spoiler file is data, not prose ([spoiler.ts](../src/core/spoiler.ts)): places are `{ area, layout }`, items and
locations are ids, dialogue is `{ speaker, text }` lines. It lists the settings, rewards, required items, logic depth,
the routes, buildings, communicators, hints, Destroyers, dark and locked areas, layouts, the playthrough by sphere and the
cosmetics. The page renders it in English (routetext.ts); other renderings and translations can work from the data.

### The routes

- **Full route**: a replay of a reasonable player who follows only the finished hints. From where they are, they go to
  the nearest known place with something to do (by the roads open to them and their lengths on the map), do everything
  they can there, and keep the steps the win depends on in play order; the rest are shown in italics. Each visit says
  what sent the player there ("suggested by 1c", citing route steps), its requirements and how the player knows them
  ("per 4c", "check area" when no hint says), and its steps lettered a, b, c.
  - **Probes**: an area whose clear needs something no clue mentioned gets a visit "Enter: needs Flare", and a later
    "return with Flare".
  - **Neutral zones on the way**: when a zone not yet looked into is near the path, the player swings by it.
  - **Trial and error**: out of leads, the player looks into unseen zones, then tries the nearest area whose
    communicator no clue told with the ones they carry, and as a last resort guesses at the Destroyers. With hints
    Vanilla or Nonsense, the route is all this.
  - **Finishing**: once everything Area 12 still needs is known and reachable, the player goes straight for it.
- **Abridged route**: the full route without what the win didn't need; cited steps are renumbered.
- **Oracle route**: the shortest way through for a player who knows every placement (true requirements only, by the
  roads' lengths, fewer stops on a tie). It notes what it skips that the full route waits for (e.g. a dark area cleared
  without the Flare: "Flareless").

## The simulator

The Simulator plays a seed without the game, in the style of z3rsim for A Link to the Past:
- **Free travel**: any place the open roads reach can be visited. Doing something there gives an item, or a line that
  teaches something, or shows what it takes.
- **Fog of war**: the player sees only what they would know. A comm room's static rules out the communicator tried;
  clues land on the places they name; maybes are narrowed as places are emptied.
- **Brute force is explicit**: Go Flareless in a dark area, guess at a Destroyer.

It's drawn with the game's own map screen, item icons and portraits, read from the player's ROM.

## Credits and final screen

Every seed except a fully vanilla one (Vanilla preset) changes two parts of the ending:

- **Credits**: the credits scene's first message (#36) becomes the randomizer's credits (who designed it, that the ROM
  is a custom one generated at comrando.com). The Capcom staff messages after it are unchanged.
- **Final screen**: in place of the date and Joe's signature over black, the screen shows:
  - MISSION TIME (with Run Timer on);
  - RUN STYLE (the preset's name, or CUSTOM);
  - the SEED code and the generator VERSION;
  - GENERATED AT COMRANDO.COM and THANK YOU FOR PLAYING!;
  - a pink heart where the date was, and Joe's signature.

With Run Timer on, the game's real time from START to the end of the escape is also shown after Ladd's last message.

## Cosmetics

Not in the seed code, never drawn from the gameplay random streams:
- Ladd's uniform and hair color, and the enemies' uniform color (presets or random; the two uniforms never match when
  either is random);
- the D-1 Portrait, Fix Typos and 0->O on Titles options change only text and graphics, but are part of the seed code so
  a shared seed looks the same for everyone.

The title screen always reads BIONIC COMRANDO.
