# Weather & Night

The engine provides two atmospheric systems: a **WeatherLayer** for precipitation and ambient effects, and a
**NightLayer** for day/night visual styling.

## WeatherLayer

The weather system treats **precipitation** (rain/snow) and **ambient effects** (falling leaves) as two independent
channels. They can run simultaneously — rain with falling leaves in chapter2, for example.

### Precipitation modes

| Mode           | Description                                  |
| -------------- | -------------------------------------------- |
| `"none"`       | No precipitation                             |
| `"light-rain"` | Light rain, 110 drops, slight slant          |
| `"heavy-rain"` | Heavy rain, 320 drops, steeper slant, tinted |
| `"snow"`       | Light snow                                   |
| `"heavy-snow"` | Heavy snow                                   |

### Ambient modes

| Mode               | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `"none"`           | No ambient effect                                                |
| `"falling-leaves"` | Falling leaf sprites with independent sway, spin, and fall speed |

### Scene configuration

Configure which weather and ambient modes are allowed per chapter:

```js
// In your scene config:
weather: {
    intro: ["light-rain"],
    chapter1: ["light-rain", "heavy-rain"],
    chapter2: ["light-rain", "heavy-rain"],
    chapter3: ["snow", "heavy-snow"],
},
ambient: {
    chapter2: ["falling-leaves"],
},
indoors: true,  // ← indoor scenes are immune to weather by convention
```

When a chapter is omitted, the system walks backwards through the chapter order
(`intro → chapter3 → chapter2 → chapter1`) to find the nearest explicit entry. A completely omitted block defaults to
`["none"]`.

### Rain/snow rendering

Rain and snow are procedurally drawn — no preloaded assets. Drops are Graphics lines, each with independent position,
speed, slant, length, and alpha.

### Leaf rendering

Falling leaves use sprites from the game-supplied `engineAssets.get("leaves")` atlas. Each leaf has independent fall
speed, horizontal sway (sinusoidal), tilt-by-sway-phase, and steady rotation.

## NightLayer

The NightLayer applies a dark-blue multiply overlay when `timeOfDay` is `"night"`. It handles:

- **Dark overlay** — semi-transparent blue covering the background and weather
- **Moon** — crescent moon with atmospheric halo (procedurally drawn, no art asset)
- **Lit windows** — additive glow patches for windows, lamps, and other light sources
- **Actor pass** — player and NPCs rendered above the dark overlay with a night tint

### Lit window configuration

```js
// In your scene config via nightLayer config:
nightLayer: {
    windows: [
        { x: 200, y: 300, w: 60, h: 80, type: "rect", color: 0xffdd88, flicker: true },
        { x: 500, y: 250, type: "oval", radius: 40, flicker: 0.5 },
        { x: 700, y: 350, type: "glow", color: 0xffaa44, glowScale: 2 },
    ],
    moon: { x: 800, y: 100, radius: 30, color: 0xfff3c4, glowScale: 1.2 },
    lanternflies: { bounds: { x: 100, y: 100, w: 600, h: 400 }, frequency: 1 },
}
```

Window types:

| Type     | Position        | Shape                                        |
| -------- | --------------- | -------------------------------------------- |
| `"rect"` | Top-left corner | Sharp rectangle                              |
| `"oval"` | Center          | Soft oval                                    |
| `"glow"` | Top-left corner | Radial soft gradient (for irregular windows) |

`flicker` controls candle wobble: `true` = default amplitude, `0.5` = subtler, `2` = more pronounced.

### Actor depth management

Every actor (player via `WalkController`, NPCs) is tagged with `nightActor: true` on their sprite data. The NightLayer
scans the scene's children on night entry and re-depths them above the overlay:

```
Night actors:  depth = 8000 + (y / 1000) + bias
Windows:       depth = 8000
Overlay:       depth = 6000
```

`nightDepthBias` data allows fine-tuning (e.g. a wearable sitting just above its character).

## Usage

```js
// The base scene handles weather and night automatically based on Store state.
// Manual control:

// Set weather:
this.weather.setWeatherMode("light-rain");
this.weather.setAmbientMode("falling-leaves");

// Set time of day (triggers NightLayer):
store.setTimeOfDay("night");

// Query state:
store.getTimeOfDay(); // → "day" | "night"
store.isNight(); // → boolean
```
