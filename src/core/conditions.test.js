import { expect, test } from "bun:test";
import { evaluateCondition } from "./conditions.js";
import { store } from "../state/Store.js";

test("evaluateCondition: empty/null", () => {
    expect(evaluateCondition(null)).toStrictEqual(true);
    expect(evaluateCondition(undefined)).toStrictEqual(true);
});

test("evaluateCondition: boolean primitives", () => {
    expect(evaluateCondition(true)).toStrictEqual(true);
    expect(evaluateCondition(false)).toStrictEqual(false);
});

test("evaluateCondition: array (OR)", () => {
    expect(evaluateCondition([{ not: true }, { not: false }])).toStrictEqual(true);
    expect(evaluateCondition([{ not: true }, { not: true }])).toStrictEqual(false);
});

test("evaluateCondition: allOf combinator", () => {
    expect(evaluateCondition({ allOf: [true, true] })).toStrictEqual(true);
    expect(evaluateCondition({ allOf: [true, false] })).toStrictEqual(false);
});

test("evaluateCondition: anyOf combinator", () => {
    expect(evaluateCondition({ anyOf: [false, true] })).toStrictEqual(true);
    expect(evaluateCondition({ anyOf: [false, false] })).toStrictEqual(false);
});

test("evaluateCondition: not combinator", () => {
    expect(evaluateCondition({ not: true })).toStrictEqual(false);
    expect(evaluateCondition({ not: false })).toStrictEqual(true);
});

test("evaluateCondition: scalar flag", () => {
    store.set("testFlag", "apple");

    // bare value = eq
    expect(evaluateCondition({ testFlag: "apple" })).toStrictEqual(true);
    expect(evaluateCondition({ testFlag: "banana" })).toStrictEqual(false);

    // ops object
    expect(evaluateCondition({ testFlag: { eq: "apple" } })).toStrictEqual(true);
    expect(evaluateCondition({ testFlag: { ne: "apple" } })).toStrictEqual(false);
});

test("evaluateCondition: number ops", () => {
    store.set("testNum", 5);

    expect(evaluateCondition({ testNum: { gt: 4 } })).toStrictEqual(true);
    expect(evaluateCondition({ testNum: { gt: 5 } })).toStrictEqual(false);

    expect(evaluateCondition({ testNum: { gte: 5 } })).toStrictEqual(true);
    expect(evaluateCondition({ testNum: { gte: 6 } })).toStrictEqual(false);

    expect(evaluateCondition({ testNum: { lt: 6 } })).toStrictEqual(true);
    expect(evaluateCondition({ testNum: { lt: 5 } })).toStrictEqual(false);

    expect(evaluateCondition({ testNum: { lte: 5 } })).toStrictEqual(true);
    expect(evaluateCondition({ testNum: { lte: 4 } })).toStrictEqual(false);

    expect(evaluateCondition({ testNum: { eq: 5 } })).toStrictEqual(true);
    expect(evaluateCondition({ testNum: { ne: 5 } })).toStrictEqual(false);
});

test("evaluateCondition: collection ops", () => {
    // Inventory is an engine-owned Set.
    store.addTo("inventory", "toy_block");

    // bare string = membership
    expect(evaluateCondition({ inventory: "toy_block" })).toStrictEqual(true);
    expect(evaluateCondition({ inventory: "toy_car" })).toStrictEqual(false);

    // has/not ops
    expect(evaluateCondition({ inventory: { has: "toy_block" } })).toStrictEqual(true);
    expect(evaluateCondition({ inventory: { has: "toy_car" } })).toStrictEqual(false);
    expect(evaluateCondition({ inventory: { not: "toy_block" } })).toStrictEqual(false);
    expect(evaluateCondition({ inventory: { not: "toy_car" } })).toStrictEqual(true);

    // count
    const count = store.collectionSize("inventory");

    expect(evaluateCondition({ inventory: { count: { gt: count - 1 } } })).toStrictEqual(true);
    expect(evaluateCondition({ inventory: { count: count } })).toStrictEqual(true);
    expect(evaluateCondition({ inventory: { count: { lt: count } } })).toStrictEqual(false);
});

test("evaluateCondition: dropped context", () => {
    const ctx = { draggedId: "apple" };

    expect(evaluateCondition({ dropped: "apple" }, ctx)).toStrictEqual(true);
    expect(evaluateCondition({ dropped: "banana" }, ctx)).toStrictEqual(false);

    // ops
    expect(evaluateCondition({ dropped: { eq: "apple" } }, ctx)).toStrictEqual(true);
    expect(evaluateCondition({ dropped: { ne: "apple" } }, ctx)).toStrictEqual(false);
});

test("evaluateCondition: item properties", () => {
    store.setItemState("container", "empty");

    const ctx = { selfId: "container" };

    // specific item path constraint
    // evaluateCollection processes entries as per-item constraints
    expect(evaluateCondition({ inventory: { "container.state": "empty" } }, ctx)).toStrictEqual(true);
    expect(evaluateCondition({ inventory: { "container.state": "full" } }, ctx)).toStrictEqual(false);

    // self path constraint
    expect(evaluateCondition({ inventory: { state: "empty" } }, ctx)).toStrictEqual(true);
    expect(evaluateCondition({ inventory: { state: "full" } }, ctx)).toStrictEqual(false);

    // self path constraint without selfId should fail
    expect(evaluateCondition({ inventory: { state: "empty" } }, {})).toStrictEqual(false);
});

test("evaluateCondition: AND across multiple keys", () => {
    store.set("key1", 1);
    store.set("key2", 2);

    expect(evaluateCondition({ key1: 1, key2: 2 })).toStrictEqual(true);
    expect(evaluateCondition({ key1: 1, key2: 3 })).toStrictEqual(false);
});

test("evaluateCondition: leaf array (OR over same key)", () => {
    store.set("key3", "apple");
    expect(evaluateCondition({ key3: ["banana", "apple"] })).toStrictEqual(true);
    expect(evaluateCondition({ key3: ["banana", "orange"] })).toStrictEqual(false);

    // ops inside leaf array
    expect(evaluateCondition({ key3: [{ eq: "banana" }, { eq: "apple" }] })).toStrictEqual(true);
});
