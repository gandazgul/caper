import { assertEquals } from "@std/assert";

import { FullscreenButton } from "./FullscreenButton.js";

class FakeEvents {
    constructor() {
        /** @type {Map<string, Array<() => void>>} */
        this.handlers = new Map();
    }

    /**
     * @param {string} event
     * @param {() => void} handler
     */
    on(event, handler) {
        const handlers = this.handlers.get(event) ?? [];
        handlers.push(handler);
        this.handlers.set(event, handlers);
        return this;
    }

    /**
     * @param {string} event
     * @param {() => void} handler
     */
    once(event, handler) {
        return this.on(event, handler);
    }

    /**
     * @param {string} event
     * @param {() => void} handler
     */
    off(event, handler) {
        const handlers = this.handlers.get(event) ?? [];
        this.handlers.set(event, handlers.filter((item) => item !== handler));
        return this;
    }

    /** @param {string} event */
    emit(event) {
        for (const handler of this.handlers.get(event) ?? []) handler();
    }
}

/**
 * @typedef {{
 *   style: Record<string, string | undefined>,
 *   ownerDocument: { documentElement: { style: Record<string, string | undefined> }, body: { style: Record<string, string | undefined> } },
 *   parentElement: null | StyleTarget,
 * }} StyleTarget
 */

/**
 * @param {{ documentElement: { style: Record<string, string | undefined> }, body: { style: Record<string, string | undefined> } }} ownerDocument
 * @returns {StyleTarget}
 */
function createStyleTarget(ownerDocument) {
    return {
        /** @type {Record<string, string | undefined>} */
        style: {},
        ownerDocument,
        /** @type {null | StyleTarget} */
        parentElement: null,
    };
}

/** @param {{ fullscreenAvailable: boolean }} options */
function createScene({ fullscreenAvailable }) {
    const ownerDocument = {
        documentElement: { style: {} },
        body: { style: {} },
    };
    const target = createStyleTarget(ownerDocument);
    const scaleEvents = new FakeEvents();
    /** @type {Map<string, () => void>} */
    const imageEvents = new Map();
    let refreshes = 0;
    let startFullscreenCalls = 0;

    const image = {
        visible: true,
        setInteractive() {
            return this;
        },
        setScale() {
            return this;
        },
        setDepth() {
            return this;
        },
        setScrollFactor() {
            return this;
        },
        /** @param {boolean} visible */
        setVisible(visible) {
            this.visible = visible;
            return this;
        },
        /**
         * @param {string} event
         * @param {() => void} handler
         */
        on(event, handler) {
            imageEvents.set(event, handler);
            return this;
        },
        destroy() {},
    };

    const scene = {
        events: new FakeEvents(),
        add: {
            image() {
                return image;
            },
        },
        scale: {
            isFullscreen: false,
            fullscreen: { available: fullscreenAvailable },
            parent: target,
            canvas: target,
            on: scaleEvents.on.bind(scaleEvents),
            off: scaleEvents.off.bind(scaleEvents),
            startFullscreen() {
                startFullscreenCalls += 1;
            },
            stopFullscreen() {},
            refresh() {
                refreshes += 1;
            },
        },
    };

    return {
        get refreshes() {
            return refreshes;
        },
        get startFullscreenCalls() {
            return startFullscreenCalls;
        },
        image,
        imageEvents,
        scaleEvents,
        scene: /** @type {import("phaser").Scene} */ (/** @type {unknown} */ (scene)),
        target,
    };
}

Deno.test("FullscreenButton uses native fullscreen when the browser supports it", () => {
    const harness = createScene({ fullscreenAvailable: true });

    new FullscreenButton(harness.scene, {
        imageOnly: true,
        iconImage: { texture: "fullscreen" },
    });

    harness.imageEvents.get("pointerup")?.();

    assertEquals(harness.startFullscreenCalls, 1);
    assertEquals(harness.target.style.position, undefined);
});

Deno.test("FullscreenButton falls back to viewport fullscreen when native fullscreen is unsupported", () => {
    const harness = createScene({ fullscreenAvailable: false });

    new FullscreenButton(harness.scene, {
        imageOnly: true,
        iconImage: { texture: "fullscreen" },
    });

    harness.imageEvents.get("pointerup")?.();

    assertEquals(harness.startFullscreenCalls, 0);
    assertEquals(harness.target.style.position, "fixed");
    assertEquals(harness.target.style.inset, "0");
    assertEquals(harness.target.ownerDocument.body.style.overflow, "hidden");
    assertEquals(harness.image.visible, true);
    assertEquals(harness.refreshes, 1);

    harness.imageEvents.get("pointerup")?.();

    assertEquals(harness.target.style.position, "");
    assertEquals(harness.target.ownerDocument.body.style.overflow, "");
    assertEquals(harness.refreshes, 2);
});

Deno.test("FullscreenButton falls back to viewport fullscreen when native fullscreen fails", () => {
    const harness = createScene({ fullscreenAvailable: true });

    new FullscreenButton(harness.scene, {
        imageOnly: true,
        iconImage: { texture: "fullscreen" },
    });

    harness.imageEvents.get("pointerup")?.();
    harness.scaleEvents.emit("fullscreenfailed");

    assertEquals(harness.startFullscreenCalls, 1);
    assertEquals(harness.target.style.position, "fixed");
    assertEquals(harness.refreshes, 1);
});
