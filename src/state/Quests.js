import { store } from "./Store.js";
import { evaluateCondition } from "../core/conditions.js";

/**
 * Engine — declarative Quest battery (ADR 0007).
 *
 * A Quest is a composite tree of nodes; a Step *is* a Quest nested in a Quest.
 * Status (`not_started`→`seen`→`started`→`done`), `whatsNext` and `progress`
 * are DERIVED on read by evaluating each node's Condition against the Store —
 * nothing is stored, so quest state cannot desync from the world.
 *
 * The Game registers a catalog at boot ({@link registerQuests}); the Engine
 * never hardcodes a quest. State is read through the `quest.<id>.<accessor>`
 * virtual namespace the Condition evaluator resolves (see conditions.js), so a
 * `when` reads quest state with the same DSL — and the same names — that
 * imperative code uses.
 *
 * Node shapes (one type, no taxonomy):
 *   - leaf:       `{ id, doneWhen: Condition, icon? }`
 *   - composite:  `{ id, steps: Node[], icon? }`
 *   - collection: `{ id, collect: { items, in, selfCombineInto? }, icon? }`
 *       `items` is a list of ids (or nested nodes), or a `() => list` for
 *       runtime-rolled sets; each generated leaf is done when its id is in the
 *       `in` collection (or already moved into `selfCombineInto`).
 * A root may also carry `seenWhen` / `startWhen` Conditions (see {@link statusOf}).
 *
 * @typedef {Record<string, any>} Condition
 * @typedef {{
 *   id?: string,
 *   doneWhen?: Condition,
 *   steps?: QuestNode[],
 *   collect?: { items: Array<string | QuestNode> | (() => Array<string | QuestNode>), in: string, selfCombineInto?: string },
 *   seenWhen?: Condition,
 *   startWhen?: Condition,
 *   icon?: any,
 *   _collect?: { in: string, selfCombineInto?: string },
 * }} QuestNode
 */

/** Accessor names that may not be used as step ids (they'd shadow the namespace). */
export const RESERVED_ACCESSORS = /** @type {const} */ (["status", "whatsNext", "progress"]);
/** @type {Set<string>} */
const RESERVED = new Set(RESERVED_ACCESSORS);

/**
 * The live quest registry — a plain id → QuestNode map the Game populates at
 * boot. Read by reference, so late registration before the first read is fine.
 * @type {Record<string, QuestNode>}
 */
export const questRegistry = {};

/**
 * Register quest definitions (merges with any already registered). Throws if a
 * step id shadows a reserved accessor.
 * @param {Record<string, QuestNode>} entries
 */
export function registerQuests(entries) {
    for (const [id, def] of Object.entries(entries)) {
        assertNoReservedStepNames(def, id);
        questRegistry[id] = { id, ...def };
    }
    return questRegistry;
}

/** @param {QuestNode} node @param {string} questId */
function assertNoReservedStepNames(node, questId) {
    walkAuthored(node, (childId) => {
        if (RESERVED.has(childId)) {
            throw new Error(
                `Quest "${questId}": step id "${childId}" collides with reserved accessor ` +
                    `(${RESERVED_ACCESSORS.join("/")}).`,
            );
        }
    });
}

/** Visit every statically-authored child id (function-generated items can't be checked). @param {QuestNode} node @param {(id: string) => void} visit */
function walkAuthored(node, visit) {
    if (Array.isArray(node.steps)) {
        for (const s of node.steps) {
            if (s.id) visit(s.id);
            walkAuthored(s, visit);
        }
    }
    if (node.collect && Array.isArray(node.collect.items)) {
        for (const it of node.collect.items) {
            if (typeof it === "string") visit(it);
            else if (it && it.id) {
                visit(it.id);
                walkAuthored(it, visit);
            }
        }
    }
}

// ─── Tree walking ───────────────────────────────────────────────────────────

/**
 * The child nodes of a node, or `null` for a leaf. Collection children are
 * generated from `collect.items`: a bare id becomes a synthetic leaf that reads
 * the parent's backing collection; a nested node is used as-is.
 * @param {QuestNode} node
 * @returns {QuestNode[] | null}
 */
function childrenOf(node) {
    if (Array.isArray(node.steps)) return node.steps;
    if (node.collect) {
        const { items, in: inName, selfCombineInto } = node.collect;
        const list = typeof items === "function" ? items() : items;
        return (list || []).map((entry) =>
            typeof entry === "string"
                ? /** @type {QuestNode} */ ({ id: entry, _collect: { in: inName, selfCombineInto } })
                : entry
        );
    }
    return null;
}

