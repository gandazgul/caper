import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { Cutscene, CutsceneCancelled } from "./Cutscene.js";

// ── The cancellation contract ──────────────────────────────────────────────
// The cutscene runner turns callback-style ops (walkTo/speak/play, which resolve
// from a Phaser tween or timer) into awaitable promises. When the scene shuts
// down (or the cutscene is preempted) mid-sequence, every outstanding await must
// reject so the async function unwinds — WITHOUT running later steps that would
// touch an already-destroyed sprite, and after stopping the underlying
// tween/timer. These tests pin that contract Phaser-free.

Deno.test("Cutscene: wait() resolves when the op completes", async () => {
    const cs = new Cutscene();
    /** @type {(value?: any) => void} */
    let fire = () => {};
    const p = cs.wait((done) => {
        fire = done;
    });
    fire("arrived");
    assertEquals(await p, "arrived");
});

Deno.test("Cutscene: a pending wait rejects with CutsceneCancelled on cancel, and its onCancel runs", async () => {
    const cs = new Cutscene();
    let cancelled = false;
    const p = cs.wait(
        () => {}, // op never completes on its own (in-flight tween)
        () => {
            cancelled = true;
        },
    );
    cs.cancel();
    await assertRejects(() => p, CutsceneCancelled);
    assert(cancelled, "onCancel ran to stop the underlying tween/timer");
});

Deno.test("Cutscene: wait() after cancel rejects immediately and never starts the op", async () => {
    const cs = new Cutscene();
    cs.cancel();
    let started = false;
    const p = cs.wait(() => {
        started = true;
    });
    await assertRejects(() => p, CutsceneCancelled);
    assert(!started, "the op must not start once cancelled (no touching live objects)");
});

Deno.test("Cutscene: a late done() after cancel is a harmless no-op", async () => {
    const cs = new Cutscene();
    /** @type {(value?: any) => void} */
    let fire = () => {};
    const p = cs.wait((done) => {
        fire = done;
    });
    cs.cancel();
    await assertRejects(() => p, CutsceneCancelled);
    // The tween's onComplete fires AFTER teardown — must not throw or re-resolve.
    fire("too-late");
});

Deno.test("Cutscene: cancel is idempotent", () => {
    const cs = new Cutscene();
    cs.cancel();
    cs.cancel(); // must not throw
    assert(cs.cancelled);
});

Deno.test("Cutscene: throwIfCancelled lets a sequence bail between awaits", () => {
    const cs = new Cutscene();
    cs.throwIfCancelled(); // no-op while live
    cs.cancel();
    let threw = null;
    try {
        cs.throwIfCancelled();
    } catch (e) {
        threw = e;
    }
    assert(threw instanceof CutsceneCancelled);
});

// The headline regression: an async cutscene unwinds on shutdown and never
// touches the destroyed sprite, with the in-flight tween stopped.
Deno.test("Cutscene: async sequence unwinds on cancel without touching a destroyed sprite", async () => {
    const cs = new Cutscene();
    /** @type {string[]} */
    const log = [];
    const sprite = { destroyed: false };
    let stopped = false;

    const actor = {
        // walkTo never auto-completes here — it models an in-flight tween.
        walkTo: () =>
            cs.wait(
                () => log.push("walk:start"),
                () => {
                    stopped = true;
                    log.push("walk:cancel");
                },
            ),
        touch: () => {
            if (sprite.destroyed) log.push("TOUCHED-DEAD");
            else log.push("touch");
        },
    };

    const sequence = (async () => {
        await actor.walkTo();
        actor.touch(); // must NOT run after cancel
        await actor.walkTo();
        actor.touch();
    })();

    await Promise.resolve(); // let the first walk start
    assertEquals(log, ["walk:start"]);

    // Scene shutdown mid-cutscene.
    cs.cancel();
    sprite.destroyed = true;

    await assertRejects(() => sequence, CutsceneCancelled);
    assert(stopped, "the in-flight tween was stopped via onCancel");
    assertStrictEquals(log.includes("TOUCHED-DEAD"), false);
    assertEquals(log, ["walk:start", "walk:cancel"]);
});
