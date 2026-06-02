/**
 * @typedef {"pickup" | "look" | "exit" | "subscene" | "use-with"} HotspotType
 */

/**
 * Default CSS cursors per hotspot type. Per-hotspot `cursor` overrides.
 * Hotspot coords (x y) target the part of the cursor that actually points
 * (fingertip, claw tip, arrow tip).
 *
 * Note: `exit` is direction-aware — see `defaultCursorFor()` below.
 */
export const DEFAULT_CURSORS = Object.freeze({
    pickup: "url('/objects/cursor_grab.png') 21 21, grab",
    "use-with": "url('/objects/cursor_point.png') 21 21, grab",
    look: "url('/objects/cursor_look.png') 20 20, pointer",
    subscene: "url('/objects/cursor_point.png') 0 0, pointer",
    exit: "url('/objects/cursor_exit.png') 16 16, pointer",
});

/**
 * Direction-aware exit cursors. Each cursor's tip is on the side it points
 * toward; the hotspot coords aim at that tip. `up` reuses the right-pointing
 * arrow (per design — "going further into the scene" reads as a right-arrow
 * cue); `down` is unused for now and falls back to the default rotated arrow.
 * @type {Partial<Record<"up" | "down" | "left" | "right", string>>}
 */
const EXIT_CURSORS_BY_FACING = Object.freeze({
    left: "url('/objects/cursor_exit_left.png') 5 40, pointer",
    right: "url('/objects/cursor_exit_right.png') 100 40, pointer",
    up: "url('/objects/cursor_exit_right.png') 100 40, pointer",
});

/**
 * Resolve the cursor for a hotspot: explicit `config.cursor` wins, then
 * direction-aware exit, then per-type default.
 * @param {HotspotConfig} config
 * @returns {string | undefined}
 */
function defaultCursorFor(config) {
    if (config.cursor) return config.cursor;
    if (config.type === "exit") {
        const dirCursor = EXIT_CURSORS_BY_FACING[config.approachPoint?.facing];
        if (dirCursor) return dirCursor;
    }
    return DEFAULT_CURSORS[config.type];
}

/**
 * @typedef {object} HotspotConfig
 * @property {string} id
 * @property {HotspotType} type
 * @property {{ x: number, y: number, w: number, h: number }} bounds
 * @property {{ x: number, y: number, facing: "up" | "down" | "left" | "right" }} approachPoint
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
        let cursor = defaultCursorFor(config);
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
                zone.input.cursor = defaultCursorFor(config);
            }
            (/** @type {any} */ (this.scene).bus).emit("hotspot:hover", config);
        });
        zone.on("pointerout", () => (/** @type {any} */ (this.scene).bus).emit("hotspot:unhover", config));
        zone.on("pointerdown", () => (/** @type {any} */ (this.scene).bus).emit("hotspot:click", config));
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
