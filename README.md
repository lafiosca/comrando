# Bionic Comrando

A randomizer for **Bionic Commando** (NES, USA). Every seed shuffles items, map layouts, buildings, communicators and
more, with hints that always lead a path through, a spoiler log with the intended route, and a seed simulator for
planning a run.

**Play it at [comrando.com](https://comrando.com).** Bring your own ROM: the randomizer only accepts the No-Intro
dump `Bionic Commando (USA)` (headered or not, or zipped). The ROM never leaves your browser. No ROM is included here,
and none will be provided.

Bugs, ideas and seed reports: [issues](https://github.com/lafiosca/comrando/issues). Please include the seed link
(it carries the version and the seed code).

## Run it yourself

The site is static: once built, any static web host can serve it.

```sh
yarn install
yarn dev          # local site at http://localhost:5173
yarn build        # the static site in dist/
```

Requires Node 24 and Yarn 4. The same generator runs from the command line:

```sh
yarn cli --rom "Bionic Commando (USA).zip" --set areas=shuffled --uniform blue    # a fresh seed
yarn cli --rom "Bionic Commando (USA).zip" --seed SAAAAAAAAAAQ                    # a given seed code
```

To host it the way comrando.com does, with every released version kept online at `v/<version>/` (so old seed links
keep working), `scripts/deploy.ts` uploads a build to an S3 bucket behind CloudFront:

```sh
yarn build && node scripts/deploy.ts --bucket BUCKET --distribution CLOUDFRONT_ID
```

Every released version is a tagged commit here (`v0.24.0`, …). A seed code makes the same game on the same version,
so to reproduce an old seed, build that tag.

## Develop

```sh
yarn check        # typecheck, lint and format check
yarn format       # format
yarn test:fast    # unit tests
yarn test:emu     # emulator tests: patched ROMs played in jsnes
```

The tests need the ROM: `BC_ROM=/path/to/rom.nes yarn test:fast`. Seeds must stay byte-identical within a version, so
a refactor should leave every generated ROM and spoiler unchanged.

- [docs/architecture.md](docs/architecture.md): how the code is organized, from seed code to patched ROM.
- [docs/design.md](docs/design.md): the options, the logic, the hints and the rest of the design.
- [docs/rom-notes.md](docs/rom-notes.md): what the randomizer knows about the game's ROM and RAM.

## How this was made

This randomizer was written almost entirely by an AI coding assistant (Anthropic's Claude, through Claude Code),
directed, play-tested and reviewed by its maintainer. The code, comments and docs reflect that: please judge them on
their own merits, and report what's wrong.

## Legal

The randomizer's code is released under the [MIT License](LICENSE). The site's fonts, Press Start 2P and JetBrains
Mono, are under the SIL Open Font License and are bundled with the site (from Fontsource).

Bionic Commando is © Capcom. This project is not affiliated with or endorsed by Capcom. It contains no ROM data
beyond short byte sequences that patches check before writing, fragments of the game's text, and two small images
derived from the game's graphics (the title logo, with an edit, and the favicon). Those remain Capcom's, as do the
game's dialogue and graphics in general. Some of the randomizer's optional joke dialogue quotes other games and
popular culture; those quotes belong to their owners.
