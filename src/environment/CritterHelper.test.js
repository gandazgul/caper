import { expect, test } from "bun:test";
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

/**
 * @param {number} x
 * @param {number} y
 * @param {string} atlas
 * @param {string | number} frame
 */
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
        destroyed: false,
        /** @type {unknown} */
        scene: undefined,
        /** @type {string | undefined} */
        _critterType: undefined,
        /** @type {import("phaser").Tweens.Tween | null | undefined} */
        _critterTween: undefined,
        setOrigin: (/** @type {number} */ ox, /** @type {number} */ oy) => {
            img.originX = ox;
            img.originY = oy;
            return img;
        },
        setScale: (/** @type {number} */ s) => {
            img.scale = s;
            return img;
        },
        setDepth: (/** @type {number} */ d) => {
            img.depth = d;
            return img;
        },
        setAngle: (/** @type {number} */ a) => {
            img.angle = a;
            return img;
        },
        setFlipX: (/** @type {boolean} */ f) => {
            img.flipX = f;
            return img;
        },
        setVisible: (/** @type {boolean} */ v) => {
            img.visible = v;
            return img;
        },
        destroy: () => {
            img.destroyed = true;
        },
    };
    return img;
}

/** @param {Record<string, string[]>} [weatherCfg] */
function makeMockScene(weatherCfg) {
    /** @type {ReturnType<typeof makeMockImage>[]} */
    const images = [];
    /** @type {{ config: import("phaser").Types.Tweens.TweenBuilderConfig, stopped: boolean, stop(): void }[]} */
    const tweens = [];
    /** @type {Record<string, (() => void)[]>} */
    const eventHandlers = { update: [], shutdown: [] };
    /** @type {Record<string, (() => void)[]>} */
    const busHandlers = { weatherchange: [], shutdown: [] };

    const scene = {
        add: {
            image: (
                /** @type {number} */ x,
                /** @type {number} */ y,
                /** @type {string} */ atlas,
                /** @type {string | number} */ frame,
            ) => {
                const img = makeMockImage(x, y, atlas, frame);
                img.scene = scene;
                images.push(img);
                return img;
            },
        },
        tweens: {
            add: (/** @type {import("phaser").Types.Tweens.TweenBuilderConfig} */ config) => {
                const tween = {
                    config,
                    stopped: false,
                    stop: () => {
                        tween.stopped = true;
                    },
                };
                tweens.push(tween);
                return tween;
            },
        },
        events: {
            on: (/** @type {string} */ name, /** @type {() => void} */ fn) =>
                eventHandlers[name] && eventHandlers[name].push(fn),
            once: (/** @type {string} */ name, /** @type {() => void} */ fn) =>
                eventHandlers[name] && eventHandlers[name].push(fn),
            off: (/** @type {string} */ name, /** @type {() => void} */ fn) => {
                if (!eventHandlers[name]) return;
                const i = eventHandlers[name].indexOf(fn);
                if (i !== -1) eventHandlers[name].splice(i, 1);
            },
        },
        bus: {
            on: (/** @type {string} */ name, /** @type {() => void} */ fn) =>
                busHandlers[name] && busHandlers[name].push(fn),
            once: (/** @type {string} */ name, /** @type {() => void} */ fn) =>
                busHandlers[name] && busHandlers[name].push(fn),
            off: (/** @type {string} */ name, /** @type {() => void} */ fn) => {
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
    // Cast only the partial external Phaser scene, not the assertions.
    return /** @type {typeof scene & import("phaser").Scene} */ (/** @type {unknown} */ (scene));
}

test("CritterHelper: creates a default butterfly critter", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 100, y: 200 }]);

    expect(scene.images.length).toStrictEqual(1);
    const img = scene.images[0];
    expect(img.x).toStrictEqual(100);
    expect(img.y).toStrictEqual(200);
    expect(img.frame).toStrictEqual("red_butterfly");

    expect(scene._tweens.length).toStrictEqual(1);
    expect(scene._tweens[0].config.targets).toStrictEqual(img);
    expect(img._critterType).toStrictEqual("butterfly");
});

test("CritterHelper: creates a bird critter with update loop", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 50, y: 50, type: "bird", scale: 0.2 }]);

    expect(scene.images.length).toStrictEqual(1);
    const img = scene.images[0];
    expect(img._critterType).toStrictEqual("bird");

    // Bird adds a wobble tween
    expect(scene._tweens.length).toStrictEqual(1);
    // Bird adds an update listener
    expect(scene.eventHandlers.update.length).toStrictEqual(1);

    const initialX = img.x;
    scene.update();
    expect(img.x !== initialX, "Bird should move on update").toBeTruthy();
});

test("CritterHelper: creates a ground critter with no animation", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "ground" }]);

    expect(scene.images.length).toStrictEqual(1);
    expect(scene._tweens.length).toStrictEqual(0);
    expect(scene.eventHandlers.update.length).toStrictEqual(0);
});

test("CritterHelper: creates a custom critter with explicit ampX/ampY", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "custom", ampX: 50, ampY: 0 }]);

    expect(scene.images.length).toStrictEqual(1);
    expect(scene._tweens.length).toStrictEqual(1);
    expect(scene._tweens[0].config.x).toStrictEqual(60); // 10 + 50
    expect(scene._tweens[0].config.y).toStrictEqual(10); // 10 - 0
});

test("CritterHelper: custom critter without amplitudes adds no tween", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 10, y: 10, type: "custom", ampX: 0, ampY: 0 }]);

    expect(scene.images.length).toStrictEqual(1);
    expect(scene._tweens.length).toStrictEqual(0); // animateCustom returns null
});

test("CritterHelper: pauseCritterAnimations stops tweens and update loops, resets position", () => {
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
    expect(butterfly._critterTween === null).toBeTruthy();
    expect(scene._tweens[0].stopped).toBeTruthy(); // butterfly tween
    expect(scene._tweens[1].stopped).toBeTruthy(); // bird wobble tween

    // Update listeners should be removed
    expect(scene.eventHandlers.update.length).toStrictEqual(0);

    // Positions should be snapped back
    expect(butterfly.x).toStrictEqual(100);
    expect(bird.x).toStrictEqual(200);
});

test("CritterHelper: shutdown cleans up resources", () => {
    const scene = makeMockScene();
    createCritters(scene, [{ x: 0, y: 0, type: "bird" }]);

    const bird = scene.images[0];
    expect(scene.eventHandlers.update.length).toStrictEqual(1);

    scene.shutdown();

    expect(scene._tweens[0].stopped).toBeTruthy();
    expect(scene.eventHandlers.update.length).toStrictEqual(0);
    expect(bird.destroyed).toBeTruthy();
});

test("CritterHelper: weather visibility logic", () => {
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
    expect(butterfly.visible).toBeTruthy();
    expect(ground.visible).toBeTruthy();

    // Rain -> butterfly hides, ground stays visible
    store.set("weatherMode", "light-rain");
    scene.emitWeatherChange();

    expect(!butterfly.visible).toBeTruthy();
    expect(ground.visible).toBeTruthy();

    // Night -> everything hides
    store.set("timeOfDay", "night");
    scene.emitWeatherChange();

    expect(!butterfly.visible).toBeTruthy();
    expect(!ground.visible).toBeTruthy();

    // Cleanup state
    store.set("timeOfDay", "day");
    store.set("weatherMode", "none");
});
