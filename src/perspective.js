/**
 * @typedef {Object} PerspectiveConfig
 * @property {number} nearY
 * @property {number} farY
 * @property {number} [nearScale]
 * @property {number} [farScale]
 *
 * Y-based perspective for outdoor 3/4-view scenes:
 *   - `nearY` is the screen Y closest to the camera (full scale by default).
 *   - `farY`  is the screen Y farthest from the camera (smaller scale).
 *   - Sprites between get a linearly-interpolated scale; outside the band
 *     they clamp to nearScale / farScale.
 *
 * Coupled with Y-sort depth (`sprite.depth = sprite.y`) the result is a
 * sensible foreshortened look: characters lower on the screen are bigger
 * and render in front of those further up.
 */

/**
 * @param {PerspectiveConfig | null | undefined} perspective
 * @param {number} y
 * @returns {number}
 */
export function computePerspectiveScale(perspective, y) {
    if (!perspective) return 1;
    const { nearY, farY, nearScale = 1, farScale = 1 } = perspective;
    if (nearY === farY) return nearScale;
    const t = (y - farY) / (nearY - farY);
    const clamped = Math.max(0, Math.min(1, t));
    return farScale + (nearScale - farScale) * clamped;
}
