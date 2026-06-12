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
          ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}
      role="alert"
    >
      {message}
    </div>
  );
};

export default Toast;
