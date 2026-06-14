import { assert, assertEquals } from "@std/assert";
import { findPathInWalkable, snapToWalkable, walkablePolygons } from "./pathfinding.js";

Deno.test("walkablePolygons accepts one polygon or several polygons", () => {
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

    assertEquals(walkablePolygons(one).length, 1);
    assertEquals(walkablePolygons(two).length, 2);
});

Deno.test("normal pathing cannot cross disconnected walkable islands", () => {
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
    assertEquals(route.reachedTarget, false);
    assert(route.path.length > 0);
    assertEquals(route.path.at(-1), { x: 10, y: 5 });
});

Deno.test("snapToWalkable snaps to the island containing or nearest the point", () => {
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

    assertEquals(snapToWalkable({ x: 35, y: 5 }, [left, right]), { x: 35, y: 5 });
    assertEquals(snapToWalkable({ x: 22, y: 5 }, [left, right]), { x: 30, y: 5 });
});
