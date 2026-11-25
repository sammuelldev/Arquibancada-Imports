import { cpSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const projectRoot = process.cwd();
const localAssetDirectories = ["img"];
const classicScripts = ["catalogo-config.js", "catalog-search.js", "script.js"];

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    watch: { ignored: ["**/data/catalogo-local/**", "**/output/**"] }
  },
  preview: {
    host: "127.0.0.1"
  },
  build: {
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        store: resolve(projectRoot, "index.html"),
        ...(existsSync(resolve(projectRoot, "admin.html")) ? { admin: resolve(projectRoot, "admin.html") } : {})
      }
    }
  },
  plugins: [{
    name: "copy-local-catalog-images",
    writeBundle(outputOptions) {
      const outputDirectory = outputOptions.dir || resolve(projectRoot, "dist");

      for (const directory of localAssetDirectories) {
        const source = resolve(projectRoot, directory);
        if (existsSync(source)) {
          cpSync(source, resolve(outputDirectory, directory), { recursive: true });
        }
      }

      const banners = readdirSync(projectRoot).filter(file => /^hero-[a-z0-9]+\.jpg$/.test(file));
      for (const file of [...classicScripts, ...banners]) {
        const source = resolve(projectRoot, file);
        if (existsSync(source)) {
          cpSync(source, resolve(outputDirectory, file));
        }
      }
    }
  }]
});
