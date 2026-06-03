/**
 * Shared "renderable item" shape used across a game's item collections (props,
 * equipment, scene-specific objects). Every collection extends this with its own
 * positional / domain
 * fields, but the visual fields are uniform: pick a frame, set a scale,
 * optionally rotate.
 *
 * Pattern for a new collection — declare a typedef that intersects this
 * with the scene-specific fields, e.g.:
 *   `import("./itemDef.js").RenderableItem & { x: number, y: number }`
 *
 * @typedef {object} RenderableItem
 * @property {string} id - registry key
 * @property {string} [frame] - atlas frame name. Defaults to `id` if omitted.
 * @property {number} [scale] - display scale, default 1
 * @property {number} [rotation] - rotation in DEGREES (Phaser setAngle), default 0
 */

/**
 * A `RenderableItem` placed in a scene at a specific position. Add a list
 * of these to `AdventureSceneConfig.propItems` and the base scene renders
 * them automatically (no per-scene loop needed). Subclasses can grab the
 * resulting sprite via `this.propSprites.get(id)` for later manipulation
 * (destroy on pickup, toggle visibility, etc.).
 *
 * @typedef {RenderableItem & {
 *   atlas: string,
 *   x: number,
 *   y: number,
 *   depth?: number,
 *   flipX?: boolean,
 *   origin?: { x?: number, y?: number },
 *   shouldRender?: () => boolean,
 *   seasons?: string[],
 *   hideIfPickedUp?: boolean,
 * }} PropItem
 */

/** @type {RenderableItem} */
export const RenderableItem = null;

