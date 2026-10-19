'use client';

import { PlatformEstudios } from './PlatformEstudios';
import type { UserRole } from '@/lib/api';

export interface PlatformViewProps {
  userRole: UserRole;
}

/**
 * Multi-estudio pivot (PR8): the platform-level counterpart to
 * BackofficeView.tsx. Composed by app/page.tsx in place of the ENTIRE
 * tenant/período flow (not alongside it, like BackofficeView's own toggle)
 * for platform-level staff (user.estudio_id === null) — that flow has
 * nothing to show them: listMyTenants always returns [] for platform
 * staff, and every :id-scoped route 403s them (tenant-access.ts). Only one
 * section exists today (estudios), so unlike BackofficeView this has no
 * tab switcher yet — one gets added here if/when platform staff needs to
 * manage something besides estudios.
 */
export function PlatformView({ userRole }: PlatformViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <PlatformEstudios userRole={userRole} />
    </div>
  );
}
