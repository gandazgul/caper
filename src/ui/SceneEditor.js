import { pauseCritterAnimations } from "../environment/CritterHelper.js";
import { arrowTip } from "./DebugOverlay.js";

/**
 * Lightweight in-game positioning editor that sits on top of `DebugOverlay`.
 * Toggle with Shift+E. While active:
 *   - Walkable polygon nodes appear as green draggable squares.
 *   - NightLayer lit windows appear as magenta draggable squares anchored
 *     where their spec says (top-left for rect/glow, center for oval).
 *   - Hotspot bounds top-left appears as a cyan square (drag the whole
 *     trigger area). The approach point appears as a yellow circle (drag
 *     where the character should stand to use the hotspot).
 *   - Press W / N / H to copy walkable / windows / hotspots arrays.
 *   - A fullscreen invisible Zone consumes pointer-downs so the character doesn't
 *     wander off every time you finish a drag.
 *
 * Drag updates mutate the SAME array/spec object the scene config uses, so
 * the copied output is just the live state stringified.
 *
 * Add new categories (props, critters) by extending `createHandles` and
 * `copyXxx`; the toast/zone/keybinding plumbing is already in place.
 */

// Editor chrome sits above everything else — the night tint (6000), weather
// (5000), and the DebugOverlay (9000) — so handles and lines stay crisp and
// untinted while editing.
const CLICK_BLOCKER_DEPTH = 9400;
const HANDLE_DEPTH = 9500;
const TOAST_DEPTH = 9700;

/** Single source of truth for keybindings — drives the HUD strip. */
const KEYBINDINGS = [
    { key: "Shift+E", desc: "toggle editor" },
    { key: "W", desc: "copy walkable polygon" },
    { key: "N", desc: "copy NightLayer windows" },
    { key: "P", desc: "copy props" },
    { key: "C", desc: "copy critters" },
];

export class SceneEditor {
    /** @param {import("phaser").Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.active = false;
        /** @type {Phaser.GameObjects.GameObject[]} */
        this.handles = [];
        /** @type {Phaser.GameObjects.Zone | null} */
        this.clickBlocker = null;
        /** @type {Phaser.GameObjects.Text | null} */
        this.toast = null;
        /** @type {Phaser.GameObjects.Text | null} */
        this.hud = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.toastTimer = null;
        /** @type {boolean | null} - debug overlay's visibility before we forced it on */
        this._debugWasVisible = null;
        /** @type {{x:number,y:number,w:number,h:number}[]} */
        this._editorBounds = [];
        /** @type {{x:number,y:number,facing?:string}[]} */
        this._editorApproaches = [];

        const kb = scene.input.keyboard;
        if (kb) {
            kb.on("keydown-E", (/** @type {KeyboardEvent} */ e) => {
                if (!e.shiftKey) return;
                this.toggle();
            });
            kb.on("keydown-W", () => this.active && this.copyWalkable());
            kb.on("keydown-N", () => this.active && this.copyWindows());
            kb.on("keydown-P", () => this.active && this.copyProps());
            kb.on("keydown-C", () => this.active && this.copyCritters());
        }

