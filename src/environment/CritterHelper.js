import { store } from "../state/Store.js";
import { randomInt } from "../core/random.js";
import { engineAssets } from "../assets/EngineAssets.js";

/**
 * CritterHelper — static utility for spawning decorative ambient critters.
 *
 * Extends Phaser.GameObjects.Image with custom animation properties.
 * @typedef {import("phaser").GameObjects.Image & {
 *   _birdTweens?: Phaser.Tweens.Tween[];
 *   _birdUpdateRef?: (() => void) | null;
 *   _critterTween?: Phaser.Tweens.Tween | null;
 *   _critterSpec?: Critter;
 *   _critterType?: 'butterfly' | 'bird' | 'ground' | 'custom';
 * }} CritterSprite
 *
 * Critters are sourced from the `summer-atlas` (shared across all scenes) and
 * animated based on their `type` property. Supported types:
 *
 *   - "butterfly" — gentle back-and-forth bobbing (default)
 *   - "bird"      — slow horizontal drift + vertical bobbing + subtle rotation wobble
 *   - "ground"    — stationary (no animation)
 *   - "custom"    — use explicit ampX/ampY bobbing (legacy mode)
 *
 * Usage:
 *   import { createCritters } from "./CritterHelper.js";
 *
 *   createCritters(this, this.critterSprites, [
 *     { x: 200, y: 320, frame: "red_butterfly", scale: 0.18, type: "butterfly" },
 *     { x: 540, y: 280, frame: "flying_bird",   scale: 0.22, type: "bird" },
 *     { x: 140, y: 560, frame: "frog",          scale: 0.20, type: "ground" },
 *   ]);
 */

/**
 * @typedef {Object} Critter
 * @property {number} x - The x-coordinate positioning.
 * @property {number} y - The y-coordinate positioning.
 * @property {string} [frame] - The texture frame name.
 * @property {string} [atlas] - Override the source atlas key (defaults to "sprite_summer").
 *   Use e.g. "sprite_forest" to spawn a ladybug / bee / ant_trail as a critter.
 * @property {number} [scale] - The scale factor of the sprite.
 * @property {number} [originX] - The horizontal origin/anchor point.
 * @property {number} [originY] - The vertical origin/anchor point.
 * @property {number} [depth] - The rendering depth or z-index layer.
 * @property {number} [rotation] - The rendering angle in degrees
 * @property {boolean} [flipX] - Whether the sprite is flipped horizontally.
 * @property {'butterfly' | 'bird' | 'ground' | 'custom'} [type] - Critter behaviour type.
 *   "butterfly": gentle back-and-forth bobbing.
 *   "bird":      slow horizontal drift + vertical bobbing + rotation wobble.
 *   "ground":    stationary (no animation).
 *   "custom":    use explicit ampX/ampY bobbing.
 * @property {number} [ampX] - Horizontal bob amplitude (used when type is "custom").
 * @property {number} [ampY] - Vertical bob amplitude (used when type is "custom").
 */

/**
 * Bird animation defaults — tweak to taste.
 */
const BIRD_BOB_AMP_Y = 12; // vertical bob amplitude
const BIRD_WOBBLE_AMP = 5; // ± rotation in degrees
const BIRD_WOBBLE_DURATION = 600; // ms per wobble cycle (wing-beat feel)
const BIRD_BASE_SPEED = 1.5; // px per frame (base, scaled by depth)
const BIRD_ALTITUDE_MIN = 20; // px from top — closest birds
const BIRD_ALTITUDE_MAX = 400; // px from top — furthest birds

const CRITTER_DEPTH = 4;

// ─────────────────────────────────────────────────────────────────────
//  Sprite creation
// ─────────────────────────────────────────────────────────────────────

/**
 * Spawn a single critter image and return it.
 *
 * @param {Phaser.Scene} scene
 * @param {Critter} critter
 * @returns {Phaser.GameObjects.Image}
 */
function createCritter(scene, critter) {
    const critterArt = engineAssets.get("critter");
    const {
        x,
        y,
        frame = critterArt?.frame,
        atlas = critterArt?.atlas,
        scale = 0.18,
        originX = 0.5,
        originY = 1.0,
        depth = CRITTER_DEPTH,
        flipX = false,
        rotation = 0,
    } = critter;

    const critterImg = scene.add.image(x, y, atlas, frame)
        .setOrigin(originX, originY)
        .setScale(scale)
        .setDepth(depth)
        .setAngle(rotation);

    critterImg.setFlipX(flipX);

    return critterImg;
}

