// @ts-nocheck: hand-written Phaser/scene mocks don't satisfy the real Phaser types
import { assert, assertEquals } from "@std/assert";
import { createCritters, pauseCritterAnimations } from "./CritterHelper.js";
import { engineAssets } from "../assets/EngineAssets.js";
import { store } from "../state/Store.js";

// The default critter atlas/frame lives in the game-side registry.
// Set it up here so tests that rely on defaults get the expected values.
engineAssets.configure({
    critter: { atlas: "critters-atlas", frame: "red_butterfly" },
});

// No global Phaser mock needed: CritterHelper now uses the project RNG
// (`randomInt` from random.js) instead of the runtime global `Phaser.Math`.

function makeMockImage(x, y, atlas, frame) {
    const img = {
        x,
        y,
        atlas,
        frame,
        originX: 0,
        originY: 0,
        scale: 1,
        depth: 0,
        angle: 0,
        flipX: false,
        visible: true,
        setOrigin: (ox, oy) => {
            img.originX = ox;
            img.originY = oy;
            return img;
        },
        setScale: (s) => {
            img.scale = s;
            return img;
        },
        setDepth: (d) => {
            img.depth = d;
            return img;
        },
        setAngle: (a) => {
            img.angle = a;
            return img;
        },
        setFlipX: (f) => {
            img.flipX = f;
            return img;
        },
        setVisible: (v) => {
            img.visible = v;
            return img;
        },
        destroy: () => {
            img.destroyed = true;
        },
    };
    return img;
}

function makeMockScene(weatherCfg) {
    const images = [];
    const tweens = [];
    const eventHandlers = { update: [], shutdown: [] };
    const busHandlers = { weatherchange: [], shutdown: [] };

    const scene = {
        add: {
            image: (x, y, atlas, frame) => {
                const img = makeMockImage(x, y, atlas, frame);
                img.scene = scene;
                images.push(img);
                return img;
            },
        },
        tweens: {
            add: (config) => {
                const tween = {
                    config,
                    stop: () => {
                        tween.stopped = true;
                    },
                };
                tweens.push(tween);
                return tween;
            },
        },
        events: {
            on: (name, fn) => eventHandlers[name] && eventHandlers[name].push(fn),
            once: (name, fn) => eventHandlers[name] && eventHandlers[name].push(fn),
            off: (name, fn) => {
                if (!eventHandlers[name]) return;
                const i = eventHandlers[name].indexOf(fn);
                if (i !== -1) eventHandlers[name].splice(i, 1);
            },
        },
        bus: {
            on: (name, fn) => busHandlers[name] && busHandlers[name].push(fn),
            once: (name, fn) => busHandlers[name] && busHandlers[name].push(fn),
            off: (name, fn) => {
                if (!busHandlers[name]) return;
                const i = busHandlers[name].indexOf(fn);
                if (i !== -1) busHandlers[name].splice(i, 1);
            },
        },
        time: { now: 1000 },
        scale: { width: 800 },
        sceneConfig: weatherCfg ? { weather: weatherCfg } : undefined,

        // test helpers
        images,
        _tweens: tweens,
        eventHandlers,
        busHandlers,
        shutdown: () => {
            [...eventHandlers.shutdown].forEach((fn) => fn());
            [...busHandlers.shutdown].forEach((fn) => fn());
            eventHandlers.shutdown = [];
            busHandlers.shutdown = [];
        },
        update: () => {
            [...eventHandlers.update].forEach((fn) => fn());
        },
        emitWeatherChange: () => {
            [...busHandlers.weatherchange].forEach((fn) => fn());
        },
    };
    return scene;
}

Deno.test("CritterHelper: creates a default butterfly critter", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 100, y: 200 }]);

    assertEquals(scene.images.length, 1);
    const img = scene.images[0];
    assertEquals(img.x, 100);
    assertEquals(img.y, 200);
    assertEquals(img.frame, "red_butterfly");

    assertEquals(scene._tweens.length, 1);
    assertEquals(scene._tweens[0].config.targets, img);
    assertEquals(img._critterType, "butterfly");
});

