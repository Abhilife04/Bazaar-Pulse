import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // during local dev, run `netlify dev` instead for functions;
      // this proxy is a fallback if you run functions separately on :9999
      "/api": {
        target: "http://localhost:9999/.netlify/functions",
        rewrite: (p) => p.replace(/^\/api/, ""),
        changeOrigin: true,
      },
    },
  },
});