// ─────────────────────────────────────────────────────────────────────
//  Animation per type
// ─────────────────────────────────────────────────────────────────────

/**
 * Butterfly: gentle back-and-forth bobbing in X and/or Y.
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Image} sprite
 * @param {number} [ampX]
 * @param {number} [ampY]
 */
function animateButterfly(scene, sprite, ampX = 20, ampY = 10) {
    const duration = 1800 + Math.random() * 800;
    return scene.tweens.add({
        targets: sprite,
        x: sprite.x + ampX,
        y: sprite.y - ampY,
        duration,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
    });
}

/**
 * Bird: flies continuously across the screen, exits, re-enters from a
 * random side at a new altitude, and repeats. Scale controls both size
 * and speed for depth perception (bigger = closer = faster).
 *
 * Layered with vertical bobbing + rotation wobble.
 * @param {Phaser.Scene} scene
 * @param {CritterSprite} sprite
 */
function animateBird(scene, sprite) {
    const bobPhase = Math.random() * Math.PI * 2;
    const wobblePhase = Math.random() * Math.PI * 2;
    const scale = sprite.scale;

    // Speed scales with size — closer birds fly faster
    const speed = BIRD_BASE_SPEED * (0.5 + scale * 1.5);

    // Direction: left→right or right→left
    let goingRight = Math.random() > 0.5;

    // Altitude band based on scale — closer birds (bigger) lower on screen
    const altitudeRange = BIRD_ALTITUDE_MAX - BIRD_ALTITUDE_MIN;
    const depthT = Math.min(1, (scale - 0.1) / 0.3); // 0 = far, 1 = close
    const currentY = BIRD_ALTITUDE_MAX - depthT * altitudeRange;
    let targetY = currentY + randomInt(-30, 30);

    // --- Rotation wobble (simulates wing-beat banking) ---
    const wobbleTween = scene.tweens.add({
        targets: sprite,
        angle: sprite.angle + BIRD_WOBBLE_AMP,
        duration: BIRD_WOBBLE_DURATION,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: wobblePhase * (BIRD_WOBBLE_DURATION / (2 * Math.PI)),
    });

    // --- Update loop: fly across, exit, respawn on random side ---
    const updateListener = () => {
        const sw = scene.scale.width;

        if (goingRight) {
            sprite.x += speed;
            sprite.setFlipX(false); // face right
            if (sprite.x > sw + 100) {
                goingRight = false;
                targetY = randomInt(BIRD_ALTITUDE_MIN, BIRD_ALTITUDE_MAX);
            }
        } else {
            sprite.x -= speed;
            sprite.setFlipX(true); // face left
            if (sprite.x < -100) {
                goingRight = true;
                targetY = randomInt(BIRD_ALTITUDE_MIN, BIRD_ALTITUDE_MAX);
            }
        }

        // Bob vertically around target altitude (sin wave)
        sprite.y = targetY + Math.sin(scene.time.now * 0.003 + bobPhase) * BIRD_BOB_AMP_Y;
    };

    scene.events.on("update", updateListener);

    // Store cleanup references (cast to extended type)
    /** @type {CritterSprite} */ (sprite)._birdTweens = [wobbleTween];
    /** @type {CritterSprite} */ (sprite)._birdUpdateRef = updateListener;
}

/**
 * Ground critter: stationary, no animation.
 * @param {Phaser.Scene} _scene
 * @param {Phaser.GameObjects.Image} _sprite
 */
function animateGround(_scene, _sprite) {
    // Nothing to do — ground critters sit still.
}

/**
 * Custom: use explicit ampX/ampY bobbing (legacy mode).
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Image} sprite
 * @param {number} [ampX]
 * @param {number} [ampY]
 */
function animateCustom(scene, sprite, ampX = 20, ampY = 10) {
    if (ampX === 0 && ampY === 0) return null;
    const duration = 1800 + Math.random() * 800;
    return scene.tweens.add({
        targets: sprite,
        x: sprite.x + ampX,
        y: sprite.y - ampY,
        duration,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
    });
}

// ─────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Spawn multiple critters into the given array.
 *
 * Critters are automatically cleaned up when the scene shuts down.
 *
 * @template {string} T — atlas frame key
 * @param {Phaser.Scene} scene
 * @param {Critter[]} critters
 *
 * @returns {void}
 */