        scene.events.once("shutdown", () => this.shutdown());
    }

    toggle() {
        this.active = !this.active;
        if (this.active) this.activate();
        else this.deactivate();
    }

    activate() {
        // Block scene clicks so dragging handles doesn't also send the character
        // walking. The Zone is interactive at a depth below the handles, so
        // WalkController's `hitTestPointer` finds something on every click
        // and bails — but the handles still get their own drag events.
        this.clickBlocker = this.scene.add.zone(0, 0, this.scene.scale.width, this.scene.scale.height)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(CLICK_BLOCKER_DEPTH)
            .setInteractive();

        // The walkable polygon / hotspot-bounds / approach-arrow LINES come
        // from DebugOverlay, a separate Shift+D toggle. Force it on while
        // editing so the lines always pair with our drag handles, then
        // restore its prior state on exit.
        const debug = /** @type {any} */ (this.scene).debug;
        this._debugWasVisible = debug?.visible ?? null;
        if (debug) {
            if (!debug.visible) {
                debug.visible = true;
                debug.draw?.();
            }
            debug.setExtraDraw?.((/** @type {Phaser.GameObjects.Graphics} */ g) => this._drawEditorLines(g));
        }

        // Freeze critter animations so they don't fight the drag handles.
        // (They stay paused after exit — reload to see them animate again.)
        pauseCritterAnimations(this.scene);

        this.createHandles();
        this.renderHud();
        this.showToast("Editor ON — Shift+E to exit");
    }

    deactivate() {
        this.destroyHandles();
        this.clickBlocker?.destroy();
        this.clickBlocker = null;
        this.hud?.destroy();
        this.hud = null;

        // Restore the debug overlay to whatever state it was in before we
        // force-enabled it.
        const debug = /** @type {any} */ (this.scene).debug;
        if (debug) {
            if (this._debugWasVisible === false) {
                debug.visible = false;
                debug.clear?.();
            }
            debug.setExtraDraw?.(null);
        }
        this._debugWasVisible = null;

        this.showToast("Editor OFF");
    }

    createHandles() {
        this.createWalkableHandles();
        this.createWindowHandles();
        this.createHotspotHandles();
        this.createPropHandles();
        this.createCritterHandles();
    }

    createWalkableHandles() {
        const walkable = this._getWalkable();
        if (!walkable) return;
        for (let i = 0; i < walkable.length; i++) {
            const node = walkable[i];
            const handle = this._makeSquareHandle(node.x, node.y, 0x00ff00);
            handle.on(
                "drag",
                (/** @type {Phaser.Input.Pointer} */ _p, /** @type {number} */ dx, /** @type {number} */ dy) => {
                    const x = Math.round(dx);
                    const y = Math.round(dy);
                    handle.x = x;
                    handle.y = y;
                    node.x = x;
                    node.y = y;
                },
            );
            this.handles.push(handle);
        }
    }

    createWindowHandles() {
        const nightLayer = /** @type {any} */ (this.scene).nightLayer;
        if (!nightLayer?.windowEntries) return;
        for (let i = 0; i < nightLayer.windowEntries.length; i++) {
            const { spec } = nightLayer.windowEntries[i];
            const handle = this._makeSquareHandle(spec.x, spec.y, 0xff00ff);
            handle.on(
                "drag",
                (/** @type {Phaser.Input.Pointer} */ _p, /** @type {number} */ dx, /** @type {number} */ dy) => {
                    const x = Math.round(dx);
                    const y = Math.round(dy);
                    handle.x = x;
                    handle.y = y;
                    nightLayer.moveWindow(i, x, y);
                },
            );
            this.handles.push(handle);
        }
    }

    createHotspotHandles() {
        const hotspotManager = /** @type {any} */ (this.scene).hotspots;
        if (!hotspotManager?.list) return;
        for (const cfg of hotspotManager.list()) {
            // Skip NPC-managed hotspots — they reposition themselves to follow
            // a moving character every frame, so a drag handle is meaningless
            // (and their `data.npc` isn't serializable).
            if (isDynamicHotspot(cfg)) continue;
            this._createHotspotBoundsHandle(cfg, hotspotManager);
            if (cfg.approachPoint) {
                this._createApproachPointHandle(cfg);
            }
        }
    }

    /**
     * Two handles per hotspot's `bounds`:
     *   - Cyan square at the TOP-LEFT moves the whole trigger area (w/h kept).
     *   - Teal square at the BOTTOM-RIGHT resizes it (bounds.w / bounds.h).
     * Both keep the config object AND the live Phaser Zone in sync.
     * @param {import("../interaction/HotspotManager.js").HotspotConfig} cfg
     * @param {any} hotspotManager
     */
    _createHotspotBoundsHandle(cfg, hotspotManager) {
        const zone = hotspotManager.zones?.get?.(cfg.id);
        this._createBoundsHandles(cfg.bounds, zone);
    }

    /**
     * Shared cyan-move + teal-resize handles for a `{x, y, w, h}` rectangle.
     * `zone` is the live Phaser.GameObjects.Zone backing the rect (legacy
     * hotspot zone OR a PropEngine prop zone); pass `undefined` when no zone
     * is currently registered (a gated prop state with no `onClick` won't
     * have one) — the config mutates either way and the zone resyncs on the
     * next reconcile.
     *
     * @param {{ x: number, y: number, w: number, h: number }} b
     * @param {import("phaser").GameObjects.Zone | undefined} zone
     */
    _createBoundsHandles(b, zone) {
        this._editorBounds.push(b);
        const syncZone = () => {
            if (!zone) return;
            zone.x = b.x;
            zone.y = b.y;
            if (zone.width !== b.w || zone.height !== b.h) {
                zone.setSize(b.w, b.h);
                if (zone.input?.hitArea) {
                    zone.input.hitArea.width = b.w;
                    zone.input.hitArea.height = b.h;
                }
            }
        };

        const moveHandle = this._makeSquareHandle(b.x, b.y, 0x00ffff);
        const resizeHandle = this._makeSquareHandle(b.x + b.w, b.y + b.h, 0x0aa3a3);

        moveHandle.on(
            "drag",
            (/** @type {Phaser.Input.Pointer} */ _p, /** @type {number} */ dx, /** @type {number} */ dy) => {
                const x = Math.round(dx);
                const y = Math.round(dy);
                moveHandle.x = x;
                moveHandle.y = y;
                b.x = x;
                b.y = y;
                // Drag the resize handle along so it stays at the corner.
                resizeHandle.x = b.x + b.w;
                resizeHandle.y = b.y + b.h;
                syncZone();
            },
        );

        resizeHandle.on(
            "drag",
            (/** @type {Phaser.Input.Pointer} */ _p, /** @type {number} */ dx, /** @type {number} */ dy) => {
                // Bottom-right corner — width/height are its distance from the
                // top-left. Clamp to a small minimum so it stays grabbable.
                const w = Math.max(10, Math.round(dx) - b.x);
                const h = Math.max(10, Math.round(dy) - b.y);
                b.w = w;
                b.h = h;
                resizeHandle.x = b.x + w;
                resizeHandle.y = b.y + h;
                syncZone();
            },
        );

        this.handles.push(moveHandle, resizeHandle);
    }

    /**
     * Yellow circle at the approach point. Dragging updates `approachPoint.x/y`
     * (facing is preserved). A plain click (press + release without drag)
     * cycles `facing` clockwise through up → right → down → left → up. The
     * DebugOverlay redraws the point + facing arrow every frame from the
     * same config object, so both move/rotate track live.
     * @param {import("../interaction/HotspotManager.js").HotspotConfig} cfg
     */
    _createApproachPointHandle(cfg) {
        this._createApproachHandle(cfg.approachPoint, cfg.id);
    }

    /**
     * Shared yellow approach-point handle. Works on any `{x, y, facing}` —
     * legacy hotspot's `approachPoint` OR a prop's `approach`. Drag updates
     * x/y; a plain click (no drag) cycles `facing` clockwise.
     *
     * @param {{ x: number, y: number, facing?: string }} ap
     * @param {string} label - shown in the rotation toast.
     */
    _createApproachHandle(ap, label) {
        this._editorApproaches.push(ap);
        const handle = this.scene.add.circle(ap.x, ap.y, 9, 0xffff00, 0.85)
            .setStrokeStyle(2, 0x000000)
            .setDepth(HANDLE_DEPTH)
            .setInteractive({ draggable: true });

        // Distinguish click from drag: dragstart only fires after the
        // pointer moves; if we never see it before pointerup, treat as a
        // click. Distance check is a belt-and-suspenders fallback.
        let dragged = false;
        let downX = 0;
        let downY = 0;
        handle.on("pointerdown", (/** @type {Phaser.Input.Pointer} */ p) => {
            dragged = false;
            downX = p.x;
            downY = p.y;
        });
        handle.on("dragstart", () => {
            dragged = true;
        });
        handle.on(
            "drag",
            (/** @type {Phaser.Input.Pointer} */ _p, /** @type {number} */ dx, /** @type {number} */ dy) => {
                const x = Math.round(dx);
                const y = Math.round(dy);
                handle.x = x;
                handle.y = y;
                ap.x = x;
                ap.y = y;
            },
        );
        handle.on("pointerup", (/** @type {Phaser.Input.Pointer} */ p) => {
            if (dragged) return;
            const dist = Math.hypot(p.x - downX, p.y - downY);
            if (dist >= 5) return;
            ap.facing = rotateFacing(ap.facing);
            this.showToast(`${label}: facing → ${ap.facing}`);
        });
        this.handles.push(handle);
    }

    /**
     * Three kinds of handle per prop / propItem:
     *   - Orange square at the anchor x/y — only when the prop is currently
     *     rendered. Drag updates the spec AND the live sprite.
     *   - Cyan move + teal resize on `bounds` — for any declarative prop that
     *     authored a hotspot rect (typically exits and other pure-zone props).
     *     Live zone is synced if the prop's currently active state has a
     *     registered PropEngine zone.
     *   - Yellow approach-point circle on `approach` — click without drag
     *     cycles facing.
     *
     * When the currently-active state overrides `x`/`y`/`bounds`/`approach`,
     * the handle edits the STATE object so the override stays effective (this
     * matches PropEngine's resolution: state value wins over prop-level).
     * Otherwise the prop-level value is edited. `approach: "in-place"` is a
     * sentinel meaning "no walk" — the editor falls back to the prop-level
     * approach so other states' approach point remains editable.
     */
    createPropHandles() {
        const anyScene = /** @type {any} */ (this.scene);
        const propSprites = anyScene.propSprites;
        const hotspotManager = anyScene.hotspots;
        const engine = anyScene.propEngine;
        // Legacy `propItems` and declarative `props` (ADR 0002) both anchor at a
        // top-level x/y and render into the same `propSprites` map, so one handle
        // factory covers both.
        const specs = [
            ...(Array.isArray(anyScene.sceneConfig?.propItems) ? anyScene.sceneConfig.propItems : []),
            ...(Array.isArray(anyScene.sceneConfig?.props) ? anyScene.sceneConfig.props : []),
        ];
        for (const item of specs) {
            const sprite = propSprites?.get?.(item.id);
            // PropEngine's currently-selected state for this prop (null for
            // legacy propItems or props with no matching `when`).
            const activeState = engine?.currentState?.get?.(item.id) ?? null;

            // Anchor handle: only when the prop has a live sprite AND some
            // object (state or prop) authored x/y. Pure-zone props (exits,
            // story-time hotspots) have no anchor.
            const xyTarget = activeState && activeState.x !== undefined && activeState.y !== undefined
                ? activeState
                : (item.x !== undefined && item.y !== undefined ? item : null);
            if (sprite && xyTarget) {
                const handle = this._makeSquareHandle(xyTarget.x, xyTarget.y, 0xff8800);
                handle.on(
                    "drag",
                    (
                        /** @type {Phaser.Input.Pointer} */ _p,
                        /** @type {number} */ dx,
                        /** @type {number} */ dy,
                    ) => {
                        const x = Math.round(dx);
                        const y = Math.round(dy);
                        handle.x = x;
                        handle.y = y;
                        xyTarget.x = x;
                        xyTarget.y = y;
                        sprite.x = x;
                        sprite.y = y;
                    },
                );
                this.handles.push(handle);
            }
            // Bounds handle (declarative props only — legacy propItems have no
            // bounds). Look up the live zone via PropEngine's `prop:${id}`
            // registration; undefined when the current state doesn't arm a
            // zone (the spec still edits, the resync happens when the state
            // next becomes interactive).
            const boundsTarget = activeState?.bounds ?? item.bounds ?? null;
            if (boundsTarget) {
                const zone = hotspotManager?.zones?.get?.(`prop:${item.id}`);
                this._createBoundsHandles(boundsTarget, zone);
            }
            // Approach handle. `approach` is an object `{x, y, facing}` OR the
            // string `"in-place"`; only the object form is draggable. Prefer
            // the active state's object form; otherwise fall back to the
            // prop-level approach (still authored, used by other states).
            let approachTarget = null;
            if (activeState?.approach && typeof activeState.approach === "object") {
                approachTarget = activeState.approach;
            } else if (item.approach && typeof item.approach === "object") {
                approachTarget = item.approach;
            }
            if (approachTarget) {
                this._createApproachHandle(approachTarget, item.id);
            }
        }
    }

    /**
     * Blue square at each critter's anchor. Critter animations are paused
     * on editor activate (see `pauseCritterAnimations`), so drag updates
     * apply cleanly without the tween snapping the sprite back.
     */
    createCritterHandles() {
        const entries = /** @type {any} */ (this.scene).critterEntries ?? [];
        for (const { spec, sprite } of entries) {
            const handle = this._makeSquareHandle(spec.x, spec.y, 0x00b3ff);
            handle.on(
                "drag",
                (
                    /** @type {Phaser.Input.Pointer} */ _p,
                    /** @type {number} */ dx,
                    /** @type {number} */ dy,
                ) => {
                    const x = Math.round(dx);
                    const y = Math.round(dy);
                    handle.x = x;
                    handle.y = y;
                    spec.x = x;
                    spec.y = y;
                    sprite.x = x;
                    sprite.y = y;
                },
            );
            this.handles.push(handle);
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} color
     * @returns {Phaser.GameObjects.Rectangle}
     */
    _makeSquareHandle(x, y, color) {
        return this.scene.add.rectangle(x, y, 14, 14, color, 0.85)
            .setStrokeStyle(2, 0x000000)
            .setDepth(HANDLE_DEPTH)
            .setInteractive({ draggable: true });
    }

    destroyHandles() {
        for (const h of this.handles) h.destroy();
        this.handles = [];
        this._editorBounds = [];
        this._editorApproaches = [];
    }

    /** @param {Phaser.GameObjects.Graphics} g */
    _drawEditorLines(g) {
        if (this._editorBounds.length > 0) {
            g.lineStyle(2, 0x00ffff, 0.9);
            for (const b of this._editorBounds) {
                g.strokeRect(b.x, b.y, b.w, b.h);
            }
        }
        if (this._editorApproaches.length > 0) {
            g.lineStyle(3, 0xffff00, 1);
            for (const ap of this._editorApproaches) {
                if (!ap.facing) continue;
                const tip = arrowTip(/** @type {any} */ (ap));
                g.lineBetween(ap.x, ap.y, tip.x, tip.y);
            }
        }
    }

    async copyWalkable() {
        const walkable = this._getWalkable();
        if (!walkable) {
            this.showToast("No walkable polygon on this scene");
            return;
        }
        const js = formatWalkable(walkable);
        await this._writeClipboard(js);
        this.showToast(`Copied walkable (${walkable.length} nodes)`);
    }

    async copyWindows() {
        const nightLayer = /** @type {any} */ (this.scene).nightLayer;
        const entries = nightLayer?.windowEntries;
        if (!entries || entries.length === 0) {
            this.showToast("No NightLayer windows on this scene");
            return;
        }
        const specs = entries.map((/** @type {any} */ e) => e.spec);
        const js = formatWindows(specs);
        await this._writeClipboard(js);
        this.showToast(`Copied windows (${specs.length})`);
    }

    async copyProps() {
        const cfg = /** @type {any} */ (this.scene).sceneConfig;
        const props = cfg?.props;
        if (!Array.isArray(props) || props.length === 0) {
            this.showToast("No props on this scene");
            return;
        }
        await this._writeClipboard(formatPropsV2(props));
        this.showToast(`Copied props (${props.length})`);
    }

    async copyCritters() {
        const entries = /** @type {any} */ (this.scene).critterEntries ?? [];
        if (entries.length === 0) {
            this.showToast("No critters on this scene");
            return;
        }
        const specs = entries.map((/** @type {any} */ e) => e.spec);
        const js = formatCritters(specs);
        await this._writeClipboard(js);
        this.showToast(`Copied critters (${specs.length})`);
    }

    /**
     * @returns {{x: number, y: number}[] | null}
     */
    _getWalkable() {
        const anyScene = /** @type {any} */ (this.scene);
        return anyScene.sceneConfig?.walkable ?? anyScene.walk?.walkable ?? null;
    }

    /** @param {string} text */
    async _writeClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_e) {
            // Clipboard API can fail (focus, permission, http). Fall back to
            // dumping to the console so the user can still grab the value.
            console.warn("[SceneEditor] Clipboard write failed — dumping to console instead:");
            console.log(text);
        }
    }

    /** @param {string} msg */
    showToast(msg) {
        this.toast?.destroy();
        this.toastTimer?.remove(false);
        this.toast = this.scene.add.text(this.scene.scale.width / 2, 40, msg, {
            fontSize: "16px",
            color: "#ffffff",
            backgroundColor: "#000000cc",
            padding: { x: 10, y: 6 },
        })
            .setOrigin(0.5, 0)
            .setDepth(TOAST_DEPTH)
            .setScrollFactor(0);
        this.toastTimer = this.scene.time.delayedCall(2500, () => {
            this.toast?.destroy();
            this.toast = null;
        });
    }

    renderHud() {
        this.hud?.destroy();
        const summary = KEYBINDINGS.map((k) => `${k.key}=${shortDesc(k.desc)}`).join(" · ");
        this.hud = this.scene.add.text(
            10,
            this.scene.scale.height - 10,
            `EDIT MODE — ${summary}`,
            {
                fontSize: "13px",
                color: "#00ff88",
                backgroundColor: "#000000aa",
                padding: { x: 6, y: 4 },
            },
        )
            .setOrigin(0, 1)
            .setDepth(TOAST_DEPTH)
            .setScrollFactor(0);
    }

    shutdown() {
        this.destroyHandles();
        this.clickBlocker?.destroy();
        this.toast?.destroy();
        this.hud?.destroy();
        this.toastTimer?.remove(false);
    }
}

