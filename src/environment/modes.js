/**
 * The weather/ambient modes a scene allows for a chapter — a direct lookup with
 * no inheritance. The engine knows nothing about chapters or their order; a
 * chapter the scene doesn't list simply allows only "none". Whatever modes a
 * game declares for a chapter are allowed as-is; the engine validates nothing.
 * @param {Record<string, string[]> | undefined} configBlock @param {string} chapter @returns {string[]}
 */
export function resolveAllowedModes(configBlock, chapter) {
    return configBlock?.[chapter] ?? ["none"];
}

/** @param {Record<string, string[]> | undefined} config @param {string} chapter */
export function resolveAmbient(config, chapter) {
    return resolveAllowedModes(config, chapter).find((mode) => mode !== "none") ?? "none";
}
