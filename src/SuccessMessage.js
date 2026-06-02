/**
 * Displays a styled success banner in the center of the scene's camera viewport,
 * styled identically to the countdown "GO!" in JumpRopeScene.
 *
 * @param {Phaser.Scene} scene - The active Phaser scene
 * @param {string} text - The success text to display (e.g. "All done!")
 * @param {object} [options]
 * @param {number} [options.x] - Optional horizontal position override
 * @param {number} [options.y] - Optional vertical position override
 * @param {string} [options.fontSize="120px"] - Font size override
 * @param {string} [options.color="#3b8c4a"] - Hex color for the text fill
 * @param {number} [options.holdMs=1200] - Duration in ms to hold the message before fading
 * @param {() => void} [options.onComplete] - Callback fired after the message is completely destroyed
 * @returns {Phaser.GameObjects.Text}
 */
export function showSuccessMessage(scene, text, options = {}) {
    const cx = options.x !== undefined ? options.x : scene.cameras.main.centerX;
    const cy = options.y !== undefined ? options.y : scene.cameras.main.centerY;
    const fontSize = options.fontSize || "120px";
    const color = options.color || "#3b8c4a";
    const holdMs = options.holdMs !== undefined ? options.holdMs : 1200;
    const onComplete = options.onComplete || null;

    const label = scene.add.text(cx, cy, text, {
        fontSize: fontSize,
        color: color,
        fontStyle: "bold",
        fontFamily: "Arial",
        stroke: "#ffffff",
        strokeThickness: 8,
    })
        .setOrigin(0.5)
        .setDepth(3000) // Ensure it draws over all puzzle/inventory layers
        .setScale(0.4)
        .setAlpha(0);

    scene.tweens.add({
        targets: label,
        scale: 1,
        alpha: 1,
        duration: 220,
        ease: "Back.easeOut",
        onComplete: () => {
            scene.time.delayedCall(holdMs, () => {
                scene.tweens.add({
                    targets: label,
                    scale: 1.45,
                    alpha: 0,
                    duration: 200,
                    ease: "Quad.easeIn",
                    onComplete: () => {
                        label.destroy();
                        onComplete?.();
                    },
                });
            });
        },
    });

    return label;
}
