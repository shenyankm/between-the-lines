import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // HeroUI composes BEM classes and our CSS Modules; no conflicting utility classes.
  resolve: {
    alias: [
      {
        find: /^tailwind-variants$/,
        replacement: fileURLToPath(
          import.meta.resolve("tailwind-variants/lite"),
        ),
      },
    ],
  },
  build: { minify: "terser", terserOptions: { compress: { passes: 2 } } },
  server: {
    proxy: { "/api": process.env.VITE_API_PROXY || "http://127.0.0.1:8000" },
  },
});
