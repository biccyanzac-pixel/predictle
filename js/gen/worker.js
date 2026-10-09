// Web Worker: builds a day in the browser when it has no pre-generated file.
// Same code as the Node tool, deterministic maths, so the result is identical.
import { buildDay } from "./day.js";

self.onmessage = async ({ data: { date } }) => {
  try {
    const { header, streams } = await buildDay(date, { onProgress: (round, attempt) => self.postMessage({ progress: { round, attempt } }) });
    self.postMessage({ header, streams }, streams.map((s) => s.buffer));
  } catch (e) {
    self.postMessage({ error: String(e?.message ?? e) });
  }
};
