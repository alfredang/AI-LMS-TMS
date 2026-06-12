import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { UserRole } from '@app-types';
import TrainerPayoutTable from '../trainer/TrainerPayoutTable';

interface Props {
  trainerUserId: string;
}

const TrainerPayoutHistory: React.FC<Props> = ({ trainerUserId }) => {
  const { role, currentUser } = useLms();
  const isOwnProfile = currentUser?.id === trainerUserId;
  const isPayrollUser = role === UserRole.Payroll;
  const visible = isOwnProfile || isPayrollUser;

  if (!visible) return null;

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">History of Payout</h2>
      <TrainerPayoutTable trainerUserId={trainerUserId} />
    </section>
  );
};

export default TrainerPayoutHistory;
