import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    port: 5173,
    // Forward /api requests to the Express backend during local dev.
    // The frontend uses the relative VITE_API_URL=/api, so without this
    // proxy the browser hits the Vite dev server itself (404) and login
    // appears to fail even with valid credentials.
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET || "http://localhost:4444",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
