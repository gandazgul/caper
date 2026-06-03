/**
 * UIHelper — Shared utilities for creating consistent chunky wooden buttons
 * and icon drawing functions used across scenes and UI components.
 */

import { store } from "../state/Store.js";
import { exitReplay } from "../scene/transitions.js";
import { engineAssets } from "../assets/EngineAssets.js";

// Re-export so existing import sites (`import { exitReplay } from
// ".../UIHelper.js"`) keep working — exitReplay lives next to transitionTo
// now so they can share a private fade helper without a recursive trip
// through the replay guard.
export { exitReplay };

/**
 * Default depth for UI buttons — high enough to sit on top of everything else
 * in a scene. Callers can still pass an explicit `depth` to override it.
 */
export const UI_DEPTH = 9000;

/**
 * Draw a trash/bin icon centered at (cx, cy).
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} cx
 * @param {number} cy
 */
export function drawTrashIcon(gfx, cx, cy) {
    gfx.lineStyle(3, 0xffebd6, 1);
    gfx.strokeRect(cx - 10, cy - 8, 20, 20);
    gfx.lineBetween(cx - 14, cy - 8, cx + 14, cy - 8);
    gfx.strokeRect(cx - 5, cy - 13, 10, 5);
}

/**
 * Draw a camera icon centered at (cx, cy).
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} cx
 * @param {number} cy
 */
export const drawCameraIcon = (gfx, cx, cy) => {
    gfx.fillStyle(0xffebd6, 1);
    gfx.lineStyle(2, 0x3d251c, 1);

    // Camera body
    gfx.fillRect(cx - 18, cy - 10, 36, 24);
    gfx.strokeRect(cx - 18, cy - 10, 36, 24);

    // Top shutter button
    gfx.fillRect(cx - 10, cy - 15, 8, 5);
    gfx.strokeRect(cx - 10, cy - 15, 8, 5);

    // Outer lens
    gfx.beginPath();
    gfx.arc(cx, cy + 2, 8, 0, Math.PI * 2);
    gfx.fill();
    gfx.stroke();

    // Inner lens
    gfx.fillStyle(0x3d251c, 1);
    gfx.beginPath();
    gfx.arc(cx, cy + 2, 4, 0, Math.PI * 2);
    gfx.fill();
};

/**
 * Draw a fullscreen toggle icon (diagonal arrows) centered at (cx, cy).
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} cx
 * @param {number} cy
 */
export function drawFullscreenIcon(gfx, cx, cy) {
    gfx.lineStyle(3, 0xffebd6, 1);
    const s = 8; // half-size of the square
    // Top-left corner: two arrows pointing out
    gfx.beginPath();
    gfx.moveTo(cx - s, cy - s + 6);
    gfx.lineTo(cx - s, cy - s);
    gfx.lineTo(cx - s + 6, cy - s);
    gfx.stroke();
    // Bottom-right corner
    gfx.beginPath();
    gfx.moveTo(cx + s, cy + s - 6);
    gfx.lineTo(cx + s, cy + s);
    gfx.lineTo(cx + s - 6, cy + s);
    gfx.stroke();
}

/**
 * Draw a reload / restart icon (circular arrow) centered at (cx, cy).
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} cx
 * @param {number} cy
 */
export function drawReloadIcon(gfx, cx, cy) {
    gfx.lineStyle(3, 0xffebd6, 1);
    const r = 10;
    // Partial circle (top ¾) to imply rotation
    gfx.beginPath();
    gfx.arc(cx, cy, r, -Math.PI * 0.75, Math.PI * 0.75, false);
    gfx.stroke();
    // Arrow head at the end of the arc
    gfx.beginPath();
    gfx.moveTo(cx + r * Math.cos(Math.PI * 0.75) + 0, cy + r * Math.sin(Math.PI * 0.75));
    gfx.lineTo(cx + (r + 5) * Math.cos(Math.PI * 0.75 - 0.4), cy + (r + 5) * Math.sin(Math.PI * 0.75 - 0.4));
    gfx.lineTo(cx + (r + 5) * Math.cos(Math.PI * 0.75 + 0.4), cy + (r + 5) * Math.sin(Math.PI * 0.75 + 0.4));
    gfx.closePath();
    gfx.fillStyle(0xffebd6, 1);
    gfx.fillPath();
}

/**
 * Icon draw dispatcher.
 * @param {Phaser.GameObjects.Graphics} gfx
 * @param {number} cx
 * @param {number} cy
 * @param {string} name — one of "trash", "camera", "fullscreen", "reload"
 */
export function drawIcon(gfx, cx, cy, name) {
    switch (name) {
        case "trash":
            drawTrashIcon(gfx, cx, cy);
            break;
        case "camera":
            drawCameraIcon(gfx, cx, cy);
            break;
        case "fullscreen":
            drawFullscreenIcon(gfx, cx, cy);
            break;
        case "reload":
            drawReloadIcon(gfx, cx, cy);
            break;
        default:
            break;
    }
}

/**
 * Canonical placement + sizing for the back button so it sits in the exact
 * same spot in every scene. Exported so callers can align other elements to it
 * (e.g. hiding the character switcher that shares this corner).
 */
export const BACK_BUTTON_POSITION = Object.freeze({ x: 80, y: 50 });
const BACK_BUTTON_SCALE = 0.4;
const BACK_BUTTON_HOVER_SCALE = 0.44;

