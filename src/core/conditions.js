import { store } from "../state/Store.js";

/**
 * Declarative condition evaluator for the prop framework (see
 * docs/adr/0002-declarative-prop-framework.md). Conditions are pure,
 * serializable data - no functions - so the in-game editor can author and
 * round-trip them.
 *
 * Shape:
 *   - An object with multiple keys is an AND across those keys.
 *   - An array as a value is an OR across its elements.
 *   - Combinators wrap sub-conditions: `{ allOf: [...] }`, `{ anyOf: [...] }`,
 *     `{ not: <cond> }`.
 *   - A leaf is `key: { op: value }` with ops eq/ne/gt/gte/lt/lte/has/not.
 *     Bare scalars are sugar: for a collection key a bare string means `has`;
 *     for a value key a bare scalar means `eq`.
 *   - Subject convention: a bare property under a collection (e.g.
 *     `world: { state: {...} }`) targets the *current prop's* id; a dotted
 *     path (`world: { "display_case.state": {...} }`) targets another item.
 *   - Special leaf `dropped` resolves against `ctx.draggedId` (the inventory
 *     item being dropped on a drop-target prop). Bare scalar = `eq`, object =
 *     ops, array value = OR.
 *
 * @typedef {Record<string, any> | { allOf: Condition[] } | { anyOf: Condition[] } | { not: Condition }} Condition
 */

/**
 * @param {any} condition - a Condition, an array (OR of sub-conditions), or null.
 * @param {{ selfId?: string, draggedId?: string }} [ctx]
 * @returns {boolean} - an absent condition is vacuously true.
 */
export function evaluateCondition(condition, ctx = {}) {
    if (condition == null) return true;
    if (Array.isArray(condition)) {
        // A bare array at the top is an OR of sub-conditions.
        return condition.some((/** @type {any} */ c) => evaluateCondition(c, ctx));
    }
    if (typeof condition !== "object") return !!condition;

    const cond = /** @type {any} */ (condition);

    // Plain object → AND across every key (including combinators).
    return Object.entries(cond).every(([key, constraint]) => {
        if (key === "allOf") {
            return Array.isArray(constraint) && constraint.every((/** @type {any} */ c) => evaluateCondition(c, ctx));
        }
        if (key === "anyOf") {
            return Array.isArray(constraint) && constraint.some((/** @type {any} */ c) => evaluateCondition(c, ctx));
        }
        if (key === "not") {
            return !evaluateCondition(constraint, ctx);
        }
        return evaluateLeaf(key, constraint, ctx);
    });
}

/**
 * Resolve one `key: constraint` leaf against game state.
 * @param {string} key
 * @param {any} constraint
 * @param {{ selfId?: string, draggedId?: string }} ctx
 * @returns {boolean}
 */
function evaluateLeaf(key, constraint, ctx) {
    // Array value = OR over the alternatives for this same key.
    if (Array.isArray(constraint)) {
        return constraint.some((c) => evaluateLeaf(key, c, ctx));
    }

    // `dropped` is the dragged-item subject for `onDrop.accepts`. Same
    // sugar as scalar leaves: bare scalar = `eq`, ops object, array = OR
    // (already handled above).
    if (key === "dropped") {
        if (constraint !== null && typeof constraint === "object") {
            return evaluateOps(ctx.draggedId, constraint);
        }
        return ctx.draggedId === constraint;
    }

    if (store.isCollection(key)) {
        return evaluateCollection(key, constraint, ctx);
    }

    // Scalar / flag value key.
    const actual = store.get(key);
    if (constraint !== null && typeof constraint === "object") {
        return evaluateOps(actual, constraint);
    }
    return actual === constraint; // bare value = eq
}

/**
 * @param {string} name - a Set-valued collection (inventory, world, …).
 * @param {any} constraint
 * @param {{ selfId?: string }} ctx
 * @returns {boolean}
 */
function evaluateCollection(name, constraint, ctx) {
    // Bare string id = membership test.
    if (typeof constraint === "string") return store.has(name, constraint);

    if (constraint !== null && typeof constraint === "object") {
        if ("has" in constraint) return store.has(name, constraint.has);
        if ("not" in constraint) return !store.has(name, constraint.not);
        if ("count" in constraint) return evaluateOps(store.collectionSize(name), normalizeOps(constraint.count));
        // Otherwise treat entries as per-item property constraints, e.g.
        // `{ state: { eq: "empty" } }` (self) or `{ "display_case.state": "empty" }`.
        return Object.entries(constraint).every(([path, opc]) => evaluateItemProp(path, opc, ctx));
    }
    return false;
}

/**
 * Resolve an item-property constraint such as `state` (the current prop) or
 * `display_case.state` (an explicit item). Only `state` is backed today (the additive
 * item-state map); other properties read as not-matching until the full item
 * registry lands.
 * @param {string} path
 * @param {any} opc
 * @param {{ selfId?: string }} ctx
 * @returns {boolean}
 */
function evaluateItemProp(path, opc, ctx) {
    let itemId = ctx.selfId;
    let prop = path;
    const dot = path.indexOf(".");
    if (dot >= 0) {
        itemId = path.slice(0, dot);
        prop = path.slice(dot + 1);
    }
    if (!itemId) return false;
    if (prop === "state") {
        return evaluateOps(store.getItemState(itemId), normalizeOps(opc));
    }
    return false;
}

/**
 * Apply a comparison-ops object to an actual value. Every op present must hold
 * (they AND together).
 * @param {any} actual
 * @param {Record<string, any>} ops
 * @returns {boolean}
 */
function evaluateOps(actual, ops) {
    return Object.entries(ops).every(([op, val]) => {
        switch (op) {
            case "eq":
                return actual === val;
            case "ne":
                return actual !== val;
            case "gt":
                return actual > val;
            case "gte":
                return actual >= val;
            case "lt":
                return actual < val;
            case "lte":
                return actual <= val;
            default:
                return false;
        }
    });
}

/**
 * Allow bare scalars where an ops object is expected (`count: 3` ⇒ `{ eq: 3 }`).
 * @param {any} c
 * @returns {Record<string, any>}
 */
function normalizeOps(c) {
    if (c !== null && typeof c === "object" && !Array.isArray(c)) return c;
    return { eq: c };
}
