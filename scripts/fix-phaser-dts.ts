// Post-processes the bundled mod.d.ts produced by dts-bundle-generator.
//
// The bundler rewrites JSDoc `import("phaser").GameObjects.X` references to
// `import("phaser").Phaser.GameObjects.X` because phaser's types use `export =
// Phaser`. That extra `.Phaser` segment doesn't exist on the module namespace,
// so JSR fast-check (and tsc) reject it. Strip it back out.
const path = "./mod.d.ts";
const before = await Deno.readTextFile(path);
const after = before.replaceAll('import("phaser").Phaser.', 'import("phaser").');
if (after !== before) await Deno.writeTextFile(path, after);
console.log(`fix-phaser-dts: ${before === after ? "no change" : "patched"} ${path}`);
