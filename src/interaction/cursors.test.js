import { assertEquals } from "@std/assert";
import { engineAssets } from "../assets/EngineAssets.js";
import { cursorFor } from "./cursors.js";

Deno.test("cursors honor deployment prefixes, overrides and legacy defaults", () => {
    try {
        engineAssets.configure({ cursorBaseUrl: "/games/demo/art", cursors: { look: "help" } });
        assertEquals(cursorFor("pickup"), "url('/games/demo/art/cursor_grab.png') 21 21, grab");
        assertEquals(cursorFor("look"), "help");
        assertEquals(cursorFor("exit", "left").includes("/games/demo/art/arrow_left.png"), true);
        assertEquals(cursorFor("exit", "left", "crosshair"), "crosshair");
        assertEquals(cursorFor("crosshair"), "crosshair");
    } finally {
        engineAssets.configure({ cursorBaseUrl: "/objects/", cursors: {}, exitCursors: {} });
    }
    assertEquals(cursorFor("pickup"), "url('/objects/cursor_grab.png') 21 21, grab");
});
