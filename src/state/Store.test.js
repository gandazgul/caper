import { expect, test } from "bun:test";
import { Store } from "./Store.js";

/**
 * @typedef {{ failRead: boolean, failWrite: boolean, writes: number,
 *   getItem(key: string): string | null, setItem(key: string, value: string): void }} TestStorage
 */
/** @param {(fixture: { storage: TestStorage, data: Map<string, string> }) => void} run */
function withStorage(run) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const data = new Map();
    /** @type {TestStorage} */
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
/** @param {Partial<Parameters<Store["configure"]>[0]>} [extra] */
const config = (extra = {}) => ({ saveKey: "test-game", createFreshState: fresh, ...extra });
const legacy = { values: { score: 7 }, collections: { clues: ["note"], inventory: ["key"] }, items: {} };

test("unversioned saves remain compatible and new defaults survive hydration", () =>
    withStorage(({ data }) => {
        data.set("test-game", JSON.stringify(legacy));
        const store = new Store().configure(config());
        expect(store.get("score")).toStrictEqual(7);
        expect(store.get("chapter")).toStrictEqual("arrival");
        expect(store.has("clues", "note")).toStrictEqual(true);
        expect(store.has("inventory", "key")).toStrictEqual(true);
        expect(store.getItemState("gate")).toStrictEqual("locked");
        store.set("score", 8);
        expect(JSON.parse(data.get("test-game")).version).toStrictEqual(0);
    }));

test("migration upgrades data and the next save writes the current version", () =>
    withStorage(({ data }) => {
        data.set("test-game", JSON.stringify(legacy));
        let calls = 0;
        const store = new Store().configure(
            config({
                saveVersion: 2,
                migrateSave: (saved, from, to) => {
                    expect([from, to]).toStrictEqual([0, 2]);
                    calls++;
                    return { ...saved, values: { ...saved.values, score: saved.values.score * 10 } };
                },
            }),
        );
        expect(store.get("score")).toStrictEqual(70);
        expect(store.save()).toStrictEqual(true);
        expect(JSON.parse(data.get("test-game")).version).toStrictEqual(2);
        new Store().configure(
            config({
                saveVersion: 2,
                migrateSave: () => {
                    calls++;
                    return null;
                },
            }),
        );
        expect(calls).toStrictEqual(1);
    }));

test("future, unmigratable and broken migrations preserve the original until explicit reset", () =>
    withStorage(({ data }) => {
        /** @type {[number, Parameters<Store["configure"]>[0]["migrateSave"]][]} */
        const cases = [
            [3, () => legacy],
            [0, undefined],
            [0, () => null],
            [
                0,
                () => {
                    throw new Error("bad migration");
                },
            ],
        ];
        for (const [version, migrateSave] of cases) {
            const raw = JSON.stringify({ ...legacy, version });
            data.set("test-game", raw);
            const store = new Store().configure(config({ saveVersion: 1, migrateSave }));
            expect(store.saveStatus.state).toStrictEqual("incompatible");
            store.setCurrentScene("Cottage");
            store.set("score", 99);
            expect(store.save()).toStrictEqual(false);
            expect(data.get("test-game")).toStrictEqual(raw);
            store.reset();
            expect(store.saveStatus.state).toStrictEqual("saved");
            expect(JSON.parse(data.get("test-game")).values.score).toStrictEqual(0);
        }
    }));

test("corrupt saves and malformed reserved data are preserved", () =>
    withStorage(({ data }) => {
        for (const raw of [
            "{broken",
            "null",
            JSON.stringify({ values: [] }),
            JSON.stringify({ values: { inventoryCounts: null } }),
            JSON.stringify({ values: {}, collections: { inventory: "key" } }),
        ]) {
            data.set("test-game", raw);
            const store = new Store().configure(config());
            expect(store.saveStatus.state).toStrictEqual("invalid");
            store.set("score", 3);
            expect(data.get("test-game")).toStrictEqual(raw);
        }
    }));

test("quota errors retain in-memory progress, report once, and recover on retry", () =>
    withStorage(({ storage, data }) => {
        const store = new Store().configure(config());
        /** @type {import("./Store.js").SaveStatus["state"][]} */
        const statuses = [];
        const off = store.onSaveStatusChange((status) => statuses.push(status.state));
        storage.failWrite = true;
        store.set("score", 1);
        store.set("score", 2);
        expect(store.get("score")).toStrictEqual(2);
        expect(statuses).toStrictEqual(["ready", "unavailable"]);
        storage.failWrite = false;
        expect(store.save()).toStrictEqual(true);
        expect(JSON.parse(data.get("test-game")).values.score).toStrictEqual(2);
        expect(statuses).toStrictEqual(["ready", "unavailable", "saved"]);
        off();
        storage.failWrite = true;
        store.set("score", 3);
        expect(statuses.length).toStrictEqual(3);
    }));

test("failed reads protect unseen progress even when writes become available", () =>
    withStorage(({ storage, data }) => {
        const raw = JSON.stringify(legacy);
        data.set("test-game", raw);
        storage.failRead = true;
        const store = new Store().configure(config());
        expect(store.saveStatus.operation).toStrictEqual("load");
        expect(store.saveStatus.state).toStrictEqual("unavailable");
        storage.failRead = false;
        store.setCurrentScene("Cottage");
        expect(store.save()).toStrictEqual(false);
        expect(data.get("test-game")).toStrictEqual(raw);
    }));

test("a throwing localStorage getter is handled without crashing configure", () =>
    withStorage(() => {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("SecurityError");
            },
        });
        const store = new Store().configure(config());
        expect(store.saveStatus.state).toStrictEqual("unavailable");
        expect(store.get("score")).toStrictEqual(0);
    }));

test("replay never writes temporary progress and exit persists the restored state once", () =>
    withStorage(({ storage, data }) => {
        const store = new Store().configure(config());
        store.set("score", 4);
        store.beginReplay();
        store.set("score", 99);
        expect(store.save()).toStrictEqual(false);
        expect(storage.writes).toStrictEqual(1);
        store.endReplay();
        expect(storage.writes).toStrictEqual(2);
        expect(JSON.parse(data.get("test-game")).values.score).toStrictEqual(4);
    }));

test("save versions must be nonnegative integers", () => {
    let thrown;
    expect(() => {
        try {
            new Store().configure(config({ saveVersion: -1 }));
        } catch (error) {
            thrown = error;
            throw error;
        }
    }).toThrow("saveVersion");
    expect(thrown).toBeInstanceOf(Error);
});
