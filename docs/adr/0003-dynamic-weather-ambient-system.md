# 0003 — Dynamic Weather & Ambient system

Status: **accepted** Date: 2026-05-29

## Decision

The weather system is refactored to treat **precipitation** (rain/snow) and **ambient effects** (falling leaves) as two
independent channels. Precipitation remains a global game state rolled upon scene entry, while ambient effects are tied
to the current season and the specific capabilities of the scene.

Each `AdventureSceneConfig` now defines these via two separate record blocks: `weather` and `ambient`. If a season is
omitted from either block, the system falls back to the _previous_ season and keeps walking: `summer` falls back to
`spring`, `fall` to `summer`, `winter` to `fall`, and `spring` wraps to `winter`. The chain stops at the first explicit
entry; if no season matches, the resolver returns `["none"]`. Omitting a block entirely on a scene is equivalent to
declaring `["none"]` for every season — that scene never participates in that channel (an indoor scene, or a scene that
never rains, etc.).

## Context

Previously, weather was a single mode. This created a conflict during the "Fall" season: falling leaves are a constant
ambient characteristic of autumn, but rain is a random occurrence. Forcing them into a single "roll" meant that if it
rained, the leaves stopped, or if leaves were rolling, it couldn't rain.

The goal was to allow:

1. **Simultaneous effects**: Rain and falling leaves occurring at once in the fall.
2. **Scene-specific constraints**: A scene can have ambient effects in certain seasons but never precipitation (regardless of
   the global weather roll).
3. **Indoor safety**: Indoor scenes should be immune to both precipitation and ambient effects without requiring
   repetitive "none" configurations.

## The Dual-Channel Model

The `WeatherLayer` now tracks two distinct states: `weatherMode` (Precipitation) and `ambientMode` (Ambient).

### 1. Precipitation Channel (`weather`)

- **Source**: Controlled by `store.get("weatherMode")`.
- **Resolution**: When entering a scene, the engine checks the scene's `weather` config for the current season.
- **Application**: If the current global `weatherMode` is present in the scene's allowed list for that season, it is
  rendered. Otherwise, `"none"` is applied.
- **Trigger**: Triggered by the game's weather-roll logic on world-scene entry.

### 2. Ambient Channel (`ambient`)

- **Source**: Derived from the current `season`.
- **Resolution**: The engine checks the scene's `ambient` config for the current season.
- **Application**: If the season's default ambient effect (e.g., `"falling-leaves"` in fall) is present in the scene's
  allowed list, it is rendered.
- **Trigger**: Applied immediately on scene `create()` and updated via `store.onChange`.

```javascript
// Example: Outdoor scene in Fall
weather: {
    spring: ["none", "light-rain", "heavy-rain"],
    summer: ["none", "light-rain", "heavy-rain"],
    fall: ["none", "light-rain", "heavy-rain"],
    winter: ["none", "snow", "heavy-snow"],
},
ambient: {
    fall: ["falling-leaves"]
}
```

## Implementation Details

### `AdventureScene` Orchestration

The base `AdventureScene` handles the resolution of these modes:

- **Initial State**: In `create()`, it resolves the modes and instantiates the `WeatherLayer` with both.
- **Reactive Updates**: It subscribes to `store.onChange`. If the season or global weather changes, it re-evaluates
  the allowed modes and calls `weather.setWeatherMode()` or `weather.setAmbientMode()` accordingly.

### `WeatherLayer` Rendering

The `WeatherLayer` maintains independent arrays for rain drops and leaf sprites. Its `_tick` (update) loop processes
both channels independently, allowing the `gfx` (rain) and `sprites` (leaves) to overlap visually.

### Entity Interaction

NPCs and Critters react to the precipitation channel:

- **Outdoor NPCs** check the global `weatherMode`. If it is raining/snowing, they execute a
  `retreatIndoors()` routine (walking to a `doorPoint` and hiding).
- **Flying Critters** are set to `setVisible(false)` during precipitation.
- **Ground Critters** remain visible, as some animals (like frogs) do not hide from rain.

## Consequences

- **Visual Richness**: Scenes can now feel more alive by layering multiple atmospheric effects.
- **Configuration Flexibility**: Removing the `weather` block from a scene now implicitly means "this scene never has
  precipitation," simplifying indoor scene configs.
- **Consistency**: Hiding logic is now centralized around the `weatherMode` state, ensuring all outdoor entities react
  consistently to rain.
- **Complexity**: Adds a small amount of overhead to the `AdventureScene` lifecycle to track four state variables
  (`currentSeason`, `currentWeather`, `currentAmbient`, `currentTimeOfDay`) and their corresponding transitions.

## Scope Boundary

- **In**: Precipitation and Ambient effect logic, `WeatherLayer` dual-mode support, NPC/Critter hiding triggers.
- **Out**: Day/Night tinting (handled by `NightLayer`), complex weather transitions (e.g., gradual fade into rain).
