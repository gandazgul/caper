import Phaser from "phaser";

/**
 * Engine bootstrap factory (ADR 0005). The single front door a game uses to
 * start: it runs the game's boot registration (content / cast / characters /
 * icon types) and then constructs the Phaser game. A thin convenience over the
 * Phaser-native path — the registries and `new Phaser.Game(...)` stay directly
 * usable, so a game can bypass this and wire things by hand if it prefers.
 *
 * @typedef {object} AdventureGameManifest
 * @property {Phaser.Types.Core.GameConfig} config - the Phaser game config
 *   (dimensions, scale, physics, scene list, …).
 * @property {() => void} [register] - boot registration, run once before the
 *   game starts (populates the engine registries from the game's catalogs).
 */

/**
 * @param {AdventureGameManifest} manifest
 * @returns {Phaser.Game}
 */
export function createAdventureGame(manifest) {
    manifest.register?.();
    return new Phaser.Game(manifest.config);
}
