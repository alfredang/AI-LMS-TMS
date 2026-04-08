import React from 'react';
import AutomationPageShell from './AutomationPageShell';
import RunAutomationActionPanel from './RunAutomationActionPanel';

export default function SimpleWebhookActionView({
  title,
  description,
  actionId,
}: {
  title: string;
  description: string;
  actionId: string;
}) {
  return (
    <AutomationPageShell title={title} description={description}>
      <RunAutomationActionPanel
        actionId={actionId}
        fallbackLabel={title}
        fallbackDescription={description}
      />
    </AutomationPageShell>
  );
}

