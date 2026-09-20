import { DialogueBubble } from "../cutscene/DialogueBubble.js";
import { evaluateCondition } from "../core/conditions.js";
import { questWhatsNextNode } from "../state/Quests.js";

/**
 * @typedef {object} QuestHintOptions
 * @property {string} quest - registered quest id.
 * @property {string | { sprite: import("phaser").GameObjects.Sprite, bubble?: DialogueBubble | null }} actor - cast id, "player", or a live actor.
 * @property {import("../core/conditions.js").Condition} [when] - optional game-owned visibility condition.
 * @property {{ x?: number, y?: number }} [offset]
 */

/**
 * Follow an actor with the next incomplete quest step's icon. Yields to speech,
 * hidden/absent actors, and close-up scenes; cleans itself up on scene shutdown.
 * Game-specific hint selection belongs in the quest's icon definitions.
 * @param {import("../scene/AdventureScene.js").AdventureScene} scene
 * @param {QuestHintOptions} opts
 * @returns {() => void} dispose
 */
export function attachQuestHint(scene, opts) {
    /** @type {DialogueBubble | null} */
    let bubble = null;
    /** @type {import("phaser").GameObjects.Sprite | null} */
    let anchor = null;
    let iconKey = "";
    let disposed = false;
    const clear = () => {
        bubble?.destroy();
        bubble = null;
        anchor = null;
        iconKey = "";
    };
    const update = () => {
        const actor = typeof opts.actor === "string"
            ? opts.actor === "player" ? scene.walk : scene.cast?.get(opts.actor)
            : opts.actor;
        const sprite = actor?.sprite;
        const speaking = sprite?.getData("caper:speaking") || /** @type {any} */ (actor)?.bubble?.active;
        if (
            !sprite?.active || !sprite.visible || speaking || scene.subscenes?.isOpen() || !evaluateCondition(opts.when)
        ) {
            clear();
            return;
        }
        const icon = questWhatsNextNode(opts.quest)?.icon;
        if (!icon) {
            clear();
            return;
        }
        const nextKey = JSON.stringify(icon);
        if (bubble?.active && anchor === sprite && iconKey === nextKey) return;
        clear();
        anchor = sprite;
        iconKey = nextKey;
        bubble = DialogueBubble.show(scene, { character: sprite, icons: [icon], offset: opts.offset, follow: true });
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        scene.events.off("update", update);
        scene.events.off("shutdown", dispose);
        clear();
    };
    scene.events.on("update", update);
    scene.events.once("shutdown", dispose);
    update();
    return dispose;
}
