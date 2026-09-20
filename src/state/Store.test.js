// @ts-nocheck: replace only the external browser Storage API; exercise the real Store.
import { assertEquals, assertThrows } from "@std/assert";
import { Store } from "./Store.js";

function withStorage(run) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const data = new Map();
    const storage = {
        failRead: false,
        failWrite: false,
        writes: 0,
        getItem(key) {
            if (this.failRead) throw new Error("SecurityError");
            return data.get(key) ?? null;
        },
        setItem(key, value) {
            if (this.failWrite) throw new Error("QuotaExceededError");
            this.writes++;
            data.set(key, value);
        },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
        run({ storage, data });
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else delete globalThis.localStorage;
    }
}

const fresh = () => ({
    values: { chapter: "arrival", score: 0 },
    collections: { clues: new Set() },
    items: { gate: "locked" },
});
const config = (extra = {}) => ({ saveKey: "test-game", createFreshState: fresh, ...extra });
const legacy = { values: { score: 7 }, collections: { clues: ["note"], inventory: ["key"] }, items: {} };

Deno.test("unversioned saves remain compatible and new defaults survive hydration", () =>
    withStorage(({ data }) => {
        data.set("test-game", JSON.stringify(legacy));
        const store = new Store().configure(config());
        assertEquals(store.get("score"), 7);
        assertEquals(store.get("chapter"), "arrival");
        assertEquals(store.has("clues", "note"), true);
        assertEquals(store.has("inventory", "key"), true);
        assertEquals(store.getItemState("gate"), "locked");
        store.set("score", 8);
        assertEquals(JSON.parse(data.get("test-game")).version, 0);
    }));

Deno.test("migration upgrades data and the next save writes the current version", () =>
    withStorage(({ data }) => {
        data.set("test-game", JSON.stringify(legacy));
        let calls = 0;
        const store = new Store().configure(config({
            saveVersion: 2,
            migrateSave: (saved, from, to) => {
                assertEquals([from, to], [0, 2]);
                calls++;
                return { ...saved, values: { ...saved.values, score: saved.values.score * 10 } };
            },
        }));
        assertEquals(store.get("score"), 70);
        assertEquals(store.save(), true);
        assertEquals(JSON.parse(data.get("test-game")).version, 2);
        new Store().configure(config({
            saveVersion: 2,
            migrateSave: () => {
                calls++;
                return null;
            },
        }));
        assertEquals(calls, 1);
    }));

Deno.test("future, unmigratable and broken migrations preserve the original until explicit reset", () =>
    withStorage(({ data }) => {
        for (
            const [version, migrateSave] of [[3, () => legacy], [0, undefined], [0, () => null], [0, () => {
                throw new Error("bad migration");
            }]]
        ) {
            const raw = JSON.stringify({ ...legacy, version });
            data.set("test-game", raw);
            const store = new Store().configure(config({ saveVersion: 1, migrateSave }));
            assertEquals(store.saveStatus.state, "incompatible");
            store.setCurrentScene("Cottage");
            store.set("score", 99);
            assertEquals(store.save(), false);
            assertEquals(data.get("test-game"), raw);
            store.reset();
            assertEquals(store.saveStatus.state, "saved");
            assertEquals(JSON.parse(data.get("test-game")).values.score, 0);
        }
    }));

Deno.test("corrupt saves and malformed reserved data are preserved", () =>
    withStorage(({ data }) => {
        for (
            const raw of [
                "{broken",
                "null",
                JSON.stringify({ values: [] }),
                JSON.stringify({ values: { inventoryCounts: null } }),
                JSON.stringify({ values: {}, collections: { inventory: "key" } }),
            ]
        ) {
            data.set("test-game", raw);
            const store = new Store().configure(config());
            assertEquals(store.saveStatus.state, "invalid");
            store.set("score", 3);
            assertEquals(data.get("test-game"), raw);
        }
    }));

Deno.test("quota errors retain in-memory progress, report once, and recover on retry", () =>
    withStorage(({ storage, data }) => {
        const store = new Store().configure(config());
        const statuses = [];
        const off = store.onSaveStatusChange((status) => statuses.push(status.state));
        storage.failWrite = true;
        store.set("score", 1);
        store.set("score", 2);
        assertEquals(store.get("score"), 2);
        assertEquals(statuses, ["ready", "unavailable"]);
        storage.failWrite = false;
        assertEquals(store.save(), true);
        assertEquals(JSON.parse(data.get("test-game")).values.score, 2);
        assertEquals(statuses, ["ready", "unavailable", "saved"]);
        off();
        storage.failWrite = true;
        store.set("score", 3);
        assertEquals(statuses.length, 3);
    }));

Deno.test("failed reads protect unseen progress even when writes become available", () =>
    withStorage(({ storage, data }) => {
        const raw = JSON.stringify(legacy);
        data.set("test-game", raw);
        storage.failRead = true;
        const store = new Store().configure(config());
        assertEquals(store.saveStatus.operation, "load");
        assertEquals(store.saveStatus.state, "unavailable");
        storage.failRead = false;
        store.setCurrentScene("Cottage");
        assertEquals(store.save(), false);
        assertEquals(data.get("test-game"), raw);
    }));

Deno.test("a throwing localStorage getter is handled without crashing configure", () =>
    withStorage(() => {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("SecurityError");
            },
        });
        const store = new Store().configure(config());
        assertEquals(store.saveStatus.state, "unavailable");
        assertEquals(store.get("score"), 0);
    }));

Deno.test("replay never writes temporary progress and exit persists the restored state once", () =>
    withStorage(({ storage, data }) => {
        const store = new Store().configure(config());
        store.set("score", 4);
        store.beginReplay();
        store.set("score", 99);
        assertEquals(store.save(), false);
        assertEquals(storage.writes, 1);
        store.endReplay();
        assertEquals(storage.writes, 2);
        assertEquals(JSON.parse(data.get("test-game")).values.score, 4);
    }));

Deno.test("save versions must be nonnegative integers", () => {
    assertThrows(() => new Store().configure(config({ saveVersion: -1 })), Error, "saveVersion");
});
