import React from 'react';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full py-4 mt-auto border-t border-default bg-surface">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm text-on-surface-secondary">
          Powered by{' '}
          <span className="font-semibold text-on-surface">
            Tertiary Infotech Academy Pte Ltd
          </span>
          {' '}&copy; {currentYear}
        </p>
      </div>
    </footer>
  );
};

export default Footer;
