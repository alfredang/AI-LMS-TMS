import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { SSGConfig } from './types';

interface ViewCourseRunProps {
  config: SSGConfig;
  updateConfig: (updates: Partial<SSGConfig>) => void;
}

const ViewCourseRun: React.FC<ViewCourseRunProps> = ({ config, updateConfig }) => {
  const [runId, setRunId] = React.useState('');
  const [includeExpired, setIncludeExpired] = React.useState(false);
  const [response, setResponse] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async () => {
    if (!runId.trim()) {
      alert('Please enter a Course Run ID');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        runId,
        includeExpired: includeExpired.toString()
        // No need to pass trainingProviderId - API will use the only one available
      });

      const response = await fetch(`/api/ssg/courses?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      setResponse(data);
    } catch (error) {
      setResponse({ error: 'Failed to fetch course run details' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>View Course Run</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Course Run ID</label>
          <input
            type="text"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter Course Run ID"
          />
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="includeExpired"
            checked={includeExpired}
            onChange={(e) => setIncludeExpired(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="includeExpired" className="text-sm font-medium">
            Include expired courses
          </label>
        </div>

        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? 'Loading...' : 'Send Request'}
        </Button>

        {response && (
          <div className="mt-4">
            <h3 className="text-lg font-medium mb-2">Response:</h3>
            <pre className="bg-gray-100 p-4 rounded-md overflow-auto text-sm">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ViewCourseRun;