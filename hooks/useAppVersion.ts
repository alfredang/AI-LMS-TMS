import { useState, useEffect } from 'react';

export function useAppVersion(): string {
  const [version, setVersion] = useState(process.env.NEXT_PUBLIC_COMMIT_HASH || '');

  useEffect(() => {
    // If already have a real version from build-time env, skip fetch
    if (version && version !== 'dev') return;

    fetch('/api/app-version')
      .then(r => r.json())
      .then(data => { if (data.version) setVersion(data.version); })
      .catch(() => {});
  }, []);

  return version || 'dev';
}
