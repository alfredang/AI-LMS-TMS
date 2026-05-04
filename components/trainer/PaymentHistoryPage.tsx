import React from 'react';
import { useLms } from '@contexts/LmsContext';
import TrainerPayoutHistory from '@components/payroll/TrainerPayoutHistory';

const PaymentHistoryPage: React.FC = () => {
  const { currentUser } = useLms();

  if (!currentUser?.id) {
    return <p className="text-sm text-on-surface-secondary">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Payment History</h1>
      <TrainerPayoutHistory trainerUserId={currentUser.id} />
    </div>
  );
};

export default PaymentHistoryPage;
