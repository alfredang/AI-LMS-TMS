import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { Icon, IconName } from '../ui/Icon';
import TrainerPayoutTable from './TrainerPayoutTable';

const PaymentHistoryPage: React.FC = () => {
  const { currentUser } = useLms();
  const trainerUserId = currentUser?.id;

  if (!trainerUserId) {
    return <p className="text-sm text-on-surface-secondary">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icon name={IconName.DollarSign} className="w-6 h-6 text-primary" />
          Trainer Payout History
        </h1>
        <p className="text-sm text-on-surface-secondary mt-1">
          A record of every payout you&rsquo;ve received. Filter by year or export to CSV for your records.
        </p>
      </div>
      <TrainerPayoutTable trainerUserId={trainerUserId} />
    </div>
  );
};

export default PaymentHistoryPage;
