import { assertEquals } from "@std/assert";
import { deriveAsset } from "./assetLoading.js";

Deno.test("deriveAsset keeps legacy default extensions", () => {
    assertEquals(deriveAsset("bg_kitchen"), { kind: "image", url: "/scenes/kitchen.jpg" });
    assertEquals(deriveAsset("sprite_props"), {
        kind: "atlas",
        url: "/objects/props.png",
        jsonUrl: "/objects/props.json",
    });
    assertEquals(deriveAsset("object_key"), { kind: "image", url: "/objects/key.png" });
    assertEquals(deriveAsset("character_hero"), { kind: "image", url: "/characters/hero.png" });
});

Deno.test("deriveAsset supports explicit image extensions", () => {
    assertEquals(deriveAsset("bg_kitchen.webp"), { kind: "image", url: "/scenes/kitchen.webp" });
    assertEquals(deriveAsset("bg_corner.svg"), { kind: "image", url: "/scenes/corner.svg" });
    assertEquals(deriveAsset("object_key.webp"), { kind: "image", url: "/objects/key.webp" });
    assertEquals(deriveAsset("character_hero.svg"), { kind: "image", url: "/characters/hero.svg" });
});

Deno.test("deriveAsset supports webp sprite atlases with json sidecars", () => {
    assertEquals(deriveAsset("sprite_props.webp"), {
        kind: "atlas",
        url: "/objects/props.webp",
        jsonUrl: "/objects/props.json",
    });
});
