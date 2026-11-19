import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure battle/data logic (type chart, Lv50 math, threat
 * engine, formatters). Node environment — none of these touch the DOM. Run with
 * `npm test`. These are the regression net for the weekly data re-bake: the data
 * changes, the math and the classifiers must not.
 *
 * `@/` mirrors tsconfig's `paths` so a test can import the modules that use it
 * (pokedex.ts → calc-data.ts): the calc index is the app's real data path into
 * the damage engine, and Mega weights went wrong THERE, not in the engine.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