Deno.test("CritterHelper: creates a bird critter with update loop", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 50, y: 50, type: "bird", scale: 0.2 }]);

    assertEquals(scene.images.length, 1);
    const img = scene.images[0];
    assertEquals(img._critterType, "bird");

    // Bird adds a wobble tween
    assertEquals(scene._tweens.length, 1);
    // Bird adds an update listener
    assertEquals(scene.eventHandlers.update.length, 1);

    const initialX = img.x;
    scene.update();
    assert(img.x !== initialX, "Bird should move on update");
});

Deno.test("CritterHelper: creates a ground critter with no animation", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "ground" }]);

    assertEquals(scene.images.length, 1);
    assertEquals(scene._tweens.length, 0);
    assertEquals(scene.eventHandlers.update.length, 0);
});

Deno.test("CritterHelper: creates a custom critter with explicit ampX/ampY", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "custom", ampX: 50, ampY: 0 }]);

    assertEquals(scene.images.length, 1);
    assertEquals(scene._tweens.length, 1);
    assertEquals(scene._tweens[0].config.x, 60); // 10 + 50
    assertEquals(scene._tweens[0].config.y, 10); // 10 - 0
});

Deno.test("CritterHelper: custom critter without amplitudes adds no tween", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "custom", ampX: 0, ampY: 0 }]);

    assertEquals(scene.images.length, 1);
    assertEquals(scene._tweens.length, 0); // animateCustom returns null
});

Deno.test("CritterHelper: pauseCritterAnimations stops tweens and update loops, resets position", () => {
    const scene = makeMockScene();
    createCritters(scene, [
        { x: 100, y: 100, type: "butterfly" },
        { x: 200, y: 200, type: "bird" },
    ]);

    const butterfly = scene.images[0];
    const bird = scene.images[1];

    // Move them to simulate mid-tween
    butterfly.x = 150;
    bird.x = 250;

    pauseCritterAnimations(scene);

    // Tweens should be stopped
    assert(butterfly._critterTween === null);
    assert(scene._tweens[0].stopped); // butterfly tween
    assert(scene._tweens[1].stopped); // bird wobble tween

    // Update listeners should be removed
    assertEquals(scene.eventHandlers.update.length, 0);

    // Positions should be snapped back
    assertEquals(butterfly.x, 100);
    assertEquals(bird.x, 200);
});

Deno.test("CritterHelper: shutdown cleans up resources", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 0, y: 0, type: "bird" }]);

    const bird = scene.images[0];
    assertEquals(scene.eventHandlers.update.length, 1);

    scene.shutdown();

    assert(scene._tweens[0].stopped);
    assertEquals(scene.eventHandlers.update.length, 0);
    assert(bird.destroyed);
});

Deno.test("CritterHelper: weather visibility logic", () => {
    // Make a scene that participates in weather
    const scene = makeMockScene({ someMode: ["light-rain"] });

    store.set("timeOfDay", "day");
    store.set("weatherMode", "none");

    createCritters(scene, [
        { x: 0, y: 0, type: "butterfly" },
        { x: 0, y: 0, type: "ground" },
    ]);

    const butterfly = scene.images[0];
    const ground = scene.images[1];

    // Day, no rain -> both visible
    assert(butterfly.visible);
    assert(ground.visible);

    // Rain -> butterfly hides, ground stays visible
    store.set("weatherMode", "light-rain");
    scene.emitWeatherChange();

    assert(!butterfly.visible);
    assert(ground.visible);

    // Night -> everything hides
    store.set("timeOfDay", "night");
    scene.emitWeatherChange();

    assert(!butterfly.visible);
    assert(!ground.visible);

    // Cleanup state
    store.set("timeOfDay", "day");
    store.set("weatherMode", "none");
});
