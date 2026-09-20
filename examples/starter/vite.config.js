import { fileURLToPath } from "node:url";

export default {
    base: "./",
    build: { assetsInlineLimit: 0 },
    resolve: {
        alias: { "@caper/engine": fileURLToPath(new URL("../../mod.js", import.meta.url)) },
        dedupe: ["phaser"],
    },
};
