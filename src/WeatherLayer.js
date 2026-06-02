import Phaser from "phaser";
import { engineAssets } from "./EngineAssets.js";

/** @typedef {"none" | "light-rain" | "heavy-rain" | "snow" | "heavy-snow"} PrecipitationMode */
/** @typedef {"none" | "falling-leaves"} AmbientMode */

/**
 * One falling raindrop drawn as a line each frame.
 * @typedef {{
 *   x: number,
 *   y: number,
 *   vx: number,
 *   vy: number,
 *   length: number,
 *   alpha: number,
 * }} Drop
 */

/**
 * One falling leaf sprite, sway + spin animated per-frame.
 * @typedef {{
 *   sprite: Phaser.GameObjects.Image,
 *   baseX: number,
 *   y: number,
 *   vy: number,
 *   driftX: number,
 *   swayAmp: number,
 *   swayFreq: number,
 *   swayPhase: number,
 *   spin: number,
 *   tiltAmp: number,
 * }} Leaf
 */

const LIGHT_DROP_COUNT = 110;
const HEAVY_DROP_COUNT = 320;
const LEAF_COUNT = 18;

const WEATHER_DEPTH = 5000;

/**
 * Weather overlay drawn on top of the scene background.
 *   - Rain ("light-rain" / "heavy-rain") uses procedural Graphics lines, no
 *     preloaded asset. Two intensities differ in drop count, speed, slant,
 *     and tint strength.
 *   - Falling leaves ("falling-leaves") uses sprites from `fall-atlas`
 *     (leaf1–leaf4). Each leaf has independent fall speed, horizontal
 *     sway (sin), tilt-by-sway-phase, and steady spin to read as a real
 *     leaf tumbling down rather than a static prop dropping straight.
 * All modes are purely cosmetic — nothing in the world interacts.
 */
export class WeatherLayer {
    /**
     * @param {import("phaser").Scene} scene
     * @param {{ weather?: PrecipitationMode, ambient?: AmbientMode }} [modes]
     */
    constructor(scene, modes = {}) {
        this.scene = scene;

        // ── Precipitation state (rain / snow) ─────────────────────────────
        /** @type {PrecipitationMode} */
        this.weatherMode = "none";
        /** @type {Phaser.GameObjects.Graphics | null} */
        this.gfx = null;
        /** @type {Phaser.GameObjects.Rectangle | null} */
        this.tint = null;
        /** @type {Drop[]} */
        this.drops = [];
        this._heavy = false;

        // ── Ambient state (falling leaves) ────────────────────────────────
        /** @type {AmbientMode} */
        this.ambientMode = "none";
        /** @type {Leaf[]} */
        this.leaves = [];

        this._updateRef = (/** @type {number} */ _t, /** @type {number} */ dt) => this._tick(dt);
        this._updateRegistered = false;

        scene.events.once("shutdown", () => this.destroy());

        this.setWeatherMode(modes.weather ?? "none");
        this.setAmbientMode(modes.ambient ?? "none");
    }

    // ─── Public mode setters ─────────────────────────────────────────────

    /** @param {PrecipitationMode} mode */
    setWeatherMode(mode) {
        if (mode === this.weatherMode) return;
        this._teardownPrecipitation();
        this.weatherMode = mode;
        if (mode === "light-rain" || mode === "heavy-rain") {
            this._startRain(mode === "heavy-rain");
        }
        this._ensureUpdateLoop();
    }

    /** @param {AmbientMode} mode */
    setAmbientMode(mode) {
        if (mode === this.ambientMode) return;
        this._teardownAmbient();
        this.ambientMode = mode;
        if (mode === "falling-leaves") {
            this._startLeaves();
        }
        this._ensureUpdateLoop();
    }

    /** Register the update listener if either channel is active. */
    _ensureUpdateLoop() {
        const needed = this.weatherMode !== "none" || this.ambientMode !== "none";
        if (needed && !this._updateRegistered) {
            this.scene.events.on("update", this._updateRef);
            this._updateRegistered = true;
        } else if (!needed && this._updateRegistered) {
            this.scene.events.off("update", this._updateRef);
            this._updateRegistered = false;
        }
    }

    // ─── Rain ────────────────────────────────────────────────────────────

    /** @param {boolean} heavy */
    _startRain(heavy) {
        this._heavy = heavy;
        const count = heavy ? HEAVY_DROP_COUNT : LIGHT_DROP_COUNT;

        // Faint blue-grey tint so the scene reads as overcast/wet.
        const tintAlpha = heavy ? 0.20 : 0.09;
        this.tint = this.scene.add.rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0x2b3a55, tintAlpha)
            .setOrigin(0, 0)
            .setDepth(WEATHER_DEPTH)
            .setScrollFactor(0);

        this.gfx = this.scene.add.graphics()
            .setDepth(WEATHER_DEPTH + 1)
            .setScrollFactor(0);

