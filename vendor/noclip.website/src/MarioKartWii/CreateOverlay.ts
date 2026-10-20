// Create mode overlay (local addition for the MKW track editor).
//
// Draws the editor's "design" layer -- spline centre lines, control-point handles, translucent
// fills, labels -- inside the noclip scene through `DebugDraw`, so it is composited with the
// course instead of floating above it as DOM.
//
// Everything that has to look crisp is drawn in *screen space*: a line is a quad strip whose width
// is exactly N pixels, a point is a disc whose radius is exactly N pixels, and a dash is exactly M
// pixels long, whatever the camera distance or projection. Edges are feathered by half a pixel
// with per-vertex alpha, which is what keeps them clean without relying on FXAA. The only
// world-space draws are the translucent fills (they are real geometry) and lines that opt out of
// `onTop` (they need the depth test).
//
// The data types mirror `CreateOverlay*` in `src/lib/create/types.ts` structurally; a vendored
// file must not import from `src/`, so they are redeclared here.

import { ReadonlyMat4 } from 'gl-matrix';
import { colorNewFromRGBA } from '../Color.js';
import { DebugDraw, DebugDrawFlags } from '../gfx/helpers/DebugDraw.js';
import type { GfxDevice } from '../gfx/platform/GfxPlatform.js';

export type CreateOverlayColor = [number, number, number, number];
export interface CreateOverlayVec3 { x: number; y: number; z: number }

export interface CreateOverlayPointData {
    id: string;
    position: CreateOverlayVec3;
    color: CreateOverlayColor;
    /** Screen-space radius in CSS pixels. */
    radius: number;
    pickable: boolean;
    ring?: boolean;
    label?: string;
}

export interface CreateOverlayLineData {
    points: CreateOverlayVec3[];
    color: CreateOverlayColor;
    closed?: boolean;
    dashed?: boolean;
    /** Default true: ignore the depth buffer. */
    onTop?: boolean;
}

export interface CreateOverlayTrianglesData {
    positions: Float32Array;
    color: CreateOverlayColor;
}

export interface CreateOverlayLabelData {
    position: CreateOverlayVec3;
    text: string;
}

export interface CreateOverlayData {
    points: CreateOverlayPointData[];
    lines: CreateOverlayLineData[];
    triangles: CreateOverlayTrianglesData[];
    labels: CreateOverlayLabelData[];
}

export interface CreateOverlayFrame {
    /** Scene-space clip-from-world matrix of the camera that renders this frame. */
    clipFromWorld: ReadonlyMat4;
    /** Backbuffer size in device pixels. */
    width: number;
    height: number;
    /** Device pixels per CSS pixel. All sizes below are CSS pixels multiplied by this. */
    pixelRatio: number;
    /** Game units to scene units (the scene draws everything at 0.1). */
    worldScale: number;
    device: GfxDevice;
}

export interface CreateOverlayStats {
    points: number;
    lines: number;
    triangles: number;
    labels: number;
    /** Items that actually produced geometry this frame (not culled). */
    drawnPoints: number;
    drawnLines: number;
    drawnDashes: number;
    drawnLabels: number;
    /** Vertices pushed to DebugDraw this frame, world + screen space. */
    vertices: number;
}

/** Stroke widths and dash pattern, CSS pixels. */
export const CREATE_LINE_WIDTH = 2;
export const CREATE_DASH_ON = 9;
export const CREATE_DASH_OFF = 6;
const FEATHER = 0.5;
const NEAR_W = 1e-4;
const STRIDE = 7;
const CULL_MARGIN = 64;
const LABEL_FONT_SIZE = 12;

/** Growable vertex staging buffer (x, y, z, r, g, b, a per vertex). */
export class VertexBatch {
    public data = new Float32Array(STRIDE * 3 * 512);
    public count = 0;

    public clear(): void {
        this.count = 0;
    }

    private reserve(extra: number): void {
        const needed = (this.count + extra) * STRIDE;
        if (needed <= this.data.length)
            return;
        let size = this.data.length;
        while (size < needed)
            size *= 2;
        const next = new Float32Array(size);
        next.set(this.data.subarray(0, this.count * STRIDE));
        this.data = next;
    }

    public vertex(x: number, y: number, z: number, r: number, g: number, b: number, a: number): void {
        this.reserve(1);
        const o = this.count * STRIDE;
        const d = this.data;
        d[o] = x; d[o + 1] = y; d[o + 2] = z;
        d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
        this.count++;
    }

