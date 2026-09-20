import { Cutscene, CutsceneCancelled } from "./Cutscene.js";
import { DialogueBubble } from "./DialogueBubble.js";
import { waitForSpeech } from "./SpeechPlayback.js";

/**
 * Show one awaitable speech line. Standalone shutdown resolves quietly; passing
 * a cutscene token propagates cancellation to prevent later story mutations.
 * @param {import("phaser").Scene} scene
 * @param {Omit<import("./DialogueBubble.js").DialogueBubbleOpts, "autoDestroyMs"> & import("./SpeechPlayback.js").SpeechOptions} opts
 * @param {Cutscene} [cs]
 * @returns {Promise<void>}
 */
export async function showSpeech(scene, opts, cs) {
    const token = cs ?? new Cutscene();
    token.throwIfCancelled();
    const sprite = /** @type {import("phaser").GameObjects.Sprite} */ (opts.character);
    const count = () => Number(sprite.getData?.("caper:speaking") ?? 0);
    sprite.setData?.("caper:speaking", count() + 1);
    try {
        const bubble = DialogueBubble.show(scene, {
            ...opts,
            variant: opts.variant ?? "speech",
            autoDestroyMs: undefined,
        });
        await waitForSpeech(scene, bubble, opts, token);
    } catch (error) {
        if (cs || !(error instanceof CutsceneCancelled)) throw error;
    } finally {
        // Destroyed sprites no longer have a DataManager; don't recreate one on shutdown.
        if (sprite.active) sprite.setData?.("caper:speaking", Math.max(0, count() - 1));
    }
}
