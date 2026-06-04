import Phaser from "phaser";
import { NPC } from "./NPC.js";
import { evaluateCondition } from "../core/conditions.js";
import { store } from "../state/Store.js";
import { CutsceneRunner } from "../cutscene/CutsceneRunner.js";
import { buildCutsceneContext } from "../cutscene/cutsceneActor.js";
import { castRegistry } from "./CastRegistry.js";
import { characters } from "../characters/CharacterRegistry.js";

/** Spatial triggers the director detects natively (vs. open bus events). */
const SPATIAL = new Set(["see", "click", "hover", "leave"]);
const DEFAULT_SEE_RANGE = 220;

/**
 * Reads the declarative cast registry (ADR 0004) and, per scene, spawns each
 * character's chapter-keyed ambient behavior, wires the current chapter's
 * reactions (pull-evaluated, scoped to this chapter only), and runs cutscenes
 * through a {@link CutsceneRunner}. One per AdventureScene.
 *
 * With an empty registry this is inert — no NPCs, no update listener, no
 * reaction subscriptions — so wiring it into every scene changes nothing until
 * the registry is populated (Phase 1+).
 */
export class CastDirector {
    /**
     * @param {any} scene - the AdventureScene
     * @param {Record<string, import("./CastRegistry.js").CastEntry>} [registry]
     */
    constructor(scene, registry = castRegistry) {
        this.scene = scene;
        this.registry = registry;
        /** Live cast NPCs by id. @type {Map<string, NPC>} */
        this.present = new Map();
        /** Attached ambient behaviors by id. @type {Map<string, any>} */
        this.behaviors = new Map();
        /** The ambient rule each present NPC is currently running (null = retreated). @type {Map<string, import("./CastRegistry.js").Ambient | null>} */
        this._activeRule = new Map();
        /** @type {Set<string>} */
        this.suppressed = new Set();

        /** @type {{ event: string, handler: (ctx: any) => void }[]} */
        this._busHandlers = [];
        /** @type {{ id: string, range: number }[]} */
        this._seeWatchers = [];
        /** ids currently within `see` range (debounces re-fires). @type {Set<string>} */
        this._inRange = new Set();
        /** @type {(() => void) | null} */
        this._seeUpdate = null;

        this.runner = new CutsceneRunner({
            suspend: (cast) => this._suspend(cast),
            resume: (cast) => this._resume(cast),
            lockPlayer: () => this.scene.walk?.lock?.(),
            unlockPlayer: () => this.scene.walk?.unlock?.(),
            buildContext: (cs) => buildCutsceneContext(this.scene, cs, this.present),
        });

        this._onCoarseChange = () => this.rebuild();
        scene.bus.on("chapterchange", this._onCoarseChange);
        scene.bus.on("weatherchange", this._onCoarseChange);
        scene.bus.on("timechange", this._onCoarseChange);

        scene.events.once("shutdown", () => this.destroy());
    }

    /** @returns {string | undefined} */
    chapter() {
        return store.get("chapter");
    }

    /**
     * This chapter's config block for a character (ambient + reactions).
     * @param {string} id
     * @returns {import("./CastRegistry.js").ChapterCast | undefined}
     */
    _chapterCfg(id) {
        const entry = this.registry[id];
        return entry ? /** @type {any} */ (entry)[this.chapter()] : undefined;
    }

    /** Spawn matching ambient + wire reactions for the current chapter. */
    build() {
        // Read declarative suppress from the scene's cast config block
        // (e.g. `cast: { <id>: { suppress: true } }` in sceneConfig).
        const castCfg = this.scene.sceneConfig?.cast;
        if (castCfg) {
            for (const [id, override] of Object.entries(castCfg)) {
                if (override?.suppress) this.suppressed.add(id);
            }
        }
        for (const id of Object.keys(this.registry)) this._resolve(id, false);
        this._wireReactions();
    }

    /** Re-resolve everything for a new chapter / weather / time. */
    rebuild() {
        // `viaTransition`: this is a live weather/chapter/time change while the
        // player is in the scene, not a fresh entry. A character newly matching
        // an outdoor activity rule should walk IN from its door, not pop into
        // the yard already working.
        for (const id of Object.keys(this.registry)) this._resolve(id, true);
        this._wireReactions();
    }

    // ─── Ambient resolution ─────────────────────────────────────────────

