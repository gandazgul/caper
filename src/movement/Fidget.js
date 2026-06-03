import Phaser from "phaser";
import { randomInt } from "../core/random.js";

/** @type {Record<string, number>} */
const fidgetTimes = {};

/**
 * Attach an "occasional fidget" loop to a static sprite. The sprite displays
 * `stillKey` (a plain texture) by default; every `intervalMs` it plays
 * `idleAnimKey` once, then returns to the still texture and reschedules.
 *
 * Use for stationary sprites that don't need a full WalkController — a
 * character sitting in a corner, background NPCs, etc. WalkController has the
 * same behavior built in for the active character.
 *
 * No-op if either key is missing — silently keeps the sprite on `stillKey`.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {{ stillKey: string, idleAnimKey: string, intervalMs?: number }} opts
 */
export function attachFidget(scene, sprite, opts) {
    const { stillKey, idleAnimKey } = opts;
    // fidgetTimes[stillKey] = opts.intervalMs ?? randomInt(1000, 1000);
    fidgetTimes[stillKey] = opts.intervalMs ?? randomInt(5000, 15000);
    sprite.setTexture(stillKey);

    const playFidget = () => {
        // fidgetTimes[stillKey] = opts.intervalMs ?? randomInt(1000, 1000);
        fidgetTimes[stillKey] = opts.intervalMs ?? randomInt(5000, 15000);
        if (!sprite.active) return;
        if (!scene.anims.exists(idleAnimKey)) {
            scene.time.delayedCall(fidgetTimes[stillKey], playFidget);
            return;
        }
        sprite.play(idleAnimKey);
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            if (!sprite.active) return;
            sprite.anims.stop();
            sprite.setTexture(stillKey);
            scene.time.delayedCall(fidgetTimes[stillKey], playFidget);
        });
    };

    scene.time.delayedCall(fidgetTimes[stillKey], playFidget);
}
