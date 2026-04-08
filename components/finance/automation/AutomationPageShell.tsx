import React from 'react';
import { Card } from '../../ui/Card';

export default function AutomationPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-on-surface">{title}</h2>
          <p className="mt-2 text-sm text-on-surface-secondary max-w-3xl">{description}</p>
        </div>
      </div>

      <Card className="p-4 sm:p-6">
        {children}
      </Card>
    </div>
  );
}

