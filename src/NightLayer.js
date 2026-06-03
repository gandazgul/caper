import Phaser from "phaser";

/** @typedef {Phaser.GameObjects.Image} Image */
/** @typedef {Phaser.GameObjects.Sprite} Sprite */

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   w?: number,
 *   h?: number,
 *   color?: number,
 *   flicker?: boolean | number,
 *   type?: "rect" | "oval" | "glow",
 *   name?: string,
 * }} LitWindow
 *
 * - `name` is a free-text label with no runtime effect — it just helps you
 *   tell windows apart. The SceneEditor preserves it through copy-out.
 * - `type: "rect"` and `"glow"` position x/y at the TOP-LEFT corner. `"oval"`
 *   (default) positions x/y at the center.
 * - `type: "glow"` renders a soft radial gradient that fades to nothing at
 *   its edges — use this for arched / skewed / irregular windows where a
 *   hard-edged rect/oval is hard to line up. Looks like warm light leaking
 *   through a window; forgiving on position because there's no hard edge.
 * - `flicker` controls candle wobble amplitude: `false` disables it, a
 *   number scales the default amplitude (`1` = default, `2` = double the
 *   alpha/scale swing, `0.5` = subtler). `true`/undefined is treated as 1.
 */

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   radius?: number,
 *   color?: number,
 *   glowScale?: number,
 * }} MoonConfig
 *
 * - `color` is the moon + glow tint (default warm cream `0xfff3c4`).
 * - `glowScale` multiplies the atmospheric halo size (default `1`).
 */

/**
 * @typedef {{
 *   id?: string,
 *   atlas?: string,
 *   frame: string,
 *   x: number,
 *   y: number,
 *   depth?: number,
 *   scale?: number,
 *   seasons?: string[],
 * }} LitPropItemConfig
 */

/**
 * @typedef {{
 *   moon?: MoonConfig | false,
 *   windows?: LitWindow[],
 *   litPropItems?: string[],
 *   flies?: boolean,
 *   tintColor?: number,
 *   flyBounds?: { x: number, y: number, w: number, h: number, frequency?: number },
 * }} NightLayerConfig
 */

// Moon and lantern flies sit above the WeatherLayer (rain tint 9000 / leaves
// 9001) so they remain bright through any weather effects.
const DEPTH_TINT = 6000;
const DEPTH_WINDOWS = DEPTH_TINT + 1;
const DEPTH_MOON = DEPTH_TINT + 2;
const DEPTH_FLIES = DEPTH_TINT + 3;

const PARTICLE_TEXTURE_KEY = "__night-fly-particle";
const SOFT_GLOW_TEXTURE_KEY = "__night-soft-glow";

/**
 * Drop-in night styling: dark-blue multiply overlay (covers background +
 * weather leaves), a crescent moon, additive glow patches for lit windows, and
 * a swarm of lantern-fly particles. Cheap, in-engine — no new art assets
 * required. Actors (active character + NPCs) and illuminated objects are kept
 * visible above the dark via data-flag tagging (see `updateCharacterLayering`).
 */
export class NightLayer {
    /**
     * @param {import("./EngineScene.js").EngineScene} scene
     * @param {NightLayerConfig} [config]
     */
    constructor(scene, config = {}) {
        this.scene = scene;
        /** @type {Phaser.GameObjects.GameObject[]} */
        this.children = [];
        /**
         * Live (spec, glow) pairs for the lit windows — kept around so the
         * SceneEditor can drag them and re-serialize the original config.
         * @type {{ spec: LitWindow, glow: Phaser.GameObjects.GameObject }[]}
         */
        this.windowEntries = [];
        /** @type {any[]} Moon disc + glow layers for manual repositioning. */
        this.moonParts = [];

        this.tintColor = config.tintColor ?? 0x3050a0;
        const overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, this.tintColor)
            .setOrigin(0, 0)
            .setDepth(DEPTH_TINT)
            .setScrollFactor(0)
            .setBlendMode(Phaser.BlendModes.MULTIPLY);
        this.children.push(overlay);

