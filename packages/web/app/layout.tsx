import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Conciliador Inteligente de Comprobantes',
  description: 'Conciliación de comprobantes ARCA vs. sistema contable',
};

// Script anti-FOUC: corre antes de la hidratación de React y aplica la clase
// `dark` en <html> de forma síncrona según lo guardado en localStorage (misma
// clave que lib/theme.ts) o, si no hay preferencia guardada, según
// prefers-color-scheme del sistema. Evita el "flash" de tema claro al cargar
// en modo oscuro.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('conciliador_theme');
    var isDark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