/** @param {QuestNode} node @returns {boolean} */
function nodeDone(node) {
    const kids = childrenOf(node);
    if (kids) return kids.every(nodeDone);
    if (node._collect) {
        const { in: inName, selfCombineInto } = node._collect;
        return store.has(inName, /** @type {string} */ (node.id)) ||
            (!!selfCombineInto && store.has(selfCombineInto, /** @type {string} */ (node.id)));
    }
    return evaluateCondition(node.doneWhen);
}

/** @param {QuestNode} node @returns {number} */
function leafCount(node) {
    const kids = childrenOf(node);
    if (!kids) return 1;
    return kids.reduce((n, k) => n + leafCount(k), 0);
}

/** @param {QuestNode} node @returns {number} */
function doneLeafCount(node) {
    const kids = childrenOf(node);
    if (!kids) return nodeDone(node) ? 1 : 0;
    return kids.reduce((n, k) => n + doneLeafCount(k), 0);
}

/** Depth-first first-incomplete leaf, or null when the subtree is done. @param {QuestNode} node @returns {QuestNode | null} */
function firstIncompleteLeaf(node) {
    const kids = childrenOf(node);
    if (!kids) return nodeDone(node) ? null : node;
    for (const k of kids) {
        const found = firstIncompleteLeaf(k);
        if (found) return found;
    }
    return null;
}

/**
 * Derived lifecycle status by priority cascade.
 * @param {QuestNode} node
 * @returns {"not_started" | "seen" | "started" | "done"}
 */
function statusOf(node) {
    if (nodeDone(node)) return "done";
    const started = node.startWhen != null ? evaluateCondition(node.startWhen) : doneLeafCount(node) > 0;
    if (started) return "started";
    if (node.seenWhen != null && evaluateCondition(node.seenWhen)) return "seen";
    return "not_started";
}

// ─── Public query API (imperative + namespace) ──────────────────────────────

/** @param {string} accessor @param {QuestNode} node */
function readAccessor(node, accessor) {
    if (accessor === "status") return statusOf(node);
    if (accessor === "whatsNext") {
        const leaf = firstIncompleteLeaf(node);
        return leaf ? leaf.id : null;
    }
    if (accessor === "progress") return doneLeafCount(node);
    return undefined;
}

/**
 * Resolve a `quest.<id>.<...>.<accessor>` path against the registry. Each
 * non-reserved segment descends into the child node with that id; a reserved
 * segment (which must be terminal) yields the derived value. A path that ends
 * on a node defaults to its `status`.
 * @param {string} path
 * @returns {string | number | null | undefined}
 */
export function resolveQuestAccessor(path) {
    const parts = path.split(".");
    if (parts[0] !== "quest" || parts.length < 2) return undefined;
    let node = questRegistry[parts[1]];
    if (!node) return undefined;
    for (let i = 2; i < parts.length; i++) {
        const seg = parts[i];
        if (RESERVED.has(seg)) {
            if (i !== parts.length - 1) return undefined; // accessor must be terminal
            return readAccessor(node, seg);
        }
        const kids = childrenOf(node);
        const next = kids && kids.find((k) => k.id === seg);
        if (!next) return undefined;
        node = next;
    }
    return statusOf(node); // node-terminal path → status
}

/** @param {string} id @returns {"not_started"|"seen"|"started"|"done"|undefined} */
export function questStatus(id) {
    const node = questRegistry[id];
    return node ? statusOf(node) : undefined;
}

/** @param {string} id @returns {string | null | undefined} first outstanding unit id. */
export function questWhatsNext(id) {
    const node = questRegistry[id];
    if (!node) return undefined;
    const leaf = firstIncompleteLeaf(node);
    return leaf ? /** @type {string} */ (leaf.id) ?? null : null;
}

/** @param {string} id @returns {QuestNode | null | undefined} the outstanding leaf node (carries its optional `icon`). */
export function questWhatsNextNode(id) {
    const node = questRegistry[id];
    if (!node) return undefined;
    return firstIncompleteLeaf(node);
}

/** @param {string} id @returns {{ done: number, total: number } | undefined} */
export function questProgress(id) {
    const node = questRegistry[id];
    if (!node) return undefined;
    return { done: doneLeafCount(node), total: leafCount(node) };
}

/** Reset the registry (tests). */
export function clearQuests() {
    for (const key of Object.keys(questRegistry)) delete questRegistry[key];
}

/**
 * Facade mirroring the ADR's ergonomics: `quests.register(...)`,
 * `quests.status(id)`, `quests.progress(id)`, etc.
 */
export const quests = {
    register: registerQuests,
    status: questStatus,
    whatsNext: questWhatsNext,
    whatsNextNode: questWhatsNextNode,
    progress: questProgress,
    resolve: resolveQuestAccessor,
    all: questRegistry,
};
