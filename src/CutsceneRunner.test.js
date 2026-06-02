import { assert, assertEquals, assertRejects } from "@std/assert";
import { CutsceneRunner } from "./CutsceneRunner.js";

/**
 * Build a runner with recording hooks. `buildContext` hands the cutscene fn an
 * actor whose `hang()` never completes on its own (models an in-flight tween),
 * so tests can cancel/preempt mid-await.
 */
function makeRunner() {
    /** @type {string[]} */
    const events = [];
    const runner = new CutsceneRunner({
        suspend: (cast) => events.push(`suspend:${cast ?? "all"}`),
        resume: (cast) => events.push(`resume:${cast ?? "all"}`),
        lockPlayer: () => events.push("lock"),
        unlockPlayer: () => events.push("unlock"),
        buildContext: (cs) => ({
            hang: () =>
                cs.wait(
                    () => events.push("hang:start"),
                    () => events.push("hang:cancel"),
                ),
            step: (/** @type {string} */ name) => {
                cs.throwIfCancelled();
                events.push(`step:${name}`);
            },
        }),
    });
    return { runner, events };
}

Deno.test("CutsceneRunner: suspends before, resumes after a normal run; respects lockPlayer", async () => {
    const { runner, events } = makeRunner();
    await runner.run(
        (d) => {
            d.step("a");
            return Promise.resolve();
        },
        { lockPlayer: true, cast: ["papa"] },
    );
    assertEquals(events, ["suspend:papa", "lock", "step:a", "unlock", "resume:papa"]);
    assert(!runner.active, "no active cutscene after completion");
});

Deno.test("CutsceneRunner: a non-cancel error propagates but still resumes", async () => {
    const { runner, events } = makeRunner();
    await assertRejects(
        () =>
            runner.run(() => {
                throw new Error("boom");
            }),
        Error,
        "boom",
    );
    assertEquals(events, ["suspend:all", "resume:all"]);
    assert(!runner.active);
});

Deno.test("CutsceneRunner: shutdown mid-cutscene cancels, unwinds, and resumes once", async () => {
    const { runner, events } = makeRunner();
    /** @type {Promise<void>} */
    const running = runner.run((d) => d.hang().then(() => d.step("after")), { lockPlayer: true });
    await Promise.resolve();
    assertEquals(events, ["suspend:all", "lock", "hang:start"]);

    runner.shutdown();
    await running; // swallows CutsceneCancelled internally

    // step:after never ran; resume/unlock happened exactly once.
    assertEquals(events, ["suspend:all", "lock", "hang:start", "hang:cancel", "unlock", "resume:all"]);
    assert(!runner.active);
});

Deno.test("CutsceneRunner: a preempting cutscene cancels the running one without double-resume", async () => {
    const { runner, events } = makeRunner();
    const first = runner.run((d) => d.hang().then(() => d.step("first-after")), { cast: ["papa"] });
    await Promise.resolve();

    // Second cutscene preempts the first.
    await runner.run(
        (d) => {
            d.step("second");
            return Promise.resolve();
        },
        { cast: ["mama"] },
    );
    await first;

    assertEquals(events, [
        "suspend:papa",
        "hang:start",
        "hang:cancel", // first cancelled by preemption
        "suspend:mama",
        "step:second",
        "resume:mama",
        // first must NOT emit its own resume:papa — it lost ownership
    ]);
    assert(!runner.active);
});
