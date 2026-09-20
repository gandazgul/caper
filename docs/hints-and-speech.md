# Quest hints and speech

## Quest icons above actors

Register quests with an `icon: { type, id, scale? }` on steps that need a hint, then attach their presentation once:

```js
attachQuestHint(this, {
    quest: "findTheKey",
    actor: "gardener", // CastDirector id, "player", or a live { sprite, bubble? } actor
    when: { chapter: "arrival" },
    offset: { x: 0, y: 100 },
});
```

The helper follows the next incomplete step's icon, hides when the quest has no next icon, yields to the actor's speech
or a subscene, and handles cast members appearing/disappearing. It disposes itself on scene shutdown; the returned
function can remove it earlier. Register icon types with `DialogueBubble.registerIconType`; the engine provides
`character`, while the starter demonstrates a registry-backed `item` resolver. Story-specific choices of which quest or
icon to show remain game code.

## Advanceable speech

```js
await showSpeech(this, {
    character: gardener.sprite,
    text: "Welcome to the garden. Click to continue.",
    advance: "manual",
});
```

`advance` is `manual` (click, tap, Enter, or Space), `auto` (duration), or `either` (default). Advance input is captured
above the room and inventory so it cannot also trigger a puzzle. A short 150 ms guard ignores the click that opened the
line (`minAdvanceMs` overrides it). Use `offset` to adapt the bubble placement to your character art. Avoid starting
overlapping standalone speech lines in the same scene; use sequential awaits or a CastDirector cutscene.

`holdMs` defaults to 2800. With a preloaded `voice` audio key, auto/either waits for playback completion. Missing,
muted, locked, or rejected audio falls back to the reading duration; manual mode still waits for the player. Voice is
stopped and destroyed on advance/cancellation/shutdown. Phaser remains responsible for loading, audio unlocking, volume
and global mute (`scene.sound.setMute(true)`). No separate audio manager or recording format is required.

For cutscenes, NPC actors accept the same controls:

```js
await d.gardener.speak("Welcome!", { advance: "either", voice: "welcome", holdMs: 4000 }, "speech");
```

Existing numeric calls (`speak("Hello", 2800)`) keep automatic timing. Passing a Cutscene token as the third argument of
`showSpeech(scene, options, token)` makes cancellation propagate, so later story effects do not execute. Standalone
calls resolve quietly on scene shutdown. All speech-owned timers, listeners, input zones and sounds are removed by the
same cleanup path.
