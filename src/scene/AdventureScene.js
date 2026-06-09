import Phaser from "phaser";
import { HotspotManager } from "../interaction/HotspotManager.js";
import { WalkController } from "../movement/WalkController.js";
import { InventoryLayer } from "../inventory/InventoryLayer.js";
import { WeatherLayer } from "../environment/WeatherLayer.js";
import { SubsceneStack } from "./SubsceneStack.js";
import { DebugOverlay } from "../ui/DebugOverlay.js";
import { SceneEditor } from "../ui/SceneEditor.js";
import { PropEngine } from "../interaction/PropEngine.js";
import { CastDirector } from "../cast/CastDirector.js";
import { store } from "../state/Store.js";
import { characters } from "../characters/CharacterRegistry.js";
import { engineAssets } from "../assets/EngineAssets.js";
import { loadAssetKeys, registerAssetKeys } from "../assets/assetLoading.js";
import { clearLastTransitionFrom, lastTransitionFrom } from "./transitions.js";
import { IdleCharacter } from "../movement/IdleCharacter.js";

/**
 * @typedef {object} SpawnPose
 * @property {{ x: number, y: number }} startPosition
 * @property {string} [spriteKey]
 * @property {import("../movement/WalkController.js").AnimationSet} [animationSet]
 * @property {Record<string, number>} [animationScales]
 * @property {Record<string, { x?: number, y?: number }>} [animationOrigins]
 */

/**
 * @typedef {object} AdventureSceneConfig
 * @property {string} key
 * @property {string} [chapter] - the chapter/chapter this scene belongs to.
 * @property {Record<string, string>} backgroundsByChapter
 * @property {{ x: number, y: number }[]} walkable
 * @property {SpawnPose} [activeCharacter] - spawn pose (+ optional sprite fields some helpers read).
 * @property {Record<string, number>} [animationScales]
 * @property {Record<string, { x?: number, y?: number }>} [animationOrigins]
 * @property {Record<string, number>} [characterScales] - per-scene scale overrides by character id/name.
 * @property {import("../core/perspective.js").PerspectiveConfig} [perspective]
 * @property {Record<string, string[]>} [weather] - per-chapter allowed precipitation modes.
 * @property {Record<string, string[]>} [ambient] - per-chapter allowed ambient effects.
 * @property {string} [inventoryAtlas]
 * @property {boolean} [inventoryHidden]
 * @property {boolean} [indoors]
 * @property {boolean} [suppressActiveCharacter] - hide the active character and disable free-walk clicks while keeping hotspot arrival routing.
 * @property {boolean} [disableIdleCharacter] - opt this scene out of the autonomous idle character.
 * @property {boolean} [hideCharacterSwitcher]
 * @property {import("../interaction/PropEngine.js").Prop[]} [props]
 * @property {string[]} [assets]
 * @property {Record<string, import("../cast/CastRegistry.js").SceneCastOverride>} [cast]
 */

/**
 * Engine base scene (ADR 0005). Composes the engine's systems — hotspots,
 * walking, inventory, weather, sub-scenes, props, cast, debug/editor — wires
 * the active character from the {@link characters} registry, and tracks
 * chapter/weather/time-of-day off the {@link store}. It knows nothing about a
 * specific game's rules; game-specific behavior lives in a subclass (this
 * game's `scenes/global/AdventureScene`) via the hooks below.
 *
 * Hooks a Game subclass overrides:
 *   - `getActiveCharacterId()` — which registered character is active (defaults
 *     to the Store's `activeCharacter`, else the first playable).
 *   - `inventoryLayout` / `debugInitialVisible` — Config values (the engine has
 *     defaults so it runs with neither).
 *   - `handleChapterTransition()` / `isExitDisabled()` — game reactions.
 */
