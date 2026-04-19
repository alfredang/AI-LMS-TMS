import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

interface GeneratedDoc { name: string; data: string; }
interface ScheduleSlot { timing: string; duration: string; description: string; methods: string; }
interface ScheduleData {
  num_days: number;
  instructional_hours: number;
  assessment_hours: number;
  per_topic_mins: number;
  days: Record<string, ScheduleSlot[]>;
}

const Expander: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
};

const CwGenerateLessonPlan: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDoc | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);

  const hasContext = !!cw.extractedResult;
  const courseTitle = cw.courseData?.courseTitle || (cw.courseData as any)?.Course_Title || '';

  const handleDownload = (doc: GeneratedDoc) => {
    const byteChars = atob(doc.data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    if (!hasContext) { setError('Please extract course info first.'); return; }
    setError('');
    setLoading(true);
    setGeneratedDoc(null);
    setSchedule(null);

    try {
      const res = await fetch('/api/developer/cw-generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: 'lp', courseData: cw.courseData, extractedResult: cw.extractedResult, cpFileBase64: cw.cpText, cpFileName: 'cp.docx' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate lesson plan');
      if (data.documents?.[0]) setGeneratedDoc(data.documents[0]);
      if (data.schedule?.schedule) setSchedule(data.schedule.schedule);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Count topics from courseData
  const numTopics = (cw.courseData as any)?.Learning_Units?.reduce((sum: number, lu: any) => sum + (lu.Topics?.length || 0), 0) || 0;
  const totalHours = (cw.courseData as any)?.Total_Course_Duration_Hours || '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Generate Lesson Plan</h2>
      </div>

      {/* Course info banner (matching Streamlit) */}
      {hasContext && courseTitle && (
        <div className="p-3 rounded-lg bg-green-900/30 border border-green-700">
          <p className="text-sm text-green-400 font-medium">{courseTitle} | {numTopics} topic(s) | {totalHours}</p>
        </div>
      )}

      {!hasContext && (
        <Card className="p-4 bg-yellow-900/20 border border-yellow-700">
          <p className="text-sm font-semibold text-yellow-400">Please extract course info first.</p>
        </Card>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <Button onClick={handleGenerate} disabled={loading || !hasContext} className="bg-red-500 hover:bg-red-600">
        {loading ? 'Generating...' : 'Generate Lesson Plan'}
      </Button>

      {loading && (
        <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-700">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-300">Generating lesson plan with barrier scheduling...</p>
          </div>
        </div>
      )}

      {/* Schedule summary + day accordions (matching Streamlit) */}
      {!loading && schedule && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            {schedule.num_days} day(s) | {schedule.per_topic_mins} mins per topic | {schedule.instructional_hours} hrs instruction | {schedule.assessment_hours} hrs assessment
          </p>

          {Object.entries(schedule.days).map(([dayNum, slots]) => (
            <Expander key={dayNum} title={`Day ${dayNum}`} defaultOpen={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b dark:border-gray-700">Timing</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b dark:border-gray-700">Duration</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b dark:border-gray-700">Description</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b dark:border-gray-700">Methods</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(slots as ScheduleSlot[]).map((slot, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{slot.timing}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{slot.duration}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{slot.description}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{slot.methods}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Expander>
          ))}

          {/* Download button */}
          {generatedDoc && (
            <button onClick={() => handleDownload(generatedDoc)}
              className="px-6 py-3 text-sm font-medium bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors">
              Download Lesson Plan (.docx)
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default CwGenerateLessonPlan;
