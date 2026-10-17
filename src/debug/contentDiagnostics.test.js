import { expect, test } from "bun:test";
import { content } from "../inventory/ContentRegistry.js";
import { inspectSceneContent, validateSceneContent } from "./contentDiagnostics.js";

// Phaser's external asset and scene registries, without a browser renderer.
/** @param {any[]} [props] */
function scene(props = []) {
    return /** @type {any} */ ({
        sceneConfig: { key: "Room", backgroundsByChapter: { arrival: "room" }, props },
        scene: { manager: { keys: { Room: {}, Garden: {} } } },
        textures: {
            exists: (/** @type {string} */ key) => ["room", "items"].includes(key),
            get: () => ({ has: (/** @type {string} */ frame) => frame === "key" }),
        },
        anims: { exists: () => false },
    });
}

test("diagnostics identify exact source paths for content errors", () => {
    const room = scene([
        {
            id: "door",
            atlas: "items",
            approach: "in-place",
            states: [
                { frame: "typo", onClick: [{ goToScnee: "Garden" }, { goToScene: "Gadren" }, { pickup: "missing" }] },
            ],
        },
        { id: "door", states: [] },
    ]);
    const issues = inspectSceneContent(room);
    expect(issues.length).toStrictEqual(5);
    expect(issues[0].path).toStrictEqual("Room.props[0](door).states[0].frame");
    expect(issues[1].message.startsWith('Unknown effect "goToScnee"')).toStrictEqual(true);
    let thrown;
    expect(() => {
        try {
            validateSceneContent(room, "error");
        } catch (error) {
            thrown = error;
            throw error;
        }
    }).toThrow("Gadren");
    expect(thrown).toBeInstanceOf(Error);
});

test("valid item resolvers, sentinel ids and destination object forms are supported", () => {
    content.registerItems({ diagnostic_key: { atlas: "items", frame: "key", scale: 1 } });
    const room = scene([
        {
            id: "diagnostic_key",
            atlas: "items",
            approach: "in-place",
            transitionsTo: "Garden",
            states: [
                {
                    frame: "key",
                    onClick: [{ pickup: true }, { goToScene: { target: "Garden", transition: "room" } }],
                    onDrop: { accepts: {}, effects: [{ removeFrom: { inventory: "$dragged" } }] },
                },
            ],
        },
    ]);
    expect(inspectSceneContent(room)).toStrictEqual([]);
    expect(validateSceneContent(room, "error")).toStrictEqual([]);
});

test("malformed effect arrays and missing approach points are explained", () => {
    const room = scene([{ id: "door", states: [{ onClick: { emit: "event" } }] }]);
    expect(inspectSceneContent(room).length).toStrictEqual(2);
});