export class AdventureScene extends Phaser.Scene {
    /** @type {AdventureSceneConfig} */
    sceneConfig;
    /** @type {Phaser.Events.EventEmitter} */
    bus;
    /** @type {HotspotManager} */
    hotspots;
    /** @type {WalkController} */
    walk;
    /** @type {InventoryLayer} */
    inventory;
    /** @type {WeatherLayer} */
    weather;
    /** @type {SubsceneStack} */
    subscenes;
    /** @type {DebugOverlay} */
    debug;
    /** @type {SceneEditor} */
    editor;
    /** @type {CastDirector} */
    cast;
    /** @type {IdleCharacter[]} */
    idleCharacters = [];
    /**
     * Count of live NPCs per character id, maintained by `NPC`. Lets wanderers
     * skip a character already present in the scene.
     * @type {Map<string, number> | undefined}
     */
    _npcPresence;
    /** @type {Map<string, Phaser.GameObjects.Sprite>} */
    propSprites = new Map();
    /** @type {PropEngine | null} */
    propEngine = null;
    /** @type {Phaser.GameObjects.Image} */
    background;
    /** @type {string} */
    currentChapter;
    /** @type {string} */
    currentWeather;
    /** @type {import("../environment/WeatherLayer.js").AmbientMode} */
    currentAmbient;
    /** @type {"day" | "night"} */
    currentTimeOfDay;

    /** @param {AdventureSceneConfig} config */
    constructor(config) {
        super({ key: config.key });
        this.sceneConfig = config;
    }

    // ─── Game hooks (overridable; engine-safe defaults) ─────────────────────
    /** @returns {string} the active character's registry id. */
    getActiveCharacterId() {
        return store.getActiveCharacter() ?? characters.defaultPlayer ?? "";
    }

    /** @returns {{ stripHeight?: number, slotPadding?: number, padding?: number } | undefined} */
    get inventoryLayout() {
        return undefined;
    }

    /** @returns {boolean} whether the debug overlay starts visible. */
    get debugInitialVisible() {
        return false;
    }

    collectAssetKeys() {
        const cfg = this.sceneConfig;
        const keys = [...Object.values(cfg.backgroundsByChapter ?? {}), ...(cfg.assets ?? [])];

        // Auto-include playable characters
        for (const id of characters.playableIds()) {
            const conf = characters.get(id);
            if (conf?.spriteKey) keys.push(conf.spriteKey);
            if (conf?.animationSet) {
                for (const dir of Object.values(conf.animationSet)) {
                    if (dir.still) keys.push(dir.still);
                    if (dir.idle) keys.push(dir.idle);
                    if (dir.walk) keys.push(dir.walk);
                    if (dir.reach) keys.push(dir.reach);
                }
            }
        }

        return keys;
    }

    preload() {
        loadAssetKeys(this, this.collectAssetKeys());
    }

    /**
     * Spawn the idle characters (the inactive playables) to wander the scene.
     * The engine automatically determines which characters are inactive, but only
     * spawns those flagged `wanderer: true` in the registry, unless overridden via opts.
     * @param {import("../movement/IdleCharacter.js").IdleCharacterOptions & { wanderers?: string[] }} [opts]
     */
    spawnIdleCharacters(opts) {
        for (const char of this.idleCharacters) char.destroy();
        this.idleCharacters = [];

        // Scene-wide suppression?
        if (this.sceneConfig.disableIdleCharacter) return this.idleCharacters;

        const playables = characters.playableIds();
        const activeName = this.getActiveCharacterId();
        const inactives = playables.filter((id) => id !== activeName);

        // Explicit list provided? Otherwise use registry opt-in.
        let targetIds = opts?.wanderers;
        if (!targetIds) {
            targetIds = inactives.filter((id) => characters.get(id)?.wanderer);
        }

        // Only spawn those that are actually inactive
        const toSpawn = targetIds.filter((id) => inactives.includes(id));

        for (const id of toSpawn) {
            this.idleCharacters.push(new IdleCharacter(this, { ...opts, characterId: id }));
        }
        return this.idleCharacters;
    }

    /**
     * Build the active character's WalkController from the registry, applying
     * the character's current outfit and any per-scene scale override. Reused
     * by `create()` and by a subclass's switch/rebuild.
     * @param {{ x: number, y: number }} startPos
     * @param {"up" | "down" | "left" | "right"} [initialFacing]
     */
    spawnActiveCharacter(startPos, initialFacing) {
        const name = this.getActiveCharacterId();
        const cfg = this.sceneConfig;
        const conf = characters.render(name, store.getOutfit(name));
        const baseScale = 0.55;
        let scale = baseScale * (conf.spriteScale ?? 1);
        const override = cfg.characterScales?.[name.toLowerCase()] ?? cfg.characterScales?.[name];
        if (override !== undefined) scale = override;

        this.walk = new WalkController(this, {
            characterId: name,
            spriteKey: /** @type {string} */ (conf.spriteKey),
            startPosition: startPos,
            initialFacing,
            walkable: cfg.walkable,
            spriteScale: scale,
            animationSet: conf.animationSet,
            animationScales: conf.animationScales,
            animationOrigins: conf.animationOrigins,
            perspective: cfg.perspective,
        });
        return this.walk;
    }

