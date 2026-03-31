import React from 'react';
import { useLms } from '@contexts/LmsContext';

const Footer: React.FC = () => {
  const { trainingProviderProfile } = useLms();
  const currentYear = new Date().getFullYear();
  const companyName = trainingProviderProfile?.companyName || 'Training Provider';

  return (
    <footer className="w-full py-4 mt-auto border-t border-default bg-surface">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm text-on-surface-secondary">
          Powered by{' '}
          {/* TODO: Replace hardcoded URL with a website field from training provider profile when available */}
          <a href="https://www.tertiarycourses.com.sg/" target="_blank" rel="noopener noreferrer" className="font-semibold text-on-surface hover:text-primary transition-colors">
            {companyName}
          </a>
          {' '}&copy; {currentYear}
        </p>
      </div>
    </footer>
  );
};

export default Footer;
