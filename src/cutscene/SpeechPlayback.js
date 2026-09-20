import { Cutscene } from "./Cutscene.js";

/**
 * @typedef {object} SpeechOptions
 * @property {"auto" | "manual" | "either"} [advance] - default either; manual waits for click/Enter/Space.
 * @property {number} [holdMs] - fallback reading duration (default 2800).
 * @property {string} [voice] - preloaded Phaser audio key; successful playback controls automatic duration.
 * @property {number} [minAdvanceMs] - ignore the input that opened the line (default 150).
 */

/**
 * Own timers, input and optional audio for a displayed Phaser speech container.
 * The same teardown runs on advance, completion, cancellation and scene shutdown.
 * @param {import("phaser").Scene} scene
 * @param {import("phaser").GameObjects.Container} bubble
 * @param {SpeechOptions} [opts]
 * @param {Cutscene} [cs]
 * @returns {Promise<void>}
 */
export async function waitForSpeech(scene, bubble, opts = {}, cs = new Cutscene()) {
    const advance = opts.advance ?? "either";
    const automatic = advance !== "manual";
    /** @type {import("phaser").Time.TimerEvent | undefined} */
    let timer;
    /** @type {import("phaser").GameObjects.Zone | undefined} */
    let blocker;
    /** @type {import("phaser").Sound.BaseSound | undefined} */
    let voice;
    let ended = false;
    let ready = false;
    /** @type {import("phaser").Time.TimerEvent | undefined} */
    let armTimer;
    /** @type {() => void} */
    let finish = () => {};
    const shutdown = () => cs.cancel();
    const onComplete = () => {
        if (automatic) finish();
    };
    const onAdvance = () => {
        if (ready) finish();
    };
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
        if (event.repeat) return;
        event.preventDefault();
        onAdvance();
    };
    const cleanup = () => {
        if (ended) return;
        ended = true;
        timer?.remove(false);
        armTimer?.remove(false);
        scene.events.off("shutdown", shutdown);
        scene.input.keyboard?.off("keydown-SPACE", onKey);
        scene.input.keyboard?.off("keydown-ENTER", onKey);
        if (voice) {
            voice.off("complete", onComplete);
            voice.stop();
            voice.destroy();
        }
        blocker?.destroy();
        bubble.destroy();
    };

    try {
        await cs.wait((done) => {
            finish = () => {
                if (ended) return;
                cleanup();
                done();
            };
            scene.events.once("shutdown", shutdown);
            if (advance !== "auto") {
                // Consume input above inventory and props so advancing cannot also
                // move the character, pick up an item, or start a second dialogue.
                blocker = scene.add.zone(0, 0, scene.scale.width, scene.scale.height)
                    .setOrigin(0, 0).setScrollFactor(0).setDepth(10000).setInteractive();
                blocker.on(
                    "pointerdown",
                    (
                        /** @type {any} */ _pointer,
                        /** @type {number} */ _x,
                        /** @type {number} */ _y,
                        /** @type {any} */ event,
                    ) => {
                        event.stopPropagation();
                        onAdvance();
                    },
                );
                bubble.setDepth(10001);
                scene.input.keyboard?.on("keydown-SPACE", onKey);
                scene.input.keyboard?.on("keydown-ENTER", onKey);
                armTimer = scene.time.delayedCall(opts.minAdvanceMs ?? 150, () => ready = true);
            }
            let playing = false;
            if (opts.voice && !scene.sound.locked && !scene.sound.mute && scene.cache.audio.exists(opts.voice)) {
                try {
                    voice = scene.sound.add(opts.voice);
                    voice.once("complete", onComplete);
                    playing = voice.play({ loop: false });
                } catch {
                    // Missing/unsupported/blocked audio must never strand a line.
                    playing = false;
                }
            }
            if (automatic && !playing && !ended) timer = scene.time.delayedCall(opts.holdMs ?? 2800, finish);
        }, cleanup);
    } finally {
        cleanup();
    }
}
