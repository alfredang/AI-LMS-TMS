import React, { useEffect, useState } from 'react';

/**
 * Full-screen "working" overlay with an animated braille spinner. Shown while a long action
 * (reschedule / cancel / calendar sync) is in flight so the user gets clear pending feedback
 * between confirming and the success/error popup. z-index sits above the confirm/event modals.
 */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const ProcessingOverlay: React.FC<{ show: boolean; label?: string }> = ({ show, label = 'Processing…' }) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!show) { setI(0); return; }
    const id = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, [show]);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-5 py-4 shadow-xl">
        <span className="text-2xl leading-none font-mono tabular-nums text-blue-600 dark:text-blue-400 w-6 text-center">{FRAMES[i]}</span>
        <span className="text-sm text-gray-800 dark:text-gray-100">{label}</span>
      </div>
    </div>
  );
};

export default ProcessingOverlay;
