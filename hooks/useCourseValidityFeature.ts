import { useEffect, useState } from 'react';

export function useCourseValidityFeature() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/courses/validity-feature', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : { enabled: false })
      .then(data => { if (active) setEnabled(data.enabled === true); })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);

  return enabled;
}
