/**
 * Add Course Runs Component
 * Complete implementation matching Python Streamlit Add Course Runs tab
 * Converted from reference/app/pages/1_📚Courses.py lines 128-784
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { OptionalSelector, IdType, Salutations, Role } from '../../types/ssg';

// Enhanced type definitions matching Python models
interface AddRunInfo {
  courseReferenceNumber: string;
  runs: AddRunIndividualInfo[];
}

interface AddRunIndividualInfo {
  sequenceNumber: number;
  // Registration dates
  openingRegistrationDate: string;
  closingRegistrationDate: string;
  // Course dates
  courseStartDate: string;
  courseEndDate: string;
  // Schedule info
  scheduleInfoTypeCode: string;
  scheduleInfoTypeDescription: string;
  scheduleInfo: string;
  // Venue info (required)
  floor: string;
  unit: string;
  postalCode: string;
  room: string;
  // Venue info (optional)
  block?: string;
  street?: string;
  building?: string;
  wheelChairAccess?: string;
  // Course intake details (optional)
  intakeSize?: number;
  threshold?: number;
  registeredUserCount?: number;
  // Course admin details
  modeOfTraining: string;
  courseAdminEmail: string;
  // Course vacancy
  courseVacancy: string;
  // File details (optional)
  fileName?: string;
  fileContent?: string;
  // Sessions and trainers
  sessions: RunSessionInfo[];
  linkCourseRunTrainer: RunTrainerInfo[];
}

interface RunSessionInfo {
  modeOfTraining: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  // Venue info (required)
  floor: string;
  unit: string;
  postalCode: string;
  room: string;
  // Venue info (optional)
  block?: string;
  street?: string;
  building?: string;
  wheelChairAccess?: string;
  primaryVenue?: string;
}

interface RunTrainerInfo {
  trainerTypeCode: string;
  trainerTypeDescription: string;
  // Common fields
  trainerIdNumber?: string;
  // For new trainers - optional fields
  trainerIndexNumber?: number;
  trainerUniqueId?: string;
  trainerName?: string;
  trainerEmail?: string;
  trainerIdType?: string;
  trainerIdNumber2?: string; // Personal ID (NRIC/FIN/Passport)
  trainerRoles?: Role[];
  trainerInTrainingProviderProfile?: string;
  trainerExperiences?: number; // Years of experience
  trainerLinkedinURL?: string;
  trainerDomainAreaOfPractice?: string;
  trainerSalutationId?: string;
  trainerPhotoName?: string;
  trainerPhotoContent?: string;
  trainerQualifications?: Array<{description: string; dateObtained: string}>;
  trainerContactNumber?: string;
}

interface AddCourseRunsProps {
  onSuccess?: (response: any) => void;
  onError?: (error: string) => void;
}

export const AddCourseRuns: React.FC<AddCourseRunsProps> = ({ onSuccess, onError }) => {
  // Form state
  const [includeExpired, setIncludeExpired] = useState<OptionalSelector>(OptionalSelector.NO);
  const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
  const [numRuns, setNumRuns] = useState(1);
  const [runs, setRuns] = useState<AddRunIndividualInfo[]>([createDefaultRun(0)]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set([0]));

  // Optional field states for each run
  const [optionalFields, setOptionalFields] = useState<Record<string, Record<string, boolean>>>({});

  // Create default run
  function createDefaultRun(sequenceNumber: number): AddRunIndividualInfo {
    return {
      sequenceNumber,
      openingRegistrationDate: '',
      closingRegistrationDate: '',
      courseStartDate: '',
      courseEndDate: '',
      scheduleInfoTypeCode: '',
      scheduleInfoTypeDescription: '',
      scheduleInfo: '',
      floor: '',
      unit: '',
      postalCode: '',
      room: '',
      modeOfTraining: '',
      courseAdminEmail: '',
      courseVacancy: '',
      sessions: [createDefaultSession('')],
      linkCourseRunTrainer: [createDefaultTrainer()]
    };
  }

  function createDefaultSession(startDate: string): RunSessionInfo {
    return {
      modeOfTraining: '',
      startDate,
      startTime: '',
      endTime: '',
      floor: '',
      unit: '',
      postalCode: '',
      room: ''
    };
  }

  function createDefaultTrainer(): RunTrainerInfo {
    return {
      trainerTypeCode: '',
      trainerTypeDescription: '',
      trainerIdNumber: ''
    };
  }

  // Mode of Training options
  const modeOfTrainingOptions = [
    { value: '1', label: '1 - Classroom' },
    { value: '2', label: '2 - Asynchronous eLearning' },
    { value: '3', label: '3 - In-house' },
    { value: '4', label: '4 - On-the-Job' },
    { value: '5', label: '5 - Blended Learning' },
    { value: '6', label: '6 - Synchronous eLearning' },
    { value: '7', label: '7 - Practical / Traineeship' },
    { value: '8', label: '8 - Assessment' },
    { value: '9', label: '9 - Virtual Classroom' }
  ];

  // Course Vacancy options
  const vacancyOptions = [
    { value: 'A', label: 'A - Available' },
    { value: 'F', label: 'F - Full' }
  ];

  // Trainer Type options
  const trainerTypeOptions = [
    { value: '1', label: '1 - Existing' },
    { value: '2', label: '2 - New' }
  ];

  // Optional selector options
  const optionalSelectorOptions = [
    { value: 'Y', label: 'Yes' },
    { value: 'N', label: 'No' }
  ];

  // Handle number of runs change
  const handleNumRunsChange = (newNumRuns: number) => {
    setNumRuns(newNumRuns);
    const newRuns = [...runs];
    
    if (newNumRuns > runs.length) {
      // Add new runs
      for (let i = runs.length; i < newNumRuns; i++) {
        newRuns.push(createDefaultRun(i));
        setExpandedRuns(prev => new Set(Array.from(prev).concat([i])));
      }
    } else if (newNumRuns < runs.length) {
      // Remove runs
      newRuns.splice(newNumRuns);
      setExpandedRuns(prev => {
        const newSet = new Set(prev);
        for (let i = newNumRuns; i < runs.length; i++) {
          newSet.delete(i);
        }
        return newSet;
      });
    }
    
    setRuns(newRuns);
  };

  // Update run field
  const updateRun = (runIndex: number, field: keyof AddRunIndividualInfo, value: any) => {
    const newRuns = [...runs];
    newRuns[runIndex] = { ...newRuns[runIndex], [field]: value };
    setRuns(newRuns);
  };

  // Update optional field state
  const updateOptionalField = (runIndex: number, fieldKey: string, enabled: boolean) => {
    setOptionalFields(prev => ({
      ...prev,
      [runIndex]: {
        ...prev[runIndex],
        [fieldKey]: enabled
      }
    }));
  };

  // Check if optional field is enabled
  const isOptionalFieldEnabled = (runIndex: number, fieldKey: string): boolean => {
    return optionalFields[runIndex]?.[fieldKey] || false;
  };

  // Add session to run
  const addSession = (runIndex: number) => {
    const newRuns = [...runs];
    newRuns[runIndex].sessions.push(createDefaultSession(newRuns[runIndex].courseStartDate));
    setRuns(newRuns);
  };

  // Remove session from run
  const removeSession = (runIndex: number, sessionIndex: number) => {
    const newRuns = [...runs];
    newRuns[runIndex].sessions.splice(sessionIndex, 1);
    setRuns(newRuns);
  };

  // Update session field
  const updateSession = (runIndex: number, sessionIndex: number, field: keyof RunSessionInfo, value: any) => {
    const newRuns = [...runs];
    newRuns[runIndex].sessions[sessionIndex] = { 
      ...newRuns[runIndex].sessions[sessionIndex], 
      [field]: value 
    };
    setRuns(newRuns);
  };

  // Add trainer to run
  const addTrainer = (runIndex: number) => {
    const newRuns = [...runs];
    newRuns[runIndex].linkCourseRunTrainer.push(createDefaultTrainer());
    setRuns(newRuns);
  };

  // Remove trainer from run
  const removeTrainer = (runIndex: number, trainerIndex: number) => {
    const newRuns = [...runs];
    newRuns[runIndex].linkCourseRunTrainer.splice(trainerIndex, 1);
    setRuns(newRuns);
  };

  // Update trainer field
  const updateTrainer = (runIndex: number, trainerIndex: number, field: keyof RunTrainerInfo | null, value: any) => {
    const newRuns = [...runs];
    if (field === null) {
      // Replace entire trainer object
      newRuns[runIndex].linkCourseRunTrainer[trainerIndex] = value;
    } else {
      // Update specific field
      newRuns[runIndex].linkCourseRunTrainer[trainerIndex] = { 
        ...newRuns[runIndex].linkCourseRunTrainer[trainerIndex], 
        [field]: value 
      };
    }
    setRuns(newRuns);
  };

  // Validate email format
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Toggle run expansion
  const toggleRunExpansion = (runIndex: number) => {
    setExpandedRuns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(runIndex)) {
        newSet.delete(runIndex);
      } else {
        newSet.add(runIndex);
      }
      return newSet;
    });
  };

  // Submit form
  const handleSubmit = async () => {
    setLoading(true);
    setResponse(null);

    try {
      const addRunInfo: AddRunInfo = {
        courseReferenceNumber,
        runs
      };

      const params = new URLSearchParams();
      params.append('includeExpiredCourses', includeExpired === OptionalSelector.YES ? 'true' : 'false');

      const response = await fetch(`/api/ssg/courses/courseRuns/publish?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(addRunInfo)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResponse(data);
      
      if (data.error) {
        onError?.(data.error);
      } else {
        onSuccess?.(data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setResponse({ error: errorMessage });
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Course Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Global Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Include Expired Courses *
              </label>
              <select 
                value={includeExpired}
                onChange={(e) => setIncludeExpired(e.target.value as OptionalSelector)}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                {optionalSelectorOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Course Reference Number *
              </label>
              <input
                type="text"
                value={courseReferenceNumber}
                onChange={(e) => setCourseReferenceNumber(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Number of Runs */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Course Runs *
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={numRuns}
              onChange={(e) => handleNumRunsChange(parseInt(e.target.value) || 1)}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>

          {/* Course Runs */}
          {runs.map((run, runIndex) => (
            <Card key={runIndex} className="border-l-4 border-l-blue-500">
              <div
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => toggleRunExpansion(runIndex)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Course Run {runIndex + 1}</span>
                    <span className="text-sm font-normal">
                      {expandedRuns.has(runIndex) ? '▼' : '▶'}
                    </span>
                  </CardTitle>
                </CardHeader>
              </div>

              {expandedRuns.has(runIndex) && (
                <CardContent className="space-y-6">
                  {/* Registration Dates */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Opening Registration Date *
                      </label>
                      <input
                        type="date"
                        value={run.openingRegistrationDate}
                        onChange={(e) => updateRun(runIndex, 'openingRegistrationDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Closing Registration Date *
                      </label>
                      <input
                        type="date"
                        value={run.closingRegistrationDate}
                        onChange={(e) => updateRun(runIndex, 'closingRegistrationDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>

                  {/* Course Dates */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Course Start Date *
                      </label>
                      <input
                        type="date"
                        value={run.courseStartDate}
                        onChange={(e) => updateRun(runIndex, 'courseStartDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Course End Date *
                      </label>
                      <input
                        type="date"
                        value={run.courseEndDate}
                        onChange={(e) => updateRun(runIndex, 'courseEndDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>

                  {/* Schedule Info */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Schedule Info Type Code *
                      </label>
                      <input
                        type="text"
                        value={run.scheduleInfoTypeCode}
                        onChange={(e) => updateRun(runIndex, 'scheduleInfoTypeCode', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Schedule Info Type Description *
                      </label>
                      <input
                        type="text"
                        value={run.scheduleInfoTypeDescription}
                        onChange={(e) => updateRun(runIndex, 'scheduleInfoTypeDescription', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Schedule Info *
                      </label>
                      <input
                        type="text"
                        value={run.scheduleInfo}
                        onChange={(e) => updateRun(runIndex, 'scheduleInfo', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>

                  {/* Venue Info (Required) */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-3">Venue Information (Required)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Floor *
                        </label>
                        <input
                          type="text"
                          value={run.floor}
                          onChange={(e) => updateRun(runIndex, 'floor', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Unit *
                        </label>
                        <input
                          type="text"
                          value={run.unit}
                          onChange={(e) => updateRun(runIndex, 'unit', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Postal Code *
                        </label>
                        <input
                          type="text"
                          value={run.postalCode}
                          onChange={(e) => updateRun(runIndex, 'postalCode', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Room *
                        </label>
                        <input
                          type="text"
                          value={run.room}
                          onChange={(e) => updateRun(runIndex, 'room', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Venue Info (Optional) */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-3">Venue Information (Optional)</h4>
                    <div className="space-y-3">
                      {/* Block */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'block')}
                          onChange={(e) => updateOptionalField(runIndex, 'block', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Block</label>
                        {isOptionalFieldEnabled(runIndex, 'block') && (
                          <input
                            type="text"
                            value={run.block || ''}
                            onChange={(e) => updateRun(runIndex, 'block', e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>

                      {/* Street */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'street')}
                          onChange={(e) => updateOptionalField(runIndex, 'street', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Street</label>
                        {isOptionalFieldEnabled(runIndex, 'street') && (
                          <input
                            type="text"
                            value={run.street || ''}
                            onChange={(e) => updateRun(runIndex, 'street', e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>

                      {/* Building */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'building')}
                          onChange={(e) => updateOptionalField(runIndex, 'building', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Building</label>
                        {isOptionalFieldEnabled(runIndex, 'building') && (
                          <input
                            type="text"
                            value={run.building || ''}
                            onChange={(e) => updateRun(runIndex, 'building', e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>

                      {/* Wheelchair Access */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'wheelChairAccess')}
                          onChange={(e) => updateOptionalField(runIndex, 'wheelChairAccess', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Wheelchair Access</label>
                        {isOptionalFieldEnabled(runIndex, 'wheelChairAccess') && (
                          <select
                            value={run.wheelChairAccess || 'N'}
                            onChange={(e) => updateRun(runIndex, 'wheelChairAccess', e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          >
                            {optionalSelectorOptions.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Course Intake Details (Optional) */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-3">Course Intake Details (Optional)</h4>
                    <div className="space-y-3">
                      {/* Intake Size */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'intakeSize')}
                          onChange={(e) => updateOptionalField(runIndex, 'intakeSize', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Intake Size</label>
                        {isOptionalFieldEnabled(runIndex, 'intakeSize') && (
                          <input
                            type="number"
                            min="1"
                            value={run.intakeSize || ''}
                            onChange={(e) => updateRun(runIndex, 'intakeSize', parseInt(e.target.value) || undefined)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>

                      {/* Threshold */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'threshold')}
                          onChange={(e) => updateOptionalField(runIndex, 'threshold', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Threshold</label>
                        {isOptionalFieldEnabled(runIndex, 'threshold') && (
                          <input
                            type="number"
                            min="1"
                            value={run.threshold || ''}
                            onChange={(e) => updateRun(runIndex, 'threshold', parseInt(e.target.value) || undefined)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>

                      {/* Registered User Count */}
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'registeredUserCount')}
                          onChange={(e) => updateOptionalField(runIndex, 'registeredUserCount', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Registered User Count</label>
                        {isOptionalFieldEnabled(runIndex, 'registeredUserCount') && (
                          <input
                            type="number"
                            min="0"
                            value={run.registeredUserCount || ''}
                            onChange={(e) => updateRun(runIndex, 'registeredUserCount', parseInt(e.target.value) || undefined)}
                            className="flex-1 p-2 border border-gray-300 rounded-md"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Course Admin Details */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-3">Course Admin Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mode of Training *
                        </label>
                        <select
                          value={run.modeOfTraining}
                          onChange={(e) => updateRun(runIndex, 'modeOfTraining', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md"
                        >
                          {modeOfTrainingOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Course Admin Email *
                        </label>
                        <input
                          type="email"
                          value={run.courseAdminEmail}
                          onChange={(e) => updateRun(runIndex, 'courseAdminEmail', e.target.value)}
                          className={`w-full p-2 border rounded-md ${
                            isValidEmail(run.courseAdminEmail) ? 'border-gray-300' : 'border-red-300 bg-red-50'
                          }`}
                        />
                        {!isValidEmail(run.courseAdminEmail) && (
                          <p className="text-red-600 text-sm mt-1">Please enter a valid email address</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Course Vacancy */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Course Vacancy *
                    </label>
                    <select
                      value={run.courseVacancy}
                      onChange={(e) => updateRun(runIndex, 'courseVacancy', e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md"
                    >
                      {vacancyOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* File Details (Optional) */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-3">File Details (Optional)</h4>
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isOptionalFieldEnabled(runIndex, 'fileName')}
                          onChange={(e) => updateOptionalField(runIndex, 'fileName', e.target.checked)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <label className="text-sm font-medium text-gray-700">Include File</label>
                      </div>
                      
                      {isOptionalFieldEnabled(runIndex, 'fileName') && (
                        <div className="grid grid-cols-1 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              File Name
                            </label>
                            <input
                              type="text"
                              value={run.fileName || ''}
                              onChange={(e) => updateRun(runIndex, 'fileName', e.target.value)}
                              className="w-full p-2 border border-gray-300 rounded-md"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              File Content (Base64)
                            </label>
                            <textarea
                              value={run.fileContent || ''}
                              onChange={(e) => updateRun(runIndex, 'fileContent', e.target.value)}
                              className="w-full p-2 border border-gray-300 rounded-md h-24"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sessions */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-medium text-gray-900">Sessions</h4>
                      <Button
                        type="button"
                        onClick={() => addSession(runIndex)}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 text-sm"
                      >
                        Add Session
                      </Button>
                    </div>
                    
                    <Alert className="mb-4">
                      <div className="text-sm">
                        <strong>Session Rules:</strong><br />
                        • For <strong>Mode of Training 2 (Asynchronous eLearning)</strong> and <strong>4 (On-the-Job)</strong>: 
                        End Date will be set same as Start Date, and times will be 12:00 AM to 11:59 PM<br />
                        • For other modes: You can specify custom End Date and times
                      </div>
                    </Alert>
                    
                    {run.sessions.map((session, sessionIndex) => {
                      const isAsyncOrOnTheJob = session.modeOfTraining === '2' || session.modeOfTraining === '4';
                      
                      return (
                        <Card key={sessionIndex} className="mb-4 border-l-4 border-l-green-500">
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">Session {sessionIndex + 1}</CardTitle>
                              {run.sessions.length > 1 && (
                                <Button
                                  type="button"
                                  onClick={() => removeSession(runIndex, sessionIndex)}
                                  className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 text-xs"
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Mode of Training *
                                </label>
                                <select
                                  value={session.modeOfTraining}
                                  onChange={(e) => {
                                    const newMode = e.target.value;
                                    updateSession(runIndex, sessionIndex, 'modeOfTraining', newMode);
                                    
                                    // Apply special rules for Mode 2 and 4
                                    if (newMode === '2' || newMode === '4') {
                                      // Set end date same as start date
                                      if (session.startDate) {
                                        updateSession(runIndex, sessionIndex, 'endDate', session.startDate);
                                      }
                                      // Set times to 00:00 and 23:59
                                      updateSession(runIndex, sessionIndex, 'startTime', '00:00');
                                      updateSession(runIndex, sessionIndex, 'endTime', '23:59');
                                    }
                                  }}
                                  className="w-full p-2 border border-gray-300 rounded-md"
                                >
                                  {modeOfTrainingOptions.map(option => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Start Date *
                                </label>
                                <input
                                  type="date"
                                  value={session.startDate}
                                  onChange={(e) => {
                                    updateSession(runIndex, sessionIndex, 'startDate', e.target.value);
                                    
                                    // For Mode 2 and 4, automatically set end date same as start date
                                    if (isAsyncOrOnTheJob) {
                                      updateSession(runIndex, sessionIndex, 'endDate', e.target.value);
                                    }
                                  }}
                                  className="w-full p-2 border border-gray-300 rounded-md"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  End Date {isAsyncOrOnTheJob ? '(Auto-set)' : ''}
                                </label>
                                <input
                                  type="date"
                                  value={session.endDate || ''}
                                  onChange={(e) => updateSession(runIndex, sessionIndex, 'endDate', e.target.value)}
                                  disabled={isAsyncOrOnTheJob}
                                  className={`w-full p-2 border rounded-md ${
                                    isAsyncOrOnTheJob 
                                      ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed' 
                                      : 'border-gray-300'
                                  }`}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Start Time {isAsyncOrOnTheJob ? '(Auto-set to 12:00 AM)' : ''}
                                </label>
                                <input
                                  type="time"
                                  value={session.startTime || ''}
                                  onChange={(e) => updateSession(runIndex, sessionIndex, 'startTime', e.target.value)}
                                  disabled={isAsyncOrOnTheJob}
                                  className={`w-full p-2 border rounded-md ${
                                    isAsyncOrOnTheJob 
                                      ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed' 
                                      : 'border-gray-300'
                                  }`}
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  End Time {isAsyncOrOnTheJob ? '(Auto-set to 11:59 PM)' : ''}
                                </label>
                                <input
                                  type="time"
                                  value={session.endTime || ''}
                                  onChange={(e) => updateSession(runIndex, sessionIndex, 'endTime', e.target.value)}
                                  disabled={isAsyncOrOnTheJob}
                                  className={`w-full p-2 border rounded-md ${
                                    isAsyncOrOnTheJob 
                                      ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed' 
                                      : 'border-gray-300'
                                  }`}
                                />
                              </div>
                            </div>

                            {isAsyncOrOnTheJob && (
                              <Alert>
                                <div className="text-sm">
                                  <strong>Info:</strong> End date is automatically set to <strong>{session.startDate || 'start date'}</strong>.
                                  <br />Start and end time set to <strong>12:00 AM to 11:59 PM</strong> respectively.
                                </div>
                              </Alert>
                            )}

                            {/* Session Venue */}
                            <div>
                              <h5 className="text-md font-medium text-gray-800 mb-2">Session Venue</h5>
                              
                              {/* Optional venue fields */}
                              <div className="space-y-3 mb-4">
                                {/* Block */}
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={session.block !== undefined && session.block !== ''}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSession(runIndex, sessionIndex, 'block', '12');
                                      } else {
                                        updateSession(runIndex, sessionIndex, 'block', '');
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Venue Block?</label>
                                  {session.block !== undefined && session.block !== '' && (
                                    <input
                                      type="text"
                                      value={session.block}
                                      onChange={(e) => updateSession(runIndex, sessionIndex, 'block', e.target.value)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                      maxLength={10}
                                    />
                                  )}
                                </div>

                                {/* Street */}
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={session.street !== undefined && session.street !== ''}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSession(runIndex, sessionIndex, 'street', 'Street 12');
                                      } else {
                                        updateSession(runIndex, sessionIndex, 'street', '');
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Venue Street?</label>
                                  {session.street !== undefined && session.street !== '' && (
                                    <input
                                      type="text"
                                      value={session.street}
                                      onChange={(e) => updateSession(runIndex, sessionIndex, 'street', e.target.value)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                      maxLength={32}
                                    />
                                  )}
                                </div>

                                {/* Building */}
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={session.building !== undefined && session.building !== ''}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSession(runIndex, sessionIndex, 'building', 'Building ABC');
                                      } else {
                                        updateSession(runIndex, sessionIndex, 'building', '');
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Venue Building?</label>
                                  {session.building !== undefined && session.building !== '' && (
                                    <input
                                      type="text"
                                      value={session.building}
                                      onChange={(e) => updateSession(runIndex, sessionIndex, 'building', e.target.value)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                      maxLength={66}
                                    />
                                  )}
                                </div>

                                {/* Wheelchair Access */}
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={session.wheelChairAccess !== undefined}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSession(runIndex, sessionIndex, 'wheelChairAccess', OptionalSelector.NO);
                                      } else {
                                        updateSession(runIndex, sessionIndex, 'wheelChairAccess', undefined);
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Wheelchair Access?</label>
                                  {session.wheelChairAccess !== undefined && (
                                    <select
                                      value={session.wheelChairAccess}
                                      onChange={(e) => updateSession(runIndex, sessionIndex, 'wheelChairAccess', e.target.value as OptionalSelector)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                    >
                                      <option value={OptionalSelector.YES}>Yes</option>
                                      <option value={OptionalSelector.NO}>No</option>
                                    </select>
                                  )}
                                </div>

                                {/* Primary Venue */}
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={session.primaryVenue !== undefined}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSession(runIndex, sessionIndex, 'primaryVenue', OptionalSelector.NO);
                                      } else {
                                        updateSession(runIndex, sessionIndex, 'primaryVenue', undefined);
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Primary Venue?</label>
                                  {session.primaryVenue !== undefined && (
                                    <select
                                      value={session.primaryVenue}
                                      onChange={(e) => updateSession(runIndex, sessionIndex, 'primaryVenue', e.target.value as OptionalSelector)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                    >
                                      <option value={OptionalSelector.YES}>Yes</option>
                                      <option value={OptionalSelector.NO}>No</option>
                                    </select>
                                  )}
                                  {session.primaryVenue !== undefined && (
                                    <div className="text-xs text-gray-500 ml-2">
                                      If Yes, API will pick venue info from course run
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Required venue fields */}
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Floor *
                                  </label>
                                  <input
                                    type="text"
                                    value={session.floor}
                                    onChange={(e) => updateSession(runIndex, sessionIndex, 'floor', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    maxLength={3}
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Unit *
                                  </label>
                                  <input
                                    type="text"
                                    value={session.unit}
                                    onChange={(e) => updateSession(runIndex, sessionIndex, 'unit', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    maxLength={5}
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Postal Code *
                                  </label>
                                  <input
                                    type="text"
                                    value={session.postalCode}
                                    onChange={(e) => updateSession(runIndex, sessionIndex, 'postalCode', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    maxLength={6}
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Room *
                                  </label>
                                  <input
                                    type="text"
                                    value={session.room}
                                    onChange={(e) => updateSession(runIndex, sessionIndex, 'room', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    maxLength={255}
                                  />
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Trainers */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-medium text-gray-900">Trainers</h4>
                      <Button
                        type="button"
                        onClick={() => addTrainer(runIndex)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 text-sm"
                      >
                        Add Trainer
                      </Button>
                    </div>
                    
                    <Alert className="mb-4">
                      <div className="text-sm">
                        <strong>Trainer Types:</strong><br />
                        • <strong>Type 1 (Existing):</strong> Only need to specify Trainer ID Number<br />
                        • <strong>Type 2 (New):</strong> Need to provide comprehensive trainer details with optional fields
                      </div>
                    </Alert>
                    
                    {run.linkCourseRunTrainer.map((trainer, trainerIndex) => {
                      const isExistingTrainer = trainer.trainerTypeCode === '1';
                      const hasTrainerType = trainer.trainerTypeCode && trainer.trainerTypeCode !== '';
                      
                      return (
                        <Card key={trainerIndex} className="mb-4 border-l-4 border-l-purple-500">
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">Trainer {trainerIndex + 1}</CardTitle>
                              {run.linkCourseRunTrainer.length > 1 && (
                                <Button
                                  type="button"
                                  onClick={() => removeTrainer(runIndex, trainerIndex)}
                                  className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 text-xs"
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Trainer Type - Always shown first */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Trainer Type *
                              </label>
                              <select
                                value={trainer.trainerTypeCode || ''}
                                onChange={(e) => {
                                  const newType = e.target.value;
                                  updateTrainer(runIndex, trainerIndex, 'trainerTypeCode', newType);
                                  
                                  // Update description based on type
                                  const typeDescription = newType === '1' ? 'Existing' : 'New';
                                  updateTrainer(runIndex, trainerIndex, 'trainerTypeDescription', typeDescription);
                                  
                                  // Clear all fields when changing type
                                  updateTrainer(runIndex, trainerIndex, 'trainerIdNumber', '');
                                  updateTrainer(runIndex, trainerIndex, 'trainerName', '');
                                  updateTrainer(runIndex, trainerIndex, 'trainerEmail', '');
                                  updateTrainer(runIndex, trainerIndex, 'trainerIdType', '');
                                  updateTrainer(runIndex, trainerIndex, 'trainerIdNumber2', '');
                                }}
                                className="w-full p-2 border border-gray-300 rounded-md"
                              >
                                <option value="">Select trainer type</option>
                                {trainerTypeOptions.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Show fields only after trainer type is selected */}
                            {hasTrainerType && (
                              <>
                                {/* Trainer ID - Always shown when type is selected */}
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Trainer ID Number *
                                  </label>
                                  <input
                                    type="text"
                                    value={trainer.trainerIdNumber || ''}
                                    onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerIdNumber', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    maxLength={128}
                                  />
                                  {isExistingTrainer && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      For existing trainers, only the ID is required
                                    </div>
                                  )}
                                </div>

                                {/* New Trainer Details - Only shown for Type 2 */}
                                {!isExistingTrainer && (
                              <div className="space-y-4 border-t pt-4">
                                <h5 className="text-md font-medium text-gray-800">New Trainer Details</h5>
                                
                                {/* Required Basic Information */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Trainer Name *
                                    </label>
                                    <input
                                      type="text"
                                      value={trainer.trainerName || ''}
                                      onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerName', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      maxLength={66}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Trainer Email *
                                    </label>
                                    <input
                                      type="email"
                                      value={trainer.trainerEmail || ''}
                                      onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerEmail', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      maxLength={320}
                                    />
                                  </div>
                                </div>

                                {/* Optional Fields */}
                                <div className="space-y-3">
                                  <h6 className="text-sm font-medium text-gray-700">Optional Information</h6>
                                  
                                  {/* ID Type and Number */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerIdType !== undefined && trainer.trainerIdType !== ''}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerIdType', IdType.SINGAPORE_BLUE);
                                          updateTrainer(runIndex, trainerIndex, 'trainerIdNumber2', 'S1234567A');
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerIdType', '');
                                          updateTrainer(runIndex, trainerIndex, 'trainerIdNumber2', '');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify ID Type & Personal ID?</label>
                                  </div>
                                  
                                  {trainer.trainerIdType !== undefined && trainer.trainerIdType !== '' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-7">
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          ID Type
                                        </label>
                                        <select
                                          value={trainer.trainerIdType}
                                          onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerIdType', e.target.value)}
                                          className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                          <option value={IdType.SINGAPORE_BLUE}>Singapore Blue IC</option>
                                          <option value={IdType.SINGAPORE_PINK}>Singapore Pink IC</option>
                                          <option value={IdType.FIN_WORK_PERMIT}>FIN/Work Permit</option>
                                          <option value={IdType.OTHERS}>Others</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Personal ID Number
                                        </label>
                                        <input
                                          type="text"
                                          value={trainer.trainerIdNumber2 || ''}
                                          onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerIdNumber2', e.target.value)}
                                          className="w-full p-2 border border-gray-300 rounded-md"
                                          maxLength={50}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {/* Contact Number */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerContactNumber !== undefined && trainer.trainerContactNumber !== ''}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerContactNumber', '+6512345678');
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerContactNumber', '');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Contact Number?</label>
                                    {trainer.trainerContactNumber !== undefined && trainer.trainerContactNumber !== '' && (
                                      <input
                                        type="text"
                                        value={trainer.trainerContactNumber}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerContactNumber', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={15}
                                      />
                                    )}
                                  </div>

                                  {/* Experience and Roles */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerExperiences !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerExperiences', 5);
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerExperiences', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Experience (years)?</label>
                                    {trainer.trainerExperiences !== undefined && (
                                      <input
                                        type="number"
                                        value={trainer.trainerExperiences}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerExperiences', parseInt(e.target.value) || 0)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        min="0"
                                        max="99"
                                      />
                                    )}
                                  </div>

                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerLinkedinURL !== undefined && trainer.trainerLinkedinURL !== ''}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerLinkedinURL', 'https://linkedin.com/in/trainer');
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerLinkedinURL', '');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify LinkedIn URL?</label>
                                    {trainer.trainerLinkedinURL !== undefined && trainer.trainerLinkedinURL !== '' && (
                                      <input
                                        type="url"
                                        value={trainer.trainerLinkedinURL}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerLinkedinURL', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={255}
                                      />
                                    )}
                                  </div>

                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerSalutationId !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerSalutationId', Salutations.MR);
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerSalutationId', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Salutation?</label>
                                    {trainer.trainerSalutationId !== undefined && (
                                      <select
                                        value={trainer.trainerSalutationId}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerSalutationId', e.target.value as Salutations)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                      >
                                        <option value={Salutations.MR}>Mr</option>
                                        <option value={Salutations.MS}>Ms</option>
                                        <option value={Salutations.MRS}>Mrs</option>
                                        <option value={Salutations.MDM}>Mdm</option>
                                        <option value={Salutations.DR}>Dr</option>
                                        <option value={Salutations.PROF}>Prof</option>
                                      </select>
                                    )}
                                  </div>

                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerPhotoName !== undefined && trainer.trainerPhotoName !== ''}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerPhotoName', 'trainer-photo.jpg');
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerPhotoName', '');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Photo Name?</label>
                                    {trainer.trainerPhotoName !== undefined && trainer.trainerPhotoName !== '' && (
                                      <input
                                        type="text"
                                        value={trainer.trainerPhotoName}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerPhotoName', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={255}
                                      />
                                    )}
                                  </div>

                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerPhotoContent !== undefined && trainer.trainerPhotoContent !== ''}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerPhotoContent', 'base64encodedphoto');
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerPhotoContent', '');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Photo Content (Base64)?</label>
                                    {trainer.trainerPhotoContent !== undefined && trainer.trainerPhotoContent !== '' && (
                                      <textarea
                                        value={trainer.trainerPhotoContent}
                                        onChange={(e) => updateTrainer(runIndex, trainerIndex, 'trainerPhotoContent', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        rows={2}
                                      />
                                    )}
                                  </div>
                                </div>

                                {/* Qualifications */}
                                <div className="space-y-3">
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainer.trainerQualifications !== undefined && trainer.trainerQualifications.length > 0}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainer(runIndex, trainerIndex, 'trainerQualifications', [
                                            {
                                              description: 'Bachelor of Science',
                                              dateObtained: '2020-01-01'
                                            }
                                          ]);
                                        } else {
                                          updateTrainer(runIndex, trainerIndex, 'trainerQualifications', []);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Qualifications?</label>
                                  </div>

                                  {trainer.trainerQualifications && trainer.trainerQualifications.length > 0 && (
                                    <div className="ml-7 space-y-2">
                                      {trainer.trainerQualifications.map((qual, qualIndex) => (
                                        <div key={qualIndex} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                          <input
                                            type="text"
                                            value={qual.description}
                                            onChange={(e) => {
                                              const updatedQuals = [...trainer.trainerQualifications!];
                                              updatedQuals[qualIndex].description = e.target.value;
                                              updateTrainer(runIndex, trainerIndex, 'trainerQualifications', updatedQuals);
                                            }}
                                            className="p-2 border border-gray-300 rounded-md"
                                            maxLength={1000}
                                          />
                                          <input
                                            type="date"
                                            value={qual.dateObtained}
                                            onChange={(e) => {
                                              const updatedQuals = [...trainer.trainerQualifications!];
                                              updatedQuals[qualIndex].dateObtained = e.target.value;
                                              updateTrainer(runIndex, trainerIndex, 'trainerQualifications', updatedQuals);
                                            }}
                                            className="p-2 border border-gray-300 rounded-md"
                                          />
                                        </div>
                                      ))}
                                      <div className="flex space-x-2">
                                        <Button
                                          type="button"
                                          onClick={() => {
                                            const updatedQuals = [...(trainer.trainerQualifications || []), {
                                              description: '',
                                              dateObtained: ''
                                            }];
                                            updateTrainer(runIndex, trainerIndex, 'trainerQualifications', updatedQuals);
                                          }}
                                          className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 text-xs"
                                        >
                                          Add Qualification
                                        </Button>
                                        {trainer.trainerQualifications.length > 1 && (
                                          <Button
                                            type="button"
                                            onClick={() => {
                                              const updatedQuals = trainer.trainerQualifications!.slice(0, -1);
                                              updateTrainer(runIndex, trainerIndex, 'trainerQualifications', updatedQuals);
                                            }}
                                            className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 text-xs"
                                          >
                                            Remove Last
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                              </>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
            >
              {loading ? 'Publishing...' : 'Publish Course Runs'}
            </Button>
          </div>

          {/* Response Display */}
          {response && (
            <Alert variant={response.error ? 'destructive' : 'default'}>
              <div className="text-sm">
                {response.error ? (
                  <div>
                    <p className="font-medium">Error:</p>
                    <p>{response.error}</p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">Success!</p>
                    <pre className="mt-2 overflow-auto text-xs bg-gray-50 p-2 rounded">
                      {JSON.stringify(response, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};