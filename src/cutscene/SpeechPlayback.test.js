import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Cutscene, CutsceneCancelled } from "./Cutscene.js";
import { waitForSpeech } from "./SpeechPlayback.js";

function fixture({ locked = false, muted = false, available = true, playable = true } = {}) {
    /** @type {{ ms: number, fn: () => void, removed: boolean, remove(): void }[]} */
    const timers = [];
    const keyboard = new EventEmitter();
    const voice = Object.assign(new EventEmitter(), {
        play: () => playable,
        stop: () => {},
        destroy() {
            this.destroyed = true;
        },
        destroyed: false,
    });
    const blocker = Object.assign(new EventEmitter(), {
        setOrigin() {
            return this;
        },
        setScrollFactor() {
            return this;
        },
        setDepth() {
            return this;
        },
        setInteractive() {
            return this;
        },
        destroy() {
            this.destroyed = true;
        },
        destroyed: false,
    });
    const bubble = {
        setDepth() {},
        destroy() {
            this.destroyed = true;
        },
        destroyed: false,
    };
    const scene = {
        events: new EventEmitter(),
        input: { keyboard },
        scale: { width: 960, height: 640 },
        add: { zone: () => blocker },
        time: {
            delayedCall: (/** @type {number} */ ms, /** @type {() => void} */ fn) => {
                const t = {
                    ms,
                    fn,
                    removed: false,
                    remove() {
                        this.removed = true;
                    },
                };
                timers.push(t);
                return t;
            },
        },
        sound: { locked, mute: muted, add: () => voice },
        cache: { audio: { exists: () => available } },
    };
    // Only the external Phaser scene and display object are partial fixtures.
    return {
        scene: /** @type {typeof scene & import("phaser").Scene} */ (/** @type {unknown} */ (scene)),
        bubble: /** @type {typeof bubble & import("phaser").GameObjects.Container} */ (/** @type {unknown} */ (bubble)),
        timers,
        keyboard,
        voice,
        blocker,
    };
}

test("speech waits for voice completion and destroys owned resources", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { voice: "hello", advance: "auto" });
    expect(f.timers.length).toStrictEqual(0);
    f.voice.emit("complete");
    await done;
    expect(f.voice.destroyed).toStrictEqual(true);
    expect(f.bubble.destroyed).toStrictEqual(true);
    expect(f.scene.events.listenerCount("shutdown")).toStrictEqual(0);
});

test("manual speech ignores opening input, then consumes advance input and cleans listeners", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { advance: "manual" });
    let stopped = 0;
    const click = () => f.blocker.emit("pointerdown", {}, 0, 0, { stopPropagation: () => stopped++ });
    click();
    expect(f.bubble.destroyed).toStrictEqual(false);
    f.timers[0].fn(); // arm the advance control
    click();
    await done;
    expect(stopped).toStrictEqual(2);
    expect(f.blocker.destroyed).toStrictEqual(true);
    expect(f.keyboard.listenerCount("keydown-SPACE")).toStrictEqual(0);
    expect(f.keyboard.listenerCount("keydown-ENTER")).toStrictEqual(0);
});

test("blocked, muted, absent and rejected audio all fall back to reading duration", async () => {
    for (const options of [{ locked: true }, { muted: true }, { available: false }, { playable: false }]) {
        const f = fixture(options);
        const done = waitForSpeech(f.scene, f.bubble, { voice: "hello", advance: "auto", holdMs: 4000 });
        expect(f.timers.length).toStrictEqual(1);
        expect(f.timers[0].ms).toStrictEqual(4000);
        f.timers[0].fn();
        await done;
    }
});

test("cutscene cancellation stops voice and prevents subsequent story effects", async () => {
    const f = fixture();
    const cs = new Cutscene();
    let mutated = false;
    const done = waitForSpeech(f.scene, f.bubble, { voice: "hello" }, cs).then(() => (mutated = true));
    cs.cancel();
    await expect(done).rejects.toThrow(CutsceneCancelled);
    f.voice.emit("complete");
    expect(mutated).toStrictEqual(false);
    expect(f.voice.destroyed).toStrictEqual(true);
    expect(f.blocker.destroyed).toStrictEqual(true);
    expect(f.timers.every((t) => t.removed)).toStrictEqual(true);
});

test("scene shutdown cancels manual speech and an already cancelled sequence creates no input", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { advance: "manual" });
    f.scene.events.emit("shutdown");
    await expect(done).rejects.toThrow(CutsceneCancelled);
    expect(f.bubble.destroyed).toStrictEqual(true);
    const cs = new Cutscene();
    cs.cancel();
    const second = fixture();
    await expect(waitForSpeech(second.scene, second.bubble, {}, cs)).rejects.toThrow(CutsceneCancelled);
    expect(second.timers.length).toStrictEqual(0);
});
