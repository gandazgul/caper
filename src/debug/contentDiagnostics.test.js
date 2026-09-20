import { assertEquals, assertThrows } from "@std/assert";
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

Deno.test("diagnostics identify exact source paths for content errors", () => {
    const room = scene([{
        id: "door",
        atlas: "items",
        approach: "in-place",
        states: [{ frame: "typo", onClick: [{ goToScnee: "Garden" }, { goToScene: "Gadren" }, { pickup: "missing" }] }],
    }, { id: "door", states: [] }]);
    const issues = inspectSceneContent(room);
    assertEquals(issues.length, 5);
    assertEquals(issues[0].path, "Room.props[0](door).states[0].frame");
    assertEquals(issues[1].message.startsWith('Unknown effect "goToScnee"'), true);
    assertThrows(() => validateSceneContent(room, "error"), Error, "Gadren");
});

Deno.test("valid item resolvers, sentinel ids and destination object forms are supported", () => {
    content.registerItems({ diagnostic_key: { atlas: "items", frame: "key", scale: 1 } });
    const room = scene([{
        id: "diagnostic_key",
        atlas: "items",
        approach: "in-place",
        transitionsTo: "Garden",
        states: [{
            frame: "key",
            onClick: [{ pickup: true }, { goToScene: { target: "Garden", transition: "room" } }],
            onDrop: { accepts: {}, effects: [{ removeFrom: { inventory: "$dragged" } }] },
        }],
    }]);
    assertEquals(inspectSceneContent(room), []);
    assertEquals(validateSceneContent(room, "error"), []);
});

Deno.test("malformed effect arrays and missing approach points are explained", () => {
    const room = scene([{ id: "door", states: [{ onClick: { emit: "event" } }] }]);
    assertEquals(inspectSceneContent(room).length, 2);
});
