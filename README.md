# AdventureEngine

A game-agnostic point-and-click adventure engine built on Phaser 3.

AdventureEngine provides the reusable systems for a Humongous-style adventure game: walking, one-click interaction,
declarative props, inventory, NPC/cast behavior, weather, cutscenes, transitions, UI helpers, and engine-owned state
primitives.

The engine owns no game content. A game supplies characters, items, cast, art keys, scene configs, and domain rules
through registries and configuration at boot.

## Documentation

Start with [docs/index.md](docs/index.md).

Useful entry points:

- [Architecture](docs/architecture.md)
- [Hello World](docs/hello-world.md)
- [Props](docs/props.md)
- [Inventory](docs/inventory.md)
- [NPCs and Cast](docs/npc-and-cast.md)
- [State Store](docs/store.md)

## Local Usage With Deno

In a game project, map the package path in `deno.json`:

```json
{
    "imports": {
        "@adventure-engine/": "../AdventureEngine/src/"
    }
}
```

Then import engine modules by file:

```js
import { createAdventureGame } from "@adventure-engine/createAdventureGame.js";
import { AdventureScene } from "@adventure-engine/AdventureScene.js";
```

## Development

```bash
deno task check
deno task test
```

## License

MIT