    /**
     * Hide the active character for scenes where the actor is already painted
     * into the background, but keep hotspot-click routing alive so prop arrival
     * effects still run. Free walking is disabled by removing only the
     * scene-click handler.
     */
    suppressActiveCharacter() {
        if (!this.walk) return;
        if (this.walk.sprite) {
            this.walk.sprite
                .setVisible(false)
                .setData("debugSkip", true);
        }
        this.walk.wearables?.destroy?.();
        this.walk.wearables = null;
        if (this.walk._onPointerDown) this.input.off("pointerdown", this.walk._onPointerDown);
    }

    /** @param {any} [data] */
    create(data) {
        this.bus = new Phaser.Events.EventEmitter();
        const cfg = this.sceneConfig;

        registerAssetKeys(this, this.collectAssetKeys());

        const chapter = store.get("chapter");

        const bgKey = cfg.backgroundsByChapter[chapter] ?? Object.values(cfg.backgroundsByChapter)[0];
        this.background = this.add.image(0, 0, bgKey).setOrigin(0, 0).setData("debugSkip", true);

        this.hotspots = new HotspotManager(this, []);

        // Active character spawn pose: a return-approach if we came from another
        // scene, else the configured start position.
        let startPos = cfg.activeCharacter?.startPosition ?? { x: 0, y: 0 };
        /** @type {"up" | "down" | "left" | "right" | undefined} */
        let initialFacing = undefined;
        const previousSceneKey = data?.from ?? lastTransitionFrom ?? store.getCurrentScene();
        if (previousSceneKey && previousSceneKey !== cfg.key && !store.isReplaying()) {
            const returnApproach = findReturnApproach(cfg, previousSceneKey);
            if (returnApproach) {
                startPos = { x: returnApproach.x, y: returnApproach.y };
                /** @type {Record<string, "up" | "down" | "left" | "right">} */
                const facingMap = { left: "right", right: "left", up: "down", down: "up" };
                if (returnApproach.facing) initialFacing = facingMap[returnApproach.facing];
            }
        }
        if (lastTransitionFrom) clearLastTransitionFrom();

        this.spawnActiveCharacter(startPos, initialFacing);
        if (cfg.suppressActiveCharacter) this.suppressActiveCharacter();

        this.inventory = new InventoryLayer(this, {
            atlasKey: cfg.inventoryAtlas ?? engineAssets.get("inventoryAtlas"),
            layout: this.inventoryLayout,
        });
        if (cfg.inventoryHidden) this.inventory.setVisible(false);

        // Weather: resolve allowed precipitation + ambient for the chapter.
        const allowedWeather = resolveAllowedModes(cfg.weather, chapter);
        const allowedAmbient = resolveAllowedModes(cfg.ambient, chapter);
        const hasWeatherConfig = !!cfg.weather;
        const hasAmbientConfig = !!cfg.ambient;
        const globalWeather = store.get("weatherMode") ?? "none";
        const initialWeather = hasWeatherConfig && allowedWeather.includes(globalWeather) ? globalWeather : "none";
        const fallbackAmbient = chapter === "fall" ? "falling-leaves" : "none";
        const initialAmbient = hasAmbientConfig && allowedAmbient.includes(fallbackAmbient) ? fallbackAmbient : "none";

        this.weather = new WeatherLayer(this, {
            weather: /** @type {import("../environment/WeatherLayer.js").PrecipitationMode} */ (initialWeather),
            ambient: /** @type {import("../environment/WeatherLayer.js").AmbientMode} */ (initialAmbient),
        });
        this.subscenes = new SubsceneStack(this);
        this.debug = new DebugOverlay(this, {
            walkable: cfg.walkable,
            hotspotManager: this.hotspots,
            initialVisible: this.debugInitialVisible,
        });
        this.editor = new SceneEditor(this);

        this.propSprites.clear();
        this.propEngine = new PropEngine(this);
        this.propEngine.build();

        this.cast = new CastDirector(this);
        this.time.delayedCall(0, () => {
            if (this.scene.isActive()) this.cast.build();
        });

        store.setCurrentScene(cfg.key);

        this.currentChapter = chapter;
        this.currentWeather = initialWeather;
        /** @type {import("../environment/WeatherLayer.js").AmbientMode} */
        this.currentAmbient = initialAmbient;
        this.currentTimeOfDay = store.getTimeOfDay();
        const unsubscribe = store.onChange(() => {
            const newChapter = store.get("chapter");
            if (this.currentChapter !== newChapter) {
                const oldChapter = this.currentChapter;
                this.currentChapter = newChapter;
                this.handleChapterTransition(oldChapter, newChapter);
                this.bus.emit("chapterchange", newChapter);
            }
            if (hasWeatherConfig) {
                const ng = store.get("weatherMode") ?? "none";
                const nw = resolveAllowedModes(cfg.weather, this.currentChapter).includes(ng) ? ng : "none";
                if (this.currentWeather !== nw) {
                    this.currentWeather = nw;
                    this.weather?.setWeatherMode(
                        /** @type {import("../environment/WeatherLayer.js").PrecipitationMode} */ (nw),
                    );
                    this.bus.emit("weatherchange", nw);
                }
            }
            if (hasAmbientConfig) {
                // Default ambient = the first non-"none" mode the scene allows
                // for this chapter (no chapter-specific knowledge in the engine).
                const na = /** @type {import("../environment/WeatherLayer.js").AmbientMode} */ (
                    resolveAllowedModes(cfg.ambient, this.currentChapter).find((m) => m !== "none") ?? "none"
                );
                if (this.currentAmbient !== na) {
                    this.currentAmbient = na;
                    this.weather?.setAmbientMode(na);
                    this.bus.emit("ambientchange", na);
                }
            }
            const nt = store.getTimeOfDay();
            if (this.currentTimeOfDay !== nt) {
                this.currentTimeOfDay = nt;
                this.bus.emit("timechange", nt);
            }
        });

        this.events.once("shutdown", () => {
            unsubscribe();
            this.bus.destroy();
        });
    }

