/** @typedef {string} HotspotType */
import { cursorFor } from "./cursors.js";
export { DEFAULT_CURSORS } from "./cursors.js";

/**
 * @typedef {object} HotspotConfig
 * @property {string} id
 * @property {HotspotType} type
 * @property {{ x: number, y: number, w: number, h: number }} bounds
 * @property {{ x: number, y: number, facing: "up" | "down" | "left" | "right" } | null} approachPoint
 * @property {Record<string, unknown>} [data]
 * @property {string} [cursor] - optional CSS cursor (e.g. `url('/objects/cursor_exit.png') 0 0, auto`). Overrides the default hand cursor.
 */

/**
 * Registers clickable Hotspots inside a Scene and routes events through
 * `scene.events`:
 *   - `hotspot:hover`   (config)
 *   - `hotspot:unhover` (config)
 *   - `hotspot:click`   (config)
 */
export class HotspotManager {
    /**
     * @param {import("phaser").Scene} scene
     * @param {HotspotConfig[]} hotspots
     */
    constructor(scene, hotspots) {
        this.scene = scene;
        /** @type {Map<string, import("phaser").GameObjects.Zone>} */
        this.zones = new Map();
        for (const h of hotspots) this.register(h);
    }

    /** @param {HotspotConfig} config */
    register(config) {
        const { id, bounds } = config;
        let cursor = cursorFor(config.type, config.approachPoint?.facing, config.cursor);
        const sceneAny = /** @type {any} */ (this.scene);
        const isDisabled = typeof sceneAny.isExitDisabled === "function" && sceneAny.isExitDisabled(config);
        if (isDisabled && config.type === "exit") {
            cursor = "default";
        }
        const interactiveOpts = cursor ? { cursor } : { useHandCursor: true };
        const zone = this.scene.add.zone(bounds.x, bounds.y, bounds.w, bounds.h)
            .setOrigin(0, 0)
            .setInteractive(interactiveOpts)
            .setName(`hotspot:${id}`)
            .setData("hotspot", config);
        zone.on("pointerover", () => {
            const currentIsDisabled = typeof sceneAny.isExitDisabled === "function" && sceneAny.isExitDisabled(config);
            if (currentIsDisabled && config.type === "exit") {
                zone.input.cursor = "default";
            } else {
                zone.input.cursor = cursorFor(config.type, config.approachPoint?.facing, config.cursor);
            }
            /** @type {any} */ (this.scene).bus.emit("hotspot:hover", config);
        });
        zone.on("pointerout", () => /** @type {any} */ (this.scene).bus.emit("hotspot:unhover", config));
        zone.on("pointerdown", () => /** @type {any} */ (this.scene).bus.emit("hotspot:click", config));
        this.zones.set(id, zone);
    }

    /** @param {string} id */
    unregister(id) {
        const zone = this.zones.get(id);
        if (zone) {
            zone.destroy();
            this.zones.delete(id);
        }
    }

    /** @returns {HotspotConfig[]} */
    list() {
        const out = [];
        for (const zone of this.zones.values()) {
            const cfg = zone.getData("hotspot");
            if (cfg) out.push(cfg);
        }
        return out;
    }
}
