import React, { useState, useEffect } from 'react';
import { Card } from '../../ui/Card';
import { useCp, INSTRUCTION_METHODS, ASSESSMENT_METHODS } from './CpContext';

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

  const handleGenerateTopics = async () => {
    if (!cp.courseTitle.trim()) {
      setTopicError('Please enter a course title first.');
      return;
    }
    setTopicError('');
    setGenerating(true);
    try {
      const res = await fetch('/api/developer/cp-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'generate_topics',
          courseTitle: cp.courseTitle,
          numTopics: cp.numTopics,
          framework: cp.framework,
          uniqueSkillName: cp.uniqueSkillName,
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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
              <option value="Accident and Incident Response Management">Accident and Incident Response Management</option>
              <option value="Accounting Standards">Accounting Standards</option>
              <option value="Adaptive Leadership">Adaptive Leadership</option>
              <option value="Agile Project Management">Agile Project Management</option>
              <option value="Artificial Intelligence Application">Artificial Intelligence Application</option>
              <option value="Audit Compliance">Audit Compliance</option>
              <option value="Big Data Analytics">Big Data Analytics</option>
              <option value="Brand Management">Brand Management</option>
              <option value="Business Continuity Management">Business Continuity Management</option>
              <option value="Business Innovation">Business Innovation</option>
              <option value="Business Negotiation">Business Negotiation</option>
              <option value="Change Management">Change Management</option>
              <option value="Cloud Computing">Cloud Computing</option>
              <option value="Communication">Communication</option>
              <option value="Computational Thinking">Computational Thinking</option>
              <option value="Conflict Resolution">Conflict Resolution</option>
              <option value="Content Marketing">Content Marketing</option>
              <option value="Continuous Improvement Management">Continuous Improvement Management</option>
              <option value="Creative Thinking">Creative Thinking</option>
              <option value="Critical Thinking">Critical Thinking</option>
              <option value="Customer Experience Management">Customer Experience Management</option>
              <option value="Cyber Security">Cyber Security</option>
              <option value="Data Analytics">Data Analytics</option>
              <option value="Data Governance">Data Governance</option>
              <option value="Data Visualisation">Data Visualisation</option>
              <option value="Design Thinking">Design Thinking</option>
              <option value="Digital Literacy">Digital Literacy</option>
              <option value="Digital Marketing">Digital Marketing</option>
              <option value="Digital Transformation">Digital Transformation</option>
              <option value="Diversity Management">Diversity Management</option>
              <option value="Emotional Intelligence">Emotional Intelligence</option>
              <option value="Environmental Sustainability">Environmental Sustainability</option>
              <option value="Financial Analysis">Financial Analysis</option>
              <option value="Financial Management">Financial Management</option>
              <option value="Global Mindset">Global Mindset</option>
              <option value="Human Resource Management">Human Resource Management</option>
              <option value="Innovation Management">Innovation Management</option>
              <option value="Internet of Things">Internet of Things</option>
              <option value="Leadership">Leadership</option>
              <option value="Learning Agility">Learning Agility</option>
              <option value="Machine Learning">Machine Learning</option>
              <option value="Manpower Planning">Manpower Planning</option>
              <option value="Marketing Strategy">Marketing Strategy</option>
              <option value="Operations Management">Operations Management</option>
              <option value="Organisational Design">Organisational Design</option>
              <option value="People Development">People Development</option>
              <option value="Performance Management">Performance Management</option>
              <option value="Problem Solving">Problem Solving</option>
              <option value="Process Improvement">Process Improvement</option>
              <option value="Product Management">Product Management</option>
              <option value="Programme Management">Programme Management</option>
              <option value="Project Management">Project Management</option>
              <option value="Quality Management">Quality Management</option>
              <option value="Regulatory Compliance">Regulatory Compliance</option>
              <option value="Robotics and Automation">Robotics and Automation</option>
              <option value="Risk Management">Risk Management</option>
              <option value="Sales Management">Sales Management</option>
              <option value="Service Excellence">Service Excellence</option>
              <option value="Software Development">Software Development</option>
              <option value="Stakeholder Management">Stakeholder Management</option>
              <option value="Strategic Planning">Strategic Planning</option>
              <option value="Supply Chain Management">Supply Chain Management</option>
              <option value="Sustainability Management">Sustainability Management</option>
              <option value="Talent Management">Talent Management</option>
              <option value="Team Building">Team Building</option>
              <option value="Technology Integration">Technology Integration</option>
              <option value="Transdisciplinary Thinking">Transdisciplinary Thinking</option>
              <option value="Workplace Safety and Health">Workplace Safety and Health</option>
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

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-3 px-4 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-all shadow-md"
      >
        {saved ? 'Saved!' : 'Save Course Details'}
      </button>
    </div>
  );
};

export default CpCourseDetails;
