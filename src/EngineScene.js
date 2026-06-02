/**
 * Engine scene capability contract (ADR 0005).
 *
 * The shape the engine's systems attach to a `Phaser.Scene` — the members
 * engine modules (`NPC`, `NightLayer`, …) may rely on without referencing any
 * specific game scene class. A Game's base scene (this game's `AdventureScene`)
 * provides these by composing the engine systems; the engine never names the
 * game class.
 *
 * `sceneConfig` is intentionally `any` here: its full shape is the engine base
 * scene's config, modeled when the base scene itself is extracted into the
 * engine. Engine modules only read a few optional fields off it.
 *
 * @typedef {import("phaser").Scene & {
 *   bus: import("phaser").Events.EventEmitter,
 *   hotspots: import("./HotspotManager.js").HotspotManager,
 *   walk: import("./WalkController.js").WalkController,
 *   cast: import("./CastDirector.js").CastDirector,
 *   propSprites: Map<string, import("phaser").GameObjects.Sprite>,
 *   sceneConfig: any,
 *   _npcPresence?: Map<string, number>,
 * }} EngineScene
 */

export {};
