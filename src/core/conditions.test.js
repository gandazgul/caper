import { assertEquals } from "@std/assert";
import { evaluateCondition } from "./conditions.js";
import { store } from "../state/Store.js";

Deno.test("evaluateCondition: empty/null", () => {
    assertEquals(evaluateCondition(null), true);
    assertEquals(evaluateCondition(undefined), true);
});

Deno.test("evaluateCondition: boolean primitives", () => {
    assertEquals(evaluateCondition(true), true);
    assertEquals(evaluateCondition(false), false);
});

Deno.test("evaluateCondition: array (OR)", () => {
    assertEquals(evaluateCondition([{ not: true }, { not: false }]), true);
    assertEquals(evaluateCondition([{ not: true }, { not: true }]), false);
});

Deno.test("evaluateCondition: allOf combinator", () => {
    assertEquals(evaluateCondition({ allOf: [true, true] }), true);
    assertEquals(evaluateCondition({ allOf: [true, false] }), false);
});

Deno.test("evaluateCondition: anyOf combinator", () => {
    assertEquals(evaluateCondition({ anyOf: [false, true] }), true);
    assertEquals(evaluateCondition({ anyOf: [false, false] }), false);
});

Deno.test("evaluateCondition: not combinator", () => {
    assertEquals(evaluateCondition({ not: true }), false);
    assertEquals(evaluateCondition({ not: false }), true);
});

Deno.test("evaluateCondition: scalar flag", () => {
    store.set("testFlag", "apple");

    // bare value = eq
    assertEquals(evaluateCondition({ testFlag: "apple" }), true);
    assertEquals(evaluateCondition({ testFlag: "banana" }), false);

    // ops object
    assertEquals(evaluateCondition({ testFlag: { eq: "apple" } }), true);
    assertEquals(evaluateCondition({ testFlag: { ne: "apple" } }), false);
});

Deno.test("evaluateCondition: number ops", () => {
    store.set("testNum", 5);

    assertEquals(evaluateCondition({ testNum: { gt: 4 } }), true);
    assertEquals(evaluateCondition({ testNum: { gt: 5 } }), false);

    assertEquals(evaluateCondition({ testNum: { gte: 5 } }), true);
    assertEquals(evaluateCondition({ testNum: { gte: 6 } }), false);

    assertEquals(evaluateCondition({ testNum: { lt: 6 } }), true);
    assertEquals(evaluateCondition({ testNum: { lt: 5 } }), false);

    assertEquals(evaluateCondition({ testNum: { lte: 5 } }), true);
    assertEquals(evaluateCondition({ testNum: { lte: 4 } }), false);

    assertEquals(evaluateCondition({ testNum: { eq: 5 } }), true);
    assertEquals(evaluateCondition({ testNum: { ne: 5 } }), false);
});

Deno.test("evaluateCondition: collection ops", () => {
    // Inventory is an engine-owned Set.
    store.addTo("inventory", "toy_block");

    // bare string = membership
    assertEquals(evaluateCondition({ inventory: "toy_block" }), true);
    assertEquals(evaluateCondition({ inventory: "toy_car" }), false);

    // has/not ops
    assertEquals(evaluateCondition({ inventory: { has: "toy_block" } }), true);
    assertEquals(evaluateCondition({ inventory: { has: "toy_car" } }), false);
    assertEquals(evaluateCondition({ inventory: { not: "toy_block" } }), false);
    assertEquals(evaluateCondition({ inventory: { not: "toy_car" } }), true);

    // count
    const count = store.collectionSize("inventory");

    assertEquals(evaluateCondition({ inventory: { count: { gt: count - 1 } } }), true);
    assertEquals(evaluateCondition({ inventory: { count: count } }), true);
    assertEquals(evaluateCondition({ inventory: { count: { lt: count } } }), false);
});

Deno.test("evaluateCondition: dropped context", () => {
    const ctx = { draggedId: "apple" };

    assertEquals(evaluateCondition({ dropped: "apple" }, ctx), true);
    assertEquals(evaluateCondition({ dropped: "banana" }, ctx), false);

    // ops
    assertEquals(evaluateCondition({ dropped: { eq: "apple" } }, ctx), true);
    assertEquals(evaluateCondition({ dropped: { ne: "apple" } }, ctx), false);
});

Deno.test("evaluateCondition: item properties", () => {
    store.setItemState("container", "empty");

    const ctx = { selfId: "container" };

    // specific item path constraint
    // evaluateCollection processes entries as per-item constraints
    assertEquals(evaluateCondition({ inventory: { "container.state": "empty" } }, ctx), true);
    assertEquals(evaluateCondition({ inventory: { "container.state": "full" } }, ctx), false);

    // self path constraint
    assertEquals(evaluateCondition({ inventory: { "state": "empty" } }, ctx), true);
    assertEquals(evaluateCondition({ inventory: { "state": "full" } }, ctx), false);

    // self path constraint without selfId should fail
    assertEquals(evaluateCondition({ inventory: { "state": "empty" } }, {}), false);
});

Deno.test("evaluateCondition: AND across multiple keys", () => {
    store.set("key1", 1);
    store.set("key2", 2);

    assertEquals(evaluateCondition({ key1: 1, key2: 2 }), true);
    assertEquals(evaluateCondition({ key1: 1, key2: 3 }), false);
});

Deno.test("evaluateCondition: leaf array (OR over same key)", () => {
    store.set("key3", "apple");
    assertEquals(evaluateCondition({ key3: ["banana", "apple"] }), true);
    assertEquals(evaluateCondition({ key3: ["banana", "orange"] }), false);

    // ops inside leaf array
    assertEquals(evaluateCondition({ key3: [{ eq: "banana" }, { eq: "apple" }] }), true);
});
