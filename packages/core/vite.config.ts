import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const entry = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry,
      formats: ["es"],
      fileName: "index"
    }
  }
});
