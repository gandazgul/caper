import { expect, test } from "bun:test";
import { engineAssets } from "../assets/EngineAssets.js";
import { cursorFor } from "./cursors.js";

test("cursors honor deployment prefixes, overrides and legacy defaults", () => {
    try {
        engineAssets.configure({ cursorBaseUrl: "/games/demo/art", cursors: { look: "help" } });
        expect(cursorFor("pickup")).toStrictEqual("url('/games/demo/art/cursor_grab.png') 21 21, grab");
        expect(cursorFor("look")).toStrictEqual("help");
        expect(cursorFor("exit", "left").includes("/games/demo/art/arrow_left.png")).toStrictEqual(true);
        expect(cursorFor("exit", "left", "crosshair")).toStrictEqual("crosshair");
        expect(cursorFor("crosshair")).toStrictEqual("crosshair");
    } finally {
        engineAssets.configure({ cursorBaseUrl: "/objects/", cursors: {}, exitCursors: {} });
    }
    expect(cursorFor("pickup")).toStrictEqual("url('/objects/cursor_grab.png') 21 21, grab");
});