/**
 * Create the standard "back" button — the wooden arrow pinned to the top-left
 * corner. Position, scale, left-facing flip, and hover feedback are identical
 * everywhere; only the click behavior and per-scene layering differ.
 *
 * @param {import("phaser").Scene} scene
 * @param {() => void} onClick - invoked on press (pointerdown)
 * @param {{ scrollFactor0?: boolean, visible?: boolean, stopPropagation?: boolean, replayReturn?: boolean }} [options]
 *   - `scrollFactor0` pins it to the camera (for scrolling scenes)
 *   - `visible: false` starts it hidden (toggle with setVisible later)
 *   - `stopPropagation` swallows the pointerdown so it doesn't reach the
 *     scene's walk/hotspot handlers
 *   - `replayReturn` (default true) — during a fridge-wall replay this back
 *     button returns to the replay's owner scene instead of running `onClick`. Set false
 *     for back arrows that pop an in-scene zoom (SubsceneStack), not the scene.
 * @returns {Phaser.GameObjects.Image}
 */
export function createBackButton(scene, onClick, options = {}) {
    const { scrollFactor0 = false, visible = true, stopPropagation = false, replayReturn = true } = options;

    // The arrow art points right by default — flip so it reads as "back".
    const backArt = engineAssets.get("backButton");
    const btn = scene.add.image(BACK_BUTTON_POSITION.x, BACK_BUTTON_POSITION.y, backArt?.atlas, backArt?.frame)
        .setFlipX(true)
        .setScale(BACK_BUTTON_SCALE)
        .setDepth(UI_DEPTH)
        .setInteractive({ useHandCursor: true });

    if (scrollFactor0) btn.setScrollFactor(0);
    if (!visible) btn.setVisible(false);

    btn.on("pointerover", () => btn.setScale(BACK_BUTTON_HOVER_SCALE));
    btn.on("pointerout", () => btn.setScale(BACK_BUTTON_SCALE));
    btn.on(
        "pointerdown",
        (
            /** @type {Phaser.Input.Pointer} */ _p,
            /** @type {number} */ _x,
            /** @type {number} */ _y,
            /** @type {{ stopPropagation?: () => void }} */ event,
        ) => {
            if (stopPropagation) event?.stopPropagation?.();
            if (replayReturn && store.isReplaying()) {
                exitReplay(scene);
                return;
            }
            onClick();
        },
    );

    return btn;
}

/**
 * Create a chunky wooden button container.
 *
 * @template {import("phaser").Scene} T
 * @param {T} scene
 * @param {number} x — center X
 * @param {number} y — center Y
 * @param {number} width
 * @param {number} height
 * @param {{ text?: string | null, fontSize?: string, icon?: string, iconDrawFn?: ((gfx: Phaser.GameObjects.Graphics, cx: number, cy: number) => void) | null, onClick: () => void, selected?: boolean }} options
 * @returns {any}
 */
export function createChunkyButton(scene, x, y, width, height, options) {
    const { text, fontSize = "30px", icon, iconDrawFn, onClick, selected = false } = options;

    const hw = width / 2;
    const hh = height / 2;

    // x, y are top-left, but we center the container so it scales from its middle
    const container = scene.add.container(x + hw, y + hh);

    const bg = scene.add.graphics();
    container.add(bg);

    let isSelected = selected;

    const drawBg = () => {
        bg.clear();
        // Shadow
        bg.fillStyle(0x1d140b, 0.5);
        bg.fillRoundedRect(-hw + 4, -hh + 4, width, height, 10);

        if (isSelected) {
            // Lighter brown base
            bg.fillStyle(0x8a5b4c, 1);
            bg.fillRoundedRect(-hw, -hh, width, height, 10);

            // Gold stroke
            bg.lineStyle(4, 0xf1c40f, 1);
            bg.strokeRoundedRect(-hw, -hh, width, height, 10);
            bg.lineStyle(2, 0xf9e076, 0.6); // Inner gold highlight
            bg.strokeRoundedRect(-hw + 2, -hh + 2, width - 4, height - 4, 8);
        } else {
            // Button base (warm medium wood)
            bg.fillStyle(0x6e473b, 1);
            bg.fillRoundedRect(-hw, -hh, width, height, 10);

            // Bevel borders
            bg.lineStyle(3, 0x3d251c, 1);
            bg.strokeRoundedRect(-hw, -hh, width, height, 10);
            bg.lineStyle(2, 0x9c6d59, 0.6);
            bg.strokeRoundedRect(-hw + 2, -hh + 2, width - 4, height - 4, 8);
        }
    };

    drawBg();

    const extendedContainer = /** @type {any} */ (container);

    extendedContainer.setSelected = (/** @type {boolean} */ val) => {
        if (isSelected !== val) {
            isSelected = val;
            drawBg();
        }
    };

    extendedContainer.isSelected = () => isSelected;

    if (text) {
        const label = scene.add.text(0, 0, text, {
            fontSize,
            color: "#ffebd6",
            fontFamily: "Arial",
            stroke: "#3d251c",
            strokeThickness: 3,
        }).setOrigin(0.5);
        container.add(label);
    }

    if (iconDrawFn) {
        const iconGfx = scene.add.graphics();
        iconDrawFn(iconGfx, 0, 0);
        container.add(iconGfx);
    } else if (icon) {
        const iconGfx = scene.add.graphics();
        drawIcon(iconGfx, 0, 0, icon);
        container.add(iconGfx);
    }

    container.setDepth(UI_DEPTH);

    const zone = scene.add.zone(0, 0, width, height)
        .setOrigin(0.5, 0.5)
        .setInteractive({ useHandCursor: true });

    const baseY = y + hh;

    zone.on("pointerover", () => {
        container.setScale(1.05);
    });
    zone.on("pointerout", () => {
        container.setScale(1.0);
        container.y = baseY;
    });
    zone.on("pointerdown", () => {
        container.y = baseY + 2;
    });
    zone.on("pointerup", () => {
        container.y = baseY;
        onClick();
    });

    container.add(zone);
    return container;
}
