import { content } from "../inventory/ContentRegistry.js";

/** Supported declarative effect verbs. Keep in sync with PropEngine.runEffect. */
export const PROP_EFFECT_VERBS = Object.freeze([
    "playReach",
    "set",
    "setItemState",
    "addTo",
    "removeFrom",
    "tween",
    "destroy",
    "pickup",
    "goToScene",
    "pushSubscene",
    "showThought",
    "emit",
]);

/** @typedef {{ path: string, message: string }} ContentDiagnostic */

/**
 * Inspect authored scene data after preload/atlas registration. Does not mutate
 * the scene or execute effects, guards, or game scripts. Dynamic $dragged item
 * references are intentionally deferred to runtime.
 * @param {import("../scene/AdventureScene.js").AdventureScene} scene
 * @returns {ContentDiagnostic[]}
 */
export function inspectSceneContent(scene) {
    const cfg = scene.sceneConfig;
    /** @type {ContentDiagnostic[]} */
    const issues = [];
    /** @param {string} path @param {string} message */
    const issue = (path, message) => issues.push({ path: `${cfg.key}.${path}`, message });
    /** @param {any} key @param {any} frame @param {string} path */
    const texture = (key, frame, path) => {
        if (typeof key !== "string" || !scene.textures.exists(key)) {
            issue(path, `Texture "${key}" is not loaded. Preload it before creating this scene.`);
        } else if (frame !== undefined && !scene.textures.get(key).has(frame)) {
            issue(path, `Frame "${frame}" is missing from texture "${key}".`);
        }
    };
    /** @param {any} key @param {string} path */
    const destination = (key, path) => {
        if (typeof key !== "string" || !Object.hasOwn(scene.scene.manager.keys, key)) {
            issue(path, `Scene "${key}" is not registered in the game.`);
        }
    };
    /** @param {any} id @param {string} self @param {string} path */
    const item = (id, self, path) => {
        if (id === "$dragged") return;
        if (id === "$self" || id === true) id = self;
        const spec = typeof id === "string" ? content.getItem(id) : null;
        if (!spec) issue(path, `Inventory item "${id}" is not registered.`);
        else texture(spec.atlas, spec.frame, path);
    };
    /** @param {any} list @param {string} self @param {string} path */
    const effects = (list, self, path) => {
        if (list === undefined) return;
        if (!Array.isArray(list)) {
            issue(path, "Effects must be an array of single-verb objects.");
            return;
        }
        list.forEach((effect, i) => {
            const at = `${path}[${i}]`;
            const keys = effect && typeof effect === "object" && !Array.isArray(effect) ? Object.keys(effect) : [];
            if (keys.length !== 1) {
                issue(at, "An effect must contain exactly one verb.");
                return;
            }
            const verb = keys[0];
            if (!PROP_EFFECT_VERBS.includes(verb)) {
                issue(at, `Unknown effect "${verb}". Supported: ${PROP_EFFECT_VERBS.join(", ")}.`);
                return;
            }
            const value = effect[verb];
            if (verb === "goToScene") destination(typeof value === "string" ? value : value?.target, at);
            if (verb === "pickup") item(value?.id ?? value, self, at);
            if (verb === "addTo" || verb === "removeFrom") {
                if (value === "inventory") item(self, self, at);
                else if (value?.inventory !== undefined) item(value.inventory, self, at);
            }
            if (verb === "pushSubscene") {
                texture(typeof value === "string" ? value : value?.backgroundKey, undefined, at);
            }
        });
    };

    for (const [chapter, key] of Object.entries(cfg.backgroundsByChapter ?? {})) {
        texture(key, undefined, `backgroundsByChapter.${chapter}`);
    }
    const ids = new Set();
    for (const [i, prop] of (cfg.props ?? []).entries()) {
        const path = `props[${i}](${prop.id})`;
        if (!prop.id || ids.has(prop.id)) issue(path, `Prop id "${prop.id}" is empty or duplicated.`);
        ids.add(prop.id);
        for (const target of [prop.transitionsTo ?? []].flat()) destination(target, `${path}.transitionsTo`);
        if (!Array.isArray(prop.states)) {
            issue(`${path}.states`, "Prop states must be an array.");
            continue;
        }
        prop.states.forEach((state, j) => {
            const at = `${path}.states[${j}]`;
            if (!state || typeof state !== "object") {
                issue(at, "A prop state must be an object.");
                return;
            }
            if (state.frame !== undefined) texture(state.atlas ?? prop.atlas, state.frame, `${at}.frame`);
            const anim = state.anim ?? prop.anim;
            if (anim && !scene.anims.exists(anim)) issue(`${at}.anim`, `Animation "${anim}" is not registered.`);
            const approach = state.approach ?? prop.approach;
            if ((state.onClick || state.onDrop) && !approach) {
                issue(at, 'Interactive state needs an approach point or approach: "in-place".');
            }
            effects(state.onClick, prop.id, `${at}.onClick`);
            effects(state.onDrop?.effects, prop.id, `${at}.onDrop.effects`);
        });
    }
    return issues;
}

/**
 * Report all diagnostics together. Error mode fails before creating the room;
 * warn mode leaves runtime behavior unchanged. Call again after loading dynamic content.
 * @param {import("../scene/AdventureScene.js").AdventureScene} scene
 * @param {"warn" | "error"} [mode]
 * @returns {ContentDiagnostic[]}
 */
export function validateSceneContent(scene, mode = "warn") {
    const issues = inspectSceneContent(scene);
    if (issues.length) {
        const message = `Caper content diagnostics:\n${issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}`;
        if (mode === "error") throw new Error(message);
        console.warn(message);
    }
    return issues;
}
