// Post-processes the bundled mod.d.ts produced by dts-bundle-generator.
//
// The bundler rewrites JSDoc `import("phaser").GameObjects.X` references to
// `import("phaser").Phaser.GameObjects.X` because phaser's types use `export =
// Phaser`. That extra `.Phaser` segment doesn't exist on the module namespace,
// so tsc rejects it. Strip it back out.
const path = "./mod.d.ts";
const before = await Bun.file(path).text();
const after = before.replaceAll('import("phaser").Phaser.', 'import("phaser").');
if (after !== before) await Bun.write(path, after);
console.log(`fix-phaser-dts: ${before === after ? "no change" : "patched"} ${path}`);
