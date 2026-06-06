import Phaser from "phaser";

/**
 * Wrap one live NPC as an awaitable cutscene actor bound to a cancel token.
 * Each method returns a promise that resolves when the underlying tween/timer
 * completes, or rejects (via the Cutscene) if the cutscene is cancelled — in
 * which case the tween/timer is stopped first so nothing fires on a dead sprite.
 *
 * @param {import("../cast/NPC.js").NPC} npc
 * @param {any} scene
 * @param {import("./Cutscene.js").Cutscene} cs
 */
function actorFor(npc, scene, cs) {
    return {
        npc,
        get sprite() {
            return npc.sprite;
        },
        /** @param {{x: number, y: number}} target */
        walkTo: (target) =>
            cs.wait(
                (done) => npc.walkTo(target, done),
                () => npc.stopWalking(),
            ),
        /** @param {string} text @param {number} [holdMs] @param {"thought" | "speech"} [variant] */
        speak: (text, holdMs = 2800, variant = "thought") => {
            /** @type {Phaser.Time.TimerEvent | undefined} */
            let timer;
            return cs.wait(
                (done) => {
                    npc.speak(text, holdMs, variant);
                    timer = scene.time.delayedCall(holdMs, done);
                },
                () => timer?.remove(false),
            );
        },
        facePlayer: () => {
            npc.facePlayer();
            return Promise.resolve();
        },
        /** @param {boolean} v */
        setFlipX: (v) => {
            npc.sprite?.setFlipX(v);
            return Promise.resolve();
        },
        /** @param {string} animKey @param {{ repeat?: number }} [opts] */
        play: (animKey, opts = {}) => {
            /** @type {(() => void) | undefined} */
            let handler;
            return cs.wait(
                (done) => {
                    const sprite = npc.sprite;
                    if (!sprite || !scene.anims.exists(animKey)) {
                        done();
                        return;
                    }
                    handler = () => done();
                    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, handler);
                    sprite.play({ key: animKey, repeat: opts.repeat ?? 0 });
                },
                () => {
                    if (handler) npc.sprite?.off(Phaser.Animations.Events.ANIMATION_COMPLETE, handler);
                },
            );
        },
    };
}

/**
 * Build the `d` actor context handed to a cutscene function. Exposes every
 * present cast member by id (e.g. `d.<id>`), the player walker, and
 * scene-level helpers — all bound to this cutscene's cancel token.
 *
 * @param {any} scene - the AdventureScene
 * @param {import("./Cutscene.js").Cutscene} cs
 * @param {Map<string, import("../cast/NPC.js").NPC>} present - live cast NPCs by id
 * @returns {Record<string, any>}
 */
export function buildCutsceneContext(scene, cs, present) {
    /** @type {Record<string, any>} */
    const d = {
        scene,
        player: scene.walk,
        /** Pause the sequence for `ms`, cancellable. @param {number} ms */
        wait: (ms) => {
            /** @type {Phaser.Time.TimerEvent | undefined} */
            let timer;
            return cs.wait(
                (done) => {
                    timer = scene.time.delayedCall(ms, done);
                },
                () => timer?.remove(false),
            );
        },
        /**
         * Fly an inventory item to the strip, originating above the giver NPC
         * (or the player). Resolves immediately — the flight is cosmetic.
         * @param {string} itemId @param {string} [fromId]
         */
        give: (itemId, fromId) => {
            const from = fromId ? present.get(fromId)?.sprite : scene.walk?.sprite;
            const x = from?.x ?? 700;
            const y = (from?.y ?? 700) - 100;
            scene.inventory?.flyItemTo?.(itemId, x, y);
            return Promise.resolve();
        },
    };

    for (const [id, npc] of present) {
        d[id] = actorFor(npc, scene, cs);
    }
    return d;
}
