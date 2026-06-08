// @ts-self-types="./mod.d.ts"
export { AdventureScene } from "./src/scene/AdventureScene.js";
export { CastDirector } from "./src/cast/CastDirector.js";
export { castRegistry, registerCast } from "./src/cast/CastRegistry.js";
export { CharacterRegistry, characters } from "./src/characters/CharacterRegistry.js";
export { CharacterSwitcher } from "./src/characters/CharacterSwitcher.js";
export { content, ContentRegistry } from "./src/inventory/ContentRegistry.js";
export { createCritters } from "./src/environment/CritterHelper.js";
export { Cutscene, CutsceneCancelled } from "./src/cutscene/Cutscene.js";
export { CutsceneRunner } from "./src/cutscene/CutsceneRunner.js";
export { DebugOverlay } from "./src/ui/DebugOverlay.js";
export { EngineAssetRegistry, engineAssets } from "./src/assets/EngineAssets.js";
export { FullscreenButton } from "./src/ui/FullscreenButton.js";
export { HotspotManager } from "./src/interaction/HotspotManager.js";
export { IdleCharacter } from "./src/movement/IdleCharacter.js";
export { CompanionBehavior } from "./src/movement/behaviors/CompanionBehavior.js";
export { WanderBehavior } from "./src/movement/behaviors/WanderBehavior.js";
export { InventoryLayer } from "./src/inventory/InventoryLayer.js";
export { NPC } from "./src/cast/NPC.js";
export { NightLayer } from "./src/environment/NightLayer.js";
export { exitApproaches, PropEngine } from "./src/interaction/PropEngine.js";
export { SceneEditor } from "./src/ui/SceneEditor.js";
export { Store, store } from "./src/state/Store.js";
export {
    clearQuests,
    questProgress,
    questRegistry,
    quests,
    questStatus,
    questWhatsNext,
    questWhatsNextNode,
    registerQuests,
    RESERVED_ACCESSORS,
    resolveQuestAccessor,
} from "./src/state/Quests.js";
export { SubsceneStack } from "./src/scene/SubsceneStack.js";
export { showSuccessMessage } from "./src/cutscene/SuccessMessage.js";
export { DialogueBubble } from "./src/cutscene/DialogueBubble.js";
export {
    BACK_BUTTON_POSITION,
    createBackButton,
    createChunkyButton,
    drawCameraIcon,
    drawFullscreenIcon,
    drawIcon,
    drawReloadIcon,
    drawTrashIcon,
    exitReplay,
    UI_DEPTH,
    UI_SAFE_TOP,
} from "./src/ui/UIHelper.js";
export { WalkController } from "./src/movement/WalkController.js";
export { WearableRegistry, wearables } from "./src/characters/Wearables.js";
export { WeatherLayer } from "./src/environment/WeatherLayer.js";
export {
    chapterLoadSet,
    collectChapterAssetKeys,
    loadAssetKeys,
    loadAssetKeysAsync,
    loadImageOnce,
    loadSpritesheetOnce,
    registerAssetKeys,
    registerTrimmedAtlas,
} from "./src/assets/assetLoading.js";
export { evaluateCondition } from "./src/core/conditions.js";
export { createAdventureGame } from "./src/scene/createAdventureGame.js";
export { buildCutsceneContext } from "./src/cutscene/cutsceneActor.js";
export { applyDebugChapterState, readEngineDebugConfig } from "./src/debug/engineDebug.js";
export { bakeCircularCrop, resolveCharacterPortrait } from "./src/characters/portraits.js";
export { randomInt } from "./src/core/random.js";
export { RenderableItem } from "./src/inventory/itemDef.js";
export { transitionIn, TRANSITIONS, transitionTo } from "./src/scene/transitions.js";
