import { assertEquals, assertThrows } from "@std/assert";
import { store } from "./Store.js";
import {
    clearQuests,
    questProgress,
    questStatus,
    questWhatsNext,
    questWhatsNextNode,
    registerQuests,
    resolveQuestAccessor,
} from "./Quests.js";
import { evaluateCondition } from "../core/conditions.js";

/** Fresh slate: empty registry + empty default collections + cleared flags. */
function reset() {
    clearQuests();
    store.clear("inventory");
    store.clear("world");
    store.set("backpackGivenToMama", false);
    store.set("backpackEquipped", false);
    store.set("mamaBackpackIntroSeen", false);
}

/** The backpack quest from ADR 0007/0002: flag → collection (with a nested collection) → flag. */
function registerBackpack() {
    registerQuests({
        backpack: {
            seenWhen: { mamaBackpackIntroSeen: { eq: true } },
            steps: [
                { id: "give", doneWhen: { backpackGivenToMama: { eq: true } } },
                {
                    id: "fill",
                    collect: {
                        in: "inventory",
                        items: [
                            "apple",
                            "lunchbox",
                            "notebook",
                            "crayons",
                            { id: "pencil_case", collect: { in: "inventory", items: ["pencil", "eraser", "ruler"] } },
                        ],
                    },
                },
                { id: "equip", doneWhen: { backpackEquipped: { eq: true } } },
            ],
        },
    });
}

Deno.test("status: not_started → seen → started → done cascade", () => {
    reset();
    registerBackpack();

    // Nothing done, intro not seen.
    assertEquals(questStatus("backpack"), "not_started");

    // Intro seen, still no progress → seen.
    store.set("mamaBackpackIntroSeen", true);
    assertEquals(questStatus("backpack"), "seen");

    // First leaf done (default startWhen = any leaf done) → started.
    store.set("backpackGivenToMama", true);
    assertEquals(questStatus("backpack"), "started");

    // Everything done → done.
    for (const id of ["apple", "lunchbox", "notebook", "crayons", "pencil", "eraser", "ruler"]) {
        store.addTo("inventory", id);
    }
    store.set("backpackEquipped", true);
    assertEquals(questStatus("backpack"), "done");
});

Deno.test("whatsNext: DFS to first incomplete leaf, three levels deep", () => {
    reset();
    registerBackpack();

    // First blocker is the `give` flag leaf.
    assertEquals(questWhatsNext("backpack"), "give");

    store.set("backpackGivenToMama", true);
    // Now the first missing collection member.
    assertEquals(questWhatsNext("backpack"), "apple");

    for (const id of ["apple", "lunchbox", "notebook", "crayons"]) store.addTo("inventory", id);
    // Descends into the nested pencil_case collection.
    assertEquals(questWhatsNext("backpack"), "pencil");

    store.addTo("inventory", "pencil");
    assertEquals(questWhatsNext("backpack"), "eraser");

    store.addTo("inventory", "eraser");
    store.addTo("inventory", "ruler");
    // pencil_case complete → last blocker is the equip flag.
    assertEquals(questWhatsNext("backpack"), "equip");

    store.set("backpackEquipped", true);
    assertEquals(questWhatsNext("backpack"), null);
});

Deno.test("progress: counts done leaves over total", () => {
    reset();
    registerBackpack();

    // 9 leaves: give, apple, lunchbox, notebook, crayons, pencil, eraser, ruler, equip.
    assertEquals(questProgress("backpack"), { done: 0, total: 9 });

    store.set("backpackGivenToMama", true);
    store.addTo("inventory", "apple");
    store.addTo("inventory", "pencil");
    assertEquals(questProgress("backpack"), { done: 3, total: 9 });
});

Deno.test("namespace: a `when` reads quest state with plain eq/ops", () => {
    reset();
    registerBackpack();
    store.set("mamaBackpackIntroSeen", true);
    store.set("backpackGivenToMama", true);

    // status (started) drives a gate.
    assertEquals(evaluateCondition({ "quest.backpack.status": { eq: "started" } }), true);
    assertEquals(evaluateCondition({ "quest.backpack.status": "started" }), true); // bare = eq
    assertEquals(evaluateCondition({ "quest.backpack.status": { eq: "done" } }), false);

    // whatsNext as a value.
    assertEquals(evaluateCondition({ "quest.backpack.whatsNext": { eq: "apple" } }), true);

    // progress with a numeric op.
    store.addTo("inventory", "apple");
    assertEquals(evaluateCondition({ "quest.backpack.progress": { gte: 2 } }), true);
    assertEquals(evaluateCondition({ "quest.backpack.progress": { gte: 5 } }), false);

    // descend into a sub-quest's accessor.
    assertEquals(evaluateCondition({ "quest.backpack.fill.pencil_case.whatsNext": { eq: "pencil" } }), true);
});

Deno.test("resolveQuestAccessor: unknown paths are undefined; node-terminal defaults to status", () => {
    reset();
    registerBackpack();
    assertEquals(resolveQuestAccessor("quest.nope.status"), undefined);
    assertEquals(resolveQuestAccessor("quest.backpack.nope.status"), undefined);
    assertEquals(resolveQuestAccessor("quest.backpack"), "not_started"); // node-terminal → status
    assertEquals(resolveQuestAccessor("quest.backpack.fill"), "not_started");
});

Deno.test("collection self-combine: item counts as done once moved into the target", () => {
    reset();
    registerQuests({
        bag: { collect: { in: "inventory", selfCombineInto: "world", items: ["a", "b"] } },
    });

    assertEquals(questWhatsNext("bag"), "a");
    store.addTo("inventory", "a"); // collected normally
    assertEquals(questStatus("bag"), "started");
    assertEquals(questWhatsNext("bag"), "b");
    store.addTo("world", "b"); // collected straight into the combined target still counts
    assertEquals(questProgress("bag"), { done: 2, total: 2 });
    assertEquals(questStatus("bag"), "done");
});

Deno.test("whatsNextNode exposes the node so the bubble can read its icon", () => {
    reset();
    registerQuests({
        chore: { steps: [{ id: "sweep", doneWhen: { swept: { eq: true } }, icon: { type: "task", id: "broom" } }] },
    });
    const node = questWhatsNextNode("chore");
    assertEquals(node?.id, "sweep");
    assertEquals(node?.icon, { type: "task", id: "broom" });
});

Deno.test("registerQuests: a step id shadowing a reserved accessor throws", () => {
    reset();
    assertThrows(
        () => registerQuests({ bad: { steps: [{ id: "status", doneWhen: { x: { eq: 1 } } }] } }),
        Error,
        "reserved accessor",
    );
});
