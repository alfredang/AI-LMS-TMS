import React from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed top-6 right-6 z-50 px-4 py-3 rounded shadow-lg text-sm font-semibold transition-all duration-300
        ${type === 'success'
          ? 'bg-success-bg text-success'
          : 'bg-danger-bg text-danger'}`}
      role="alert"
    >
      {message}
    </div>
  );
};

export default Toast;
