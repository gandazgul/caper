import Phaser from "phaser";
import { exitApproaches } from "../../interaction/PropEngine.js";
import { walkablePolygons } from "../pathfinding.js";
export { exitApproaches };

/**
 * The minimal locomotion contract the behaviors depend on. Both `NPC` and
 * `WalkController` satisfy it, so a behavior drives a lightweight NPC or a full
 * pathfinding character identically.
 *
 * @typedef {object} Walker
 * @property {Phaser.GameObjects.Sprite} sprite
 * @property {(target: {x: number, y: number}, onArrive?: () => void, opts?: { direct?: boolean }) => void} walkTo
 * @property {() => void} stopWalking - cancel in-flight tween, settle to still
 */

/**
 * A `WanderHost` is a `Walker` plus the scene-level affordances the come-and-go
 * machine needs: a walkable area, a random-point picker, and spawn/despawn that
 * encapsulate "show + register hotspot" vs "hide + unregister hotspot" so an
 * `NPC` and a `WalkController`-backed character both plug in.
 *
 * @typedef {Walker & {
 *   scene: Phaser.Scene,
 *   walkable: import("../pathfinding.js").WalkableArea,
 *   getRandomPoint: () => {x: number, y: number},
 *   spawnAt: (x: number, y: number) => void,
 *   despawn: () => void,
 *   isSpawned: () => boolean,
 * }} WanderHost
 */

/**
 * Pick a random point inside the walkable bounding box, snapped onto the
 * polygon and kept clear of scene exits so wanderers don't camp on doors.
 * Extracted from the six near-identical copies across the old controllers.
 *
 * @param {import("phaser").Scene} scene
 * @param {import("../pathfinding.js").WalkableArea} walkable
 * @param {(p: {x: number, y: number}) => {x: number, y: number}} [snap]
 * @param {number} [exitClearance]
 * @returns {{x: number, y: number}}
 */
export function getRandomWalkablePoint(scene, walkable, snap, exitClearance = 150) {
    const polygons = walkablePolygons(walkable);
    const polygon = polygons.length > 0 ? Phaser.Utils.Array.GetRandom(polygons) : [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polygon) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return { x: 700, y: 700 };

    // Bounded retry instead of unbounded recursion: if every roll lands near an
    // exit (tight walkable strips), fall back to the last candidate.
    let p = { x: 700, y: 700 };
    const sceneAny = /** @type {any} */ (scene);
    const exits = exitApproaches(sceneAny.sceneConfig?.props);
    for (let attempt = 0; attempt < 8; attempt++) {
        p = { x: Phaser.Math.Between(minX, maxX), y: Phaser.Math.Between(minY, maxY) };
        if (snap) p = snap(p);
        let clear = true;
        for (const exit of exits) {
            if (Phaser.Math.Distance.Between(p.x, p.y, exit.x, exit.y) < exitClearance) {
                clear = false;
                break;
            }
        }
        if (clear) break;
    }
    return p;
}

/**
 * Resolve a spawn position at a random scene exit (as if the character walked
 * in), falling back to a screen edge at a random walkable Y.
 *
 * @param {import("phaser").Scene} scene
 * @param {import("../pathfinding.js").WalkableArea} walkable
 * @returns {{x: number, y: number}}
 */
export function randomExitSpawn(scene, walkable) {
    const sceneAny = /** @type {any} */ (scene);
    const exits = exitApproaches(sceneAny.sceneConfig?.props);
    if (exits.length > 0) {
        const exit = Phaser.Utils.Array.GetRandom(exits);
        return { x: exit.x, y: exit.y };
    }
    const edge = Math.random() < 0.5 ? -100 : 1476;
    const polygons = walkablePolygons(walkable);
    const polygon = polygons.length > 0 ? Phaser.Utils.Array.GetRandom(polygons) : [];
    const wp = polygon.length > 0 ? Phaser.Utils.Array.GetRandom(polygon) : { y: 660 };
    return { x: edge, y: wp.y };
}

/**
 * Wrap an `NPC` as a `WanderHost`. Come-and-go is show/hide + hotspot
 * register/unregister (no destroy/recreate churn). `spawnAt` is idempotent:
 * it only registers the hotspot when one isn't already present.
 *
 * @param {import("../../cast/NPC.js").NPC} npc
 * @returns {WanderHost}
 */
export function npcWanderHost(npc) {
    const scene = /** @type {any} */ (npc.scene);
    return {
        get sprite() {
            return npc.sprite;
        },
        scene: npc.scene,
        walkable: scene.sceneConfig?.walkable ?? [],
        walkTo: (target, onArrive, opts) => npc.walkTo(target, onArrive, opts),
        stopWalking: () => npc.stopWalking(),
        getRandomPoint: () =>
            getRandomWalkablePoint(npc.scene, scene.sceneConfig?.walkable ?? [], (p) => {
                const w = scene.walk;
                return w?.snapToWalkable ? w.snapToWalkable(p) : p;
            }),
        isSpawned: () => npc.scene.hotspots.zones.has(npc.hotspotConfig.id),
        spawnAt(x, y) {
            npc.setPosition(x, y);
            npc.sprite?.setVisible(true);
            if (!npc.scene.hotspots.zones.has(npc.hotspotConfig.id)) {
                npc.scene.hotspots.register(npc.hotspotConfig);
            }
        },
        despawn() {
            npc.stopWalking();
            npc.sprite?.setVisible(false);
            npc.scene.hotspots.unregister(npc.hotspotConfig.id);
        },
    };
}

/**
 * Wrap a `WalkController`-backed character (the wandering inactive sibling) as a
 * `WanderHost`. Unlike the NPC host, this one creates/destroys the underlying
 * `WalkController` on spawn/despawn (the character sprite is heavy and has its own
 * input listeners), delegating that to the caller's `make`/`teardown` hooks.
 *
 * @param {object} cfg
 * @param {import("phaser").Scene & { sceneConfig?: any }} cfg.scene
 * @param {() => import("../WalkController.js").WalkController | null} cfg.getWalker
 * @param {(x: number, y: number) => void} cfg.make - build the WalkController at (x,y).
 * @param {() => void} cfg.teardown - destroy the WalkController + sprite.
 * @returns {WanderHost}
 */
export function walkControllerWanderHost(cfg) {
    const scene = /** @type {any} */ (cfg.scene);
    return {
        get sprite() {
            return cfg.getWalker()?.sprite ?? null;
        },
        scene: cfg.scene,
        walkable: scene.sceneConfig?.walkable ?? [],
        walkTo: (target, onArrive, opts) => cfg.getWalker()?.walkTo(target, onArrive, opts),
        stopWalking: () => cfg.getWalker()?.stopWalking(),
        getRandomPoint: () =>
            getRandomWalkablePoint(cfg.scene, scene.sceneConfig?.walkable ?? [], (p) => {
                const w = cfg.getWalker();
                return w?.snapToWalkable ? w.snapToWalkable(p) : p;
            }),
        isSpawned: () => !!cfg.getWalker(),
        spawnAt(x, y) {
            if (!cfg.getWalker()) cfg.make(x, y);
        },
        despawn() {
            cfg.teardown();
        },
    };
}
