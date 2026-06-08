/**
 * Asset loading driven by a key-naming convention — no hand-maintained
 * manifest. The texture/JSON key encodes where the file lives, so given a key
 * we can derive its URL:
 *
 *   bg_<name>         → image   /scenes/<name>.jpg by default; may include
 *                               .jpg, .jpeg, .png, .webp, or .svg
 *   sprite_<name>     → atlas   /objects/<name>.png by default; may include
 *                               .png or .webp (+ /objects/<name>.json,
 *                               spritecook frames registered onto the texture)
 *   object_<name>     → image   /objects/<name>.png by default; may include
 *                               .png, .webp, or .svg
 *   character_<name>  → image   /characters/<name>.png by default; may include
 *                               .png, .webp, or .svg
 *
 * Anything that doesn't match a prefix (globally loaded characters
 * and shared atlases like `inventory-atlas`/`ui-atlas`, plus spritesheets whose
 * frame size can't be encoded in a name) is loaded explicitly by BootScene or
 * the owning scene. Spritesheets in particular need frameWidth/frameHeight, so
 * they are never auto-derived.
 *
 * Each scene declares the keys it needs:
 *   - `backgroundsByChapter` (already in the config) → the per-chapter background
 *   - `assets` (an array of convention keys) → its other backgrounds, props,
 *     and chapter atlases
 * Scanning those at boot tells each chapter loading screen exactly what that
 * chapter requires (see collectChapterAssetKeys), so we never load a later
 * chapter's heavy atlases for a player who's still in an earlier one.
 *
 * Every loader guards on the texture / JSON cache, so the same key requested
 * from BootScene, a chapter intro, and the scene itself only downloads once.
 */

/**
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {string} url
 */
export function loadImageOnce(scene, key, url) {
    if (!scene.textures.exists(key)) scene.load.image(key, url);
}

/**
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {string} url
 * @param {Phaser.Types.Loader.FileTypes.ImageFrameConfig} frameConfig
 */
export function loadSpritesheetOnce(scene, key, url, frameConfig) {
    if (!scene.textures.exists(key)) scene.load.spritesheet(key, url, frameConfig);
}

/**
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {string} url
 */
export function loadJsonOnce(scene, key, url) {
    if (!scene.cache.json.exists(key)) scene.load.json(key, url);
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "svg", "gif"]);
const ATLAS_EXTENSIONS = new Set(["png", "webp", "jpg", "jpeg", "svg", "gif"]);

import { characters } from "../characters/CharacterRegistry.js";

/**
 * @param {string} name
 * @returns {string}
 */
function extensionOf(name) {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match?.[1]?.toLowerCase() ?? "";
}

/**
 * @param {string} name
 * @param {string} fallbackExtension
 * @param {Set<string>} allowedExtensions
 * @returns {{ file: string, stem: string }}
 */
function resolveAssetName(name, fallbackExtension, allowedExtensions) {
    const ext = extensionOf(name);
    if (ext && allowedExtensions.has(ext)) {
        return { file: name, stem: name.slice(0, -ext.length - 1) };
    }
    // If no extension, or unrecognised extension, assume the requested fallback
    return { file: `${name}.${fallbackExtension}`, stem: name };
}

/**
 * Resolve a convention key to what it takes to load it. Returns null for keys
 * that don't follow the convention (those are loaded explicitly elsewhere).
 * @param {string} key
 * @returns {{ kind: "image" | "atlas", url: string, jsonUrl?: string } | null}
 */
export function deriveAsset(key) {
    if (typeof key !== "string") return null;
    if (key.startsWith("bg_")) {
        const asset = resolveAssetName(key.slice(3), "jpg", IMAGE_EXTENSIONS);
        return { kind: "image", url: `/scenes/${asset.file}` };
    }
    if (key.startsWith("sprite_")) {
        const asset = resolveAssetName(key.slice("sprite_".length), "png", ATLAS_EXTENSIONS);
        return { kind: "atlas", url: `/objects/${asset.file}`, jsonUrl: `/objects/${asset.stem}.json` };
    }
    if (key.startsWith("object_")) {
        const asset = resolveAssetName(key.slice("object_".length), "png", IMAGE_EXTENSIONS);
        return { kind: "image", url: `/objects/${asset.file}` };
    }
    if (key.startsWith("character_")) {
        const asset = resolveAssetName(key.slice("character_".length), "png", IMAGE_EXTENSIONS);
        return { kind: "image", url: `/characters/${asset.file}` };
    }
    return null;
}

/**
 * Queue a single convention key for loading (guarded). For `sprite_` keys this
 * loads both the PNG and its JSON sidecar (cached under the same key); call
 * registerAssetKeys() afterwards to add the atlas frames.
 * @param {Phaser.Scene} scene
 * @param {string} key
 */
export function loadAssetKey(scene, key) {
    const d = deriveAsset(key);
    if (!d) return;
    loadImageOnce(scene, key, d.url);
    if (d.kind === "atlas" && d.jsonUrl) loadJsonOnce(scene, key, d.jsonUrl);
}

/**
 * @param {Phaser.Scene} scene
 * @param {Iterable<string>} keys
 */
export function loadAssetKeys(scene, keys) {
    for (const key of keys) loadAssetKey(scene, key);
}