export function createCritters(scene, critters) {
    /** @type CritterSprite[] */
    const sprites = [];
    /** @type {{ spec: Critter, sprite: CritterSprite }[]} */
    const entries = [];

    for (const critter of critters) {
        const type = critter.type ?? "butterfly";
        const sprite = /** @type {CritterSprite} */ (createCritter(scene, critter));
        sprite._critterType = type;
        // Attach the original spec so the SceneEditor can drag the sprite
        // around and re-serialize the exact same config (including
        // type/scale/frame/etc., not just x/y).
        sprite._critterSpec = critter;
        sprites.push(sprite);
        entries.push({ spec: critter, sprite });

        switch (type) {
            case "butterfly":
                sprite._critterTween = animateButterfly(scene, sprite, critter.ampX ?? 20, critter.ampY ?? 10);
                break;
            case "bird":
                animateBird(scene, sprite);
                break;
            case "ground":
                animateGround(scene, sprite);
                break;
            case "custom":
                sprite._critterTween = animateCustom(scene, sprite, critter.ampX, critter.ampY);
                break;
            default:
                sprite._critterTween = animateButterfly(scene, sprite, critter.ampX ?? 20, critter.ampY ?? 10);
        }
    }

    // Expose entries on the scene so SceneEditor can iterate them. Multiple
    // createCritters calls in one scene append to the same list.
    const anyScene = /** @type {any} */ (scene);
    anyScene.critterEntries = (anyScene.critterEntries ?? []).concat(entries);
    scene.events.once("shutdown", () => {
        anyScene.critterEntries = [];
    });

    // Visibility rules:
    //   - Night: ALL critters hide (birds asleep, butterflies tucked away —
    //     keeps the night look consistent).
    //   - Rain: flying critters hide; stationary "ground" critters (frog on
    //     a lily pad, perched birds) stay put.
    // Only react when the host scene actually participates in weather —
    // minigames / unrelated scenes shouldn't empty their skies just because
    // it's raining elsewhere.
    const weatherCfg = /** @type {any} */ (scene).sceneConfig?.weather;
    const weatherEligible = !!weatherCfg && typeof weatherCfg === "object" && Object.values(weatherCfg).some(
        (/** @type {string[]} */ modes) => modes.some((m) => m !== "none"),
    );
    if (weatherEligible) {
        const applyVisibility = () => {
            const night = store.isNight();
            const mode = store.get("weatherMode") ?? "none";
            const raining = mode === "light-rain" || mode === "heavy-rain" ||
                mode === "snow" || mode === "heavy-snow";
            for (const s of sprites) {
                if (night) {
                    s.setVisible(false);
                    continue;
                }
                const isFlying = s._critterType !== "ground";
                s.setVisible(!(raining && isFlying));
            }
        };
        applyVisibility();

        const weatherListener = () => applyVisibility();
        const bus = /** @type {any} */ (scene).bus;
        bus.on("weatherchange", weatherListener);
        bus.once("shutdown", () => {
            bus.off("weatherchange", weatherListener);
        });
    }

    // Clean up tween references and listeners on scene shutdown.
    scene.events.once("shutdown", () => {
        // Note: pauseCritterAnimations may have already nulled out
        // _birdUpdateRef and stopped tweens; the guards below handle both.
        for (const s of sprites) {
            // Destroy any stored bird tweens
            if (s._birdTweens) {
                for (const t of s._birdTweens) t?.stop?.();
            }
            // Remove update listener
            if (s._birdUpdateRef && s.scene) {
                s.scene.events.off("update", s._birdUpdateRef);
            }

            s.destroy();
        }
    });
}

/**
 * Stop every critter's animation in this scene and snap each sprite back to
 * the position recorded in its spec. Used by SceneEditor so dragging a
 * critter handle isn't fought by an ongoing tween. Animations don't resume
 * — once paused, exiting edit mode leaves critters static until reload
 * (acceptable since the editor is a between-code-edits workflow).
 *
 * @param {Phaser.Scene} scene
 */
export function pauseCritterAnimations(scene) {
    const entries = /** @type {{ spec: Critter, sprite: CritterSprite }[]} */ (
        /** @type {any} */ (scene).critterEntries ?? []
    );
    for (const { spec, sprite } of entries) {
        if (sprite._critterTween) {
            sprite._critterTween.stop();
            sprite._critterTween = null;
        }
        if (sprite._birdTweens) {
            for (const t of sprite._birdTweens) t?.stop?.();
            sprite._birdTweens = undefined;
        }
        if (sprite._birdUpdateRef) {
            scene.events.off("update", sprite._birdUpdateRef);
            sprite._birdUpdateRef = null;
        }
        // Snap back to spec position so dragging from the visual location
        // matches the source-of-truth coordinates.
        sprite.x = spec.x;
        sprite.y = spec.y;
        sprite.angle = spec.rotation ?? 0;
    }
}
