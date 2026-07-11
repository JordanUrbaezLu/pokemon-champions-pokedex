import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure battle/data logic (type chart, Lv50 math, threat
 * engine, formatters). Node environment — none of these touch the DOM. Run with
 * `npm test`. These are the regression net for the weekly data re-bake: the data
 * changes, the math and the classifiers must not.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
