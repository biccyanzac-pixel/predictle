// Replace the bonus puzzle in existing day files with a freshly generated one, keeping the
// physics rounds byte-for-byte. Usage: node tools/gen/fix-aim.mjs DATE [DATE...]
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { readDayHeader, packDay } from "../../public/js/shared/codec.js";
import { bonusFor } from "../../public/js/gen/day.js";

for (const date of process.argv.slice(2)) {
  const url = new URL(`../../public/puzzles/${date}.prd`, import.meta.url);
  const bytes = new Uint8Array(gunzipSync(readFileSync(url)));
  const { header, dataStart } = readDayHeader(bytes);
  header.puzzles[2] = bonusFor(date);
  writeFileSync(url, gzipSync(packDay(header, [bytes.subarray(dataStart)]), { level: 9 }));
  console.log(date, "bonus regenerated");
}
