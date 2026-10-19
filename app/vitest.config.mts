import { defineConfig } from "vitest/config";

// Unit tests run in Node. Code under test must not import react-native or
// expo modules; the platform glue that does is covered by the typecheck, the
// web run in e2e/ and the Android build.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