    /** @param {string} id @param {boolean} viaTransition */
    _resolve(id, viaTransition) {
        if (this.suppressed.has(id)) {
            if (this.present.has(id)) this._despawn(id);
            return;
        }

        const rule = this._pickAmbientRule(id);
        const npc = this.present.get(id);

        if (!rule) {
            // No rule matches here/now. If present under a live rule, retreat
            // (walk to the indoor exit + hide) rather than vanish; if already
            // retreated (activeRule cleared) leave it be.
            if (npc && this._activeRule.get(id)) this._removePresence(id, true);
            return;
        }

        if (!npc) {
            // Don't double up on a character another spawner already placed here.
            if (this.scene.hasCharacter?.(id)) return;
            this._spawnForRule(id, rule, viaTransition);
            return;
        }

        // Already present — switch behavior if the matching rule changed
        // (e.g. rain just started: dry-patrol → inside-wander).
        if (this._activeRule.get(id) !== rule) {
            this._applyRuleBehavior(id, npc, rule, viaTransition);
            this._activeRule.set(id, rule);
        }
    }

    /** @param {string} id @returns {import("./CastRegistry.js").Ambient[]} */
    _ambientRules(id) {
        const a = this._chapterCfg(id)?.ambient;
        if (!a) return [];
        return Array.isArray(a) ? a : [a];
    }

    /**
     * The first ambient rule whose weather (`when`) + scope + guard + activity
     * availability all hold for this scene right now. Pull-evaluated on coarse
     * changes only — never a continuous scan.
     * @param {string} id @returns {import("./CastRegistry.js").Ambient | null}
     */
    _pickAmbientRule(id) {
        for (const rule of this._ambientRules(id)) {
            if (!rule || rule.behavior === "none") continue;
            if (rule.guard && !rule.guard(store.subject)) continue;
            if (rule.when && !evaluateCondition(rule.when)) continue;
            if (!this._scopeAllows(rule.scope)) continue;
            // An outdoor activity rule only applies where the scene supplies its
            // geometry (yards) — that's how garden/rake stays yard-only.
            if (rule.activity && !this._sceneActivity(id, rule.activity)) continue;
            return rule;
        }
        return null;
    }

    /**
     * @param {"inside" | "outside" | "anywhere" | undefined} scope
     * @returns {boolean}
     */
    _scopeAllows(scope) {
        if (!scope || scope === "anywhere") return true;
        const indoors = !!this.scene.sceneConfig?.indoors;
        return scope === "inside" ? indoors : !indoors;
    }

    /**
     * @param {string} id @param {string} name
     * @returns {import("./CastRegistry.js").SceneActivity | undefined}
     */
    _sceneActivity(id, name) {
        return this.scene.sceneConfig?.cast?.[id]?.activities?.[name];
    }

    /** @param {string} id @param {import("./CastRegistry.js").Ambient} rule @param {boolean} [viaTransition] */
    _spawnForRule(id, rule, viaTransition = false) {
        const entry = this.registry[id];
        if (!entry) return;

        // Appearance comes from the CharacterRegistry + the character's current
        // outfit (ADR 0006) — the game establishes the per-scene outfit. The
        // registry is keyed by the character's display name (the capitalized id,
        // same convention as the NPC `name` below).
        const name = id.charAt(0).toUpperCase() + id.slice(1);
        if (!characters.has(name)) return;
        const animSet = /** @type {any} */ (characters.render(name, store.getOutfit(name)).animationSet);
        const texture = animSet?.side?.walk ?? animSet?.side?.still ?? animSet?.front?.still;
        if (!texture) return;

        const defaults = entry.defaults ?? {};
        const npc = new NPC(this.scene, {
            id,
            name,
            x: -1000, // offscreen until the behavior walks/places them
            y: 660,
            texture,
            scale: defaults.scale,
            depth: defaults.depth ?? 6,
            walkSpeed: defaults.walkSpeed,
            approachOffset: defaults.approachOffset,
            boundsOffset: defaults.boundsOffset,
            animationOverrides: defaults.animationOverrides,
            onClick: () => this._handleInteraction(id, "click"),
        });
        this.present.set(id, npc);
        this._applyRuleBehavior(id, npc, rule, viaTransition);
        this._activeRule.set(id, rule);
    }

