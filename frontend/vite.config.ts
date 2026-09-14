import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// The product is Chinese-only. Retain Chinese accessibility messages and the
// library's English fallback instead of shipping every translated control string.
// Uses the same import boundary as React Aria's optimize-locales plugin.
const unusedLocale = "\0btl-unused-control-locale";
export default defineConfig({
  // Layout overrides are CSS Modules, never conflicting Tailwind utilities.
  // The official lite entry avoids shipping a runtime class-conflict engine.
  resolve: {
    alias: [
      { find: /^tailwind-variants$/, replacement: "tailwind-variants/lite" },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "btl-control-locales",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          !importer ||
          !/[\\/]node_modules[\\/].*(?:react-aria|react-stately|react-spectrum)/.test(
            importer,
          )
        )
          return;
        const locale = source.match(
          /(?:^|\/)([a-z]{2}-[A-Z]{2})\.(?:m?js)$/,
        )?.[1];
        if (locale && !["zh-CN", "en-US"].includes(locale)) return unusedLocale;
      },
      load(id) {
        if (id === unusedLocale) return "export default {};";
      },
    },
  ],
  build: {
    minify: "terser",
    target: "es2022",
    terserOptions: {
      ecma: 2022,
      module: true,
      compress: { passes: 3 },
      format: { comments: false },
    },
  },
  server: {
    proxy: { "/api": process.env.VITE_API_PROXY || "http://127.0.0.1:8000" },
  },
});
