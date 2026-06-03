/**
 * Engine — cast registry + type contracts (ADR 0004 / 0005).
 *
 * The declarative NPC cast is game content, but its SHAPE is an engine contract
 * that {@link CastDirector} consumes. The engine owns the types here; the Game
 * registers its actual cast at boot via {@link registerCast}. With an empty
 * registry the CastDirector is inert.
 *
 * @typedef {object} Ambient
 * @property {"wander" | "patrol" | "static" | "follow" | "none"} behavior -
 *   the global routine this character runs while present this season. `none`
 *   = don't spawn globally (a scene spawns/positions them itself).
 * @property {"inside" | "outside" | "anywhere"} [scope] - which scenes this
 *   ambient applies to (indoor/outdoor/either). Default "anywhere".
 * @property {any} [when] - weather/time conditions (DSL) gating this rule.
 *   Ambient may be an ORDERED LIST of rules; the director picks the first whose
 *   `when` + `scope` (+ `activity` availability) match, re-picking on
 *   weatherchange.
 * @property {string} [activity] - name of the per-scene activity geometry this
 *   rule installs (from scene config `cast.<id>.activities.<activity>`). If the
 *   scene declares no such activity, the rule doesn't apply (character absent).
 * @property {Record<string, any>} [options] - options forwarded to the behavior.
 * @property {(npc: import("./NPC.js").NPC, ctx: any) => { destroy: () => void }} [factory] -
 *   custom behavior factory; overrides `behavior` when set.
 * @property {(gs: any) => boolean} [guard] - rare imperative gate the
 *   conditions DSL can't express (e.g. a custom game-mode check). Receives the
 *   game's state facade (the engine treats it opaquely).
 *
 * @typedef {object} Reaction
 * @property {"see" | "click" | "hover" | "leave" | string} on - spatial trigger
 *   the engine detects natively, OR any bus-event string the game emits.
 * @property {any} [when] - conditions DSL (see engine/conditions.js).
 * @property {boolean} [every] - fire on every occurrence (true) vs first only
 *   (false, default for `say` greetings) — backed by a state flag.
 * @property {(d: any) => (Promise<void> | void)} [run] - cutscene to play.
 * @property {string[]} [say] - lines to speak (one picked at random).
 * @property {boolean} [lockPlayer] - lock the player walk while `run` plays.
 * @property {string[]} [cast] - which cast to suspend for `run` (default: this one).
 *
 * @typedef {object} SeasonCast
 * @property {Ambient | Ambient[]} [ambient] - one rule, or an ordered list of
 *   weather/scope-conditioned rules (first match wins, re-picked on weatherchange).
 * @property {Reaction[]} [reactions]
 *
 * @typedef {object} SceneActivity
 * @property {import("../movement/behaviors/PatrolBehavior.js").PatrolWaypoint[]} waypoints
 * @property {Record<string, import("../movement/behaviors/PatrolBehavior.js").PatrolActivity>} [activities]
 * @property {{ x: number, y: number }} [doorPoint]
 * @property {"loop" | "random"} [order] - waypoint order (default "loop").
 *
 * @typedef {object} SceneCastOverride
 * @property {boolean} [suppress] - opt this character out of the scene.
 * @property {Record<string, SceneActivity>} [activities] - activity geometry by name.
 *
 * @typedef {object} CastEntry
 * @property {Record<string, any>} [defaults] - scale / boundsOffset / approachOffset.
 * @property {SeasonCast} [spring]
 * @property {SeasonCast} [summer]
 * @property {SeasonCast} [fall]
 * @property {SeasonCast} [winter]
 */

/**
 * The live cast registry — a plain id → CastEntry map the Game populates at
 * boot. CastDirector reads it by reference, so late registration before the
 * first scene resolves is fine.
 * @type {Record<string, CastEntry>}
 */
export const castRegistry = {};

/**
 * Register cast entries (merges with any already registered).
 * @param {Record<string, CastEntry>} entries
 */
export function registerCast(entries) {
    Object.assign(castRegistry, entries);
    return castRegistry;
}
