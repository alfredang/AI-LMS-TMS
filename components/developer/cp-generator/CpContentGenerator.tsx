import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCp, LU_SEQUENCING_TYPES } from './CpContext';
import CpPromptTemplateEditor from './CpPromptTemplateEditor';

interface CpContentGeneratorProps {
  section: string;
  title: string;
  description: string;
}

// Map section names to their state getter/setter in CpContext
function useContentState(section: string) {
  const cp = useCp();

  const map: Record<string, { value: string; setValue: (v: string) => void }> = {
    about_course: { value: cp.aboutCourseText, setValue: cp.setAboutCourseText },
    what_youll_learn: { value: cp.wylText, setValue: cp.setWylText },
    background_a: { value: cp.bgPartAText, setValue: cp.setBgPartAText },
    background_b: { value: cp.bgPartBText, setValue: cp.setBgPartBText },
    learning_outcomes: { value: cp.learningOutcomesText, setValue: cp.setLearningOutcomesText },
    lu_sequencing: { value: cp.luSequencingText, setValue: cp.setLuSequencingText },
    course_outline: { value: cp.courseOutlineText, setValue: cp.setCourseOutlineText },
    entry_requirements: { value: cp.entryRequirementsText, setValue: cp.setEntryRequirementsText },
    job_roles: { value: cp.jobRolesText, setValue: cp.setJobRolesText },
    lesson_plan: { value: cp.lessonPlanText, setValue: cp.setLessonPlanText },
    validation: { value: cp.validationText, setValue: cp.setValidationText },
  };

  return map[section] || { value: '', setValue: () => {} };
}

const CpContentGenerator: React.FC<CpContentGeneratorProps> = ({ section, title, description }) => {
  const cp = useCp();
  const contentState = useContentState(section);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // For instructional/assessment methods, we handle multiple results
  const isMethodSection = section === 'instructional_methods' || section === 'assessment_methods';
  const methods = section === 'instructional_methods' ? cp.selectedInstrMethods : cp.selectedAssessMethods;
  const methodResults = section === 'instructional_methods' ? cp.instrMethodResults : cp.assessMethodResults;
  const setMethodResults = section === 'instructional_methods' ? cp.setInstrMethodResults : cp.setAssessMethodResults;

  const handleGenerate = async () => {
    if (!cp.courseTitle.trim() || !cp.courseTopics.trim()) {
      setError('Please fill in Course Details first (course title and topics are required).');
      return;
    }

    if (isMethodSection && methods.length === 0) {
      setError(`Please select at least one ${section === 'instructional_methods' ? 'instructional' : 'assessment'} method in Course Details first.`);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/developer/cp-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section,
          courseTitle: cp.courseTitle,
          courseTopics: cp.courseTopics,
          courseDuration: cp.courseDuration,
          numTopics: cp.numTopics,
          instructionalHours: cp.instructionalHours,
          assessmentHours: cp.assessmentHours,
          framework: cp.framework,
          tscRefCode: cp.tscRefCode,
          tscTitle: cp.tscTitle,
          uniqueSkillName: cp.uniqueSkillName,
          selectedInstrMethods: cp.selectedInstrMethods,
          selectedAssessMethods: cp.selectedAssessMethods,
          luSequencingType: cp.luSequencingType,
          learningOutcomes: cp.learningOutcomesText,
          courseOutline: cp.courseOutlineText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      if (isMethodSection && data.results) {
        setMethodResults(data.results);
      } else {
        contentState.setValue(data.result);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const hasContent = isMethodSection
    ? Object.keys(methodResults).length > 0
    : contentState.value.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      </div>

      {/* Course context — blue info box matching Streamlit's st.info() */}
      {cp.courseTitle && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm">
          <p className="text-gray-800 dark:text-gray-200">
            <span className="font-semibold text-blue-700 dark:text-blue-300">Course:</span>{' '}
            {cp.courseTitle}
          </p>
          <p className="text-xs text-blue-700/70 dark:text-blue-300/70 mt-0.5">
            {cp.numTopics} topics · {cp.courseDuration}h · {cp.framework.toUpperCase()}
          </p>
        </div>
      )}

      {/* Prompt Template editor */}
      <CpPromptTemplateEditor section={section} />

      {/* LU Sequencing type selector */}
      {section === 'lu_sequencing' && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Sequencing Type</h3>
          <div className="flex flex-wrap gap-2">
            {LU_SEQUENCING_TYPES.map(type => (
              <button
                key={type}
                onClick={() => cp.setLuSequencingType(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  cp.luSequencingType === type
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Generate / Regenerate — matches Streamlit's two-button pattern */}
      <div>
        {error && (
          <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerate} disabled={loading} className="flex-1 sm:flex-none">
            {loading ? 'Generating with Claude AI...' : 'Generate'}
          </Button>
          <button
            onClick={handleGenerate}
            disabled={loading || !hasContent}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            Regenerate
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Generating {title.toLowerCase()} with Claude AI...</p>
        </Card>
      )}

      {/* Results for method sections (multiple outputs) */}
      {isMethodSection && Object.keys(methodResults).length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Generated Results</h3>
            <button
              onClick={() => handleCopy(Object.entries(methodResults).map(([k, v]) => `**${k}**\n${v}`).join('\n\n'))}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Copy All
            </button>
          </div>
          {Object.entries(methodResults).map(([method, text]) => (
            <Card key={method} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">{method}</h4>
                <button onClick={() => handleCopy(text)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Copy</button>
              </div>
              <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                {text}
              </pre>
            </Card>
          ))}
        </div>
      )}

      {/* Results for single-output sections */}
      {!isMethodSection && hasContent && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Generated {title}</h4>
            <button onClick={() => handleCopy(contentState.value)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Copy</button>
          </div>
          {/* Editable output */}
          <textarea
            value={contentState.value}
            onChange={e => contentState.setValue(e.target.value)}
            rows={Math.max(8, contentState.value.split('\n').length + 2)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-sans leading-relaxed"
          />
        </Card>
      )}

      {/* Empty state */}
      {!loading && !hasContent && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">📝</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Click the generate button above to create {title.toLowerCase()} content using Claude AI.
            Make sure you have filled in the Course Details first.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CpContentGenerator;
