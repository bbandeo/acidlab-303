import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutas relativas: sirve igual en GitHub Pages (subruta), localhost y Capacitor.
  base: "./",
  server: { allowedHosts: ["terminal.local"], fs: { allow: [".."] } },
  // Túnel ngrok para probar en el teléfono (`ngrok http 4173`).
  // acid.bnbandeo.com: dominio de producción detrás de nginx (ver deploy/).
  preview: {
    allowedHosts: [
      ".ngrok-free.app",
      ".ngrok-free.dev",
      ".ngrok.app",
      ".ngrok.io",
      "acid.bnbandeo.com",
    ],
  },
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
      // Los PDF de GUÍAS se abren navegando: sin la exclusión, el SW devolvería index.html.
      // Los PDF van precacheados para leerlos sin conexión; el límite por defecto (2 MiB) los dejaría afuera.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2,pdf}"],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallbackDenylist: [/\.pdf$/],
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
