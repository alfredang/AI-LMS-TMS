import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';

/**
 * Mouse / touch / pen signature pad. Draws on a transparent canvas so the
 * exported PNG can sit on top of a document without a white box. The canvas is
 * rendered at devicePixelRatio for crisp strokes and exported at a fixed
 * logical size so stamped signatures are a consistent size.
 */

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** PNG data URL (transparent background), or null when nothing was drawn */
  toDataURL: () => string | null;
}

interface Props {
  width?: number;
  height?: number;
  strokeColor?: string;
  lineWidth?: number;
  disabled?: boolean;
  className?: string;
  onChange?: (empty: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 560, height = 180, strokeColor = '#1e2a78', lineWidth = 2.4, disabled = false, className = '', onChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
  };

  useEffect(() => {
    setupCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, strokeColor, lineWidth]);

  const markDirty = (isEmpty: boolean) => {
    setEmpty(isEmpty);
    onChange?.(isEmpty);
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      markDirty(true);
    },
    isEmpty: () => empty,
    toDataURL: () => {
      const canvas = canvasRef.current;
      if (!canvas || empty) return null;
      // Export at logical size so the PNG is small and consistent
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const octx = out.getContext('2d');
      if (!octx) return null;
      octx.drawImage(canvas, 0, 0, width, height);
      return out.toDataURL('image/png');
    },
  }), [empty, width, height]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // The canvas may be CSS-scaled on narrow screens; map back to logical px.
    const sx = width / rect.width;
    const sy = height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pointFrom(e);
    last.current = p;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    // A tap should still leave a dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();
    markDirty(false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext('2d');
    const p = pointFrom(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}`, touchAction: 'none' }}
      className={`block rounded-lg border-2 border-dashed bg-white ${
        disabled ? 'border-gray-200 cursor-not-allowed' : 'border-gray-300 dark:border-gray-500 cursor-crosshair'
      } ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={endStroke}
      aria-label="Signature pad — draw your signature with the mouse, finger or pen"
    />
  );
});

export default SignaturePad;
