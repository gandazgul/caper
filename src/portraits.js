/**
 * Character portraits (ADR 0005/0006). A registered character gets a circular
 * portrait for free — used by the {@link CharacterSwitcher} and by thought-
 * bubble `character` icons — resolved from its registration metadata. The
 * engine bakes a default crop of the character's front sprite; a game may
 * override the whole texture or tune the crop.
 *
 * Resolution order (per character config):
 *   1. `getPortrait(scene)` — full override returning a texture key.
 *   2. `portraitSettings` — crop recipe (`texture`, `scale`, `offsetX`, `offsetY`).
 *   3. Engine default — circular crop of the character's front still texture,
 *      centred at (50%, 25%) with radius = 20% of width.
 *
 * Baked portraits are cached under `engine-portrait-<id>` and shared by every
 * consumer. A null result means the source texture isn't loaded yet — callers
 * should retry on a later frame.
 */

import { characters } from "./CharacterRegistry.js";

/**
 * Bake a circular crop from a texture frame into a new cached canvas texture.
 * Idempotent — subsequent calls with the same `outKey` are no-ops.
 *
 * @param {import("phaser").Scene} scene
 * @param {string} sourceKey
 * @param {string | number} frameNameOrIndex
 * @param {string} outKey
 * @param {{ cx: number, cy: number, radius: number }} circle - crop circle in
 *   pixel coords of the source frame.
 */
export function bakeCircularCrop(scene, sourceKey, frameNameOrIndex, outKey, circle) {
    if (scene.textures.exists(outKey)) return;
    if (!scene.textures.exists(sourceKey)) return;
    const texture = scene.textures.get(sourceKey);
    const frame = texture.get(frameNameOrIndex);
    if (!frame) return;
    const sourceImg = texture.getSourceImage(frame.sourceIndex);
    const diameter = Math.round(circle.radius * 2);
    const canvas = document.createElement("canvas");
    canvas.width = diameter;
    canvas.height = diameter;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
        /** @type {CanvasImageSource} */ (sourceImg),
        frame.cutX + (circle.cx - circle.radius),
        frame.cutY + (circle.cy - circle.radius),
        diameter,
        diameter,
        0,
        0,
        diameter,
        diameter,
    );
    ctx.restore();
    scene.textures.addCanvas(outKey, canvas);
}

/**
 * Resolve (or create) a circular portrait texture key for a registered
 * character. Follows the fallback chain getPortrait → portraitSettings →
 * engine default (front-sprite crop).
 *
 * @param {import("phaser").Scene} scene
 * @param {string} characterId
 * @param {import("./CharacterRegistry.js").CharacterConfig} [config] - the
 *   character's config; looked up from the registry when omitted.
 * @returns {string | null} texture key, or null if not yet available.
 */
export function resolveCharacterPortrait(scene, characterId, config = characters.get(characterId)) {
    if (!config) return null;

    // 1. Full override callback.
    if (typeof config.getPortrait === "function") {
        const key = config.getPortrait(scene);
        if (key && scene.textures.exists(key)) return key;
        // Callback returned a key but texture isn't ready → retry.
        if (key) return null;
        // Falsy → fall through.
    }

    const settings = config.portraitSettings;
    // Default source is the character's front still — the "head-on" pose that
    // crops cleanly to a portrait — falling back to the base sprite key.
    const sourceKey = settings?.texture ?? config.animationSet?.front?.still ?? config.spriteKey;
    if (!sourceKey || !scene.textures.exists(sourceKey)) return null;

    const texture = scene.textures.get(sourceKey);
    const frameObj = texture.get(); // default frame (frame 0)
    if (!frameObj) return null;

    const fw = frameObj.width;
    const fh = frameObj.height;
    const outKey = `engine-portrait-${characterId}`;

    // 2. portraitSettings crop recipe.
    if (settings) {
        const cx = fw * (settings.offsetX ?? 0.5);
        const cy = fh * (settings.offsetY ?? 0.25);
        // Default radius = 20% of frame width, scaled by portraitSettings.scale.
        const radius = fw * 0.2 * (settings.scale ?? 1);
        bakeCircularCrop(scene, sourceKey, 0, outKey, { cx, cy, radius });
        return outKey;
    }

    // 3. Engine default — centre at (50%, 25%), radius = 20% of width.
    bakeCircularCrop(scene, sourceKey, 0, outKey, { cx: fw * 0.5, cy: fh * 0.25, radius: fw * 0.2 });
    return outKey;
}
