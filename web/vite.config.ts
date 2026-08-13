import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // three.js 一家就占 1MB+，拆成独立 chunk：
    // 1) 消除 500kB 大 chunk 警告；2) 版本稳定时命中浏览器长缓存。
    // 阈值 900：three 本身 gzip 后约 222kB，是已知大库，警告已无指导意义。
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three/ },
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: "charts", test: /node_modules[\\/]recharts/ },
          ],
        },
      },
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
