// @ts-nocheck: model Phaser's external event, timer, input, and audio APIs without a renderer.
import { assertEquals, assertRejects } from "@std/assert";
import { EventEmitter } from "node:events";
import { Cutscene, CutsceneCancelled } from "./Cutscene.js";
import { waitForSpeech } from "./SpeechPlayback.js";

function fixture({ locked = false, muted = false, available = true, playable = true } = {}) {
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
            delayedCall: (ms, fn) => {
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
    return { scene, bubble, timers, keyboard, voice, blocker };
}

Deno.test("speech waits for voice completion and destroys owned resources", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { voice: "hello", advance: "auto" });
    assertEquals(f.timers.length, 0);
    f.voice.emit("complete");
    await done;
    assertEquals(f.voice.destroyed, true);
    assertEquals(f.bubble.destroyed, true);
    assertEquals(f.scene.events.listenerCount("shutdown"), 0);
});

Deno.test("manual speech ignores opening input, then consumes advance input and cleans listeners", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { advance: "manual" });
    let stopped = 0;
    const click = () => f.blocker.emit("pointerdown", {}, 0, 0, { stopPropagation: () => stopped++ });
    click();
    assertEquals(f.bubble.destroyed, false);
    f.timers[0].fn(); // arm the advance control
    click();
    await done;
    assertEquals(stopped, 2);
    assertEquals(f.blocker.destroyed, true);
    assertEquals(f.keyboard.listenerCount("keydown-SPACE"), 0);
    assertEquals(f.keyboard.listenerCount("keydown-ENTER"), 0);
});

Deno.test("blocked, muted, absent and rejected audio all fall back to reading duration", async () => {
    for (const options of [{ locked: true }, { muted: true }, { available: false }, { playable: false }]) {
        const f = fixture(options);
        const done = waitForSpeech(f.scene, f.bubble, { voice: "hello", advance: "auto", holdMs: 4000 });
        assertEquals(f.timers.length, 1);
        assertEquals(f.timers[0].ms, 4000);
        f.timers[0].fn();
        await done;
    }
});

Deno.test("cutscene cancellation stops voice and prevents subsequent story effects", async () => {
    const f = fixture();
    const cs = new Cutscene();
    let mutated = false;
    const done = waitForSpeech(f.scene, f.bubble, { voice: "hello" }, cs).then(() => mutated = true);
    cs.cancel();
    await assertRejects(() => done, CutsceneCancelled);
    f.voice.emit("complete");
    assertEquals(mutated, false);
    assertEquals(f.voice.destroyed, true);
    assertEquals(f.blocker.destroyed, true);
    assertEquals(f.timers.every((t) => t.removed), true);
});

Deno.test("scene shutdown cancels manual speech and an already cancelled sequence creates no input", async () => {
    const f = fixture();
    const done = waitForSpeech(f.scene, f.bubble, { advance: "manual" });
    f.scene.events.emit("shutdown");
    await assertRejects(() => done, CutsceneCancelled);
    assertEquals(f.bubble.destroyed, true);
    const cs = new Cutscene();
    cs.cancel();
    const second = fixture();
    await assertRejects(() => waitForSpeech(second.scene, second.bubble, {}, cs), CutsceneCancelled);
    assertEquals(second.timers.length, 0);
});