        this.drops = new Array(count);
        for (let i = 0; i < count; i++) {
            this.drops[i] = this._makeDrop(true);
        }
    }

    /**
     * @param {boolean} initial - if true, seed positions across the full
     *   screen so rain doesn't pop in from the top all at once.
     * @returns {Drop}
     */
    _makeDrop(initial) {
        const heavy = this._heavy;
        const speedY = Phaser.Math.Between(heavy ? 900 : 650, heavy ? 1300 : 950);
        // Drops slant from upper-right to lower-left.
        const speedX = Phaser.Math.Between(heavy ? -260 : -160, heavy ? -160 : -80);
        const length = Phaser.Math.Between(heavy ? 14 : 9, heavy ? 22 : 16);
        const alpha = Phaser.Math.FloatBetween(heavy ? 0.55 : 0.35, heavy ? 0.85 : 0.6);
        const x = Phaser.Math.Between(-80, this.scene.scale.width + 200);
        const y = initial ? Phaser.Math.Between(-40, this.scene.scale.height) : Phaser.Math.Between(-120, -20);
        return { x, y, vx: speedX, vy: speedY, length, alpha };
    }

    // ─── Falling leaves ──────────────────────────────────────────────────

    _startLeaves() {
        this.leaves = new Array(LEAF_COUNT);
        for (let i = 0; i < LEAF_COUNT; i++) {
            this.leaves[i] = this._makeLeaf(true);
        }
    }

    /**
     * @param {boolean} initial - seed across the full screen on first build
     *   so leaves don't all pop in at the top together.
     * @returns {Leaf}
     */
    _makeLeaf(initial) {
        const leafArt = engineAssets.get("leaves");
        const frames = leafArt?.frames ?? [];
        const frame = frames.length ? Phaser.Utils.Array.GetRandom(frames) : undefined;
        // Tiny on screen — leaves are ~170px source, scale down hard.
        const scale = Phaser.Math.FloatBetween(.1, .2);
        const baseX = Phaser.Math.Between(-60, this.scene.scale.width + 60);
        const y = initial ? Phaser.Math.Between(-80, this.scene.scale.height) : Phaser.Math.Between(-160, -40);
        const sprite = this.scene.add.image(baseX, y, leafArt?.atlas, frame)
            .setScale(scale)
            .setDepth(WEATHER_DEPTH + 1)
            .setScrollFactor(0)
            .setAlpha(Phaser.Math.FloatBetween(0.85, 1));
        return {
            sprite,
            baseX,
            y,
            // Real leaves fall slow — a few seconds across the screen.
            vy: Phaser.Math.Between(45, 110),
            // Steady horizontal drift (breeze) on top of the sway.
            driftX: Phaser.Math.Between(-28, -8),
            // Sinusoidal side-to-side sway.
            swayAmp: Phaser.Math.Between(18, 60),
            swayFreq: Phaser.Math.FloatBetween(0.6, 1.6),
            swayPhase: Phaser.Math.FloatBetween(0, Math.PI * 2),
            // Steady rotation in degrees per second — direction varies per leaf.
            spin: Phaser.Math.FloatBetween(-90, 90),
            // Tilt-with-sway gives the "facing flat then edge-on" feel.
            tiltAmp: Phaser.Math.FloatBetween(8, 22),
        };
    }

    // ─── Tick ────────────────────────────────────────────────────────────

    /** @param {number} dt - delta-ms from Phaser's update event */
    _tick(dt) {
        const seconds = dt / 1000;

        // ── Precipitation ──────────────────────────────────────────────
        if (this.gfx && (this.weatherMode === "light-rain" || this.weatherMode === "heavy-rain")) {
            const g = this.gfx;
            g.clear();
            for (const drop of this.drops) {
                drop.x += drop.vx * seconds;
                drop.y += drop.vy * seconds;
                if (drop.y > this.scene.scale.height + 20 || drop.x < -80) {
                    Object.assign(drop, this._makeDrop(false));
                }
                const len = drop.length;
                const speed = Math.hypot(drop.vx, drop.vy) || 1;
                const ux = drop.vx / speed;
                const uy = drop.vy / speed;
                g.lineStyle(1.5, 0xcfe6ff, drop.alpha);
                g.beginPath();
                g.moveTo(drop.x, drop.y);
                g.lineTo(drop.x - ux * len, drop.y - uy * len);
                g.strokePath();
            }
        }

        // ── Ambient (falling leaves) ──────────────────────────────────
        if (this.ambientMode === "falling-leaves") {
            for (const leaf of this.leaves) {
                leaf.y += leaf.vy * seconds;
                leaf.baseX += leaf.driftX * seconds;
                leaf.swayPhase += leaf.swayFreq * seconds;
                // Recycle when offscreen at the bottom or far left.
                if (leaf.y > this.scene.scale.height + 80 || leaf.baseX < -120) {
                    leaf.sprite.destroy();
                    Object.assign(this.leaves[this.leaves.indexOf(leaf)], this._makeLeaf(false));
                    continue;
                }
                const sway = Math.sin(leaf.swayPhase) * leaf.swayAmp;
                leaf.sprite.x = leaf.baseX + sway;
                leaf.sprite.y = leaf.y;
                // Pure rotation (spin) + sway-driven tilt blended together —
                // makes leaves read as tumbling rather than rigidly spinning.
                const tilt = Math.cos(leaf.swayPhase) * leaf.tiltAmp;
                leaf.sprite.angle += leaf.spin * seconds;
                leaf.sprite.setRotation(leaf.sprite.rotation + Phaser.Math.DegToRad(tilt) * seconds);
            }
        }
    }

    /** Tear down precipitation only. */
    _teardownPrecipitation() {
        if (this.gfx) {
            this.gfx.destroy();
            this.gfx = null;
        }
        if (this.tint) {
            this.tint.destroy();
            this.tint = null;
        }
        this.drops = [];
    }

    /** Tear down ambient only. */
    _teardownAmbient() {
        for (const leaf of this.leaves) {
            leaf.sprite?.destroy();
        }
        this.leaves = [];
    }

    /** Tear down everything. */
    _teardown() {
        if (this._updateRegistered) {
            this.scene.events.off("update", this._updateRef);
            this._updateRegistered = false;
        }
        this._teardownPrecipitation();
        this._teardownAmbient();
    }

    destroy() {
        this._teardown();
    }
}
