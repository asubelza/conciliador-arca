'use client';

import { useEffect } from 'react';
import { XIcon } from './icons';

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
  'focus-rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800';

const confirmButtonBaseClass =
  'focus-rounded-lg px-4 py-2 text-sm font-medium text-white bg-emerald-600 shadow-card hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60';

export function ConfirmDialog({
  title,
  text,
  onConfirm,
  onCancel,
  isLoading = false,
  showCancel = true,
}: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className={baseDialogClass} onClick={() => onCancel?.()}>
      <div
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