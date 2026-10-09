// SHA-256 of a day's packed bytes, generated here in Node (compare with public/dev/determinism.html).
import { createHash } from "node:crypto";
import { buildDay } from "../../public/js/gen/day.js";
import { packDay } from "../../public/js/shared/codec.js";
const date = process.argv[2] || "2026-10-12";
const t0 = performance.now();
const { header, streams } = await buildDay(date);
const bytes = packDay(header, streams);
console.log(JSON.stringify({ date, hash: createHash("sha256").update(bytes).digest("hex"), ms: Math.round(performance.now() - t0), bytes: bytes.length }));