        if (config.moon !== false) {
            const moon = this._createMoon(config.moon ?? { x: scene.scale.width - 200, y: 130 });
            if (moon) this.children.push(moon);
        }

        for (const win of config.windows ?? []) {
            const glow = this._createWindow(win);
            this.children.push(glow);
            this.windowEntries.push({ spec: win, glow });
        }

        for (const id of config.litPropItems ?? []) {
            this._lightUpPropItem(id);
        }

        if (config.flies !== false) {
            const bounds = config.flyBounds ?? { x: 0, y: 280, w: scene.scale.width, h: scene.scale.height - 280 };
            const emitter = this._createLanternFlies(bounds);
            if (emitter) this.children.push(emitter);
        }

        this.onScenePostUpdate = () => this.updateCharacterLayering();
        scene.events.on("postupdate", this.onScenePostUpdate);

        scene.events.once("shutdown", () => this.destroy());
    }

    /**
     * Full moon: a bright disc with a two-layer additive radial glow (a wide
     * atmospheric halo plus a tighter, brighter inner bloom) and a slow
     * breathing pulse so it reads as a living light source in the night sky.
     * @param {MoonConfig} cfg
     * @returns {Phaser.GameObjects.Arc | null}
     */
    _createMoon(cfg) {
        const r = cfg.radius ?? 56;
        const color = cfg.color ?? 0xfff3c4;
        const glowScale = cfg.glowScale ?? 1;
        ensureSoftGlowTexture(this.scene);

        // Wide, faint atmospheric halo — bleeds the moonlight into the sky.
        const outerGlow = this.scene.add.image(cfg.x, cfg.y, SOFT_GLOW_TEXTURE_KEY)
            .setDisplaySize(r * 5 * glowScale, r * 5 * glowScale)
            .setTint(color)
            .setDepth(DEPTH_MOON - 2)
            .setScrollFactor(0)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.16);
        this.children.push(outerGlow);

        // Tighter bloom hugging the disc for a soft halo edge.
        const innerGlow = this.scene.add.image(cfg.x, cfg.y, SOFT_GLOW_TEXTURE_KEY)
            .setDisplaySize(r * 2.4 * glowScale, r * 2.4 * glowScale)
            .setTint(color)
            .setDepth(DEPTH_MOON - 1)
            .setScrollFactor(0)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.28);
        this.children.push(innerGlow);

        // Slow, gentle breathing pulse on both glows.
        this.scene.tweens.add({
            targets: [outerGlow, innerGlow],
            alpha: { from: 0.14, to: 0.3 },
            scale: "*=1.03",
            duration: 3200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
        });

        // The solid full-moon disc on top of the glow.
        const disc = this.scene.add.circle(cfg.x, cfg.y, r, color)
            .setScrollFactor(0)
            .setDepth(DEPTH_MOON);

        // Keep references so scenes with manual scrolling can reposition.
        this.moonParts = [outerGlow, innerGlow, disc];
        return disc;
    }

    /**
     * @param {string} id
     */
    _lightUpPropItem(id) {
        if (!this.scene.propSprites) return;
        const sprite = this.scene.propSprites.get(id);
        if (!sprite) return;

        // If the frame doesn't start with "night_", try to switch to the lit version
        const currentFrame = sprite.frame.name;
        if (currentFrame && !currentFrame.startsWith("night_")) {
            sprite.setFrame(`night_${currentFrame}`);
        }

        // Pull above the night overlay
        sprite.setDepth(DEPTH_WINDOWS);
    }

    /**
     * @param {LitWindow} win
     * @returns {Phaser.GameObjects.Ellipse | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image}
     */
    _createWindow(win) {
        const w = win.w ?? 30;
        const h = win.h ?? 24;
        const color = win.color ?? 0xffd27a;
        // Default scrollFactor (1) so windows stay glued to specific houses
        // in scrolling scenes like NeighborhoodScene. For fixed-camera scenes
        // it makes no difference.
        let glow;
        if (win.type === "glow") {
            // Soft radial-gradient glow — alpha falls off at the edges so the
            // boundary is fuzzy and forgiving of imprecise placement. Best for
            // arched / skewed window shapes that hard rects/ovals can't match.
            ensureSoftGlowTexture(this.scene);
            glow = this.scene.add.image(win.x + w / 2, win.y + h / 2, SOFT_GLOW_TEXTURE_KEY)
                .setDisplaySize(w, h)
                .setTint(color);
        } else if (win.type === "rect") {
            // Author specifies top-left coords, but we render with the default
            // center origin so the flicker scale tween wobbles symmetrically
            // around the window's middle (not stretching to one side).
            glow = this.scene.add.rectangle(win.x + w / 2, win.y + h / 2, w, h, color);
        } else {
            glow = this.scene.add.ellipse(win.x, win.y, w, h, color);
        }
        glow.setDepth(DEPTH_WINDOWS)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.8);

        // Flicker amplitude per window. `false` disables; a number scales
        // the default wobble (1 = default, 0 = effectively off, 2 = double).
        const flickerAmp = win.flicker === false ? 0 : typeof win.flicker === "number" ? win.flicker : 1;
        if (flickerAmp > 0) {
            const alphaSwing = 0.125 * flickerAmp;
            const scaleSwing = 0.05 * flickerAmp;
            const baseScaleX = glow.scaleX;
            const baseScaleY = glow.scaleY;
            this.scene.tweens.add({
                targets: glow,
                alpha: { from: 0.8 - alphaSwing, to: 0.8 + alphaSwing },
                scaleX: { from: baseScaleX * (1 - scaleSwing), to: baseScaleX * (1 + scaleSwing) },
                scaleY: { from: baseScaleY * (1 - scaleSwing), to: baseScaleY * (1 + scaleSwing) },
                duration: 700 + Math.random() * 800,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
            });
        }
        return glow;
    }

    /**
     * @param {{ x: number, y: number, w: number, h: number, frequency?: number }} props
     * @returns {Phaser.GameObjects.Particles.ParticleEmitter | null}
     */
    _createLanternFlies(props) {
        ensureFlyParticleTexture(this.scene);
        const emitter = this.scene.add.particles(0, 0, PARTICLE_TEXTURE_KEY, {
            x: { min: props.x, max: props.x + props.w },
            y: { min: props.y, max: props.y + props.h },
            lifespan: { min: 2500, max: 4500 },
            speedX: { min: -22, max: 22 },
            speedY: { min: -14, max: 14 },
            scale: { min: 0.6, max: 1.4 },
            // Sin-pulse alpha: fade in, then back out across the lifespan so
            // each fly reads like a firefly winking on and off as it drifts.
            // `t` is the EmitterOp normalized 0→1 lifetime; sin(t*π) peaks
            // at 0.5 and returns to 0 at both ends.
            alpha: {
                onEmit: (/** @type {any} */ p) => {
                    p.lanternPeak = 0.55 + Math.random() * 0.4;
                    return 0;
                },
                onUpdate: (/** @type {any} */ p, _key, t) => Math.sin(t * Math.PI) * (p.lanternPeak ?? 0.8),
            },
            tint: [0xfff3a0, 0xfff7c2, 0xffcc66],
            blendMode: "ADD",
            frequency: props.frequency ?? 500,
            quantity: 1,
            emitting: true,
        });
        emitter.setDepth(DEPTH_FLIES);
        // emitter.setScrollFactor(0);

        return emitter;
    }

    /**
     * Move a window to a new anchor point, updating both its spec (so
     * editor copy-out is accurate) and the visual glow. The anchor follows
     * the spec convention: top-left for rect/glow, center for oval.
     * @param {number} idx
     * @param {number} x
     * @param {number} y
     */
    moveWindow(idx, x, y) {
        const entry = this.windowEntries[idx];
        if (!entry) return;
        entry.spec.x = x;
        entry.spec.y = y;
        const w = entry.spec.w ?? 30;
        const h = entry.spec.h ?? 24;
        const isCenterAnchored = entry.spec.type !== "rect" && entry.spec.type !== "glow";
        const anyGlow = /** @type {any} */ (entry.glow);
        anyGlow.x = isCenterAnchored ? x : x + w / 2;
        anyGlow.y = isCenterAnchored ? y : y + h / 2;
    }

    /**
     * Reposition all moon sprites (disc + glow layers).
     * @param {number} x
     * @param {number} y
     */
    setMoonPosition(x, y) {
        for (const part of this.moonParts) {
            part.x = x;
            part.y = y;
        }
    }

    updateCharacterLayering() {
        const base = DEPTH_WINDOWS + 10;
        // Selection is by data flag, so the engine needs no texture names:
        //   - `nightActor`      → render above the dark + take the night tint
        //     (the active character + every NPC, tagged at the source by
        //     WalkController / NPC).
        //   - `nightIlluminated`→ render above the dark but stay UNtinted (lit
        //     up) — game-declared bright actors / lit props.
        // An optional `nightDepthBias` data value fine-tunes stacking (e.g. a
        // costume sitting just above its character).
        for (const child of this.scene.children.list) {
            const obj = /** @type {any} */ (child);
            if (!obj.active || typeof obj.setDepth !== "function") continue;
            const isActor = obj.getData?.("nightActor");
            const isLit = obj.getData?.("nightIlluminated");
            if (!isActor && !isLit) continue;
            const bias = obj.getData?.("nightDepthBias") ?? 0;
            obj.setDepth(base + (obj.y ?? 0) / 1000 + bias);
            if (isActor) obj.setTint?.(this.tintColor);
            else obj.clearTint?.();
        }

        // Lift thought bubbles to remain visible on top of actors and glows
        for (const child of this.scene.children.list) {
            if (child.constructor.name === "DialogueBubble") {
                /** @type {any} */ (child).setDepth(DEPTH_WINDOWS + 20);
            }
        }
    }

    destroy() {
        if (this.onScenePostUpdate) {
            this.scene.events.off("postupdate", this.onScenePostUpdate);
            this.onScenePostUpdate = null;
        }
        for (const child of this.children) {
            child?.destroy?.();
        }
        this.children = [];
        this.windowEntries = [];
        this.moonParts = [];
    }
}

