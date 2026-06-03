# Caper

A point-and-click adventure engine built on Phaser 3.

Caper provides the reusable systems for a Humongous-style adventure game: walking, one-click interaction, declarative
props, inventory, NPC/cast behavior, weather, cutscenes, transitions, UI helpers, and engine-owned state primitives.

The engine owns no game content. A game supplies characters, items, cast, art keys, scene configs, and domain rules
through registries and configuration at boot.

## Install

Caper is published to [JSR](https://jsr.io/@caper/engine) and depends on Phaser 3 as a runtime dependency.

**Deno:**

```bash
deno add jsr:@caper/engine
```

**Node / npm (Vite, webpack, etc.):**

```bash
npx jsr add @caper/engine
npm install phaser
```

## Usage

Everything is imported from the package entry point:

```js
import { AdventureScene, createAdventureGame } from "@caper/engine";

const game = createAdventureGame({
    scenes: [MyScene],
    // ...game config
});
```

See the [public API](mod.js) for the full list of exports.

## Documentation

Start with [docs/index.md](docs/index.md).

Useful entry points:

- [Architecture](docs/architecture.md)
- [Hello World](docs/hello-world.md)
- [Props](docs/props.md)
- [Inventory](docs/inventory.md)
- [NPCs and Cast](docs/npc-and-cast.md)
- [State Store](docs/store.md)

## Local development against an unpublished checkout

To work on a game and the engine side by side without publishing, map the package in your game's `deno.json`:

```json
{
    "imports": {
        "@caper/engine": "../Caper/mod.js"
    }
}
```

## Development

```bash
deno task ci      # lint + fmt:check + check + test
deno task test
```

## Publishing

```bash
deno publish --allow-slow-types
```

Requires the `@caper` scope on JSR. The engine is authored in JavaScript with JSDoc types, so JSR ships it with "slow
types" (no generated `.d.ts`); `--allow-slow-types` acknowledges that.

## License

MIT
