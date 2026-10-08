import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { fileParallelism: false, exclude: [...configDefaults.exclude, "tests/browser/**"] },
});
