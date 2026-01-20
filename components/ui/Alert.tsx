import React, { ReactNode } from 'react';

interface AlertProps {
  children: ReactNode;
  variant?: 'default' | 'destructive';
  className?: string;
}

interface AlertDescriptionProps {
  children: ReactNode;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({ children, variant = 'default', className = '' }) => {
  const variantStyles = {
    default: 'border-blue-200 bg-blue-50 text-blue-900',
    destructive: 'border-red-200 bg-red-50 text-red-900'
  };

  return (
    <div className={`border-l-4 p-4 ${variantStyles[variant]} ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          {/* Icon will be passed as children */}
        </div>
        <div className="ml-3">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AlertDescription: React.FC<AlertDescriptionProps> = ({ children, className = '' }) => {
  return (
    <div className={`text-sm ${className}`}>
      {children}
    </div>
  );
};