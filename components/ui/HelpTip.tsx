import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface HelpTipProps {
  /** The explanatory content shown in the popover. */
  children: React.ReactNode;
  /** Accessible label for the button. */
  label?: string;
  /** Preferred horizontal alignment of the popover relative to the button. */
  side?: 'left' | 'right';
  className?: string;
}

const WIDTH = 256; // px (w-64)
const MARGIN = 8;

/**
 * Small "?" help button that reveals a popover of usage explanation on click.
 * The popover is rendered in a PORTAL with fixed positioning + viewport clamping, so it is
 * never clipped by a modal's overflow and can't run off-screen. Closes on outside-click /
 * Escape / scroll / resize. No deps.
 */
export const HelpTip: React.FC<HelpTipProps> = ({ children, label = 'More info', side = 'right', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Position the (already-rendered, hidden) popover against the button, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    if (!btnRef.current || !popRef.current) return;
    const br = btnRef.current.getBoundingClientRect();
    const h = popRef.current.offsetHeight || 120;
    const w = popRef.current.offsetWidth || WIDTH;
    let left = side === 'left' ? br.right - w : br.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    let top = br.bottom + 6;
    if (top + h > window.innerHeight - MARGIN) {
      const above = br.top - 6 - h;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - h - MARGIN);
    }
    setPos({ top, left });
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 dark:border-gray-500 text-[10px] font-semibold leading-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        ?
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: WIDTH,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[60] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 text-left text-xs font-normal leading-relaxed text-gray-600 dark:text-gray-300 shadow-lg"
        >
          {children}
        </div>,
        document.body
      )}
    </span>
  );
};

export default HelpTip;
