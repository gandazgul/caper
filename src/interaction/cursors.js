import { engineAssets } from "../assets/EngineAssets.js";

/** Legacy defaults retained for existing games. Resolution happens at use time. */
export const DEFAULT_CURSORS = Object.freeze({
    pickup: "url('/objects/cursor_grab.png') 21 21, grab",
    "use-with": "url('/objects/cursor_point.png') 21 21, grab",
    look: "url('/objects/cursor_look.png') 20 20, pointer",
    subscene: "url('/objects/cursor_point.png') 0 0, pointer",
    exit: "url('/objects/cursor_exit.png') 16 16, pointer",
});

const EXIT_CURSORS = Object.freeze({
    left: "url('/objects/arrow_left.png') 1 38, url('/objects/cursor_exit_left.png') 5 40, pointer",
    right: "url('/objects/arrow_right.png') 95 38, url('/objects/cursor_exit_right.png') 100 40, pointer",
    up: "url('/objects/arrow_up.png') 36 1, url('/objects/cursor_exit_right.png') 100 40, pointer",
    down: "url('/objects/arrow_down.png') 38 95, url('/objects/cursor_exit_right.png') 100 40, pointer",
});

/**
 * Shared by walking hotspots, in-place props, and inventory dragging.
 * Explicit CSS wins; registered cursors are verbatim, default URLs use the configured base.
 * @param {string} type
 * @param {"left" | "right" | "up" | "down"} [facing]
 * @param {string} [explicit]
 * @returns {string}
 */
export function cursorFor(type, facing, explicit) {
    if (explicit) return explicit;
    const custom = engineAssets.get("cursors")?.[type];
    const directional = type === "exit" && facing ? engineAssets.get("exitCursors")?.[facing] : undefined;
    if (directional || custom) return directional ?? custom;
    const css =
        (type === "exit" && facing ? EXIT_CURSORS[facing] : undefined) ??
        /** @type {Record<string, string>} */ (DEFAULT_CURSORS)[type];
    if (!css) return type || "pointer";
    const base = engineAssets.get("cursorBaseUrl") ?? "/objects/";
    return css.replaceAll("/objects/", `${base.replace(/\/$/, "")}/`);
}
