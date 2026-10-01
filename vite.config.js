import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        markets: resolve(root, "index.html"),
        create: resolve(root, "create.html"),
        owner: resolve(root, "owner.html"),
      },
    },
  },
});