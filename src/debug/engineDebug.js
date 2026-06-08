/**
 * Engine-level debug flags parsed from a Game's env object.
 *
 * `loadSave` suppresses conflicting start/seed/time overrides so a requested
 * save file always replays exactly.
 *
 * @param {Record<string, any> | undefined} env
 */
export function readEngineDebugConfig(env) {
    const rawLoadSave = env?.DEBUG_LOAD_SAVE ?? "";
    return Object.freeze({
        loadSave: rawLoadSave,
        startScene: rawLoadSave ? "" : (env?.START_SCENE ?? ""),
        chapter: rawLoadSave ? "" : (env?.DEBUG_CHAPTER ?? ""),
        reset: rawLoadSave ? false : (env?.DEBUG_RESET === "true"),
        debugOverlay: env?.DEBUG_OVERLAY === "true",
        timeOfDay: rawLoadSave ? "" : (env?.DEBUG_TIME_OF_DAY ?? ""),
    });
}

/**
 * Apply chapter debug seeding through a game callback.
 *
 * Default behavior when no callback is supplied: ignore `chapter` (no-op).
 *
 * @param {{
 *   chapter?: string,
 *   reset?: boolean,
 *   applyChapterDefaultState?: ((chapter: string, force: boolean) => "seeded" | "kept" | "ignored"),
 * }} opts
 * @returns {"seeded" | "kept" | "ignored"}
 */
export function applyDebugChapterState(opts) {
    if (!opts?.chapter) return "ignored";
    if (typeof opts.applyChapterDefaultState !== "function") return "ignored";
    return opts.applyChapterDefaultState(opts.chapter, !!opts.reset);
}
