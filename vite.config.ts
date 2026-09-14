import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    // The pricing core is the only thing on the critical path; everything else
    // (the SDK, the worker) is split so first paint does not wait for it.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("genlayer-js")) return "sdk";
        },
      },
    },
  },
  worker: {
    format: "es",
  },
});
