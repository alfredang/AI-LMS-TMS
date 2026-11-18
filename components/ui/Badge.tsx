import React, { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'danger';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
  const variantStyles = {
    default: 'chip-neutral',
    secondary: 'chip-info',
    success: 'chip-success',
    warning: 'chip-warning',
    danger: 'chip-danger'
  };

  // Shared design-system status chips (styles/globals.css)
  return (
    <span className={`chip ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  );
};