import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
