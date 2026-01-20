import React from 'react';
import { Icon, IconName } from './Icon';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

const Spinner: React.FC<SpinnerProps> = ({ size = 'md', text }) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-2">
      <Icon name={IconName.Spinner} className={`${sizeClasses[size]} text-primary`} />
      {text && <p className="text-subtle">{text}</p>}
    </div>
  );
};

export default Spinner;
