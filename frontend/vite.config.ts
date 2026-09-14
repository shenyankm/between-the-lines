import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "image-manifest-runtime",
      enforce: "pre",
      transform(source, id) {
        if (!id.endsWith("/src/assets.json")) return;
        // Byte counts are build verification metadata, not browser data.
        const assets = JSON.parse(source) as Record<
          string,
          { width: number; src: string; bytes: number }[]
        >;
        return {
          code: JSON.stringify(
            Object.fromEntries(
              Object.entries(assets).map(([key, variants]) => [
                key,
                variants.map(({ width, src }) => ({ width, src })),
              ]),
            ),
          ),
          map: null,
        };
      },
    },
  ],
  // File and local names stay unique within this app without shipping line-number suffixes.
  css: { modules: { generateScopedName: "[name]_[local]_" } },
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
  build: {
    minify: "terser",
    terserOptions: {
      compress: { passes: 4 },
      format: { comments: false },
    },
  },
  server: {
    proxy: { "/api": process.env.VITE_API_PROXY || "http://127.0.0.1:8000" },
  },
});
