/**
 * ConfirmPopup
 *
 * Shared centered modal for confirming an action. Replaces the four
 * near-duplicate popups that accumulated during the Company Application UX
 * sprint (Delete, Send Invoice, Generate Invoice, Delete Doc).
 *
 * All popups share the same shape:
 *   - tinted header strip with icon + title + subtitle
 *   - body slot for explanatory copy or pre-check details
 *   - footer with Cancel + Confirm buttons, where Confirm shows a spinner
 *     and switches label while the action is in flight
 *
 * Backdrop click cancels — unless the action is already running.
 */
import React from 'react';
import { Icon, IconName } from '../ui/Icon';

export type ConfirmTone = 'danger' | 'primary' | 'warning' | 'success';

interface ToneClasses {
  ring: string;
  headerBg: string;
  headerBorder: string;
  iconBg: string;
  iconColor: string;
  titleColor: string;
  subtitleColor: string;
  confirmBg: string;
  confirmHoverBg: string;
}

const TONE_CLASSES: Record<ConfirmTone, ToneClasses> = {
  danger: {
    ring: 'ring-red-200 dark:ring-red-800/60',
    headerBg: 'bg-red-50 dark:bg-red-900/20',
    headerBorder: 'border-red-200 dark:border-red-800/60',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    iconColor: 'text-red-600 dark:text-red-400',
    titleColor: 'text-red-900 dark:text-red-100',
    subtitleColor: 'text-red-700 dark:text-red-300',
    confirmBg: 'bg-red-600',
    confirmHoverBg: 'hover:bg-red-700',
  },
  primary: {
    ring: 'ring-blue-200 dark:ring-blue-800/60',
    headerBg: 'bg-blue-50 dark:bg-blue-900/20',
    headerBorder: 'border-blue-200 dark:border-blue-800/60',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    titleColor: 'text-blue-900 dark:text-blue-100',
    subtitleColor: 'text-blue-700 dark:text-blue-300',
    confirmBg: 'bg-blue-600',
    confirmHoverBg: 'hover:bg-blue-700',
  },
  warning: {
    ring: 'ring-orange-200 dark:ring-orange-800/60',
    headerBg: 'bg-orange-50 dark:bg-orange-900/20',
    headerBorder: 'border-orange-200 dark:border-orange-800/60',
    iconBg: 'bg-orange-100 dark:bg-orange-900/40',
    iconColor: 'text-orange-600 dark:text-orange-400',
    titleColor: 'text-orange-900 dark:text-orange-100',
    subtitleColor: 'text-orange-700 dark:text-orange-300',
    confirmBg: 'bg-orange-600',
    confirmHoverBg: 'hover:bg-orange-700',
  },
  success: {
    ring: 'ring-emerald-200 dark:ring-emerald-800/60',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/20',
    headerBorder: 'border-emerald-200 dark:border-emerald-800/60',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    titleColor: 'text-emerald-900 dark:text-emerald-100',
    subtitleColor: 'text-emerald-700 dark:text-emerald-300',
    confirmBg: 'bg-emerald-600',
    confirmHoverBg: 'hover:bg-emerald-700',
  },
};

export interface ConfirmPopupProps {
  tone?: ConfirmTone;
  icon?: IconName;
  /** Icon on the confirm button. Defaults to header icon. */
  confirmIcon?: IconName;
  title: string;
  subtitle?: string;
  /** Optional explanatory body — strings, JSX, anything. */
  children?: React.ReactNode;
  /** Idle label for the confirm button. */
  confirmLabel: string;
  /** Label shown while the action is in flight. */
  busyLabel?: string;
  /** Whether the action is currently running. Disables buttons + swaps to busy state. */
  busy?: boolean;
  /** Disable the confirm button independent of busy (e.g. pre-check failed). */
  disableConfirm?: boolean;
  /** Tooltip on the confirm button when disabled, to explain why. */
  confirmDisabledHint?: string;
  /** Hide the Cancel button — turns the popup into a single-action acknowledgement. */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmPopup: React.FC<ConfirmPopupProps> = ({
  tone = 'primary',
  icon = IconName.InfoCircle,
  confirmIcon,
  title,
  subtitle,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  disableConfirm = false,
  confirmDisabledHint,
  hideCancel = false,
  onConfirm,
  onCancel,
}) => {
  const t = TONE_CLASSES[tone];
  const buttonIcon = confirmIcon ?? icon;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className={`bg-white dark:bg-gray-900 rounded-xl shadow-2xl ring-1 ${t.ring} w-full max-w-md overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${t.headerBg} px-5 py-4 flex items-center gap-3 border-b ${t.headerBorder}`}>
          <div className={`w-10 h-10 rounded-full ${t.iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon name={icon} className={`w-5 h-5 ${t.iconColor}`} />
          </div>
          <div className="min-w-0">
            <h4 className={`text-sm font-bold ${t.titleColor}`}>{title}</h4>
            {subtitle && (
              <p className={`text-xs ${t.subtitleColor} mt-0.5 truncate`}>{subtitle}</p>
            )}
          </div>
        </div>
        {children && (
          <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 space-y-2">
            {children}
          </div>
        )}
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t dark:border-gray-700 flex items-center justify-end gap-2">
          {!hideCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={busy || disableConfirm}
            onClick={onConfirm}
            title={disableConfirm ? confirmDisabledHint : undefined}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md text-white ${t.confirmBg} ${t.confirmHoverBg} disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5`}
          >
            {busy ? (
              <>
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                {busyLabel ?? `${confirmLabel}…`}
              </>
            ) : (
              <>
                <Icon name={buttonIcon} className="w-3.5 h-3.5" />
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmPopup;