/** Clockwise rotation order matching the visual quadrants. */
const FACING_ORDER = /** @type {const} */ (["up", "right", "down", "left"]);

/**
 * @param {string | undefined} current
 * @returns {"up" | "right" | "down" | "left"}
 */
function rotateFacing(current) {
    const idx = FACING_ORDER.indexOf(/** @type {any} */ (current));
    if (idx < 0) return "up";
    return FACING_ORDER[(idx + 1) % FACING_ORDER.length];
}

/**
 * Shorten a binding description for the always-on HUD strip.
 * @param {string} d
 */
function shortDesc(d) {
    // "copy walkable polygon" → "walkable"
    return d.replace(/^copy\s+/, "").replace(/^toggle\s+/, "").split(" ")[0];
}

/** @param {{x: number, y: number}[]} arr */
function formatWalkable(arr) {
    const lines = arr.map((n) => `    { x: ${Math.round(n.x)}, y: ${Math.round(n.y)} },`);
    return `walkable: [\n${lines.join("\n")}\n],`;
}

/** @param {import("../environment/NightLayer.js").LitWindow[]} arr */
function formatWindows(arr) {
    const lines = arr.map((w) => {
        const parts = [];
        if (w.name != null) parts.push(`name: ${JSON.stringify(w.name)}`);
        parts.push(`x: ${Math.round(w.x)}`, `y: ${Math.round(w.y)}`);
        if (w.w != null) parts.push(`w: ${w.w}`);
        if (w.h != null) parts.push(`h: ${w.h}`);
        if (w.type) parts.push(`type: "${w.type}"`);
        if (w.color != null) parts.push(`color: 0x${w.color.toString(16).padStart(6, "0")}`);
        if (w.flicker != null) parts.push(`flicker: ${JSON.stringify(w.flicker)}`);
        return `    { ${parts.join(", ")} },`;
    });
    return `windows: [\n${lines.join("\n")}\n],`;
}