    /** @param {string} bgKey */
    changeBackground(bgKey) {
        this.background?.setTexture(bgKey, "__BASE");
    }

    /**
     * Whether a character id currently has a live NPC in the scene. Used to
     * avoid spawning a duplicate wanderer. @param {string} id @returns {boolean}
     */
    hasCharacter(id) {
        return (this._npcPresence?.get(id) ?? 0) > 0;
    }

    /**
     * Game hook: react to a chapter transition. No-op in the engine.
     * @param {string} _oldChapter @param {string} _newChapter
     */
    handleChapterTransition(_oldChapter, _newChapter) {}

    /**
     * Game hook: whether an exit is currently blocked. @param {import("../interaction/HotspotManager.js").HotspotConfig} _hotspot
     * @returns {boolean}
     */
    isExitDisabled(_hotspot) {
        return false;
    }
}

/**
 * Where the character should spawn when entering FROM `previousSceneKey` — the
 * `approach` of whichever prop transitions to that scene.
 * @param {AdventureSceneConfig} cfg @param {string} previousSceneKey
 * @returns {{ x: number, y: number, facing?: string } | null}
 */
function findReturnApproach(cfg, previousSceneKey) {
    for (const prop of cfg.props ?? []) {
        let declared = prop.transitionsTo ?? [];
        if (typeof declared === "string") declared = [declared];
        if (declared.includes(previousSceneKey)) {
            const approach = prop.approach;
            if (approach && approach !== "in-place") {
                return /** @type {{ x: number, y: number, facing?: string }} */ (approach);
            }
        }
        for (const st of prop.states ?? []) {
            for (const eff of st.onClick ?? []) {
                const gts = /** @type {any} */ (eff).goToScene;
                if (!gts) continue;
                const target = typeof gts === "string" ? gts : gts.target;
                if (target !== previousSceneKey) continue;
                const approach = st.approach ?? prop.approach;
                if (approach && approach !== "in-place") {
                    return /** @type {{ x: number, y: number, facing?: string }} */ (approach);
                }
            }
        }
    }
    return null;
}

/**
 * The weather/ambient modes a scene allows for a chapter — a direct lookup with
 * no inheritance. The engine knows nothing about chapters or their order; a
 * chapter the scene doesn't list simply allows only "none". Whatever modes a
 * game declares for a chapter are allowed as-is; the engine validates nothing.
 * @param {Record<string, string[]> | undefined} configBlock @param {string} chapter @returns {string[]}
 */
function resolveAllowedModes(configBlock, chapter) {
    return configBlock?.[chapter] ?? ["none"];
}
