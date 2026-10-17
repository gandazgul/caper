import { expect, test } from "bun:test";
import { resolveAmbient } from "./modes.js";

test("ambient comes from configuration, regardless of chapter name", () => {
    expect(resolveAmbient({ arrival: ["none", "falling-leaves"] }, "arrival")).toStrictEqual("falling-leaves");
    expect(resolveAmbient({ fall: ["none"] }, "fall")).toStrictEqual("none");
    expect(resolveAmbient({ arrival: ["falling-leaves"] }, "other")).toStrictEqual("none");
    expect(resolveAmbient(undefined, "fall")).toStrictEqual("none");
});
