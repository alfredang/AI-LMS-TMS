import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const qrSrc = (url: string, size: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;

/**
 * Class page → SWDA Enrolment (after E-Attendance). The QR code of the class's public enrolment
 * form (/enrol/<class uuid>) for learners not yet enrolled on SWDA/TPGateway. A learner already
 * enrolled is told so; anyone else submits their details, is registered on this class and can sign
 * in with an email code. Staff then enrol them on TPGateway from E-Attendance → Enrolment Requests.
 * Collapsed by default; the QR opens full screen for projecting to the class.
 */
export const SwdaEnrolmentSection: React.FC<{ courseRunUuid: string; courseRunId?: string; courseCode?: string }> = ({
  courseRunUuid, courseRunId, courseCode,
}) => {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open || !courseRunUuid || available !== null) return;
    fetch(`/api/public/enrolment-request?run=${encodeURIComponent(courseRunUuid)}`)
      .then(r => r.json())
      .then(j => setAvailable(!!(j.success && j.available)))
      .catch(() => setAvailable(true));
  }, [open, courseRunUuid, available]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [zoomed]);

  if (!courseRunUuid) return null;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/enrol/${courseRunUuid}` : '';
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  const ref = [courseCode && `Course Code: ${courseCode}`, courseRunId && `Course Run ID: ${courseRunId}`].filter(Boolean).join(' · ');

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 p-6">
        <button
          type="button"
          className="flex-1 min-w-0 text-left flex justify-between items-center gap-3"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">SWDA Enrolment</h3>
          <Icon name={IconName.ChevronDown} className={`w-6 h-6 text-blue-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="p-2 rounded-md text-blue-600 hover:bg-surface-elevated transition-colors flex-shrink-0"
          title="Show the enrolment QR code full screen"
          aria-label="Show the enrolment QR code full screen"
        >
          <Icon name={IconName.ZoomIn} className="w-6 h-6" />
        </button>
      </div>

      {open && (
        <div className="px-6 pb-6 border-t border-default">
          <p className="pt-4 text-sm text-on-surface-secondary">
            For learners not yet enrolled on SWDA (TPGateway). They scan the QR code and fill in their details; a learner who is
            already enrolled is told so. Each learner who submits is registered on this class and can sign in with an email code.
            Their details appear on E-Attendance → Enrolment Requests for enrolment on TPGateway. This is not the attendance QR code.
          </p>
          {available === false && (
            <p className="mt-3 text-sm text-amber-500">
              This class does not take SWDA enrolment requests (a Non-WSQ course, or outside the enrolment window).
            </p>
          )}
          <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col rounded-xl border border-default overflow-hidden">
              <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-center gap-2">
                <Icon name={IconName.ClipboardCheck} className="w-4 h-4 text-white flex-shrink-0" />
                <span className="text-sm font-semibold text-white">SWDA Enrolment</span>
              </div>
              <div className="flex flex-col items-center p-5 bg-surface flex-1 justify-between gap-3">
                <div className="flex flex-col items-center gap-3 w-full">
                  <button type="button" className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm cursor-zoom-in" onClick={() => setZoomed(true)} title="Show full screen">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrSrc(url, 200)} alt="SWDA enrolment QR code" className="w-36 h-36 object-contain" />
                  </button>
                  <p className="text-sm text-on-surface-secondary text-center">Scan to enrol for this class</p>
                </div>
                <div className="w-full flex flex-col gap-2">
                  <p className="text-xs text-on-surface-secondary break-all px-1">{url}</p>
                  <div className="flex gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 transition-colors"
                    >
                      Open Link
                    </a>
                    <button
                      type="button"
                      onClick={copy}
                      className="px-3 py-2 text-sm font-medium border border-default rounded-lg text-on-surface hover:bg-surface-elevated transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  {ref && <p className="text-xs text-on-surface-secondary text-center mt-1">{ref}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {zoomed && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[1000] bg-black/90 flex flex-col items-center justify-center gap-4 p-4 cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label="SWDA enrolment QR code full screen"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 p-2 rounded-full text-white bg-white/10 hover:bg-white/25 transition-colors"
            aria-label="Close full screen QR code"
          >
            <Icon name={IconName.Close} className="w-7 h-7" />
          </button>
          <h2 className="text-xl md:text-4xl font-bold text-indigo-300 text-center">SWDA Enrolment</h2>
          <p className="text-sm md:text-xl text-white text-center">Not enrolled yet? Scan to enrol for this class.</p>
          <div className="bg-white p-3 md:p-5 rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrSrc(url, 1000)}
              alt="SWDA enrolment QR code"
              className="object-contain"
              style={{ width: 'min(68vh, 86vw)', height: 'min(68vh, 86vw)', imageRendering: 'pixelated' }}
            />
          </div>
          {ref && <p className="text-base md:text-2xl text-white font-medium text-center">{ref}</p>}
          <p className="text-xs md:text-sm text-gray-300 break-all text-center">{url}</p>
        </div>,
        document.body
      )}
    </Card>
  );
};

export default SwdaEnrolmentSection;
