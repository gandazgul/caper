import { expect, test } from "bun:test";
import { deriveAsset } from "./assetLoading.js";

test("deriveAsset keeps legacy default extensions", () => {
    expect(deriveAsset("bg_kitchen")).toStrictEqual({ kind: "image", url: "/scenes/kitchen.jpg" });
    expect(deriveAsset("sprite_props")).toStrictEqual({
        kind: "atlas",
        url: "/objects/props.png",
        jsonUrl: "/objects/props.json",
    });
    expect(deriveAsset("object_key")).toStrictEqual({ kind: "image", url: "/objects/key.png" });
    expect(deriveAsset("character_hero")).toStrictEqual({ kind: "image", url: "/characters/hero.png" });
});

test("deriveAsset supports explicit image extensions", () => {
    expect(deriveAsset("bg_kitchen.webp")).toStrictEqual({ kind: "image", url: "/scenes/kitchen.webp" });
    expect(deriveAsset("bg_corner.svg")).toStrictEqual({ kind: "image", url: "/scenes/corner.svg" });
    expect(deriveAsset("object_key.webp")).toStrictEqual({ kind: "image", url: "/objects/key.webp" });
    expect(deriveAsset("character_hero.svg")).toStrictEqual({ kind: "image", url: "/characters/hero.svg" });
});

test("deriveAsset supports webp sprite atlases with json sidecars", () => {
    expect(deriveAsset("sprite_props.webp")).toStrictEqual({
        kind: "atlas",
        url: "/objects/props.webp",
        jsonUrl: "/objects/props.json",
    });
});
