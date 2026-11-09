/** @type {import('tailwindcss').Config} */
// Sistema de diseno de Arca (Fase 14). Los mismos valores estan como variables CSS en src/index.css.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // verde principal y su tinte
        arca: { DEFAULT: "#0E6B58", oscuro: "#0A5242", claro: "#E3F1EC" },
        // naranja de los apoyos: color, tinte y texto sobre el tinte
        apoyo: { DEFAULT: "#A8470A", claro: "#FBEBDD", texto: "#6E3207" },
        // La paleta "stone" se re-mapea a los grises del sistema:
        // fondo #F4F6F5 (50), bordes #E1E7E5 (200), texto secundario #4A5A56 (600), texto #12201C (900)
        stone: {
          50: "#F4F6F5",
          100: "#EAEFED",
          200: "#E1E7E5",
          300: "#C9D3D0",
          400: "#8A9893",
          500: "#5B6B67",
          600: "#4A5A56",
          700: "#34433F",
          800: "#1F2E2A",
          900: "#12201C",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
        titulo: ['"Space Grotesk Variable"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        tarjeta: "18px", // tarjetas: 16 a 20 px
        campo: "14px", // campos de formulario
      },
      height: { nav: "72px" }, // barra inferior
    },
  },
  plugins: [],
};
