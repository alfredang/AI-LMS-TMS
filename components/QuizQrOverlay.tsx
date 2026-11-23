import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './ui/Icon';

/** The link a quiz QR code carries: opens the quiz in the browser, or in the mobile app when installed. */
export function quizLink(courseId: string, quizId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/quiz/${encodeURIComponent(courseId)}/${encodeURIComponent(quizId)}`;
}

interface Tally { attempts: number; learners: number; average: number | null }

/**
 * Full-screen quiz QR code for the classroom screen (same pattern as the
 * feedback QR zoom). Learners scan it, sign in and take the quiz; the counter
 * underneath refreshes while the overlay is open so the trainer can see who
 * has finished.
 */
const QuizQrOverlay: React.FC<{
  courseId: string;
  quizId: string;
  title: string;
  questionCount: number;
  onClose: () => void;
}> = ({ courseId, quizId, title, questionCount, onClose }) => {
  const link = quizLink(courseId, quizId);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(link)}`;
  const [tally, setTally] = useState<Tally | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let stop = false;
    const load = () => {
      fetch(`/api/courses/quiz?courseId=${encodeURIComponent(courseId)}&quizId=${encodeURIComponent(quizId)}&tally=1`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (!stop && j?.success && j.tally) setTally(j.tally); })
        .catch(() => { /* the counter is optional */ });
    };
    load();
    const timer = setInterval(load, 10000);
    return () => { stop = true; clearInterval(timer); };
  }, [courseId, quizId]);

  if (typeof document === 'undefined') return null;
  const qrSize = 'min(64vh, 86vw)';
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out" // design-tokens-allow
      role="dialog"
      aria-modal="true"
      aria-label="Quiz QR code full screen"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full text-white bg-white/10 hover:bg-white/25 transition-colors" // design-tokens-allow
        aria-label="Close full screen quiz QR code"
      >
        <Icon name={IconName.Close} className="w-7 h-7" />
      </button>
      <div className="flex flex-col items-center min-w-0">
        <h2 className="text-xl md:text-4xl font-bold mb-1 text-green-300 text-center">{title || 'Quiz'}</h2>
        <p className="mb-4 text-sm md:text-xl text-white">{/* design-tokens-allow */}
          Scan to take the quiz · {questionCount} question{questionCount === 1 ? '' : 's'}
        </p>
        <div className="bg-white p-3 md:p-5 rounded-2xl">{/* design-tokens-allow */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt={`QR code for ${title || 'the quiz'}`}
            className="object-contain"
            style={{ width: qrSize, height: qrSize, imageRendering: 'pixelated' }}
          />
        </div>
        {tally && (
          <p className="mt-4 text-base md:text-2xl text-white font-medium">{/* design-tokens-allow */}
            {tally.learners} learner{tally.learners === 1 ? '' : 's'} completed
            {tally.average !== null ? ` · average ${tally.average}%` : ''}
          </p>
        )}
        <p className="mt-1 text-xs md:text-sm text-muted break-all text-center" style={{ maxWidth: qrSize }}>{link}</p>
      </div>
    </div>,
    document.body
  );
};

export default QuizQrOverlay;
