import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (command === "build" && mode === "production" && !(env.VITE_API_URL || process.env.VITE_API_URL)) {
    console.warn("\n[arca] AVISO: falta VITE_API_URL. La app compilada mostrara un aviso de configuracion en vez de conectarse.\n");
  }
  const idCompilacion = env.VITE_BUILD_ID || process.env.VITE_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";
  return {
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(idCompilacion) },
  plugins: [
    react(),
    VitePWA({
      // "prompt": una version nueva NO reemplaza a la vieja sola; la app avisa y el usuario actualiza (ver core/actualizacion.ts)
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Arca - Gastos familiares",
        short_name: "Arca",
        description: "Control de gastos familiares con captura rápida",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FAFAF9",
        theme_color: "#0E6B58",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // La app (HTML, JS, CSS, fuentes) queda en cache; la API nunca se cachea aqui.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  };
});
