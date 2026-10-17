/**
 * JSON representation of a save. Unversioned saves are version 0.
 * @typedef {{ version?: number, values: Record<string, any>, collections?: Record<string, string[]>, items?: Record<string, string> }} SaveData
 */

/** @param {any} value @returns {boolean} */
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate the engine envelope, leaving game-owned value schemas to migrations. @param {any} data @returns {boolean} */
export function isSaveData(data) {
    if (!record(data) || !record(data.values)) return false;
    if (data.version !== undefined && (!Number.isSafeInteger(data.version) || data.version < 0)) return false;
    if (data.collections !== undefined) {
        if (!record(data.collections)) return false;
        if (
            !Object.values(data.collections).every(
                (items) => Array.isArray(items) && items.every((id) => typeof id === "string"),
            )
        )
            return false;
    }
    if (
        data.items !== undefined &&
        (!record(data.items) || !Object.values(data.items).every((v) => typeof v === "string"))
    )
        return false;
    const values = data.values;
    if (values.currentScene !== undefined && typeof values.currentScene !== "string") return false;
    if (values.timeOfDay !== undefined && !["day", "night"].includes(values.timeOfDay)) return false;
    if (values.inventoryCounts !== undefined) {
        if (!record(values.inventoryCounts)) return false;
        if (!Object.values(values.inventoryCounts).every((n) => Number.isSafeInteger(n) && Number(n) > 0)) return false;
    }
    return true;
}
