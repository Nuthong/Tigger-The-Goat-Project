import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api -> FastAPI so the SPA and API share an origin (cookies + no CORS pain).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
