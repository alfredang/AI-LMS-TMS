import React, { useState, useEffect } from 'react';
import { Card } from '../../ui/Card';
import { useCp, INSTRUCTION_METHODS, ASSESSMENT_METHODS } from './CpContext';
import { CP_SKILLS } from '../../../lib/cp-skills';
import CpPromptTemplateEditor from './CpPromptTemplateEditor';

// ─── Stepper Number Input (matches Streamlit's +/- number input) ───
const StepperInput: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}> = ({ label, value, onChange, min = 0, max = 999 }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
    <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="px-3 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors text-lg font-medium"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        onChange={e => {
          const n = Number(e.target.value);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="flex-1 text-center py-2 bg-transparent text-gray-900 dark:text-white text-sm border-none focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="px-3 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors text-lg font-medium"
      >
        +
      </button>
    </div>
  </div>
);

// ─── Pill Toggle Selector (click to select/deselect) ───
const PillSelector: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const toggle = (method: string) => {
    if (selected.includes(method)) {
      onChange(selected.filter(m => m !== method));
    } else {
      onChange([...selected, method]);
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map(method => (
          <button
            key={method}
            type="button"
            onClick={() => toggle(method)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              selected.includes(method)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {method}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400">{selected.length} selected</p>
    </Card>
  );
};

// ─── Main Component ───
const CpCourseDetails: React.FC = () => {
  const cp = useCp();
  const [generating, setGenerating] = useState(false);
  const [topicError, setTopicError] = useState('');
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Suggest Course Titles — local-only state; the brainstorm topic and
  // generated titles don't need to persist across sessions like the rest
  // of the CP state.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [suggestResult, setSuggestResult] = useState('');

  const handleSuggestTitles = async () => {
    if (!topicInput.trim()) {
      setSuggestError('Please enter a course topic to brainstorm titles for.');
      return;
    }
    setSuggestError('');
    setSuggesting(true);
    try {
      const res = await fetch('/api/developer/cp-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'suggest_titles',
          courseTopic: topicInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to suggest titles');
      setSuggestResult(data.result);
    } catch (err: any) {
      setSuggestError(err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handleGenerateTopics = async () => {
    if (!cp.courseTitle.trim()) {
      setTopicError('Please enter a course title first.');
      return;
    }
    setTopicError('');
    setGenerating(true);
    try {
      const selectedSkill = cp.uniqueSkillName
        ? CP_SKILLS.find(s => s.name === cp.uniqueSkillName)
        : undefined;
      const res = await fetch('/api/developer/cp-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'generate_topics',
          courseTitle: cp.courseTitle,
          numTopics: cp.numTopics,
          framework: cp.framework,
          uniqueSkillName: cp.uniqueSkillName,
          uniqueSkillDescription: selectedSkill?.description ?? '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate topics');
      cp.setCourseTopics(data.result);
    } catch (err: any) {
      setTopicError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = () => {
    cp.setHasSavedCourseDetails(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Derived summary values — mirrors the Streamlit st.dataframe summary.
  // All math stays in one place so the rendered table can't drift from the
  // numbers the AI is asked to respect.
  const minutesPerTopic = cp.numTopics > 0
    ? Math.round(cp.courseDuration * 60 / cp.numTopics)
    : 0;
  const instrMinutesPerTopic = cp.numTopics > 0
    ? Math.round(cp.instructionalHours * 60 / cp.numTopics)
    : 0;
  const durationPerInstrMethod = cp.numInstrMethods > 0
    ? Math.round(cp.instructionalHours * 60 / cp.numInstrMethods)
    : 0;
  const durationPerAssessMethod = cp.numAssessMethods > 0
    ? Math.round(cp.assessmentHours * 60 / cp.numAssessMethods)
    : 0;
  const summaryRows: [string, string][] = [
    ['Course Duration', `${cp.courseDuration} hrs`],
    ['Number of Topics', String(cp.numTopics)],
    ['Duration per Topic', `${minutesPerTopic} mins`],
    ['Instructional Duration', `${cp.instructionalHours} hrs`],
    ['Instructional per Topic', `${instrMinutesPerTopic} mins`],
    ['No. of Instructional Methods', String(cp.numInstrMethods)],
    ['Duration per Instructional Method', `${durationPerInstrMethod} mins`],
    ['Assessment Duration', `${cp.assessmentHours} hrs`],
    ['No. of Assessment Methods', String(cp.numAssessMethods)],
    ['Duration per Assessment Method', `${durationPerAssessMethod} mins`],
  ];

  // Keep selected methods in sync with max count
  useEffect(() => {
    if (cp.selectedInstrMethods.length > cp.numInstrMethods) {
      cp.setSelectedInstrMethods(cp.selectedInstrMethods.slice(0, cp.numInstrMethods));
    }
  }, [cp.numInstrMethods]);

  useEffect(() => {
    if (cp.selectedAssessMethods.length > cp.numAssessMethods) {
      cp.setSelectedAssessMethods(cp.selectedAssessMethods.slice(0, cp.numAssessMethods));
    }
  }, [cp.numAssessMethods]);

  return (
    <div className="space-y-6">
      {/* Framework selector */}
      <Card className="p-5">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Select Course Type</h3>
        <div className="flex gap-3">
          <button
            onClick={() => cp.setFramework('wsq')}
            className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all ${
              cp.framework === 'wsq'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            WSQ Course
          </button>
          <button
            onClick={() => cp.setFramework('casl')}
            className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all ${
              cp.framework === 'casl'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            CASL Course
          </button>
        </div>
      </Card>

      {/* Course Details Card */}
      <Card className="p-5 space-y-5">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          {cp.framework === 'wsq' ? 'WSQ' : 'CASL'} Course Details
        </h3>

        {/* Course Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
          <input
            type="text"
            value={cp.courseTitle}
            onChange={e => cp.setCourseTitle(e.target.value)}
            placeholder="e.g. Innovative Problem Solving with Generative AI"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Suggest Course Titles with AI — works for both WSQ and CASL.
            Brainstorms 20 SEO-friendly titles from a user-entered topic. */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
          <button
            type="button"
            onClick={() => setSuggestOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
          >
            <svg className={`w-4 h-4 transition-transform ${suggestOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Suggest Course Titles with AI
          </button>
          {suggestOpen && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enter a course topic to brainstorm 20 appealing, SEO-friendly course titles.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Course Topic</label>
                <input
                  type="text"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  placeholder="e.g. Digital Marketing, Generative AI for Business, Agile Project Management"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <CpPromptTemplateEditor section="suggest_titles" />
              <button
                onClick={handleSuggestTitles}
                disabled={suggesting}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-all"
              >
                {suggesting ? 'Suggesting…' : 'Suggest Titles'}
              </button>
              {suggestError && <p className="text-sm text-red-500">{suggestError}</p>}
              {suggestResult && (
                <pre className="text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-200 dark:border-gray-700">
                  {suggestResult}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Framework-specific fields */}
        {cp.framework === 'wsq' ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TSC Reference Code</label>
              <input
                type="text"
                value={cp.tscRefCode}
                onChange={e => cp.setTscRefCode(e.target.value)}
                placeholder="e.g. ICT-DIT-4003-1.1"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TSC Title</label>
              <input
                type="text"
                value={cp.tscTitle}
                onChange={e => cp.setTscTitle(e.target.value)}
                placeholder="e.g. Digital Innovation"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unique Skill Name</label>
            <select
              value={cp.uniqueSkillName}
              onChange={e => cp.setUniqueSkillName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a skill...</option>
              {CP_SKILLS.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Generate Topics with AI - Collapsible */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
          <button
            type="button"
            onClick={() => setTopicsOpen(!topicsOpen)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
          >
            <svg className={`w-4 h-4 transition-transform ${topicsOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Generate Topics with AI
          </button>
          {topicsOpen && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Auto-generate course topics based on the course title. You can edit the results afterwards.
              </p>
              <CpPromptTemplateEditor section="generate_topics" />
              {cp.framework === 'casl' && cp.uniqueSkillName && (() => {
                const selected = CP_SKILLS.find(s => s.name === cp.uniqueSkillName);
                if (!selected) return null;
                return (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-1 text-sm">
                    <p className="text-gray-800 dark:text-gray-200">
                      <span className="font-semibold text-blue-700 dark:text-blue-300">Skill:</span>{' '}
                      {selected.name}
                    </p>
                    {selected.description && (
                      <p className="text-gray-700 dark:text-gray-300">
                        <span className="font-semibold text-blue-700 dark:text-blue-300">Description:</span>{' '}
                        {selected.description}
                      </p>
                    )}
                  </div>
                );
              })()}
              <button
                onClick={handleGenerateTopics}
                disabled={generating}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {generating ? 'Generating...' : 'Generate Topics'}
              </button>
              {topicError && <p className="text-sm text-red-500">{topicError}</p>}
            </div>
          )}
        </div>

        {/* Course Topics */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Topics</label>
          <textarea
            value={cp.courseTopics}
            onChange={e => cp.setCourseTopics(e.target.value)}
            placeholder={"## Topic 1: Strategic Marketing Principles\n- Explain core marketing frameworks and models\n- Identify target market segments and positioning strategies\n\n## Topic 2: Consumer Behaviour Analysis\n- Describe consumer decision-making processes\n- Analyse factors influencing purchasing behaviour"}
            rows={10}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
        </div>
      </Card>

      {/* Duration & Settings Card */}
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <StepperInput label="Course Duration (hrs)" value={cp.courseDuration} onChange={cp.setCourseDuration} min={1} max={200} />
          <StepperInput label="No. of Topics" value={cp.numTopics} onChange={cp.setNumTopics} min={1} max={20} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <StepperInput label="Instructional Duration (hrs)" value={cp.instructionalHours} onChange={cp.setInstructionalHours} min={0} max={200} />
          <StepperInput label="Assessment Duration (hrs)" value={cp.assessmentHours} onChange={cp.setAssessmentHours} min={0} max={200} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <StepperInput label="No. of Instructional Methods" value={cp.numInstrMethods} onChange={cp.setNumInstrMethods} min={0} max={19} />
          <StepperInput label="No. of Assessment Methods" value={cp.numAssessMethods} onChange={cp.setNumAssessMethods} min={0} max={11} />
        </div>

        {/* Instructional Methods */}
        <PillSelector
          label="Instructional Methods"
          options={INSTRUCTION_METHODS}
          selected={cp.selectedInstrMethods}
          onChange={cp.setSelectedInstrMethods}
        />

        {/* Assessment Methods */}
        <PillSelector
          label="Assessment Methods"
          options={ASSESSMENT_METHODS}
          selected={cp.selectedAssessMethods}
          onChange={cp.setSelectedAssessMethods}
        />
      </Card>

      {/* Save + Clear */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 py-3 px-4 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-all shadow-md"
        >
          {saved ? 'Saved!' : 'Save Course Details'}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Clear all CP Generator fields? This wipes every section (Course Details, About, What You\'ll Learn, etc.) and cannot be undone.')) {
              cp.reset();
            }
          }}
          className="py-3 px-4 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
        >
          Clear All
        </button>
      </div>

      {/* Saved course details summary — appears after Save, mirrors the
          st.dataframe summary on the Streamlit "Course Details" page. */}
      {cp.hasSavedCourseDetails && cp.courseTitle && (
        <Card className="p-5 space-y-3">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{cp.courseTitle}</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Field</th>
                  <th className="text-left px-4 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(([field, value]) => (
                  <tr key={field} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{field}</td>
                    <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default CpCourseDetails;
