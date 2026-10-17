import { expect, test } from "bun:test";
import { findPathInWalkable, snapToWalkable, walkablePolygons } from "./pathfinding.js";

test("walkablePolygons accepts one polygon or several polygons", () => {
    const one = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];
    const two = [
        one,
        [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 10 },
        ],
    ];

    expect(walkablePolygons(one).length).toStrictEqual(1);
    expect(walkablePolygons(two).length).toStrictEqual(2);
});

test("normal pathing cannot cross disconnected walkable islands", () => {
    const left = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];
    const right = [
        { x: 30, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 10 },
        { x: 30, y: 10 },
    ];

    const route = findPathInWalkable({ x: 5, y: 5 }, { x: 35, y: 5 }, [left, right]);
    expect(route.reachedTarget).toStrictEqual(false);
    expect(route.path.length > 0).toBeTruthy();
    expect(route.path.at(-1)).toStrictEqual({ x: 10, y: 5 });
});

test("snapToWalkable snaps to the island containing or nearest the point", () => {
    const left = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];
    const right = [
        { x: 30, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 10 },
        { x: 30, y: 10 },
    ];

    expect(snapToWalkable({ x: 35, y: 5 }, [left, right])).toStrictEqual({ x: 35, y: 5 });
    expect(snapToWalkable({ x: 22, y: 5 }, [left, right])).toStrictEqual({ x: 30, y: 5 });
});
