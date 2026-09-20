import { assertEquals } from "@std/assert";
import { resolveAmbient } from "./modes.js";

Deno.test("ambient comes from configuration, regardless of chapter name", () => {
    assertEquals(resolveAmbient({ arrival: ["none", "falling-leaves"] }, "arrival"), "falling-leaves");
    assertEquals(resolveAmbient({ fall: ["none"] }, "fall"), "none");
    assertEquals(resolveAmbient({ arrival: ["falling-leaves"] }, "other"), "none");
    assertEquals(resolveAmbient(undefined, "fall"), "none");
});
