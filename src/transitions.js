import { store } from "./Store.js";
import { engineAssets } from "./EngineAssets.js";

/**
 * Named scene-transition presets and the single helper every scene change runs
 * through. Replaces the copy-pasted `fadeOut → camerafadeoutcomplete →
 * scene.start` block that was duplicated across ~20 scenes.
 *
 * Resolution order (most specific wins):
 *   1. per-call override   — `transitionTo(scene, key, "cinematic")` or `{ duration, color }`
 *   2. per-scene default   — `scene.sceneConfig.transition` (a scene's house style)
 *   3. global default      — DEFAULT_TRANSITION
 *
 * Color is the fade fill (0xRRGGBB); white = everyday room-to-room, black =
 * weightier/darker moments.
 *
 * @typedef {Object} TransitionPreset
 * @property {number} duration
 * @property {number} color
 * @property {boolean} [fadeIn]
 */

/** @type {Record<string, TransitionPreset>} */
export const TRANSITIONS = {
    // White / everyday
    quick: { duration: 400, color: 0xffffff, fadeIn: true }, // snappy (mini-game back-buttons)
    room: { duration: 600, color: 0xffffff, fadeIn: true }, // default room-to-room
    arrival: { duration: 800, color: 0xffffff, fadeIn: true }, // longer destination reveal
    // Black / weightier
    dim: { duration: 500, color: 0x000000, fadeIn: true }, // quickest dark cut
    dramatic: { duration: 600, color: 0x000000, fadeIn: true }, // weightier dark exit
    night: { duration: 700, color: 0x000000, fadeIn: true }, // deeper dark
    cinematic: { duration: 800, color: 0x000000, fadeIn: true }, // season-change intros
};

export const DEFAULT_TRANSITION = "room";

/**
 * @typedef {object} TransitionOpts
 * @property {string} [preset] - a key of TRANSITIONS.
 * @property {number} [duration] - overrides the resolved preset duration (ms).
 * @property {number} [color] - overrides the resolved preset color (0xRRGGBB).
 * @property {boolean} [fadeIn] - opt out of fadeIn for this specific transition.
 * @property {object} [data] - passed to `scene.start` as its data argument.
 * @property {() => void} [onBeforeStart] - runs after the fade, before `scene.start`.
 */

/** @type {string | null} */
export let lastTransitionFrom = null;

export function clearLastTransitionFrom() {
    lastTransitionFrom = null;
}

/**
 * Fade the camera out, then start `targetKey`.
 *
 * If a replay sandbox is active, the call is redirected to {@link exitReplay}
 * — the player is mid-mini-game and "exit" means "return to the wall's owning
 * scene with the snapshot restored," not "go to the literal target."
 *
 * @param {import("phaser").Scene} scene
 * @param {string} targetKey
 * @param {string | TransitionOpts} [opts] - a preset name, or an options object.
 */
export function transitionTo(scene, targetKey, opts = {}) {
    if (store.isReplaying()) return exitReplay(scene);

    lastTransitionFrom = scene.scene.key;

    const o = typeof opts === "string" ? { preset: opts } : { ...opts };
    o.data = { ...(o.data ?? {}), from: scene.scene.key };

    fadeAndStart(scene, targetKey, o);
}

/**
 * Leave a mini-game launched from a replay wall: fade out, restore the real
 * game state, and return to the wall's owning scene (configured via
 * `engineAssets`). Uses {@link fadeAndStart} directly so the replay guard in
 * `transitionTo` doesn't catch us in a tight recursion before the
 * `endReplay()` in `onBeforeStart` ever fires.
 *
 * @param {import("phaser").Scene} scene
 */
export function exitReplay(scene) {
    lastTransitionFrom = scene.scene.key;
    const target = store.getReplayReturnScene() || engineAssets.get("replayDefaultReturn");
    fadeAndStart(scene, target, {
        preset: "quick",
        data: { from: scene.scene.key },
        onBeforeStart: () => store.endReplay(),
    });
}

/**
 * Shared fade-out → `scene.start` worker. Private to this module; callers use
 * `transitionTo` or `exitReplay` instead so the replay sandbox is honored.
 *
 * @param {import("phaser").Scene} scene
 * @param {string} targetKey
 * @param {string | TransitionOpts} opts
 */
function fadeAndStart(scene, targetKey, opts) {
    const o = typeof opts === "string" ? { preset: opts } : opts;
    const name = o.preset ?? (/** @type {any} */ (scene).sceneConfig?.transition) ?? DEFAULT_TRANSITION;
    const base = TRANSITIONS[name] ?? TRANSITIONS[DEFAULT_TRANSITION];
    const duration = o.duration ?? base.duration;
    const color = o.color ?? base.color;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    const cam = scene.cameras.main;
    cam.fadeOut(duration, r, g, b);
    cam.once("camerafadeoutcomplete", () => {
        o.onBeforeStart?.();
        if (o.data !== undefined) scene.scene.start(targetKey, o.data);
        else scene.scene.start(targetKey);
    });
}

/**
 * Opt-in symmetric fade-in upon scene creation. Call this in a scene's create()
 * method instead of `cameras.main.resetFX()` to match the fade out style.
 *
 * @param {import("phaser").Scene} scene
 * @param {string | TransitionOpts} [opts]
 */
export function transitionIn(scene, opts = {}) {
    const o = typeof opts === "string" ? { preset: opts } : opts;
    const name = o.preset ?? (/** @type {any} */ (scene).sceneConfig?.transition) ?? DEFAULT_TRANSITION;
    const base = TRANSITIONS[name] ?? TRANSITIONS[DEFAULT_TRANSITION];

    if (o.fadeIn ?? base.fadeIn) {
        const duration = o.duration ?? base.duration;
        const color = o.color ?? base.color;
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;

        scene.cameras.main.fadeIn(duration, r, g, b);
    } else {
        scene.cameras.main.resetFX();
    }
}
