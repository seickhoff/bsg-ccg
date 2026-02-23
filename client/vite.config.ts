import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
