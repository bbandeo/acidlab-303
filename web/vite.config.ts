import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutas relativas: sirve igual en GitHub Pages (subruta), localhost y Capacitor.
  base: "./",
  server: { fs: { allow: [".."] } },
  // Túnel ngrok para probar en el teléfono (`ngrok http 4173`).
  preview: { allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.io"] },
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Acidlab 303",
        short_name: "Acidlab 303",
        description: "Generador y editor de patrones ácidos para Behringer TD-3",
        lang: "es",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#151515",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2}"] },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
