/**
 * components/icons.tsx — rediseño UI/UX (2026-08): set mínimo de íconos
 * SVG dibujados a mano, sin dependencia nueva de npm (evita complicar el
 * build de Docker / lockfile-sync por un paquete de íconos). Cada ícono es
 * un componente funcional que acepta className/size igual que cualquier
 * elemento SVG — `aria-hidden` por defecto porque siempre acompañan texto
 * visible o un aria-label en el elemento interactivo que los contiene, así
 * que nunca son ellos mismos el nombre accesible de un control.
 */
import type { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function baseProps(size: number, props: SVGProps<SVGSVGElement>) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function SunIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

export function LogoutIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CheckIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function XIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function BuildingIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
      <path d="M10 21v-3h4v3" />
    </svg>
  );
}

export function UploadIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function SpinnerIcon({ size = 18, className, ...props }: IconProps) {
  return (
    <svg
      {...baseProps(size, props)}
      className={['animate-spin', className].filter(Boolean).join(' ')}
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}

export function WarningIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...baseProps(size, props)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
