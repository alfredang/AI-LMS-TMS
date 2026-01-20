import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { SSGConfig } from './types';
import { Month, MonthNames } from './constants';

interface ViewCourseSessionsProps {
  config: SSGConfig;
  updateConfig: (updates: Partial<SSGConfig>) => void;
}

const ViewCourseSessions: React.FC<ViewCourseSessionsProps> = ({ config }) => {
  const [courseReferenceNumber, setCourseReferenceNumber] = useState('TGS-2020000697');
  const [courseRunId, setCourseRunId] = useState('835457');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [specifyMonthYear, setSpecifyMonthYear] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<Month>(Month.JANUARY);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!courseReferenceNumber.trim()) {
      alert('Please enter a Course Reference Number');
      return;
    }

    if (!courseRunId.trim()) {
      alert('Please enter a Course Run ID');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        includeExpired: includeExpired.toString(),
        courseReferenceNumber: courseReferenceNumber
      });

      // Add month and year parameters if specified
      if (specifyMonthYear) {
        params.append('month', selectedMonth.toString());
        params.append('year', selectedYear.toString());
      }

      const response = await fetch(`/api/ssg/courses/runs/${courseRunId}/sessions?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      setResponse(data);
    } catch (error) {
      setResponse({ error: 'Failed to fetch course sessions' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>View Course Sessions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600 mb-4">
          You can use this API to retrieve course sessions based on the course reference number, course run ID and optionally month/year filters.
        </p>

        <div>
          <label className="block text-sm font-medium mb-2">
            * Course Reference Number (Sample data: TGS-2020000697)
          </label>
          <input
            type="text"
            value={courseReferenceNumber}
            onChange={(e) => setCourseReferenceNumber(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="TGS-2020000697"
            maxLength={300}
          />
          <p className="text-xs text-gray-500 mt-1">
            Reference number for the course of interest. Encode the course reference number as it may contain special characters.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            * Course Run ID (Sample data: 835457)
          </label>
          <input
            type="text"
            value={courseRunId}
            onChange={(e) => setCourseRunId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="835457"
          />
          <p className="text-xs text-gray-500 mt-1">
            You will get this value after you add a course run.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="includeExpiredSessions"
            checked={includeExpired}
            onChange={(e) => setIncludeExpired(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="includeExpiredSessions" className="text-sm font-medium">
            Include expired courses
          </label>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="specifyMonthYear"
              checked={specifyMonthYear}
              onChange={(e) => setSpecifyMonthYear(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="specifyMonthYear" className="text-sm font-medium">
              Specify Month and Year to retrieve
            </label>
          </div>

          {specifyMonthYear && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
              <div>
                <label className="block text-sm font-medium mb-2">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value) as Month)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(MonthNames).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  The month of the sessions to retrieve
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Year</label>
                <input
                  type="number"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  min={1900}
                  max={9999}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  The year of the sessions to retrieve
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <h3 className="text-lg font-medium mb-3">Send Request</h3>
          <p className="text-sm text-gray-600 mb-3">
            Click the Send button below to send the request to the API!
          </p>
          
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? 'Loading...' : 'Send'}
          </Button>
        </div>

        {response && (
          <div className="mt-4">
            <h3 className="text-lg font-medium mb-2">Response:</h3>
            <pre className="bg-gray-100 p-4 rounded-md overflow-auto text-sm max-h-96">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ViewCourseSessions;