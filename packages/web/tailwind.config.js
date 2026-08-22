const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
      },
      // Paleta semántica del sistema (todas son clases estándar de Tailwind,
      // documentadas acá para que el mapeo de significado quede explícito):
      //   primario/marca -> indigo
      //   neutro         -> slate
      //   éxito/conciliado -> emerald
      //   alerta/divergencia pendiente -> amber
      //   peligro/error  -> red
      //   "Posible Coincidencia" -> violet (coincide con el acento FF6D28D9
      //   ya usado en periodo-report-exporter.ts para esa sección en el XLSX)
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 8px -2px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
      },
    },
  },
  plugins: [],
};