    /** A triangle with an explicit alpha per corner (colour shared). */
    public tri(
        x0: number, y0: number, a0: number,
        x1: number, y1: number, a1: number,
        x2: number, y2: number, a2: number,
        c: CreateOverlayColor, alphaScale: number,
    ): void {
        this.vertex(x0, y0, 0, c[0], c[1], c[2], a0 * alphaScale);
        this.vertex(x1, y1, 0, c[0], c[1], c[2], a1 * alphaScale);
        this.vertex(x2, y2, 0, c[0], c[1], c[2], a2 * alphaScale);
    }

    public quad(
        x0: number, y0: number, a0: number,
        x1: number, y1: number, a1: number,
        x2: number, y2: number, a2: number,
        x3: number, y3: number, a3: number,
        c: CreateOverlayColor, alphaScale: number,
    ): void {
        this.tri(x0, y0, a0, x1, y1, a1, x2, y2, a2, c, alphaScale);
        this.tri(x0, y0, a0, x2, y2, a2, x3, y3, a3, c, alphaScale);
    }
}

// ---------------------------------------------------------------------------------------------
// Pure geometry helpers (unit tested in CreateOverlay.test.ts)
// ---------------------------------------------------------------------------------------------

/** A screen-space polyline (device pixels) produced by near-plane clipping a world polyline. */
export interface ScreenRun {
    /** x, y pairs. */
    points: number[];
    /** True when the run is the whole closed polyline, wrap-around join included. */
    closed: boolean;
}

/** Clip-space position of a game-unit point. Returns w. */
export function projectToClip(out: Float64Array | number[], m: ReadonlyMat4, x: number, y: number, z: number, worldScale: number): number {
    const X = x * worldScale, Y = y * worldScale, Z = z * worldScale;
    out[0] = m[0] * X + m[4] * Y + m[8] * Z + m[12];
    out[1] = m[1] * X + m[5] * Y + m[9] * Z + m[13];
    out[2] = m[2] * X + m[6] * Y + m[10] * Z + m[14];
    out[3] = m[3] * X + m[7] * Y + m[11] * Z + m[15];
    return out[3];
}

/**
 * Projects a polyline to device pixels, clipping it against the camera's near plane (`w > 0`).
 * The result is one run per contiguous in-front stretch. A closed polyline that is entirely in
 * front comes back as a single run flagged `closed`.
 */
export function projectPolylineToScreen(
    pts: ReadonlyArray<CreateOverlayVec3>,
    closed: boolean,
    m: ReadonlyMat4,
    width: number,
    height: number,
    worldScale: number,
): ScreenRun[] {
    const runs: ScreenRun[] = [];
    const n = pts.length;
    if (n === 0)
        return runs;
    const clip = new Float64Array(4 * n);
    const tmp = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
        projectToClip(tmp, m, pts[i].x, pts[i].y, pts[i].z, worldScale);
        clip[i * 4] = tmp[0]; clip[i * 4 + 1] = tmp[1]; clip[i * 4 + 2] = tmp[2]; clip[i * 4 + 3] = tmp[3];
    }
    const toX = (cx: number, cw: number) => (cx / cw * 0.5 + 0.5) * width;
    const toY = (cy: number, cw: number) => (0.5 - cy / cw * 0.5) * height;

    const allInFront = (() => {
        for (let i = 0; i < n; i++)
            if (!(clip[i * 4 + 3] > NEAR_W))
                return false;
        return true;
    })();
    if (n === 1) {
        if (allInFront)
            runs.push({ points: [toX(clip[0], clip[3]), toY(clip[1], clip[3])], closed: false });
        return runs;
    }
    if (closed && allInFront && n >= 3) {
        const points: number[] = [];
        for (let i = 0; i < n; i++)
            points.push(toX(clip[i * 4], clip[i * 4 + 3]), toY(clip[i * 4 + 1], clip[i * 4 + 3]));
        runs.push({ points, closed: true });
        return runs;
    }

    let current: number[] | null = null;
    const flush = () => {
        if (current !== null && current.length >= 4)
            runs.push({ points: current, closed: false });
        current = null;
    };
    const segmentCount = closed ? n : n - 1;
    for (let i = 0; i < segmentCount; i++) {
        const a = i * 4;
        const b = ((i + 1) % n) * 4;
        const wa = clip[a + 3], wb = clip[b + 3];
        const aIn = wa > NEAR_W, bIn = wb > NEAR_W;
        if (!aIn && !bIn) {
            flush();
            continue;
        }
        let ax = clip[a], ay = clip[a + 1], aw = wa;
        let bx = clip[b], by = clip[b + 1], bw = wb;
        if (!aIn) {
            const t = (NEAR_W - wa) / (wb - wa);
            ax = clip[a] + (clip[b] - clip[a]) * t;
            ay = clip[a + 1] + (clip[b + 1] - clip[a + 1]) * t;
            aw = NEAR_W;
        } else if (!bIn) {
            const t = (NEAR_W - wa) / (wb - wa);
            bx = clip[a] + (clip[b] - clip[a]) * t;
            by = clip[a + 1] + (clip[b + 1] - clip[a + 1]) * t;
            bw = NEAR_W;
        }
        if (current === null) {
            current = [toX(ax, aw), toY(ay, aw)];
        } else if (!aIn) {
            // Re-entering after a gap is handled by the `current === null` branch above, so an
            // out-of-front start inside an open run cannot happen; keep the run continuous anyway.
            current.push(toX(ax, aw), toY(ay, aw));
        }
        current.push(toX(bx, bw), toY(by, bw));
        if (!bIn)
            flush();
    }
    flush();
    return runs;
}

