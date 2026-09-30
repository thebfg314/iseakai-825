import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  plugins: [
    {
      name: "asset-stub",
      enforce: "pre",
      load(id) {
        if (/\.(png|jpe?g|gif|webp|mp3|wav)$/i.test(id)) {
          return `export default ${JSON.stringify(id)};`;
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
