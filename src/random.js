const two32 = 4294967296;

/**
 * @typedef {object} RNG
 * @property {function(): number} random - A function that returns a float between 0 and 1
 * @property {function(): number} uint32 - A function that returns a random 32bit integer
 */

/**
 * Creates a deterministic PRNG using SplitMix32.
 * Encapsulates the seed state via closure.
 *
 * @param {number} [seed] Defaults to Date.now() >>> 0
 * @returns {RNG}
 */
export function getSeededRNG(seed = Date.now() >>> 0) {
    let currentSeed = seed >>> 0;

    function splitmix32() {
        currentSeed = currentSeed + 0x9e3779b9 | 0;
        let t = currentSeed ^ currentSeed >>> 16;
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ t >>> 15;
        t = Math.imul(t, 0x735a2d97);
        return ((t ^ t >>> 15) >>> 0) / two32;
    }

    return {
        random: splitmix32,
        uint32: () => Math.floor(splitmix32() * two32),
    };
}

// Persist the RNG instance so tight loops don't reset to the same millisecond timestamp
let defaultRNG = getSeededRNG();

/**
 * Uses the given seed for all subsequent random number generation.
 *
 * @param {number} seed
 */
export function setGlobalSeed(seed) {
    defaultRNG = getSeededRNG(seed);
}

/**
 * Like Math.random() but deterministic if setGlobalSeed() was called.
 *
 * @return {number} A float between 0 and 1
 */
export function random() {
    return defaultRNG.random();
}

/**
 * Returns a pseudo random integer between min (inclusive) and max (inclusive).
 *
 * If no arguments are passed, it will return a number between 0 and Number.MAX_VALUE
 * If only one argument is passed, it will return a number between 0 and the argument
 * If two arguments are passed, it will return a number between the two arguments (inclusive of both)
 * If three arguments are passed, it will return a number between the two arguments (inclusive of both), using the third argument as a seed
 *
 * Use this instead of Math.round() because that will give you a non-uniform distribution!
 *
 * @param {...number} args min, max or just max or nothing
 * @return {number}
 */
export function randomInt(...args) {
    const randomInt32 = defaultRNG.uint32();

    // no arguments: return between 0 and Number.MAX_VALUE
    if (args.length === 0) {
        return randomInt32 % (Number.MAX_VALUE + 1);
    }

    // one argument: return between 0 and that argument
    if (args.length === 1) {
        const max = Math.floor(args[0]);
        return randomInt32 % (max + 1);
    }

    // two arguments: return between them
    const min = Math.ceil(args[0]);
    const max = Math.floor(args[1]);

    return min + (randomInt32 % (max - min + 1));
}
