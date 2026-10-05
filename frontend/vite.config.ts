/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const api = process.env.AEROPULSE_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/docs": { target: api, changeOrigin: true },
      "/openapi.json": { target: api, changeOrigin: true },
      "/ws": { target: api.replace("http", "ws"), ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
