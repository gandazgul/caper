# The Garden Gate

A complete two-room Caper adventure with one playable character, a key-and-gate puzzle, an NPC, an ending, automatic
resume, and Start over. All artwork is local, editable SVG under the repository's MIT license. No external assets or
accounts are required.

From the Caper repository root:

```sh
deno task starter
```

Open the URL printed by Vite. Click the key on the bench, drag it from the inventory to the gate, click the gate, and
speak to the gardener. Reload to resume. Use **Start over** for a fresh playthrough. Shift+D displays geometry and
Shift+E lets you move prop/approach coordinates; P copies the edited prop definitions.

## Make it yours

- `main.js`: boot registration, two scene configs, and the story rules.
- `art/`: replace the SVGs with your own art; register matching texture keys in Boot.
- `vite.config.js`: local engine alias and relative deployment base.
- Change the save key before making a new game so its progress is independent.
- Add a room by extending AdventureScene, putting it in `config.scene`, and adding a prop with `goToScene` pointing at
  its key.
- Extend a puzzle using ordered prop states and `when` conditions. Keep special game rules in the game; use `emit`
  effects to reach custom code.

## Build and deploy

```sh
deno task starter:build
deno task starter:preview
```

Upload the contents of `examples/starter/dist/` to any static host. The relative base and bundled asset URLs support
hosting below a path such as `/games/garden/`. Serve through HTTP; opening index.html through a file URL is unsupported.

This checkout uses the local engine through the Vite alias. To move the starter into its own repository, install Phaser
and Vite, add `@caper/engine` through JSR, and remove the local engine alias. Keep the Phaser dedupe setting so the
engine and game share one runtime.

SVGs use `?no-inline` because Phaser's SVG loader expects a URL or a base64 data URI, whereas Vite can otherwise produce
percent-encoded SVG data URIs.