    /**
     * Attach the behavior for a rule, (re)spawning visibility for an NPC that
     * had retreated. Patrol pulls per-scene activity geometry and starts the
     * NPC standing AT a waypoint so its in-place activity matches its position.
     * @param {string} id @param {NPC} npc @param {import("./CastRegistry.js").Ambient} rule
     * @param {boolean} [viaTransition] - true when re-resolving after a live
     *   weather/chapter/time change (vs a fresh scene entry). Makes an outdoor
     *   activity NPC walk IN from its door instead of popping into the yard.
     */
    _applyRuleBehavior(id, npc, rule, viaTransition = false) {
        // Walk in from the door when re-emerging after a retreat (hidden), OR
        // when a weather transition just made this rule apply while the player
        // is here. A fresh scene entry instead drops the NPC straight into its
        // activity (already raking/gardening when you arrive).
        const wasHidden = !!npc.sprite && !npc.sprite.visible;
        const enterViaDoor = wasHidden || viaTransition;
        // Cancel any in-flight walk (e.g. an interrupted retreat) so its
        // tween/onArrive — which would hide the NPC — can't fire over the new
        // behavior. Without this, flipping weather back mid-retreat leaves the
        // NPC raking-while-moving, then hidden by the stale arrival callback.
        npc.stopWalking();
        this._ensureVisible(npc);
        const opts = rule.options ?? {};
        if (rule.factory) {
            this.behaviors.set(id, rule.factory(npc, this));
            return;
        }
        switch (rule.behavior) {
            case "wander":
                this.behaviors.set(id, npc.wander(opts));
                break;
            case "patrol": {
                const geo = rule.activity ? this._sceneActivity(id, rule.activity) : null;
                const waypoints = geo?.waypoints ?? opts.waypoints ?? [];
                const patrolOpts = {
                    activities: geo?.activities,
                    doorPoint: geo?.doorPoint,
                    order: geo?.order,
                    ...opts,
                };
                if (enterViaDoor && geo?.doorPoint) {
                    // Re-emerge (rain cleared / weather flipped while present):
                    // stand at the door and walk back out to a waypoint instead
                    // of popping into the yard already working.
                    npc.setPosition(geo.doorPoint.x, geo.doorPoint.y);
                    const behavior = npc.patrol(waypoints, { ...patrolOpts, autoStart: false });
                    this.behaviors.set(id, behavior);
                    behavior.chooseNextWaypoint();
                } else {
                    // Fresh spawn: start standing AT a waypoint doing its activity.
                    const startIndex = waypoints.length > 0 ? Phaser.Math.Between(0, waypoints.length - 1) : 0;
                    const start = waypoints[startIndex];
                    if (start) npc.setPosition(start.x, start.y);
                    this.behaviors.set(id, npc.patrol(waypoints, { ...patrolOpts, startIndex }));
                }
                break;
            }
            case "follow":
                this.behaviors.set(id, npc.follow(opts));
                break;
            case "static":
            default:
                break;
        }
    }

    /** Show + re-register an NPC's hotspot if it had retreated/hidden. @param {NPC} npc */
    _ensureVisible(npc) {
        npc.sprite?.setVisible(true);
        if (!this.scene.hotspots.zones.has(npc.hotspotConfig.id)) {
            this.scene.hotspots.register(npc.hotspotConfig);
        }
    }

    /**
     * Remove a character's presence: retreat to the nearest indoor exit (rain
     * transition) when its behavior supports it, otherwise destroy. Retreat
     * keeps the NPC object (hidden) so it isn't re-spawned; `activeRule` is
     * cleared so `_resolve` treats it as gone.
     * @param {string} id @param {boolean} [retreat]
     */
    _removePresence(id, retreat = false) {
        const behavior = this.behaviors.get(id);
        if (retreat && (behavior?.retreat || behavior?.retreatToShelter)) {
            if (behavior.retreat) behavior.retreat();
            else behavior.retreatToShelter();
            this._activeRule.set(id, null);
            return;
        }
        this._despawn(id);
    }

    /** @param {string} id */
    _despawn(id) {
        const behavior = this.behaviors.get(id);
        behavior?.destroy?.();
        this.behaviors.delete(id);
        const npc = this.present.get(id);
        npc?.destroy?.();
        this.present.delete(id);
        this._activeRule.delete(id);
        this._inRange.delete(id);
    }

    // ─── Scene-facing API ───────────────────────────────────────────────

    /** @param {string} id @returns {NPC | undefined} */
    get(id) {
        return this.present.get(id);
    }

    /** Opt a character out of this scene. @param {string} id */
    suppress(id) {
        this.suppressed.add(id);
        this._despawn(id);
    }

    /**
     * Install a local activity routine for this scene, replacing the global
     * ambient (the patrol's `destroy` of the prior behavior auto-suspends it).
     * This is where per-scene geometry (flower-bed / raking waypoints) lives.
     * @param {string} id
     * @param {import("../movement/behaviors/PatrolBehavior.js").PatrolWaypoint[]} waypoints
     * @param {import("../movement/behaviors/PatrolBehavior.js").PatrolOptions} [opts]
     */
    activityLoop(id, waypoints, opts = {}) {
        const npc = this.present.get(id);
        if (!npc) return null;
        const behavior = npc.patrol(waypoints, opts);
        this.behaviors.set(id, behavior);
        return behavior;
    }

