import Phaser from "phaser";
import { HotspotManager } from "./HotspotManager.js";
import { WalkController } from "./WalkController.js";
import { InventoryLayer } from "./InventoryLayer.js";
import { WeatherLayer } from "./WeatherLayer.js";
import { SubsceneStack } from "./SubsceneStack.js";
import { DebugOverlay } from "./DebugOverlay.js";
import { SceneEditor } from "./SceneEditor.js";
import { PropEngine } from "./PropEngine.js";
import { CastDirector } from "./CastDirector.js";
import { store } from "./Store.js";
import { characters } from "./CharacterRegistry.js";
import { engineAssets } from "./EngineAssets.js";
import { loadAssetKeys, registerAssetKeys } from "./assetLoading.js";
import { clearLastTransitionFrom, lastTransitionFrom } from "./transitions.js";

/**
 * @typedef {object} AdventureSceneConfig
 * @property {string} key
 * @property {string} [season] - the chapter/season this scene belongs to.
 * @property {Record<string, string>} backgroundsBySeason
 * @property {{ x: number, y: number }[]} walkable
 * @property {{
 *   startPosition: { x: number, y: number },
 *   spriteKey?: string,
 *   animationSet?: import("./WalkController.js").AnimationSet,
 *   animationScales?: Record<string, number>,
 *   animationOrigins?: Record<string, { x?: number, y?: number }>,
 * }} [activeCharacter] - spawn pose (+ optional sprite fields some helpers read).
 * @property {Record<string, number>} [animationScales]
 * @property {Record<string, { x?: number, y?: number }>} [animationOrigins]
 * @property {Record<string, number>} [characterScales] - per-scene scale overrides by character id/name.
 * @property {import("./perspective.js").PerspectiveConfig} [perspective]
 * @property {Record<string, string[]>} [weather] - per-season allowed precipitation modes.
 * @property {Record<string, string[]>} [ambient] - per-season allowed ambient effects.
 * @property {string} [inventoryAtlas]
 * @property {boolean} [inventoryHidden]
 * @property {boolean} [indoors]
 * @property {boolean} [disableIdleCharacter] - opt this scene out of the autonomous idle character.
 * @property {boolean} [hideCharacterSwitcher]
 * @property {import("./PropEngine.js").Prop[]} [props]
 * @property {string[]} [assets]
 * @property {Record<string, import("./CastRegistry.js").SceneCastOverride>} [cast]
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
 *   - `handleSeasonTransition()` / `isExitDisabled()` — game reactions.
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
    currentSeason;
    /** @type {string} */
    currentWeather;
    /** @type {import("./WeatherLayer.js").AmbientMode} */
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
        return [...Object.values(cfg.backgroundsBySeason ?? {}), ...(cfg.assets ?? [])];
    }

    preload() {
        loadAssetKeys(this, this.collectAssetKeys());
    }

    /**
     * Build the active character's WalkController from the registry, applying
     * the character's current outfit and any per-scene scale override. Reused
     * by `create()` and by a subclass's switch/rebuild.
     * @param {string} name @param {{ x: number, y: number }} startPos
     * @param {"up" | "down" | "left" | "right"} [initialFacing]
     */
    spawnActiveCharacter(name, startPos, initialFacing) {
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

    /** @param {any} [data] */
    create(data) {
        this.bus = new Phaser.Events.EventEmitter();
        const cfg = this.sceneConfig;

        registerAssetKeys(this, this.collectAssetKeys());

        const chapter = store.get("chapter") ?? "spring";

        const bgKey = cfg.backgroundsBySeason[chapter] ?? cfg.backgroundsBySeason["spring"] ??
            Object.values(cfg.backgroundsBySeason)[0];
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

        this.spawnActiveCharacter(this.getActiveCharacterId(), startPos, initialFacing);

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
            weather: /** @type {import("./WeatherLayer.js").PrecipitationMode} */ (initialWeather),
            ambient: /** @type {import("./WeatherLayer.js").AmbientMode} */ (initialAmbient),
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

        this.currentSeason = chapter;
        this.currentWeather = initialWeather;
        /** @type {import("./WeatherLayer.js").AmbientMode} */
        this.currentAmbient = initialAmbient;
        this.currentTimeOfDay = store.getTimeOfDay();
        const unsubscribe = store.onChange(() => {
            const newSeason = store.get("chapter") ?? "spring";
            if (this.currentSeason !== newSeason) {
                const oldSeason = this.currentSeason;
                this.currentSeason = newSeason;
                this.handleSeasonTransition(oldSeason, newSeason);
                this.bus.emit("seasonchange", newSeason);
            }
            if (hasWeatherConfig) {
                const ng = store.get("weatherMode") ?? "none";
                const nw = resolveAllowedModes(cfg.weather, this.currentSeason).includes(ng) ? ng : "none";
                if (this.currentWeather !== nw) {
                    this.currentWeather = nw;
                    this.weather?.setWeatherMode(/** @type {import("./WeatherLayer.js").PrecipitationMode} */ (nw));
                    this.bus.emit("weatherchange", nw);
                }
            }
            if (hasAmbientConfig) {
                const fb = this.currentSeason === "fall" ? "falling-leaves" : "none";
                const na = resolveAllowedModes(cfg.ambient, this.currentSeason).includes(fb) ? fb : "none";
                if (this.currentAmbient !== na) {
                    this.currentAmbient = na;
                    this.weather?.setAmbientMode(/** @type {import("./WeatherLayer.js").AmbientMode} */ (na));
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
     * @param {string} _oldSeason @param {string} _newSeason
     */
    handleSeasonTransition(_oldSeason, _newSeason) {}

    /**
     * Game hook: whether an exit is currently blocked. @param {import("./HotspotManager.js").HotspotConfig} _hotspot
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
 * Resolve the allowed modes for a chapter, walking backwards through the
 * season order (with wraparound) when the chapter isn't listed.
 * @param {Record<string, string[]> | undefined} configBlock @param {string} season @returns {string[]}
 */
function resolveAllowedModes(configBlock, season) {
    if (!configBlock) return ["none"];
    const order = ["spring", "summer", "fall", "winter"];
    const idx = order.indexOf(season);
    if (idx < 0) return configBlock[season] ?? ["none"];
    for (let i = 0; i < order.length; i++) {
        const s = order[(idx - i + order.length) % order.length];
        if (configBlock[s]) return configBlock[s];
    }
    return ["none"];
}