/**
 * Load any convention keys not already present, then register atlas frames and
 * invoke `onComplete`. Mid-scene (post-create) loading — used by the fridge
 * wall to pull the handful of item thumbnails it shows from other scenes'
 * sheets on demand, instead of loading them on every scene visit. Keys that
 * don't follow the convention (e.g. the globally-preloaded `inventory-atlas`) are
 * assumed already present and skipped. If nothing needs loading, `onComplete`
 * fires synchronously.
 *
 * @param {Phaser.Scene} scene
 * @param {Iterable<string>} keys
 * @param {() => void} [onComplete]
 */
export function loadAssetKeysAsync(scene, keys, onComplete) {
    const toLoad = [...keys].filter((k) => deriveAsset(k) && !scene.textures.exists(k));
    if (toLoad.length === 0) {
        onComplete?.();
        return;
    }
    loadAssetKeys(scene, toLoad);
    scene.load.once("complete", () => {
        registerAssetKeys(scene, toLoad);
        onComplete?.();
    });
    scene.load.start();
}

/**
 * Atlas keys whose sprites are packed with trim (transparent margins removed),
 * so their frames need `setTrim` to render at the original placement. The
 * engine doesn't know which atlases these are — the Game registers them at boot
 * via {@link registerTrimmedAtlas}. Empty by default: no atlas is trimmed
 * unless declared.
 * @type {Set<string>}
 */
const trimmedAtlases = new Set();

/**
 * Declare that an atlas is packed with trim, so its frames get `setTrim` when
 * registered. Call at boot for each trimmed atlas.
 * @param {string} key
 */
export function registerTrimmedAtlas(key) {
    trimmedAtlases.add(key);
}

/**
 * Register spritecook-style atlas frames from a JSON sidecar onto a texture.
 * Idempotent — `Texture.add()` ignores frame names that already exist.
 * @param {Phaser.Scene} scene
 * @param {string} key - a `sprite_` key (PNG and JSON share this cache key)
 */
export function registerAtlasFrames(scene, key) {
    const meta = scene.cache.json.get(key);
    const sheet = meta?.sheets?.[0];
    if (!sheet) return;
    const texture = scene.textures.get(key);
    for (const s of sheet.sprites) {
        const frame = texture.add(s.name, 0, s.x, s.y, s.width, s.height);
        // Apply trim only for atlases the Game declared as trimmed — preserves
        // exact prior behavior while keeping atlas names out of the engine.
        if (
            trimmedAtlases.has(key) && frame && s.originalWidth && s.originalHeight &&
            (s.trimOffsetX !== undefined || s.trimOffsetY !== undefined)
        ) {
            frame.setTrim(
                s.originalWidth,
                s.originalHeight,
                s.trimOffsetX ?? 0,
                s.trimOffsetY ?? 0,
                s.width,
                s.height,
            );
        }
    }
}

/**
 * Register frames for every `sprite_` atlas in a key list (call from create(),
 * after the loader has finished).
 * @param {Phaser.Scene} scene
 * @param {Iterable<string>} keys
 */
export function registerAssetKeys(scene, keys) {
    for (const key of keys) {
        if (typeof key === "string" && key.startsWith("sprite_")) registerAtlasFrames(scene, key);
    }
}

/**
 * Walk every registered scene's config and collect the asset keys that the
 * given chapter needs: each scene that has a background for `chapter` contributes
 * that background plus its declared `assets`. Minigame scenes (plain
 * Phaser.Scene, no sceneConfig) aren't included — they load their own assets in
 * their preload, since they're entered deliberately.
 *
 * @param {Phaser.Scenes.SceneManager} manager
 * @param {string} chapter
 * @returns {Set<string>}
 */
export function collectChapterAssetKeys(manager, chapter) {
    /** @type {Set<string>} */
    const keys = new Set();
    for (const scene of manager.scenes) {
        const cfg = /** @type {any} */ (scene).sceneConfig;
        const bg = cfg?.backgroundsByChapter?.[chapter];
        if (!bg) continue;
        keys.add(bg);
        for (const a of cfg.assets ?? []) keys.add(a);
    }

    // Auto-include playable characters, as they can appear in any scene
    for (const id of characters.playableIds()) {
        const conf = characters.get(id);
        if (conf?.spriteKey) keys.add(conf.spriteKey);
        if (conf?.animationSet) {
            for (const dir of Object.values(conf.animationSet)) {
                if (dir.still) keys.add(dir.still);
                if (dir.idle) keys.add(dir.idle);
                if (dir.walk) keys.add(dir.walk);
                if (dir.reach) keys.add(dir.reach);
            }
        }
    }

    return keys;
}

/**
 * The union of asset keys to preload for one or more chapters. Pass every
 * chapter whose backgrounds should be loaded for a given screen — the engine
 * has no notion of a "baseline" chapter, so if a game wants a common chapter's
 * art always available it includes that chapter id in the list itself.
 *
 * @param {Phaser.Scenes.SceneManager} manager
 * @param {string[]} chapters
 * @returns {Set<string>}
 */
export function chapterLoadSet(manager, chapters) {
    /** @type {Set<string>} */
    const keys = new Set();
    for (const chapter of chapters) {
        for (const k of collectChapterAssetKeys(manager, chapter)) keys.add(k);
    }
    return keys;
}