    /**
     * Play a cutscene (suspend ambient → run → resume). A puzzle is a cutscene
     * that sets a flag.
     * @param {(d: any) => (Promise<void> | void)} fn
     * @param {import("../cutscene/CutsceneRunner.js").CutsceneOpts} [opts]
     */
    cutscene(fn, opts) {
        return this.runner.run(fn, opts);
    }

    /**
     * Alias for {@link cutscene}.
     * @param {(d: any) => (Promise<void> | void)} fn
     * @param {import("../cutscene/CutsceneRunner.js").CutsceneOpts} [opts]
     */
    play(fn, opts) {
        return this.runner.run(fn, opts);
    }

    // ─── Reactions ──────────────────────────────────────────────────────

    _wireReactions() {
        this._clearReactions();
        for (const id of this.present.keys()) {
            const reactions = this._chapterCfg(id)?.reactions ?? [];
            for (const r of reactions) {
                if (r.on === "see") {
                    this._seeWatchers.push({ id, range: DEFAULT_SEE_RANGE });
                } else if (!SPATIAL.has(r.on)) {
                    const handler = (/** @type {any} */ ctx) => this._handleInteraction(id, r.on, ctx);
                    this.scene.bus.on(r.on, handler);
                    this._busHandlers.push({ event: r.on, handler });
                }
            }
        }
        if (this._seeWatchers.length > 0 && !this._seeUpdate) {
            this._seeUpdate = () => this._tickSee();
            this.scene.events.on("update", this._seeUpdate);
        }
    }

    _clearReactions() {
        for (const { event, handler } of this._busHandlers) {
            this.scene.bus.off(event, handler);
        }
        this._busHandlers = [];
        this._seeWatchers = [];
        if (this._seeUpdate) {
            this.scene.events.off("update", this._seeUpdate);
            this._seeUpdate = null;
        }
    }

    /** Per-frame proximity check for `see` reactions, debounced per approach. */
    _tickSee() {
        const player = this.scene.walk?.sprite;
        if (!player) return;
        for (const { id, range } of this._seeWatchers) {
            const sprite = this.present.get(id)?.sprite;
            if (!sprite || !sprite.active) continue;
            const within = Phaser.Math.Distance.Between(sprite.x, sprite.y, player.x, player.y) <= range;
            if (within && !this._inRange.has(id)) {
                this._inRange.add(id);
                this._handleInteraction(id, "see");
            } else if (!within) {
                this._inRange.delete(id);
            }
        }
    }

    /**
     * Resolve the first matching reaction for a fired trigger (pull). Respects
     * `every:false` via a Store flag.
     * @param {string} id @param {string} trigger @param {any} [ctx]
     */
    _handleInteraction(id, trigger, ctx) {
        const reactions = this._chapterCfg(id)?.reactions ?? [];
        for (let i = 0; i < reactions.length; i++) {
            const r = reactions[i];
            if (r.on !== trigger) continue;
            if (r.when && !evaluateCondition(r.when, ctx)) continue;
            if (r.every === false) {
                const flag = `cast:${id}:${this.chapter()}:r${i}`;
                if (store.get(flag)) continue;
                store.set(flag, true);
            }
            this._runReaction(id, r);
            return;
        }
    }

    /** @param {string} id @param {import("./CastRegistry.js").Reaction} r */
    _runReaction(id, r) {
        if (r.run) {
            this.cutscene(r.run, { cast: r.cast ?? [id], lockPlayer: r.lockPlayer });
            return;
        }
        const npc = this.present.get(id);
        if (r.say && npc) {
            const lines = r.say;
            const behavior = this.behaviors.get(id);
            const speak = () => {
                npc.facePlayer();
                // A `say` reaction is the character talking aloud → speech bubble.
                npc.speakRandom(lines, 2800, "speech");
            };
            if (behavior?.interrupt) behavior.interrupt(speak);
            else speak();
        }
    }

    // ─── Cutscene lifecycle hooks ───────────────────────────────────────

    /** @param {string[] | undefined} cast */
    _suspend(cast) {
        const ids = cast ?? [...this.present.keys()];
        for (const id of ids) this.behaviors.get(id)?.pause?.();
    }

    /** @param {string[] | undefined} cast */
    _resume(cast) {
        const ids = cast ?? [...this.present.keys()];
        for (const id of ids) this.behaviors.get(id)?.resume?.();
    }

    destroy() {
        this.runner.shutdown();
        this._clearReactions();
        if (this.scene?.bus) {
            this.scene.bus.off("chapterchange", this._onCoarseChange);
            this.scene.bus.off("weatherchange", this._onCoarseChange);
            this.scene.bus.off("timechange", this._onCoarseChange);
        }
        for (const id of [...this.present.keys()]) this._despawn(id);
    }
}
