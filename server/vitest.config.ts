import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "threads",
    clearMocks: true,
    restoreMocks: true
  }
});
