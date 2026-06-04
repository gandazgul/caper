# 0003 — Dynamic Weather & Ambient system

Status: **accepted** Date: 2026-05-29

## Decision

The weather system is refactored to treat **precipitation** (rain/snow) and **ambient effects** (falling leaves) as two
independent channels. Precipitation remains a global game state rolled upon scene entry, while ambient effects are tied
to the current chapter and the specific capabilities of the scene.

Each `AdventureSceneConfig` now defines these via two separate record blocks: `weather` and `ambient`. Each block is a
**direct per-chapter lookup with no inheritance and no chapter ordering** — the engine knows nothing about how a game's
chapters relate. A chapter a block doesn't list allows only `["none"]`, so a game lists every chapter it wants a mode in
explicitly. Omitting a block entirely on a scene is equivalent to declaring `["none"]` for every chapter — that scene
never participates in that channel (an indoor scene, or a scene that never rains, etc.).

## Context

Previously, weather was a single mode. This created a conflict during chapter2: falling leaves are a constant ambient
characteristic, but rain is a random occurrence. Forcing them into a single "roll" meant that if it rained, the leaves
stopped, or if leaves were rolling, it couldn't rain.

The goal was to allow:

1. **Simultaneous effects**: Rain and falling leaves occurring at once in chapter2.
2. **Scene-specific constraints**: A scene can have ambient effects in certain chapters but never precipitation
   (regardless of the global weather roll).
3. **Indoor safety**: Indoor scenes should be immune to both precipitation and ambient effects without requiring
   repetitive "none" configurations.

## The Dual-Channel Model

The `WeatherLayer` now tracks two distinct states: `weatherMode` (Precipitation) and `ambientMode` (Ambient).

### 1. Precipitation Channel (`weather`)

- **Source**: Controlled by `store.get("weatherMode")`.
- **Resolution**: When entering a scene, the engine checks the scene's `weather` config for the current chapter.
- **Application**: If the current global `weatherMode` is present in the scene's allowed list for that chapter, it is
  rendered. Otherwise, `"none"` is applied.
- **Trigger**: Triggered by the game's weather-roll logic on world-scene entry.

### 2. Ambient Channel (`ambient`)

- **Source**: Derived from the current `chapter`.
- **Resolution**: The engine checks the scene's `ambient` config for the current chapter.
- **Application**: If the chapter's default ambient effect (e.g., `"falling-leaves"` in chapter2) is present in the
  scene's allowed list, it is rendered.
- **Trigger**: Applied immediately on scene `create()` and updated via `store.onChange`.

```javascript
// Example: Outdoor scene in chapter2
weather: {
    intro: ["none", "light-rain", "heavy-rain"],
    chapter1: ["none", "light-rain", "heavy-rain"],
    chapter2: ["none", "light-rain", "heavy-rain"],
    chapter3: ["none", "snow", "heavy-snow"],
},
ambient: {
    chapter2: ["falling-leaves"]
}
```

## Implementation Details

### `AdventureScene` Orchestration

The base `AdventureScene` handles the resolution of these modes:

- **Initial State**: In `create()`, it resolves the modes and instantiates the `WeatherLayer` with both.
- **Reactive Updates**: It subscribes to `store.onChange`. If the chapter or global weather changes, it re-evaluates the
  allowed modes and calls `weather.setWeatherMode()` or `weather.setAmbientMode()` accordingly.

### `WeatherLayer` Rendering

The `WeatherLayer` maintains independent arrays for rain drops and leaf sprites. Its `_tick` (update) loop processes
both channels independently, allowing the `gfx` (rain) and `sprites` (leaves) to overlap visually.

### Entity Interaction

NPCs and Critters react to the precipitation channel:

- **Outdoor NPCs** check the global `weatherMode`. If it is raining/snowing, they execute a `retreatIndoors()` routine
  (walking to a `doorPoint` and hiding).
- **Flying Critters** are set to `setVisible(false)` during precipitation.
- **Ground Critters** remain visible, as some animals (like frogs) do not hide from rain.

## Consequences

- **Visual Richness**: Scenes can now feel more alive by layering multiple atmospheric effects.
- **Configuration Flexibility**: Removing the `weather` block from a scene now implicitly means "this scene never has
  precipitation," simplifying indoor scene configs.
- **Consistency**: Hiding logic is now centralized around the `weatherMode` state, ensuring all outdoor entities react
  consistently to rain.
- **Complexity**: Adds a small amount of overhead to the `AdventureScene` lifecycle to track four state variables
  (`currentChapter`, `currentWeather`, `currentAmbient`, `currentTimeOfDay`) and their corresponding transitions.

## Scope Boundary

- **In**: Precipitation and Ambient effect logic, `WeatherLayer` dual-mode support, NPC/Critter hiding triggers.
- **Out**: Day/Night tinting (handled by `NightLayer`), complex weather transitions (e.g., gradual fade into rain).
