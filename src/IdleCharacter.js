import { WalkController } from "./WalkController.js";
import { characters } from "./CharacterRegistry.js";
import { store } from "./Store.js";
import { DialogueBubble } from "./DialogueBubble.js";
import { WanderBehavior } from "./behaviors/WanderBehavior.js";
import { walkControllerWanderHost } from "./behaviors/walker.js";

/**
 * @typedef {object} IdleCharacterOptions
 * @property {(activeId: string, idleId: string) => string} [greeting] - text to
 *   speak when the idle character is clicked. No bubble if omitted.
 * @property {boolean} [startPresent] - spawn already on-screen (vs. the default
 *   come-and-go roll that may start absent / walk in from an exit).
 * @property {{ x: number, y: number } | null} [startPos] - explicit spawn point
 *   when present-on-entry (else a random walkable point).
 */

/**
 * The idle character (ADR 0005): the player-controllable character that ISN'T
 * currently active ambles around the scene via the shared {@link WanderBehavior}
 * over a {@link WalkController}, and greets the active character when clicked.
 *
 * Engine-generic — the idle is whichever **playable** character isn't active
 * (from the {@link characters} registry). Stays inert when the active character
 * isn't playable (e.g. a non-playable lead whose followers are companions) or
 * there's no second playable. Game-specific text/spawn come via options.
 */
export class IdleCharacter {
    /**
     * @param {import("./EngineScene.js").EngineScene} scene
     * @param {IdleCharacterOptions} [opts]
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.opts = opts;
        /** @type {WalkController | null} */
        this.walker = null;
        /** @type {Phaser.GameObjects.Sprite | null} */
        this.sprite = null;
        /** @type {WanderBehavior | null} */
        this.behavior = null;

        const sceneConfig = scene.sceneConfig;
        if (!sceneConfig?.walkable || sceneConfig.disableIdleCharacter) return;

        const playables = characters.playableIds();
        this.activeName = store.getActiveCharacter() ?? characters.defaultPlayer ?? "";
        // Inert unless the active character is itself playable and a different
        // playable exists to stand in as the idle one.
        if (!playables.includes(this.activeName)) return;
        const idle = playables.find((id) => id !== this.activeName);
        if (!idle) return;
        this.name = idle;
        this.config = characters.render(this.name, store.getOutfit(this.name));

        this.walkable = sceneConfig.walkable;
        this.host = walkControllerWanderHost({
            scene,
            getWalker: () => this.walker,
            make: (x, y) => this.spawn(x, y),
            teardown: () => this.destroyWalker(),
        });

        this.behavior = new WanderBehavior(this.host, {
            presentChance: 0.33,
            walksRange: [2, 5],
            wanderDelayRange: [4000, 8000],
            returnInterval: 15000,
            returnChance: 0.33,
            startAtExit: !opts.startPresent,
            startPresent: opts.startPresent ? true : undefined,
            startPos: opts.startPos ?? null,
        });

        scene.events.once("shutdown", () => this.destroy());
    }

    /**
     * Build the WalkController at (x, y) and wire its click-to-greet hit-area.
     * Called by the wander host's `spawnAt`. @param {number} x @param {number} y
     */
    spawn(x, y) {
        if (this.walker) this.destroyWalker();

        const sceneCfg = this.scene.sceneConfig;
        const baseScale = 0.55;
        let finalScale = baseScale * (this.config.spriteScale ?? 1);
        const override = sceneCfg?.characterScales?.[this.name.toLowerCase()] ??
            sceneCfg?.characterScales?.[this.name];
        if (override !== undefined) finalScale = override;

        this.walker = new WalkController(
            this.scene,
            /** @type {import("./WalkController.js").WalkControllerOpts & {nonControllable?: boolean}} */ ({
                characterId: this.name,
                spriteKey: this.config.spriteKey,
                startPosition: { x, y },
                walkable: this.walkable,
                walkSpeed: 150,
                spriteScale: finalScale,
                animationSet: this.config.animationSet,
                animationScales: this.config.animationScales,
                animationOrigins: this.config.animationOrigins,
                nonControllable: true,
                perspective: sceneCfg?.perspective,
            }),
        );

        this.sprite = this.walker.sprite;
        if (!sceneCfg?.perspective) this.sprite.setDepth(6);

        // Narrow centre hit-strip (the art has wide transparent padding).
        const frameW = this.sprite.width;
        const frameH = this.sprite.height;
        const stripW = frameW * 0.22;
        const hitArea = new Phaser.Geom.Rectangle((frameW - stripW) / 2, 0, stripW, frameH);
        this.sprite.setInteractive({
            hitArea,
            hitAreaCallback: Phaser.Geom.Rectangle.Contains,
            cursor: "url('/objects/cursor_look.png') 20 20, pointer",
        });
        this.sprite.on(
            "pointerdown",
            /** @param {any} _p @param {number} _x @param {number} _y @param {PointerEvent} event */
            (_p, _x, _y, event) => {
                event?.stopPropagation?.();
                this.onClicked();
            },
        );
    }

    /** Greet the active character (game-provided text), then resume wandering. */
    onClicked() {
        if (!this.sprite || !this.behavior) return;
        const text = this.opts.greeting?.(store.getActiveCharacter() ?? "", this.name);
        this.behavior.interrupt(() => {
            if (text) {
                DialogueBubble.show(this.scene, { character: this.sprite, text, autoDestroyMs: 2000 });
            }
        });
    }

    // ─── Public API (consumers) ─────────────────────────────────────────────
    /** Force present at (x, y), wandering — used by the char-switch handoff. @param {number} x @param {number} y */
    presentAt(x, y) {
        this.behavior?.becomePresentAt(x, y);
    }

    /**
     * Pin present at (x, y), wandering forever. @param {number} x @param {number} y
     * @param {{x: number, y: number, w: number, h: number} | null} [area] - explicit roam rect.
     */
    keepWanderingAt(x, y, area = null) {
        if (!this.behavior) return;
        this.behavior.walksRange = null;
        this.behavior.area = area;
        this.behavior.becomePresentAt(x, y);
    }

    /** Freeze movement (mini-game takeover). */
    freeze() {
        this.behavior?.pause();
        this.walker?.lock?.();
    }

    isPresent() {
        return !!this.sprite && this.behavior?.state !== "absent";
    }

    getPosition() {
        return this.sprite ? { x: this.sprite.x, y: this.sprite.y } : null;
    }

    destroyWalker() {
        if (this.walker) {
            this.walker.shutdown();
            if (this.sprite) {
                this.sprite.destroy();
                this.sprite = null;
            }
            this.walker = null;
        }
    }

    destroy() {
        this.behavior?.destroy();
        this.behavior = null;
        this.destroyWalker();
    }
}