export interface DashPiece {
    /** x, y pairs of one dash, possibly spanning several polyline vertices. */
    points: number[];
}

/**
 * Splits a screen polyline into dashes of `on` pixels separated by `off` pixels. The pattern is
 * anchored at the start of the polyline, so the dashes of a spline stay put while the camera
 * moves along it. Only the part inside the (margin-expanded) screen rectangle is emitted, but the
 * pattern distance is accumulated over the whole polyline, so a very long off-screen stretch costs
 * nothing and does not shift the phase.
 */
export function dashPolyline(
    run: ScreenRun,
    on: number,
    off: number,
    width: number,
    height: number,
    margin: number,
): DashPiece[] {
    const out: DashPiece[] = [];
    const pts = run.points;
    const count = pts.length / 2;
    if (count < 2)
        return out;
    const period = on + off;
    const segmentCount = run.closed ? count : count - 1;
    let distance = 0;
    let open: number[] | null = null;
    const closeOpen = () => {
        if (open !== null && open.length >= 4)
            out.push({ points: open });
        open = null;
    };
    const minX = -margin, minY = -margin, maxX = width + margin, maxY = height + margin;

    for (let s = 0; s < segmentCount; s++) {
        const x0 = pts[s * 2], y0 = pts[s * 2 + 1];
        const nextIndex = (s + 1) % count;
        const x1 = pts[nextIndex * 2], y1 = pts[nextIndex * 2 + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const length = Math.hypot(dx, dy);
        if (!(length > 1e-6))
            continue;

        // Liang-Barsky against the expanded rectangle: [t0, t1] is the visible part.
        let t0 = 0, t1 = 1;
        const clipEdge = (p: number, q: number): boolean => {
            if (p === 0)
                return q >= 0;
            const r = q / p;
            if (p < 0) {
                if (r > t1) return false;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return false;
                if (r < t1) t1 = r;
            }
            return true;
        };
        const visible = clipEdge(-dx, x0 - minX) && clipEdge(dx, maxX - x0) && clipEdge(-dy, y0 - minY) && clipEdge(dy, maxY - y0);
        if (!visible || t1 <= t0) {
            closeOpen();
            distance += length;
            continue;
        }

        let along = t0 * length;
        const end = t1 * length;
        if (along > 1e-9)
            closeOpen();
        while (along < end - 1e-9) {
            const position = distance + along;
            const phase = position - Math.floor(position / period) * period;
            if (phase < on - 1e-6) {
                const remain = on - phase;
                const step = Math.min(end - along, remain);
                const startT = along / length;
                const endT = (along + step) / length;
                if (open === null)
                    open = [x0 + dx * startT, y0 + dy * startT];
                open.push(x0 + dx * endT, y0 + dy * endT);
                along += step;
                // The dash only ends when the pattern says so, not where the segment happens to end.
                if (step >= remain - 1e-9)
                    closeOpen();
            } else {
                closeOpen();
                along += Math.min(end - along, period - phase);
            }
        }
        if (t1 < 1)
            closeOpen();
        distance += length;
    }
    closeOpen();
    return out;
}

// ---------------------------------------------------------------------------------------------
// Rasterising helpers: strokes, discs and rings as feathered triangle strips
// ---------------------------------------------------------------------------------------------

/**
 * Appends a stroked polyline to `batch`: `width` device pixels wide with miter joins (limited),
 * feathered by `FEATHER` pixels on each side. Joins are shared between segments, so a translucent
 * stroke never double-covers a corner.
 */
export function strokePolyline(batch: VertexBatch, pts: ReadonlyArray<number>, closed: boolean, width: number, color: CreateOverlayColor, alphaScale: number): void {
    const n = pts.length / 2;
    if (n < 2)
        return;
    const half = width * 0.5;
    const inner = Math.max(half - FEATHER, 0);
    const outer = half + FEATHER;
    const segments = closed ? n : n - 1;

    // Per-segment unit normals.
    const nx = new Float64Array(segments);
    const ny = new Float64Array(segments);
    for (let s = 0; s < segments; s++) {
        const a = s, b = (s + 1) % n;
        const dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1];
        const len = Math.hypot(dx, dy) || 1;
        nx[s] = -dy / len;
        ny[s] = dx / len;
    }

    // Four rails per point: outer-left, inner-left, inner-right, outer-right.
    const rail = new Float64Array(n * 8);
    for (let i = 0; i < n; i++) {
        let mx: number, my: number, scale = 1;
        const prev = i === 0 ? (closed ? segments - 1 : -1) : i - 1;
        const next = i === n - 1 ? (closed ? 0 : -1) : i;
        if (prev >= 0 && next >= 0) {
            const sx = nx[prev] + nx[next], sy = ny[prev] + ny[next];
            const sl = Math.hypot(sx, sy);
            if (sl < 1e-6) {
                mx = nx[next]; my = ny[next];
            } else {
                mx = sx / sl; my = sy / sl;
                const d = mx * nx[next] + my * ny[next];
                scale = Math.min(1 / Math.max(d, 1e-3), 2.5);
            }
        } else {
            const s = prev >= 0 ? prev : next;
            mx = nx[s]; my = ny[s];
        }
        const cx = pts[i * 2], cy = pts[i * 2 + 1];
        rail[i * 8 + 0] = cx - mx * outer * scale; rail[i * 8 + 1] = cy - my * outer * scale;
        rail[i * 8 + 2] = cx - mx * inner * scale; rail[i * 8 + 3] = cy - my * inner * scale;
        rail[i * 8 + 4] = cx + mx * inner * scale; rail[i * 8 + 5] = cy + my * inner * scale;
        rail[i * 8 + 6] = cx + mx * outer * scale; rail[i * 8 + 7] = cy + my * outer * scale;
    }
    const alphaForRail = [0, 1, 1, 0];
    for (let s = 0; s < segments; s++) {
        const a = s * 8, b = ((s + 1) % n) * 8;
        for (let r = 0; r < 3; r++) {
            batch.quad(
                rail[a + r * 2], rail[a + r * 2 + 1], alphaForRail[r],
                rail[a + r * 2 + 2], rail[a + r * 2 + 3], alphaForRail[r + 1],
                rail[b + r * 2 + 2], rail[b + r * 2 + 3], alphaForRail[r + 1],
                rail[b + r * 2], rail[b + r * 2 + 1], alphaForRail[r],
                color, alphaScale,
            );
        }
    }
}

