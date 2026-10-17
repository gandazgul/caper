import Phaser from "phaser";
import {
    AdventureScene,
    attachQuestHint,
    characters,
    content,
    createAdventureGame,
    DialogueBubble,
    engineAssets,
    NPC,
    registerQuests,
    showSpeech,
    store,
    transitionIn,
} from "@gandazgul/caper-engine";

// Every image is local and bundled by Vite; base: './' also supports subdirectory hosting.
const art = {
    cottage: new URL("./art/cottage.svg?no-inline", import.meta.url).href,
    garden: new URL("./art/garden.svg?no-inline", import.meta.url).href,
    character_hero: new URL("./art/hero.svg?no-inline", import.meta.url).href,
    keeper: new URL("./art/keeper.svg?no-inline", import.meta.url).href,
    key: new URL("./art/key.svg?no-inline", import.meta.url).href,
    bubble: new URL("./art/bubble.svg?no-inline", import.meta.url).href,
    "bg-inventory": new URL("./art/inventory.svg?no-inline", import.meta.url).href,
};

function register() {
    store.configure({
        saveKey: "caper-garden-starter",
        saveVersion: 1,
        // The original unversioned starter had the same schema.
        migrateSave: (saved, from) => (from === 0 ? saved : null),
        createFreshState: () => ({
            values: { chapter: "arrival", activeCharacter: "hero", foundKey: false, gateOpen: false, finished: false },
            collections: {},
            items: {},
        }),
    });
    characters.register("hero", { spriteKey: "character_hero", playable: true, walkSpeed: 280 });
    DialogueBubble.registerIconType("item", (scene, id, scale) => {
        const item = content.getItem(id);
        return item ? scene.add.image(0, 0, item.atlas, item.frame).setScale(scale) : null;
    });
    content.registerItems({ key: { atlas: "key", frame: "__BASE", scale: 1 } });
    engineAssets.configure({
        thoughtBubble: { atlas: "bubble", frame: "__BASE", scale: 0.65 },
        speechBubble: { atlas: "bubble", frame: "__BASE" },
        inventoryAtlas: "key",
        cursors: { pickup: "grab", "use-with": "grab", look: "help", exit: "pointer" },
    });
    registerQuests({
        garden: {
            steps: [
                { id: "key", doneWhen: { foundKey: true }, icon: { type: "item", id: "key", scale: 0.9 } },
                { id: "gate", doneWhen: { gateOpen: true } },
                { id: "visit", doneWhen: { finished: true } },
            ],
        },
    });
}

class Boot extends Phaser.Scene {
    constructor() {
        super("Boot");
    }
    preload() {
        for (const [key, url] of Object.entries(art)) this.load.svg(key, url);
        this.load.on("loaderror", (file) => {
            document.querySelector("#status").textContent = `Could not load ${file.key}. Reload to retry.`;
        });
    }
    create() {
        const resume = store.getCurrentScene();
        this.scene.start(["Cottage", "Garden"].includes(resume) ? resume : "Cottage");
    }
}

const walkable = [
    { x: 70, y: 410 },
    { x: 880, y: 410 },
    { x: 880, y: 510 },
    { x: 70, y: 510 },
];

class Cottage extends AdventureScene {
    constructor() {
        super({
            key: "Cottage",
            diagnostics: "error",
            backgroundsByChapter: { arrival: "cottage" },
            walkable,
            activeCharacter: { startPosition: { x: 200, y: 470 } },
            props: [
                {
                    id: "key",
                    atlas: "key",
                    x: 385,
                    y: 375,
                    approach: { x: 385, y: 450, facing: "up" },
                    states: [
                        {
                            when: { foundKey: false },
                            frame: "__BASE",
                            cursor: "pickup",
                            onClick: [{ pickup: "key" }, { set: { foundKey: true } }],
                        },
                    ],
                },
                {
                    id: "gate",
                    bounds: { x: 730, y: 250, w: 160, h: 180 },
                    approach: { x: 785, y: 450, facing: "up" },
                    states: [
                        { when: { gateOpen: true }, cursor: "exit", onClick: [{ goToScene: "Garden" }] },
                        {
                            cursor: "look",
                            onClick: [{ showThought: { text: "A locked gate. Drag the key here." } }],
                            onDrop: {
                                accepts: { dropped: "key" },
                                effects: [{ set: { gateOpen: true } }, { removeFrom: { inventory: "key" } }],
                            },
                        },
                    ],
                },
            ],
        });
    }
    create(data) {
        super.create(data);
        const label = this.add.text(480, 50, "", { fontSize: "25px", color: "#163a34" }).setOrigin(0.5);
        const update = () =>
            label.setText(
                store.get("gateOpen") ? "The gate is open. Come on in!" : "Find the key and open the garden gate.",
            );
        const unsubscribe = store.onChange(update);
        this.events.once("shutdown", unsubscribe);
        update();
        attachQuestHint(this, { quest: "garden", actor: "player", offset: { x: -60, y: 0 } });
        transitionIn(this);
    }
}

class Garden extends AdventureScene {
    constructor() {
        super({
            key: "Garden",
            diagnostics: "error",
            backgroundsByChapter: { arrival: "garden" },
            walkable,
            activeCharacter: { startPosition: { x: 180, y: 470 } },
            props: [
                {
                    id: "return",
                    cursor: "exit",
                    bounds: { x: 30, y: 290, w: 100, h: 140 },
                    approach: { x: 100, y: 450, facing: "left" },
                    states: [{ onClick: [{ goToScene: "Cottage" }] }],
                },
            ],
        });
    }
    create(data) {
        super.create(data);
        const label = this.add.text(480, 50, "", { fontSize: "25px", color: "#163a34" }).setOrigin(0.5);
        const update = () =>
            label.setText(
                store.get("finished")
                    ? "You found the garden! Thanks for playing."
                    : "Someone is waiting to welcome you.",
            );
        const unsubscribe = store.onChange(update);
        this.events.once("shutdown", unsubscribe);
        update();
        new NPC(this, {
            id: "keeper",
            name: "Gardener",
            texture: "keeper",
            frame: "__BASE",
            x: 640,
            y: 445,
            depth: 9,
            boundsOffset: { x: -35, y: -105, w: 70, h: 105 },
            approachOffset: { x: -110, y: 20, facing: "right" },
            onClick: (npc) => {
                store.set("finished", true);
                showSpeech(this, {
                    character: npc.sprite,
                    text: "Welcome! The garden is yours to explore. Click to continue.",
                    advance: "manual",
                    offset: { x: -60, y: 0 },
                });
            },
        });
        transitionIn(this);
    }
}

const game = createAdventureGame({
    register,
    config: {
        type: Phaser.AUTO,
        parent: "game",
        width: 960,
        height: 640,
        backgroundColor: "#f8efd8",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [Boot, Cottage, Garden],
    },
});

document.querySelector("#restart").addEventListener("click", () => {
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene);
    store.reset();
    game.scene.start("Cottage");
});

store.onSaveStatusChange((status) => {
    const label = document.querySelector("#status");
    if (status.state === "unavailable" || status.state === "invalid" || status.state === "incompatible") {
        label.textContent = status.message;
    } else {
        label.textContent = "Click to explore. Progress saves automatically.";
    }
    document.querySelector("#retry-save").hidden = !(status.state === "unavailable" && status.operation === "save");
});
document.querySelector("#retry-save").addEventListener("click", () => store.save());
