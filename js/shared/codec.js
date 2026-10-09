// Recording codec, shared by the Node generator (encode) and the browser (decode).
//
// A recording is the motion of every dynamic body, sampled at a fixed fps:
//   { fps, frameCount, bodies: [{ x: number[], y: number[], a: number[] }] }
// x, y in metres, a in radians (unwrapped, so it never jumps by 2*pi).
//
// Encoding: quantise to integers (1 mm, 1 mrad), take the second difference
// along time (smooth motion -> mostly 0, +-1), zigzag, then LEB128 varints.
// Bodies and channels are laid out one after another, so long runs of zeros
// (bodies at rest) sit together and gzip squeezes them to almost nothing.
// gzip itself is applied outside this module (zlib in Node,
// DecompressionStream in the browser).

export const POS_Q = 1000; // units per metre
export const ANG_Q = 1000; // units per radian
const MAGIC = 0x31445250; // "PRD1" little-endian

const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (n) => (n >>> 1) ^ -(n & 1);

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  varint(v) {
    this.ensure(5);
    while (v > 0x7f) { this.buf[this.len++] = (v & 0x7f) | 0x80; v >>>= 7; }
    this.buf[this.len++] = v;
  }
  bytes(b) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
  u32(v) { this.ensure(4); new DataView(this.buf.buffer).setUint32(this.len, v, true); this.len += 4; }
  done() { return this.buf.slice(0, this.len); }
}

function encodeChannel(w, values, q) {
  let p1 = 0, p2 = 0; // previous value, previous first difference
  for (let i = 0; i < values.length; i++) {
    const v = Math.round(values[i] * q);
    const d1 = v - p1;
    w.varint(zig(d1 - p2));
    p2 = d1; p1 = v;
  }
}

function decodeChannel(bytes, pos, n, q, out) {
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    let shift = 0, raw = 0, b;
    do { b = bytes[pos++]; raw |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const d1 = p2 + unzig(raw >>> 0);
    const v = p1 + d1;
    out[i] = v / q;
    p2 = d1; p1 = v;
  }
  return pos;
}

/** Recording -> bytes (not yet gzipped). */
export function encodeMotion(rec) {
  const w = new ByteWriter();
  for (const b of rec.bodies) {
    encodeChannel(w, b.x, POS_Q);
    encodeChannel(w, b.y, POS_Q);
    encodeChannel(w, b.a, ANG_Q);
  }
  return w.done();
}

/** bytes -> { bodies: [{ x: Float32Array, y, a }] }. Values are exactly the quantised ones. */
export function decodeMotion(bytes, bodyCount, frameCount) {
  let pos = 0;
  const bodies = [];
  for (let i = 0; i < bodyCount; i++) {
    const x = new Float64Array(frameCount), y = new Float64Array(frameCount), a = new Float64Array(frameCount);
    pos = decodeChannel(bytes, pos, frameCount, POS_Q, x);
    pos = decodeChannel(bytes, pos, frameCount, POS_Q, y);
    pos = decodeChannel(bytes, pos, frameCount, ANG_Q, a);
    bodies.push({ x, y, a });
  }
  if (pos !== bytes.length) throw new Error(`motion stream has ${bytes.length - pos} trailing bytes`);
  return { bodies };
}

/** Puzzle file = magic, JSON header length, JSON header (scene + metadata), motion bytes. */
export function packPuzzle(meta, motionBytes) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const w = new ByteWriter();
  w.u32(MAGIC);
  w.u32(json.length);
  w.bytes(json);
  w.bytes(motionBytes);
  return w.done();
}

export function unpackPuzzle(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a Predictle recording");
  const len = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len)));
  const motion = decodeMotion(bytes.subarray(8 + len), meta.bodies.length, meta.frameCount);
  return { meta, motion };
}

/** Body pose at fractional frame f, linearly interpolated (for display refresh rates above fps). */
export function poseAt(body, f) {
  const n = body.x.length - 1;
  if (f <= 0) return { x: body.x[0], y: body.y[0], a: body.a[0] };
  if (f >= n) return { x: body.x[n], y: body.y[n], a: body.a[n] };
  const i = Math.floor(f), t = f - i;
  return {
    x: body.x[i] + (body.x[i + 1] - body.x[i]) * t,
    y: body.y[i] + (body.y[i + 1] - body.y[i]) * t,
    a: body.a[i] + (body.a[i + 1] - body.a[i]) * t,
  };
}

// ---------------------------------------------------------------- day files
// A day file holds several puzzles, each with one or more recordings (a "place"
// puzzle has one per choice). Layout: magic "PRD2", JSON header length, JSON
// header, then every recording's motion bytes back to back, in header order.
// header.puzzles[i].recordings[j] = { frameCount, keyFrame, length } (length in bytes).
const MAGIC_DAY = 0x32445250; // "PRD2"

export function packDay(header, streams) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const w = new ByteWriter();
  w.u32(MAGIC_DAY);
  w.u32(json.length);
  w.bytes(json);
  for (const s of streams) w.bytes(s);
  return w.done();
}

/** Header only (cheap): what the leaderboard needs to score guesses. */
export function readDayHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC_DAY) throw new Error("not a Predictle day file");
  const len = dv.getUint32(4, true);
  return { header: JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))), dataStart: 8 + len };
}

/** Header + decoded motion: motions[puzzle][recording] = { bodies }. */
export function unpackDay(bytes) {
  const { header, dataStart } = readDayHeader(bytes);
  let pos = dataStart;
  const motions = header.puzzles.map((p) => p.recordings.map((r) => {
    const m = decodeMotion(bytes.subarray(pos, pos + r.length), p.bodies.length, r.frameCount);
    pos += r.length;
    return m;
  }));
  if (pos !== bytes.length) throw new Error("day file has trailing bytes");
  return { header, motions };
}