/**
 * Generate a larger soft radial-gradient texture for the `type: "glow"`
 * window style. Many concentric circles with decreasing alpha approximate a
 * smooth gaussian falloff. Generated once per game and reused.
 * @param {Phaser.Scene} scene
 */
function ensureSoftGlowTexture(scene) {
    if (scene.textures.exists(SOFT_GLOW_TEXTURE_KEY)) return;
    const size = 128;
    const r = size / 2;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // 16 concentric circles, alpha fades from 0 at the rim to 1 at the core.
    // The squared curve keeps the bright center smallish so the glow reads
    // as "core of light + soft halo" rather than a uniform bright disc.
    const steps = 16;
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1); // 0 at rim → 1 at core
        const radius = r * (1 - t);
        const alpha = t * t; // squared falloff
        g.fillStyle(0xffffff, alpha);
        g.fillCircle(r, r, radius);
    }
    g.generateTexture(SOFT_GLOW_TEXTURE_KEY, size, size);
    g.destroy();
}

/**
 * Generate a small soft-edged white dot once and reuse it for every scene's
 * lantern-fly emitter.
 * @param {Phaser.Scene} scene
 */
function ensureFlyParticleTexture(scene) {
    if (scene.textures.exists(PARTICLE_TEXTURE_KEY)) return;
    const size = 12;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // Soft falloff: three concentric circles with decreasing alpha.
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(size / 2, size / 2, size / 2);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(size / 2, size / 2, size / 2.6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(size / 2, size / 2, size / 4.5);
    g.generateTexture(PARTICLE_TEXTURE_KEY, size, size);
    g.destroy();
}
