import { registerHooks } from "node:module";
import {
  repairVitestTaskUpdates,
  repairVitestVmTaskUpdates,
} from "./vitest-progress.mjs";

// This preload is added only to Vitest workers. Chaining nextLoad preserves
// project loaders; the repair changes matching runner code in memory only.
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (loaded.format !== "module" || loaded.source == null) return loaded;
    const source =
      typeof loaded.source === "string"
        ? loaded.source
        : Buffer.from(loaded.source).toString("utf8");
    const repaired = repairVitestVmTaskUpdates(
      url,
      repairVitestTaskUpdates(url, source),
    );
    return repaired === source ? loaded : { ...loaded, source: repaired };
  },
});
