import React from 'react';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full py-4 mt-auto border-t border-default bg-surface">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm text-on-surface-secondary">
          Powered by{' '}
          <a href="https://www.tertiarycourses.com.sg/" target="_blank" rel="noopener noreferrer" className="font-semibold text-on-surface hover:text-primary transition-colors">
            Tertiary Infotech Academy Pte Ltd
          </a>
          {' '}&copy; {currentYear}
        </p>
      </div>
    </footer>
  );
};

export default Footer;