function discSides(radius: number): number {
    return Math.max(16, Math.min(56, Math.round(radius * 2.2)));
}

/** A filled disc with a feathered rim. */
export function fillDisc(batch: VertexBatch, cx: number, cy: number, radius: number, color: CreateOverlayColor, alphaScale: number): void {
    const sides = discSides(radius);
    const inner = Math.max(radius - FEATHER, 0);
    const outer = radius + FEATHER;
    for (let i = 0; i < sides; i++) {
        const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        batch.tri(cx, cy, 1, cx + c0 * inner, cy + s0 * inner, 1, cx + c1 * inner, cy + s1 * inner, 1, color, alphaScale);
        batch.quad(
            cx + c0 * inner, cy + s0 * inner, 1,
            cx + c0 * outer, cy + s0 * outer, 0,
            cx + c1 * outer, cy + s1 * outer, 0,
            cx + c1 * inner, cy + s1 * inner, 1,
            color, alphaScale,
        );
    }
}

/** A ring centred on `radius`, `width` device pixels thick, feathered on both edges. */
export function strokeRing(batch: VertexBatch, cx: number, cy: number, radius: number, width: number, color: CreateOverlayColor, alphaScale: number): void {
    const sides = discSides(radius);
    const half = width * 0.5;
    const r0 = Math.max(radius - half - FEATHER, 0), r1 = Math.max(radius - half + FEATHER, 0);
    const r2 = radius + half - FEATHER, r3 = radius + half + FEATHER;
    for (let i = 0; i < sides; i++) {
        const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        const radii = [r0, r1, r2, r3];
        const alphas = [0, 1, 1, 0];
        for (let r = 0; r < 3; r++) {
            batch.quad(
                cx + c0 * radii[r], cy + s0 * radii[r], alphas[r],
                cx + c0 * radii[r + 1], cy + s0 * radii[r + 1], alphas[r + 1],
                cx + c1 * radii[r + 1], cy + s1 * radii[r + 1], alphas[r + 1],
                cx + c1 * radii[r], cy + s1 * radii[r], alphas[r],
                color, alphaScale,
            );
        }
    }
}

