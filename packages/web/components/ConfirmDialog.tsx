'use client';

import { useEffect, useRef } from 'react';
import { XIcon } from './icons';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps {
  title: string;
  text: string;
  onConfirm: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
  showCancel?: boolean;
}

const baseDialogClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4';

const modalClass = 'flex w-full max-w-lg flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900';

const titleClass = 'text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4';

const contentClass = 'text-slate-700 dark:text-slate-300 mb-6';

const buttonRowClass = 'flex gap-3 w-full justify-end';

const cancelButtonBaseClass =
  'focus-ring rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800';

const confirmButtonBaseClass =
  'focus-ring rounded-lg px-4 py-2 text-sm font-medium text-white bg-emerald-600 shadow-card hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60';

export function ConfirmDialog({
  title,
  text,
  onConfirm,
  onCancel,
  isLoading = false,
  showCancel = true,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Focus management (WAI-ARIA dialog pattern): move focus into the dialog
  // on open (prefer the cancel button — the safer default for destructive
  // confirmations), trap Tab/Shift+Tab within it, and restore focus to
  // whatever was focused before the dialog opened once it closes.
  //
  // Mount-only effect (no `onCancel` in the dependency array): callers
  // like Dashboard's `useConfirmAction` pass a new `onCancel` closure on
  // every render, which would otherwise re-run this whole effect on every
  // re-render — including during an `isLoading` transition, where
  // `.focus()` on the now-disabled cancel button is a no-op, stranding
  // focus outside the modal. `onCancelRef` always has the latest callback.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const initialFocusTarget = cancelButtonRef.current ?? confirmButtonRef.current;
    initialFocusTarget?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancelRef.current?.();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []); // mount-only — onCancelRef.current always has the latest callback

  return (
    <div className={baseDialogClass} onClick={() => onCancel?.()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmación"
        onClick={(e) => e.stopPropagation()}
        className={modalClass}
      >
        <h2 className={titleClass}>{title}</h2>

        <p className={contentClass}>{text}</p>

        <div className={buttonRowClass}>
          {showCancel && onCancel && (
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className={cancelButtonBaseClass}
            >
              {isLoading ? (
                <>
                  Cancelar
                  <span className="ml-2 animate-spin h-4 w-4" />
                </>
              ) : (
                'Cancelar'
              )}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={confirmButtonBaseClass}
          >
            {isLoading ? (
              <>
                Confirmar
                <span className="ml-2 animate-spin h-4 w-4" />
              </>
            ) : (
              'Confirmar'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}