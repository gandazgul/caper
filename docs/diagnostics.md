# Content diagnostics

Enable authored-content checks per scene during development:

```js
super({
    key: "Cottage",
    diagnostics: "error", // or "warn" to report without stopping creation
    // backgroundsByChapter, walkable, props, ...
});
```

Checks run after preloading and atlas registration, before the room is built. Each message identifies the scene, prop
index/id, state index, and effect index. The starter enables error mode so mistakes are visible immediately.

The checks cover duplicate/empty prop ids, malformed states/effect arrays, unknown or multiple effect verbs, missing
approach points, unregistered scene destinations, missing inventory ids, and missing textures/frames/animations. They
inspect both click and drop effects, including state-specific art and `transitionsTo` metadata. Registered item
resolvers are honored. `$self` resolves to the prop id; `$dragged` is dynamic and is not guessed.

For content loaded later, call `validateSceneContent(scene, "warn")` yourself. `inspectSceneContent(scene)` returns
`{ path, message }[]` without logging or throwing, suitable for custom authoring tools. The inspector does not execute
effects or game scripts, and does not attempt to prove puzzle solvability or validate arbitrary state keys. Assets
referenced by inspected data must already be loaded; leave automatic checks off for scenes that intentionally load their
content later, then inspect when ready.

Diagnostics are off by default and do not change existing games' runtime behavior.