/** A filled rounded rectangle with a feathered edge. */
export function fillRoundedRect(batch: VertexBatch, x: number, y: number, w: number, h: number, radius: number, color: CreateOverlayColor, alphaScale: number): void {
    const r = Math.min(radius, w * 0.5, h * 0.5);
    const arc = 5;
    const outline: number[] = [];
    const corners: [number, number, number][] = [
        [x + w - r, y + r, -Math.PI / 2],
        [x + w - r, y + h - r, 0],
        [x + r, y + h - r, Math.PI / 2],
        [x + r, y + r, Math.PI],
    ];
    for (const [cx, cy, start] of corners)
        for (let i = 0; i <= arc; i++) {
            const t = start + (i / arc) * (Math.PI / 2);
            outline.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
        }
    const n = outline.length / 2;
    const centerX = x + w * 0.5, centerY = y + h * 0.5;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = outline[i * 2], ay = outline[i * 2 + 1], bx = outline[j * 2], by = outline[j * 2 + 1];
        // Outward direction of the two outline points (rounded rect is convex: radial from centre).
        const aLen = Math.hypot(ax - centerX, ay - centerY) || 1, bLen = Math.hypot(bx - centerX, by - centerY) || 1;
        const aox = (ax - centerX) / aLen, aoy = (ay - centerY) / aLen, box = (bx - centerX) / bLen, boy = (by - centerY) / bLen;
        batch.tri(centerX, centerY, 1, ax - aox * FEATHER, ay - aoy * FEATHER, 1, bx - box * FEATHER, by - boy * FEATHER, 1, color, alphaScale);
        batch.quad(
            ax - aox * FEATHER, ay - aoy * FEATHER, 1,
            ax + aox * FEATHER, ay + aoy * FEATHER, 0,
            bx + box * FEATHER, by + boy * FEATHER, 0,
            bx - box * FEATHER, by - boy * FEATHER, 1,
            color, alphaScale,
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------------------------

const screenFlags = DebugDrawFlags.ScreenSpace | DebugDrawFlags.NoDepthTest;
const worldAlwaysFlags = DebugDrawFlags.NoDepthTest;
const worldDepthFlags = 0 as DebugDrawFlags;
const textOutlineColor = colorNewFromRGBA(1, 1, 1, 1);
const haloColor: CreateOverlayColor = [0, 0, 0, 0.55];
const pillColor: CreateOverlayColor = [0.04, 0.05, 0.08, 0.62];

export class CreateOverlayRenderer {
    private data: CreateOverlayData | null = null;
    private screen = new VertexBatch();
    private world = new VertexBatch();
    private stats: CreateOverlayStats = emptyStats();
    private clipScratch = [0, 0, 0, 0];

    public setData(data: CreateOverlayData | null): void {
        this.data = data;
    }

    public getData(): CreateOverlayData | null {
        return this.data;
    }

    public getStats(): CreateOverlayStats {
        return { ...this.stats };
    }

    public draw(debugDraw: DebugDraw, frame: CreateOverlayFrame): void {
        const data = this.data;
        const stats = emptyStats();
        this.stats = stats;
        if (data === null)
            return;
        stats.points = data.points.length;
        stats.lines = data.lines.length;
        stats.triangles = data.triangles.reduce((sum, t) => sum + Math.floor(t.positions.length / 9), 0);
        stats.labels = data.labels.length;

        const ratio = frame.pixelRatio;
        this.world.clear();
        this.screen.clear();

        // 1. Translucent fills: real geometry, drawn first so the lines and handles sit on top.
        for (const group of data.triangles)
            this.addWorldTriangles(group, frame);
        if (this.world.count > 0) {
            debugDraw.drawTrianglesPC(this.world.data, this.world.count, { flags: worldAlwaysFlags });
            stats.vertices += this.world.count;
        }

        // 2. Lines.
        const textJobs: TextJob[] = [];
        for (const line of data.lines) {
            if ((line.onTop ?? true) === false)
                this.drawDepthTestedLine(debugDraw, line, frame, stats);
            else
                this.addScreenLine(line, frame, stats);
        }

        // 3. Handles.
        for (const point of data.points)
            this.addScreenPoint(point, frame, stats, textJobs);

        // 4. Free labels.
        for (const label of data.labels) {
            const w = projectToClip(this.clipScratch, frame.clipFromWorld, label.position.x, label.position.y, label.position.z, frame.worldScale);
            if (!(w > NEAR_W))
                continue;
            const x = (this.clipScratch[0] / w * 0.5 + 0.5) * frame.width;
            const y = (0.5 - this.clipScratch[1] / w * 0.5) * frame.height;
            if (x < -200 || y < -100 || x > frame.width + 200 || y > frame.height + 100)
                continue;
            textJobs.push({ text: label.text, x, y: y - 14 * ratio, align: 'center' });
        }

        // Label backgrounds go into the same batch, before the glyphs.
        const fontSize = Math.max(8, Math.round(LABEL_FONT_SIZE * ratio));
        const textOptions = { flags: screenFlags, fontSize, textAlign: 'left' as const };
        const placed: { text: string; x: number; y: number }[] = [];
        for (const job of textJobs) {
            if (job.text.length === 0)
                continue;
            const size = debugDraw.measureText(job.text, textOptions);
            const padX = 5 * ratio, padY = 2 * ratio;
            const left = job.align === 'center' ? job.x - size.width * 0.5 : job.x;
            const top = job.y - size.height * 0.5;
            fillRoundedRect(this.screen, left - padX, top - padY, size.width + padX * 2, size.height + padY * 2, 4 * ratio, pillColor, 1);
            placed.push({ text: job.text, x: left, y: top });
            stats.drawnLabels++;
        }

        if (this.screen.count > 0) {
            debugDraw.drawTrianglesPC(this.screen.data, this.screen.count, { flags: screenFlags });
            stats.vertices += this.screen.count;
        }
        for (const item of placed)
            debugDraw.drawScreenText(item.text, item.x, item.y, textOutlineColor, textOptions);
    }

    private addWorldTriangles(group: CreateOverlayTrianglesData, frame: CreateOverlayFrame): void {
        const p = group.positions;
        const s = frame.worldScale;
        const [r, g, b, a] = group.color;
        const count = Math.floor(p.length / 9) * 3;
        for (let i = 0; i < count; i++)
            this.world.vertex(p[i * 3] * s, p[i * 3 + 1] * s, p[i * 3 + 2] * s, r, g, b, a);
    }

    private addScreenLine(line: CreateOverlayLineData, frame: CreateOverlayFrame, stats: CreateOverlayStats): void {
        if (line.points.length < 2)
            return;
        const runs = projectPolylineToScreen(line.points, line.closed === true, frame.clipFromWorld, frame.width, frame.height, frame.worldScale);
        if (runs.length === 0)
            return;
        stats.drawnLines++;
        const width = CREATE_LINE_WIDTH * frame.pixelRatio;
        const alpha = line.color[3];
        const color: CreateOverlayColor = [line.color[0], line.color[1], line.color[2], 1];
        for (const run of runs) {
            if (line.dashed === true) {
                const pieces = dashPolyline(run, CREATE_DASH_ON * frame.pixelRatio, CREATE_DASH_OFF * frame.pixelRatio, frame.width, frame.height, CULL_MARGIN);
                for (const piece of pieces) {
                    strokePolyline(this.screen, piece.points, false, width, color, alpha);
                    stats.drawnDashes++;
                }
            } else {
                strokePolyline(this.screen, run.points, run.closed, width, color, alpha);
            }
        }
    }

    /** Lines that opt out of `onTop` need the depth test, so they stay world-space `DebugDraw` lines. */
    private drawDepthTestedLine(debugDraw: DebugDraw, line: CreateOverlayLineData, frame: CreateOverlayFrame, stats: CreateOverlayStats): void {
        const points = line.points;
        if (points.length < 2)
            return;
        const color = colorNewFromRGBA(line.color[0], line.color[1], line.color[2], line.color[3]);
        const s = frame.worldScale;
        const a = [0, 0, 0], b = [0, 0, 0];
        const segments = line.closed === true ? points.length : points.length - 1;
        stats.drawnLines++;
        for (let i = 0; i < segments; i++) {
            const p = points[i], q = points[(i + 1) % points.length];
            a[0] = p.x * s; a[1] = p.y * s; a[2] = p.z * s;
            b[0] = q.x * s; b[1] = q.y * s; b[2] = q.z * s;
            if (line.dashed !== true) {
                debugDraw.drawLine(a as unknown as Float32Array, b as unknown as Float32Array, color, color, { flags: worldDepthFlags });
                continue;
            }
            // Dashes in world units sized for the segment's own distance, so they read ~9 px long.
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
            const w = projectToClip(this.clipScratch, frame.clipFromWorld, mid[0] / s, mid[1] / s, mid[2] / s, s);
            if (!(w > NEAR_W))
                continue;
            const m = frame.clipFromWorld;
            const worldPerPixel = (2 * w / Math.max(Math.abs(m[0]), 1e-9)) / Math.max(frame.width, 1);
            const on = CREATE_DASH_ON * frame.pixelRatio * worldPerPixel, off = CREATE_DASH_OFF * frame.pixelRatio * worldPerPixel;
            const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            if (!(length > 1e-9) || !(on > 0))
                continue;
            const period = on + off;
            const maxDashes = 400;
            let count = 0;
            for (let d = 0; d < length && count < maxDashes; d += period, count++) {
                const t0 = d / length, t1 = Math.min(length, d + on) / length;
                const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
                const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
                debugDraw.drawLine(p0 as unknown as Float32Array, p1 as unknown as Float32Array, color, color, { flags: worldDepthFlags });
                stats.drawnDashes++;
            }
        }
    }

    private addScreenPoint(point: CreateOverlayPointData, frame: CreateOverlayFrame, stats: CreateOverlayStats, text: TextJob[]): void {
        const w = projectToClip(this.clipScratch, frame.clipFromWorld, point.position.x, point.position.y, point.position.z, frame.worldScale);
        if (!(w > NEAR_W))
            return;
        const x = (this.clipScratch[0] / w * 0.5 + 0.5) * frame.width;
        const y = (0.5 - this.clipScratch[1] / w * 0.5) * frame.height;
        const r = Math.max(1, point.radius) * frame.pixelRatio;
        const margin = r + 80 * frame.pixelRatio;
        if (x < -margin || y < -margin || x > frame.width + margin || y > frame.height + margin)
            return;
        stats.drawnPoints++;
        const alpha = point.color[3];
        const color: CreateOverlayColor = [point.color[0], point.color[1], point.color[2], 1];
        // A dark halo keeps white dots readable on snow and dark dots readable on asphalt.
        fillDisc(this.screen, x, y, r + 1.25 * frame.pixelRatio, haloColor, alpha);
        fillDisc(this.screen, x, y, r, color, alpha);
        let reach = r;
        if (point.ring === true) {
            const ringRadius = r + 4.5 * frame.pixelRatio;
            strokeRing(this.screen, x, y, ringRadius, 3.5 * frame.pixelRatio, haloColor, alpha);
            strokeRing(this.screen, x, y, ringRadius, 2 * frame.pixelRatio, color, alpha);
            reach = ringRadius + 1.75 * frame.pixelRatio;
        }
        if (point.label !== undefined && point.label.length > 0)
            text.push({ text: point.label, x: x + reach + 8 * frame.pixelRatio, y, align: 'left' });
    }
}

interface TextJob {
    text: string;
    x: number;
    y: number;
    align: 'left' | 'center';
}

function emptyStats(): CreateOverlayStats {
    return { points: 0, lines: 0, triangles: 0, labels: 0, drawnPoints: 0, drawnLines: 0, drawnDashes: 0, drawnLabels: 0, vertices: 0 };
}