/**
 * A hotspot the scene config didn't author. Two cases:
 *   - `data.npc` — an NPC registered + repositions it every frame.
 *   - `data.propId` — PropEngine registered it for a declarative `props[]`
 *     state; it's owned by the engine, not the editor's hotspot handles.
 * Filters both out so the cyan/teal/yellow handles only ever wrap genuinely
 * authored content — which now means props.
 * @param {any} h
 */
function isDynamicHotspot(h) {
    return h?.data?.npc || h?.data?.propId;
}

/**
 * Format declarative `props` (ADR 0002). These are pure data — conditions,
 * states, and effect lists are plain objects/arrays — so a recursive JS-
 * literal dump round-trips losslessly. Identifier-safe keys go unquoted (and
 * strings stay JSON-quoted), to match the source style of the migrated
 * scenes; `JSON.stringify` would quote every key.
 * @param {any[]} arr
 */
function formatPropsV2(arr) {
    const items = arr.map((p) => `    ${jsLiteral(p, 1)},`);
    return `props: [\n${items.join("\n")}\n],`;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Recursive JS-literal serializer with unquoted identifier keys and trailing
 * commas. `indent` is the *current* indent level — children render at
 * `indent + 1`. The opening `{` / `[` is written at the caller's position,
 * the closing brace lands back at `indent`.
 *
 * @param {any} value
 * @param {number} indent
 * @returns {string}
 */
function jsLiteral(value, indent) {
    if (value === null) return "null";
    const t = typeof value;
    if (t === "number" || t === "boolean") return String(value);
    if (t === "string") return JSON.stringify(value);
    const pad = (/** @type {number} */ n) => "    ".repeat(n);
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const lines = value.map((v) => `${pad(indent + 1)}${jsLiteral(v, indent + 1)},`);
        return `[\n${lines.join("\n")}\n${pad(indent)}]`;
    }
    if (t === "object") {
        const keys = Object.keys(value);
        if (keys.length === 0) return "{}";
        const lines = keys.map((k) => {
            const keyStr = IDENTIFIER_RE.test(k) ? k : JSON.stringify(k);
            return `${pad(indent + 1)}${keyStr}: ${jsLiteral(value[k], indent + 1)},`;
        });
        return `{\n${lines.join("\n")}\n${pad(indent)}}`;
    }
    return "undefined";
}

/**
 * Critters are usually passed inline to `createCritters(this, [...])` — emit
 * just the array literal so the user can paste over the existing argument.
 * @param {any[]} arr
 */
function formatCritters(arr) {
    const ordered = [
        "x",
        "y",
        "frame",
        "atlas",
        "scale",
        "type",
        "ampX",
        "ampY",
        "depth",
        "rotation",
        "flipX",
        "originX",
        "originY",
    ];
    const items = arr.map((spec) => {
        /** @type {string[]} */
        const parts = [];
        const seen = new Set();
        for (const key of ordered) {
            if (spec[key] === undefined) continue;
            seen.add(key);
            if (key === "x" || key === "y") parts.push(`${key}: ${Math.round(spec[key])}`);
            else parts.push(`${key}: ${JSON.stringify(spec[key])}`);
        }
        for (const [k, v] of Object.entries(spec)) {
            if (seen.has(k)) continue;
            if (typeof v === "function") continue;
            parts.push(`${k}: ${JSON.stringify(v)}`);
        }
        return `    { ${parts.join(", ")} },`;
    });
    return `[\n${items.join("\n")}\n]`;
}
