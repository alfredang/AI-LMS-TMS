import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import FinanceManagementView from '../components/training-provider/FinanceManagementView';

const FinanceLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />
      <main className="flex-1 overflow-x-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <FinanceManagementView />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FinanceLayout;
