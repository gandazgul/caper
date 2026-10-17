import { expect, test } from "bun:test";
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

test("status: not_started → seen → started → done cascade", () => {
    reset();
    registerBackpack();

    // Nothing done, intro not seen.
    expect(questStatus("backpack")).toStrictEqual("not_started");

    // Intro seen, still no progress → seen.
    store.set("mamaBackpackIntroSeen", true);
    expect(questStatus("backpack")).toStrictEqual("seen");

    // First leaf done (default startWhen = any leaf done) → started.
    store.set("backpackGivenToMama", true);
    expect(questStatus("backpack")).toStrictEqual("started");

    // Everything done → done.
    for (const id of ["apple", "lunchbox", "notebook", "crayons", "pencil", "eraser", "ruler"]) {
        store.addTo("inventory", id);
    }
    store.set("backpackEquipped", true);
    expect(questStatus("backpack")).toStrictEqual("done");
});

test("whatsNext: DFS to first incomplete leaf, three levels deep", () => {
    reset();
    registerBackpack();

    // First blocker is the `give` flag leaf.
    expect(questWhatsNext("backpack")).toStrictEqual("give");

    store.set("backpackGivenToMama", true);
    // Now the first missing collection member.
    expect(questWhatsNext("backpack")).toStrictEqual("apple");

    for (const id of ["apple", "lunchbox", "notebook", "crayons"]) store.addTo("inventory", id);
    // Descends into the nested pencil_case collection.
    expect(questWhatsNext("backpack")).toStrictEqual("pencil");

    store.addTo("inventory", "pencil");
    expect(questWhatsNext("backpack")).toStrictEqual("eraser");

    store.addTo("inventory", "eraser");
    store.addTo("inventory", "ruler");
    // pencil_case complete → last blocker is the equip flag.
    expect(questWhatsNext("backpack")).toStrictEqual("equip");

    store.set("backpackEquipped", true);
    expect(questWhatsNext("backpack")).toStrictEqual(null);
});

test("progress: counts done leaves over total", () => {
    reset();
    registerBackpack();

    // 9 leaves: give, apple, lunchbox, notebook, crayons, pencil, eraser, ruler, equip.
    expect(questProgress("backpack")).toStrictEqual({ done: 0, total: 9 });

    store.set("backpackGivenToMama", true);
    store.addTo("inventory", "apple");
    store.addTo("inventory", "pencil");
    expect(questProgress("backpack")).toStrictEqual({ done: 3, total: 9 });
});

test("namespace: a `when` reads quest state with plain eq/ops", () => {
    reset();
    registerBackpack();
    store.set("mamaBackpackIntroSeen", true);
    store.set("backpackGivenToMama", true);

    // status (started) drives a gate.
    expect(evaluateCondition({ "quest.backpack.status": { eq: "started" } })).toStrictEqual(true);
    expect(evaluateCondition({ "quest.backpack.status": "started" })).toStrictEqual(true); // bare = eq
    expect(evaluateCondition({ "quest.backpack.status": { eq: "done" } })).toStrictEqual(false);

    // whatsNext as a value.
    expect(evaluateCondition({ "quest.backpack.whatsNext": { eq: "apple" } })).toStrictEqual(true);

    // progress with a numeric op.
    store.addTo("inventory", "apple");
    expect(evaluateCondition({ "quest.backpack.progress": { gte: 2 } })).toStrictEqual(true);
    expect(evaluateCondition({ "quest.backpack.progress": { gte: 5 } })).toStrictEqual(false);

    // descend into a sub-quest's accessor.
    expect(evaluateCondition({ "quest.backpack.fill.pencil_case.whatsNext": { eq: "pencil" } })).toStrictEqual(true);
});

test("resolveQuestAccessor: unknown paths are undefined; node-terminal defaults to status", () => {
    reset();
    registerBackpack();
    expect(resolveQuestAccessor("quest.nope.status")).toStrictEqual(undefined);
    expect(resolveQuestAccessor("quest.backpack.nope.status")).toStrictEqual(undefined);
    expect(resolveQuestAccessor("quest.backpack")).toStrictEqual("not_started"); // node-terminal → status
    expect(resolveQuestAccessor("quest.backpack.fill")).toStrictEqual("not_started");
});

test("collection self-combine: item counts as done once moved into the target", () => {
    reset();
    registerQuests({
        bag: { collect: { in: "inventory", selfCombineInto: "world", items: ["a", "b"] } },
    });

    expect(questWhatsNext("bag")).toStrictEqual("a");
    store.addTo("inventory", "a"); // collected normally
    expect(questStatus("bag")).toStrictEqual("started");
    expect(questWhatsNext("bag")).toStrictEqual("b");
    store.addTo("world", "b"); // collected straight into the combined target still counts
    expect(questProgress("bag")).toStrictEqual({ done: 2, total: 2 });
    expect(questStatus("bag")).toStrictEqual("done");
});

test("whatsNextNode exposes the node so the bubble can read its icon", () => {
    reset();
    registerQuests({
        chore: { steps: [{ id: "sweep", doneWhen: { swept: { eq: true } }, icon: { type: "task", id: "broom" } }] },
    });
    const node = questWhatsNextNode("chore");
    expect(node?.id).toStrictEqual("sweep");
    expect(node?.icon).toStrictEqual({ type: "task", id: "broom" });
});

test("registerQuests: a step id shadowing a reserved accessor throws", () => {
    reset();
    let thrown;
    expect(() => {
        try {
            registerQuests({ bad: { steps: [{ id: "status", doneWhen: { x: { eq: 1 } } }] } });
        } catch (error) {
            thrown = error;
            throw error;
        }
    }).toThrow("reserved accessor");
    expect(thrown).toBeInstanceOf(Error);
});
