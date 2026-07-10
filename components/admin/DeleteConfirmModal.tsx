import React, { useEffect } from 'react';
import { Icon, IconName } from '../ui/Icon';

// Shared destructive-delete confirmation modal. Mirrors the Company Application
// delete dialog so other lists (Direct Application, etc.) get the same polished
// confirmation instead of a browser confirm(). Columns are supplied by the
// caller so the row table adapts to each entity.

export interface DeleteColumn<T> {
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

interface Props<T> {
  rows: T[];
  columns: DeleteColumn<T>[];
  /** Singular entity name, e.g. "Direct Application" — pluralised automatically. */
  entityLabel: string;
  /** Warning copy shown under the title (what the delete will actually do). */
  description: React.ReactNode;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmModal<T>({ rows, columns, entityLabel, description, isDeleting, onConfirm, onClose }: Props<T>) {
  const count = rows.length;

  // Esc-to-close, skipped while a delete is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDeleting, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => { if (!isDeleting) onClose(); }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden ring-1 ring-red-200/60 dark:ring-red-900/40"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative px-6 py-5 border-b dark:border-gray-800 bg-gradient-to-br from-red-50 via-white to-white dark:from-red-950/30 dark:via-gray-900 dark:to-gray-900">
          <span className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-red-500 via-red-400 to-red-500" />
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/40 ring-1 ring-red-200 dark:ring-red-800/60 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Icon name={IconName.Warning} className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                  Delete {count} {entityLabel} row{count === 1 ? '' : 's'}?
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-300/60 dark:ring-red-800/60">
                  Destructive
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">{description}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50/60 dark:bg-gray-950/40">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Rows to delete</p>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {count} selected
            </span>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shadow-sm">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  {columns.map((col, i) => (
                    <th key={i} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-red-50/40 dark:hover:bg-red-900/10 transition-colors">
                    {columns.map((col, j) => (
                      <td key={j} className={`px-4 py-2.5 text-gray-700 dark:text-gray-300 ${col.className || ''}`}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-800 flex items-center justify-between gap-3 bg-white dark:bg-gray-900">
          <p className="text-[11px] text-gray-500 dark:text-gray-500 hidden sm:flex items-center gap-1.5">
            Press <kbd className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-[10px] text-gray-600 dark:text-gray-400">Esc</kbd> to cancel
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting || count === 0}
              className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-md shadow-red-900/30 ring-1 ring-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-2" />
                  Deleting...
                </>
              ) : (
                <>
                  <Icon name={IconName.Delete} className="w-3.5 h-3.5 mr-1.5" />
                  Confirm Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirmModal;
