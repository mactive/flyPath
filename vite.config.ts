import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/states/all": {
        target: "https://flight-viz.com",
        changeOrigin: true,
        secure: true
      },
      "/proxy": {
        target: "https://flight-viz-proxy.flight-viz.workers.dev",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/proxy/, "")
      }
    }
  }
});
