import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

   VitePWA({
  registerType: "autoUpdate",

  devOptions: {
    enabled: false   // 🔥 DEV এ SW OFF
  },

  disable: true,     // 🔥 PROD এও SW OFF (MOST IMPORTANT)

  workbox: {
    runtimeCaching: [

      {
        urlPattern: ({ request }) =>
          request.destination === "style" ||
          request.destination === "script" ||
          request.destination === "image",

        handler: "CacheFirst",

        options: {
          cacheName: "ui-assets",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30
          }
        }
      },

      {
        urlPattern: ({ url }) =>
          url.pathname.startsWith("/api/"),

        handler: "NetworkOnly"
      }

    ]
  },

  manifest: {
    name: "PACE ERP",
    short_name: "PACE",
    description: "Process Automation & Control Environment",
    theme_color: "#0f172a",
    background_color: "#ffffff",
    display: "standalone",
    start_url: "/",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  }
})
  ],


  // 🔥 ADD THIS BLOCK
  server: {
    proxy: {
      "/api": {
        target: "https://pace-erp-api-dev.onrender.com",
        changeOrigin: true,
        secure: true
      }
    }
  }

});