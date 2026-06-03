/** @typedef {Object} Point
 * @property {number} x
 * @property {number} y */

/**
 * Lightweight 2D nav helpers for adventure-scene walking. The walkable region is
 * a simple polygon (possibly concave) — these helpers let characters route
 * around its interior instead of cutting through obstacles like the tree house.
 *
 *   - `pointInPolygon`         classic ray-cast inclusion test (boundary undefined)
 *   - `snapToPolygon`          project an outside click onto the nearest boundary
 *   - `findPath(start, end)`   visibility-graph + Dijkstra; returns waypoints
 *                              (excluding start, including end). Falls back to
 *                              `[end]` if no path can be found so callers still move.
 */

const NEAR_BOUNDARY_EPSILON = 0.5;

/**
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @param {Point} p
 * @param {Point[]} poly
 * @returns {boolean}
 */
export function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) &&
            (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Closest point on segment a-b to p.
 *
 * @param {Point} p
 * @param {Point} a
 * @param {Point} b
 * @returns {Point}
 */
export function projectPointOntoSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Snap p to the polygon: returns p unchanged if inside, otherwise the closest
 * point on the polygon boundary.
 *
 * @param {Point} p
 * @param {Point[]} polygon
 * @returns {Point}
 */
export function snapToPolygon(p, polygon) {
    if (pointInPolygon(p, polygon)) return p;
    /** @type {Point | null} */
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const proj = projectPointOntoSegment(p, a, b);
        const d = distance(p, proj);
        if (d < bestDist) {
            bestDist = d;
            best = proj;
        }
    }
    return best ?? p;
}

/**
 * @param {Point} p
 * @param {Point} q
 * @param {Point} r
 * @returns {number}
 */
function orient(p, q, r) {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

/**
 * Strict (proper) segment intersection: returns true only when ab and cd cross
 * in their interiors. Touches at endpoints / collinear overlaps return false so
 * polygon-edge-following segments are accepted by `segmentInsidePolygon`.
 *
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @param {Point} d
 * @returns {boolean}
 */
function segmentsCrossProperly(a, b, c, d) {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * True when p is inside the polygon OR within ~half a pixel of any edge.
 * Used by `segmentInsidePolygon` so segments running along a polygon edge are
 * accepted (their interior samples sit exactly on the boundary).
 *
 * @param {Point} p
 * @param {Point[]} polygon
 * @returns {boolean}
 */
function pointInOrNearPolygon(p, polygon) {
    if (pointInPolygon(p, polygon)) return true;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const proj = projectPointOntoSegment(p, a, b);
        if (distance(p, proj) < NEAR_BOUNDARY_EPSILON) return true;
    }
    return false;
}

/**
 * Whether the segment a-b stays inside the (possibly concave) polygon.
 * No proper crossings with any polygon edge AND every interior sample lies
 * inside or on the polygon boundary.
 *
 * @param {Point} a
 * @param {Point} b
 * @param {Point[]} polygon
 * @returns {boolean}
 */
function segmentInsidePolygon(a, b, polygon) {
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i];
        const q = polygon[(i + 1) % polygon.length];
        if (segmentsCrossProperly(a, b, p, q)) return false;
    }
    const samples = 12;
    for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        if (!pointInOrNearPolygon({ x: px, y: py }, polygon)) return false;
    }
    return true;
}

/**
 * Shortest path from start to end that stays inside the polygon.
 *
 * Builds a visibility graph over `[start, end, ...polygon_vertices]` and runs
 * Dijkstra. The returned list is the sequence of waypoints to walk through —
 * does NOT include `start` (the caller is already there) but DOES include
 * `end`. If pathfinding fails (start/end disconnected or outside polygon),
 * returns `[end]` so the caller still moves.
 *
 * @param {Point} start
 * @param {Point} end
 * @param {Point[]} polygon
 * @returns {Point[]}
 */
export function findPath(start, end, polygon) {
    // Trivial direct path.
    if (segmentInsidePolygon(start, end, polygon)) {
        return [end];
    }

    const nodes = [start, end, ...polygon];
    const N = nodes.length;
    /** @type {Array<Array<{ to: number, w: number }>>} */
    const adj = Array.from({ length: N }, () => /** @type {{ to: number, w: number }[]} */ ([]));
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            if (segmentInsidePolygon(nodes[i], nodes[j], polygon)) {
                const w = distance(nodes[i], nodes[j]);
                adj[i].push({ to: j, w });
                adj[j].push({ to: i, w });
            }
        }
    }

    // Dijkstra from node 0 (start) to node 1 (end). N is tiny so a linear
    // priority scan is faster than the bookkeeping of a heap.
    const dist = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(-1);
    const visited = new Array(N).fill(false);
    dist[0] = 0;
    for (let step = 0; step < N; step++) {
        let u = -1;
        let minD = Infinity;
        for (let i = 0; i < N; i++) {
            if (!visited[i] && dist[i] < minD) {
                minD = dist[i];
                u = i;
            }
        }
        if (u === -1 || u === 1) break;
        visited[u] = true;
        for (const { to, w } of adj[u]) {
            if (dist[u] + w < dist[to]) {
                dist[to] = dist[u] + w;
                prev[to] = u;
            }
        }
    }

    if (dist[1] === Infinity) {
        // Disconnected — bail to a direct move so the character still responds.
        return [end];
    }

    /** @type {Point[]} */
    const path = [];
    let cur = 1;
    while (cur !== 0 && cur !== -1) {
        path.unshift(nodes[cur]);
        cur = prev[cur];
    }
    return path;
}
