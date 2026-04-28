import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const entry = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
  ssr: {
    external: ["node:fs/promises", "node:path"]
  },
  build: {
    ssr: true,
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: entry,
      output: {
        entryFileNames: "index.js",
        format: "es"
      }
    }
  }
});
