/**
 * Edit/Delete Course Runs Component
 * Complete implementation matching Python Streamlit Edit/Delete Course Runs tab
 * Converted from reference/app/pages/1_📚Courses.py lines 787-1424
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

export enum OptionalSelector {
  YES = 'true',
  NO = 'false'
}

// Enhanced type definitions matching our models
interface EditRunInfo {
  courseReferenceNumber: string;
  sequenceNumber?: number;
  
  // Registration dates (optional for editing)
  openingRegistrationDate?: string;
  closingRegistrationDate?: string;
  
  // Course dates (optional for editing)
  courseStartDate?: string;
  courseEndDate?: string;
  
  // Schedule information (optional for editing)
  scheduleInfoTypeCode?: string;
  scheduleInfoTypeDescription?: string;
  scheduleInfo?: string;
  
  // Venue information (optional for editing)
  block?: string;
  street?: string;
  floor?: string;
  unit?: string;
  building?: string;
  postalCode?: string;
  room?: string;
  wheelChairAccess?: OptionalSelector;
  
  // Course intake details (optional for editing)
  intakeSize?: number;
  threshold?: number;
  registeredUserCount?: number;
  
  // Course admin details (optional for editing)
  modeOfTraining?: string;
  courseAdminEmail?: string;
  
  // Course vacancy (optional for editing)
  courseVacancy?: {
    code: string;
    description?: string;
  };
  
  // File details (optional for editing)
  fileName?: string;
  fileContent?: string;
  
  // Session details (optional for editing)
  sessionId?: string;
  sessionModeOfTraining?: string;
  sessionStartDate?: string;
  sessionEndDate?: string;
  sessionStartTime?: string;
  sessionEndTime?: string;
  sessionBlock?: string;
  sessionStreet?: string;
  sessionBuilding?: string;
  sessionFloor?: string;
  sessionUnit?: string;
  sessionPostalCode?: string;
  sessionRoom?: string;
  sessionWheelchairAccess?: OptionalSelector;
  sessionPrimaryVenue?: OptionalSelector;
  
  // Trainer details (optional for editing)
  trainerTypeCode?: string;
  trainerTypeDescription?: string;
  trainerIdNumber?: string;
  trainerIndexNumber?: number;
  trainerUniqueId?: string;
  trainerName?: string;
  trainerEmail?: string;
  trainerIdType?: string;
  trainerRoles?: string[];
  trainerInTrainingProviderProfile?: OptionalSelector;
  trainerDomainAreaOfPractice?: string;
  trainerExperience?: string;
  trainerLinkedinURL?: string;
  trainerSalutationId?: string;
  trainerPhotoName?: string;
  trainerPhotoContent?: string;
  
  // Sessions and trainers (optional for editing)
  sessions?: any[];
  linkCourseRunTrainer?: any[];
}

interface DeleteRunInfo {
  courseReferenceNumber: string;
}

interface EditDeleteCourseRunsProps {
  onSuccess?: (response: any) => void;
  onError?: (error: string) => void;
}

export const EditDeleteCourseRuns: React.FC<EditDeleteCourseRunsProps> = ({ onSuccess, onError }) => {
  // Form state
  const [includeExpired, setIncludeExpired] = useState<OptionalSelector>(OptionalSelector.NO);
  const [action, setAction] = useState<'update' | 'delete'>('update');
  const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);

  // Edit form state
  const [editFormData, setEditFormData] = useState<EditRunInfo>({
    courseReferenceNumber: ''
  });

  // Optional field states
  const [optionalFields, setOptionalFields] = useState<Record<string, boolean>>({});

  // Session state management
  const [sessionCount, setSessionCount] = useState(1);
  const [sessionData, setSessionData] = useState<Record<number, any>>({
    0: {}
  });

  // Trainer state management
  const [trainerCount, setTrainerCount] = useState(1);
  const [trainerData, setTrainerData] = useState<Record<number, any>>({
    0: {}
  });

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

  // Optional selector options
  const optionalSelectorOptions = [
    { value: OptionalSelector.YES, label: 'Yes' },
    { value: OptionalSelector.NO, label: 'No' }
  ];

  // Update edit form field
  const updateEditField = (field: keyof EditRunInfo, value: any) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  // Update optional field state
  const updateOptionalField = (fieldKey: string, enabled: boolean) => {
    setOptionalFields(prev => ({
      ...prev,
      [fieldKey]: enabled
    }));
    
    // Clear the field value if disabling
    if (!enabled && fieldKey in editFormData) {
      setEditFormData(prev => {
        const updated = { ...prev };
        delete updated[fieldKey as keyof EditRunInfo];
        return updated;
      });
    }
  };

  // Check if optional field is enabled
  const isOptionalFieldEnabled = (fieldKey: string): boolean => {
    return optionalFields[fieldKey] || false;
  };

  // Session management functions
  const updateSessionCount = (count: number) => {
    setSessionCount(count);
    
    // Ensure we have data objects for all sessions
    const newSessionData = { ...sessionData };
    for (let i = 0; i < count; i++) {
      if (!newSessionData[i]) {
        newSessionData[i] = {};
      }
    }
    
    // Remove data for sessions beyond the count
    Object.keys(newSessionData).forEach(key => {
      const index = parseInt(key);
      if (index >= count) {
        delete newSessionData[index];
      }
    });
    
    setSessionData(newSessionData);
  };

  const updateSessionField = (sessionIndex: number, field: string, value: any) => {
    setSessionData(prev => ({
      ...prev,
      [sessionIndex]: {
        ...prev[sessionIndex],
        [field]: value
      }
    }));
  };

  const getSessionData = (sessionIndex: number) => {
    return sessionData[sessionIndex] || {};
  };

  // Trainer management functions
  const updateTrainerCount = (count: number) => {
    setTrainerCount(count);
    
    // Ensure we have data objects for all trainers
    const newTrainerData = { ...trainerData };
    for (let i = 0; i < count; i++) {
      if (!newTrainerData[i]) {
        newTrainerData[i] = {};
      }
    }
    
    // Remove data for trainers beyond the count
    Object.keys(newTrainerData).forEach(key => {
      const index = parseInt(key);
      if (index >= count) {
        delete newTrainerData[index];
      }
    });
    
    setTrainerData(newTrainerData);
  };

  const updateTrainerField = (trainerIndex: number, field: string, value: any) => {
    setTrainerData(prev => ({
      ...prev,
      [trainerIndex]: {
        ...prev[trainerIndex],
        [field]: value
      }
    }));
  };

  const getTrainerData = (trainerIndex: number) => {
    return trainerData[trainerIndex] || {};
  };

  // Validate email format
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Submit form
  const handleSubmit = async () => {
    if (!courseRunId.trim()) {
      setResponse({ error: 'Course Run ID is required' });
      onError?.('Course Run ID is required');
      return;
    }

    setLoading(true);
    setResponse(null);

    try {
      const params = new URLSearchParams();
      params.append('includeExpiredCourses', includeExpired === OptionalSelector.YES ? 'true' : 'false');
      params.append('action', action === 'update' ? 'edit' : 'delete');

      let requestBody;
      if (action === 'delete') {
        requestBody = { courseReferenceNumber };
      } else {
        // Construct complete request body with sessions and trainers
        requestBody = { 
          ...editFormData, 
          courseReferenceNumber 
        };
        
        // Add sessions if enabled and have data
        if (isOptionalFieldEnabled('sessions') && sessionCount > 0) {
          const sessions = [];
          for (let i = 0; i < sessionCount; i++) {
            const session = getSessionData(i);
            if (session && Object.keys(session).length > 0) {
              // Transform session field names to match server expectations
              const transformedSession: any = {};
              
              // Map frontend session field names to backend expected names
              if (session.sessionId) transformedSession.sessionId = session.sessionId;
              if (session.modeOfTraining) transformedSession.modeOfTraining = session.modeOfTraining;
              
              // Date fields: sessionStartDate -> startDate, sessionEndDate -> endDate
              if (session.sessionStartDate) transformedSession.startDate = session.sessionStartDate;
              if (session.sessionEndDate) transformedSession.endDate = session.sessionEndDate;
              if (session.sessionStartTime) transformedSession.startTime = session.sessionStartTime;
              if (session.sessionEndTime) transformedSession.endTime = session.sessionEndTime;
              
              // Venue fields: sessionFloor -> floor, etc.
              if (session.sessionBlock) transformedSession.block = session.sessionBlock;
              if (session.sessionStreet) transformedSession.street = session.sessionStreet;
              if (session.sessionFloor) transformedSession.floor = session.sessionFloor;
              if (session.sessionUnit) transformedSession.unit = session.sessionUnit;
              if (session.sessionBuilding) transformedSession.building = session.sessionBuilding;
              if (session.sessionPostalCode) transformedSession.postalCode = session.sessionPostalCode;
              if (session.sessionRoom) transformedSession.room = session.sessionRoom;
              if (session.sessionWheelchairAccess) transformedSession.wheelChairAccess = session.sessionWheelchairAccess;
              if (session.sessionPrimaryVenue) transformedSession.primaryVenue = session.sessionPrimaryVenue;
              
              console.log(`Transformed session ${i}:`, transformedSession);
              sessions.push(transformedSession);
            }
          }
          if (sessions.length > 0) {
            requestBody.sessions = sessions;
          }
        }
        
        // Add trainers if enabled and have data
        if (isOptionalFieldEnabled('trainers') && trainerCount > 0) {
          const trainers = [];
          for (let i = 0; i < trainerCount; i++) {
            const trainer = getTrainerData(i);
            if (trainer && Object.keys(trainer).length > 0) {
              // Transform trainer field names to match server expectations
              const transformedTrainer: any = {};
              
              // Map frontend trainer field names to backend expected names
              if (trainer.trainerTypeCode) {
                transformedTrainer.trainerTypeCode = trainer.trainerTypeCode;
                // Add description based on type code
                transformedTrainer.trainerTypeDescription = trainer.trainerTypeCode === '1' ? 'Existing' : 'New';
              }
              
              // Basic trainer fields
              if (trainer.trainerIdNumber) transformedTrainer.trainerIdNumber = trainer.trainerIdNumber;
              if (trainer.trainerIndexNumber !== undefined) transformedTrainer.trainerIndexNumber = trainer.trainerIndexNumber;
              if (trainer.trainerUniqueId) transformedTrainer.trainerUniqueId = trainer.trainerUniqueId;
              if (trainer.trainerName) transformedTrainer.trainerName = trainer.trainerName;
              if (trainer.trainerEmail) transformedTrainer.trainerEmail = trainer.trainerEmail;
              if (trainer.trainerIdType) transformedTrainer.idType = trainer.trainerIdType;
              
              // Optional trainer fields
              if (trainer.trainerInTrainingProviderProfile) transformedTrainer.inTrainingProviderProfile = trainer.trainerInTrainingProviderProfile;
              if (trainer.trainerDomainAreaOfPractice) transformedTrainer.domainAreaOfPractice = trainer.trainerDomainAreaOfPractice;
              if (trainer.trainerExperience) transformedTrainer.experience = trainer.trainerExperience;
              if (trainer.trainerLinkedinURL) transformedTrainer.linkedinURL = trainer.trainerLinkedinURL;
              if (trainer.trainerSalutationId) transformedTrainer.salutationId = trainer.trainerSalutationId;
              if (trainer.trainerPhotoName) transformedTrainer.photoName = trainer.trainerPhotoName;
              if (trainer.trainerPhotoContent) transformedTrainer.photoContent = trainer.trainerPhotoContent;
              
              // Add roles if trainer type is Existing and trainer roles exist
              if (trainer.trainerRoles && Array.isArray(trainer.trainerRoles) && trainer.trainerRoles.length > 0) {
                transformedTrainer.trainerRoles = trainer.trainerRoles;
              }
              
              console.log(`Transformed trainer ${i}:`, transformedTrainer);
              
              trainers.push(transformedTrainer);
            }
          }
          if (trainers.length > 0) {
            requestBody.linkCourseRunTrainer = trainers;
          }
        }
        
        // Log the request body for debugging
        console.log('Request Body being sent to API:', requestBody);
        console.log('Session count:', sessionCount);
        console.log('Session data:', sessionData);
        console.log('Trainer count:', trainerCount);
        console.log('Trainer data:', trainerData);
        console.log('Optional fields enabled:', optionalFields);
      }

      const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Try to parse JSON response, handle empty responses
      let data;
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          console.error('Failed to parse JSON response:', text);
          throw new Error(`Invalid JSON response: ${text}`);
        }
      } else {
        // Non-JSON response
        const text = await response.text();
        throw new Error(`Unexpected response type: ${text}`);
      }

      if (!response.ok) {
        // Handle error responses
        const errorMessage = data?.error?.message || 
                            data?.error?.details?.[0]?.message ||
                            `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }
      
      // Ensure we always have a valid response object and include the status
      const safeResponse = data ? { 
        ...data, 
        status: response.status 
      } : { status: response.status };
      
      setResponse(safeResponse);
      
      // For successful operations (200 status), treat as success even if there's an error object
      if (response.status === 200) {
        onSuccess?.(safeResponse);
      } else if (safeResponse.error) {
        onError?.(safeResponse.error);
      } else {
        onSuccess?.(safeResponse);
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
          <CardTitle>Edit/Delete Course Runs</CardTitle>
          <p className="text-sm text-gray-600">
            You can use this API to edit and delete your course runs. Note that this API uses 
            the <strong>Edit/Delete Course Runs</strong> API to achieve the edit request!
          </p>
          <Alert className="mt-4">
            <div className="text-sm">
              <strong>Edit/Delete Course Runs requires your request payloads to be encrypted!</strong>
              <br />
              Make sure that you have loaded your UEN properly before proceeding!
            </div>
          </Alert>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Global Settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Action *
              </label>
              <select 
                value={action}
                onChange={(e) => setAction(e.target.value as 'update' | 'delete')}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                <option value="update">UPDATE</option>
                <option value="delete">DELETE</option>
              </select>
            </div>
            
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
                onChange={(e) => {
                  setCourseReferenceNumber(e.target.value);
                  updateEditField('courseReferenceNumber', e.target.value);
                }}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Course Run ID *
            </label>
            <input
              type="text"
              value={courseRunId}
              onChange={(e) => setCourseRunId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
            <p className="text-sm text-gray-500 mt-1">
              The Course Run ID is used as a URL parameter for the API request
            </p>
          </div>

          {action === 'update' && (
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader>
                <CardTitle>Update Course Run Details</CardTitle>
                <p className="text-sm text-gray-600">
                  Note that registrationDates, courseDates, scheduleInfoType, scheduleInfo, 
                  courseVacancy, modeOfTraining are required for the update action!
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sequence Number */}
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={isOptionalFieldEnabled('sequenceNumber')}
                    onChange={(e) => updateOptionalField('sequenceNumber', e.target.checked)}
                    className="h-4 w-4 text-blue-600"
                  />
                  <label className="text-sm font-medium text-gray-700">Specify Sequence Number?</label>
                  {isOptionalFieldEnabled('sequenceNumber') && (
                    <input
                      type="number"
                      min="0"
                      value={editFormData.sequenceNumber || ''}
                      onChange={(e) => updateEditField('sequenceNumber', parseInt(e.target.value) || 0)}
                      className="flex-1 p-2 border border-gray-300 rounded-md"
                    />
                  )}
                </div>

                {/* Course Admin Details */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Course Admin Details</h4>
                  
                  {/* Mode of Training */}
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      checked={isOptionalFieldEnabled('modeOfTraining')}
                      onChange={(e) => updateOptionalField('modeOfTraining', e.target.checked)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <label className="text-sm font-medium text-gray-700">Specify Mode of Training?</label>
                    {isOptionalFieldEnabled('modeOfTraining') && (
                      <select
                        value={editFormData.modeOfTraining || ''}
                        onChange={(e) => updateEditField('modeOfTraining', e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded-md"
                      >
                        <option value="">Select mode of training</option>
                        {modeOfTrainingOptions.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Course Admin Email */}
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Course Admin Email *
                    </label>
                    <input
                      type="email"
                      value={editFormData.courseAdminEmail || ''}
                      onChange={(e) => updateEditField('courseAdminEmail', e.target.value)}
                      className={`w-full p-2 border rounded-md ${
                        editFormData.courseAdminEmail && !isValidEmail(editFormData.courseAdminEmail) 
                          ? 'border-red-300 bg-red-50' 
                          : 'border-gray-300'
                      }`}
                    />
                    {editFormData.courseAdminEmail && !isValidEmail(editFormData.courseAdminEmail) && (
                      <p className="text-red-500 text-xs mt-1">Please enter a valid email address</p>
                    )}
                  </div>
                </div>

                {/* Course Vacancy */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Course Vacancy Details</h4>
                  <select
                    value={editFormData.courseVacancy?.code || ''}
                    onChange={(e) => updateEditField('courseVacancy', { 
                      code: e.target.value, 
                      description: vacancyOptions.find(opt => opt.value === e.target.value)?.label 
                    })}
                    className="w-full p-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Select course vacancy</option>
                    {vacancyOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Registration Dates */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Registration Dates</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Opening Registration Date *
                      </label>
                      <input
                        type="date"
                        value={editFormData.openingRegistrationDate || ''}
                        onChange={(e) => updateEditField('openingRegistrationDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Closing Registration Date *
                      </label>
                      <input
                        type="date"
                        value={editFormData.closingRegistrationDate || ''}
                        onChange={(e) => updateEditField('closingRegistrationDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>

                {/* Course Dates */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Course Dates</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Course Start Date *
                      </label>
                      <input
                        type="date"
                        value={editFormData.courseStartDate || ''}
                        onChange={(e) => updateEditField('courseStartDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Course End Date *
                      </label>
                      <input
                        type="date"
                        value={editFormData.courseEndDate || ''}
                        onChange={(e) => updateEditField('courseEndDate', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>

                {/* Schedule Info Type */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Schedule Info Type</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Schedule Info Type Code *
                      </label>
                      <input
                        type="text"
                        value={editFormData.scheduleInfoTypeCode || ''}
                        onChange={(e) => updateEditField('scheduleInfoTypeCode', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Schedule Info Type Description *
                      </label>
                      <input
                        type="text"
                        value={editFormData.scheduleInfoTypeDescription || ''}
                        onChange={(e) => updateEditField('scheduleInfoTypeDescription', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3 mt-3">
                    <input
                      type="checkbox"
                      checked={isOptionalFieldEnabled('scheduleInfo')}
                      onChange={(e) => updateOptionalField('scheduleInfo', e.target.checked)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <label className="text-sm font-medium text-gray-700">Specify Schedule Info?</label>
                    {isOptionalFieldEnabled('scheduleInfo') && (
                      <input
                        type="text"
                        value={editFormData.scheduleInfo || ''}
                        onChange={(e) => updateEditField('scheduleInfo', e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded-md"
                      />
                    )}
                  </div>
                </div>

                {/* Venue Info */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Venue Information</h4>
                  
                  {/* Optional Venue Fields */}
                  <div className="space-y-3 mb-4">
                    {/* Block */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('block')}
                        onChange={(e) => updateOptionalField('block', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify Venue Block?</label>
                      {isOptionalFieldEnabled('block') && (
                        <input
                          type="text"
                          value={editFormData.block || ''}
                          onChange={(e) => updateEditField('block', e.target.value)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                          maxLength={10}
                        />
                      )}
                    </div>

                    {/* Street */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('street')}
                        onChange={(e) => updateOptionalField('street', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify Venue Street?</label>
                      {isOptionalFieldEnabled('street') && (
                        <input
                          type="text"
                          value={editFormData.street || ''}
                          onChange={(e) => updateEditField('street', e.target.value)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                          maxLength={32}
                        />
                      )}
                    </div>

                    {/* Building */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('building')}
                        onChange={(e) => updateOptionalField('building', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Set Venue Building?</label>
                      {isOptionalFieldEnabled('building') && (
                        <input
                          type="text"
                          value={editFormData.building || ''}
                          onChange={(e) => updateEditField('building', e.target.value)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                          maxLength={66}
                        />
                      )}
                    </div>

                    {/* Wheelchair Access */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('wheelChairAccess')}
                        onChange={(e) => updateOptionalField('wheelChairAccess', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Set Venue Wheelchair Access?</label>
                      {isOptionalFieldEnabled('wheelChairAccess') && (
                        <select
                          value={editFormData.wheelChairAccess || ''}
                          onChange={(e) => updateEditField('wheelChairAccess', e.target.value as OptionalSelector)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="">Select wheelchair access</option>
                          {optionalSelectorOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Required Venue Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Floor *
                      </label>
                      <input
                        type="text"
                        value={editFormData.floor || ''}
                        onChange={(e) => updateEditField('floor', e.target.value)}
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
                        value={editFormData.unit || ''}
                        onChange={(e) => updateEditField('unit', e.target.value)}
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
                        value={editFormData.postalCode || ''}
                        onChange={(e) => updateEditField('postalCode', e.target.value)}
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
                        value={editFormData.room || ''}
                        onChange={(e) => updateEditField('room', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                        maxLength={255}
                      />
                    </div>
                  </div>
                </div>

                {/* Course Intake Details */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Course Intake Details</h4>
                  <div className="space-y-3">
                    {/* Intake Size */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('intakeSize')}
                        onChange={(e) => updateOptionalField('intakeSize', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify Intake Size?</label>
                      {isOptionalFieldEnabled('intakeSize') && (
                        <input
                          type="number"
                          min="0"
                          value={editFormData.intakeSize || ''}
                          onChange={(e) => updateEditField('intakeSize', parseInt(e.target.value) || 0)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                        />
                      )}
                    </div>

                    {/* Threshold */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('threshold')}
                        onChange={(e) => updateOptionalField('threshold', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify Threshold?</label>
                      {isOptionalFieldEnabled('threshold') && (
                        <input
                          type="number"
                          min="0"
                          value={editFormData.threshold || ''}
                          onChange={(e) => updateEditField('threshold', parseInt(e.target.value) || 0)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                        />
                      )}
                    </div>

                    {/* Registered User Count */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('registeredUserCount')}
                        onChange={(e) => updateOptionalField('registeredUserCount', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify Registered User Count?</label>
                      {isOptionalFieldEnabled('registeredUserCount') && (
                        <input
                          type="number"
                          min="0"
                          value={editFormData.registeredUserCount || ''}
                          onChange={(e) => updateEditField('registeredUserCount', parseInt(e.target.value) || 0)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* File Details */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">File Details</h4>
                  <div className="space-y-3">
                    {/* File Name */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('fileName')}
                        onChange={(e) => updateOptionalField('fileName', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify File Name?</label>
                      {isOptionalFieldEnabled('fileName') && (
                        <input
                          type="text"
                          value={editFormData.fileName || ''}
                          onChange={(e) => updateEditField('fileName', e.target.value)}
                          className="flex-1 p-2 border border-gray-300 rounded-md"
                          maxLength={255}
                        />
                      )}
                    </div>

                    {/* File Content */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isOptionalFieldEnabled('fileContent')}
                        onChange={(e) => updateOptionalField('fileContent', e.target.checked)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <label className="text-sm font-medium text-gray-700">Specify File Content?</label>
                    </div>
                    {isOptionalFieldEnabled('fileContent') && (
                      <textarea
                        value={editFormData.fileContent || ''}
                        onChange={(e) => updateEditField('fileContent', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md"
                        rows={3}
                      />
                    )}
                  </div>
                </div>

                {/* Multiple Sessions Implementation */}
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      checked={isOptionalFieldEnabled('sessions')}
                      onChange={(e) => updateOptionalField('sessions', e.target.checked)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <label className="text-sm font-medium text-gray-700">Specify Session Details?</label>
                  </div>
                  
                  {isOptionalFieldEnabled('sessions') && (
                    <Card className="border-l-4 border-l-green-500">
                      <CardHeader>
                        <CardTitle className="text-lg">Session Information</CardTitle>
                        <p className="text-sm text-gray-600">
                          Fill in the course session information here. Multiple sessions can be configured.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Number of Sessions */}
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Number of Sessions *
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={sessionCount}
                            onChange={(e) => updateSessionCount(parseInt(e.target.value) || 0)}
                            className="w-32 p-2 border border-gray-300 rounded-md"
                          />
                          <p className="text-xs text-gray-500">
                            Specify how many sessions you want to configure (minimum 0)
                          </p>
                        </div>

                        {/* Session Forms */}
                        {Array.from({ length: sessionCount }, (_, index) => {
                          const sessionIndex = index;
                          const sessionKey = `session_${sessionIndex}`;
                          const sessionInfo = getSessionData(sessionIndex);

                          return (
                            <div key={sessionKey} className="border border-gray-200 rounded-lg p-4 space-y-4">
                              <div className="flex items-center justify-between">
                                <h4 className="text-md font-medium text-gray-800">Session {sessionIndex + 1}</h4>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (sessionCount > 1) {
                                      updateSessionCount(sessionCount - 1);
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-800 text-sm"
                                  disabled={sessionCount <= 1}
                                >
                                  Remove Session
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Session ID *
                                  </label>
                                  <input
                                    type="text"
                                    value={sessionInfo.sessionId || ''}
                                    onChange={(e) => updateSessionField(sessionIndex, 'sessionId', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    placeholder="e.g., TGS-2022014980-1045850-S1"
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={!!sessionInfo.modeOfTraining}
                                    onChange={(e) => {
                                      if (!e.target.checked) {
                                        updateSessionField(sessionIndex, 'modeOfTraining', '');
                                      } else {
                                        updateSessionField(sessionIndex, 'modeOfTraining', ' ');
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600"
                                  />
                                  <label className="text-sm font-medium text-gray-700">Specify Mode of Training?</label>
                                  {!!sessionInfo.modeOfTraining && (
                                    <select
                                      value={sessionInfo.modeOfTraining || ''}
                                      onChange={(e) => updateSessionField(sessionIndex, 'modeOfTraining', e.target.value)}
                                      className="flex-1 p-2 border border-gray-300 rounded-md"
                                    >
                                      <option value="">Select mode</option>
                                      {modeOfTrainingOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-3">
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={!!sessionInfo.sessionStartDate}
                                      onChange={(e) => {
                                        if (!e.target.checked) {
                                          updateSessionField(sessionIndex, 'sessionStartDate', '');
                                        } else {
                                          updateSessionField(sessionIndex, 'sessionStartDate', ' ');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Session Start Date?</label>
                                  </div>
                                  {!!sessionInfo.sessionStartDate && (
                                    <input
                                      type="date"
                                      value={sessionInfo.sessionStartDate || ''}
                                      onChange={(e) => updateSessionField(sessionIndex, 'sessionStartDate', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                  )}
                                  
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={!!sessionInfo.sessionStartTime}
                                      onChange={(e) => {
                                        if (!e.target.checked) {
                                          updateSessionField(sessionIndex, 'sessionStartTime', '');
                                        } else {
                                          updateSessionField(sessionIndex, 'sessionStartTime', ' ');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Session Start Time?</label>
                                  </div>
                                  {!!sessionInfo.sessionStartTime && (
                                    <input
                                      type="time"
                                      value={sessionInfo.sessionStartTime || ''}
                                      onChange={(e) => updateSessionField(sessionIndex, 'sessionStartTime', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                  )}
                                </div>

                                <div className="space-y-3">
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={!!sessionInfo.sessionEndDate}
                                      onChange={(e) => {
                                        if (!e.target.checked) {
                                          updateSessionField(sessionIndex, 'sessionEndDate', '');
                                        } else {
                                          updateSessionField(sessionIndex, 'sessionEndDate', ' ');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Session End Date?</label>
                                  </div>
                                  {!!sessionInfo.sessionEndDate && (
                                    <input
                                      type="date"
                                      value={sessionInfo.sessionEndDate || ''}
                                      onChange={(e) => updateSessionField(sessionIndex, 'sessionEndDate', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                  )}
                                  
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={!!sessionInfo.sessionEndTime}
                                      onChange={(e) => {
                                        if (!e.target.checked) {
                                          updateSessionField(sessionIndex, 'sessionEndTime', '');
                                        } else {
                                          updateSessionField(sessionIndex, 'sessionEndTime', ' ');
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Session End Time?</label>
                                  </div>
                                  {!!sessionInfo.sessionEndTime && (
                                    <input
                                      type="time"
                                      value={sessionInfo.sessionEndTime || ''}
                                      onChange={(e) => updateSessionField(sessionIndex, 'sessionEndTime', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                  )}
                                </div>
                              </div>

                              {/* Session Venue */}
                              <div>
                                <h5 className="text-md font-medium text-gray-700 mb-3">Session Venue *</h5>
                                <div className="space-y-4">
                                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Floor *
                                      </label>
                                      <input
                                        type="text"
                                        value={sessionInfo.sessionFloor || ''}
                                        onChange={(e) => updateSessionField(sessionIndex, 'sessionFloor', e.target.value)}
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
                                        value={sessionInfo.sessionUnit || ''}
                                        onChange={(e) => updateSessionField(sessionIndex, 'sessionUnit', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                        maxLength={5}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Postal Code {sessionInfo.modeOfTraining === '2' || sessionInfo.modeOfTraining === '4' ? '' : '*'}
                                      </label>
                                      <input
                                        type="text"
                                        value={sessionInfo.sessionPostalCode || ''}
                                        onChange={(e) => updateSessionField(sessionIndex, 'sessionPostalCode', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                        maxLength={6}
                                        disabled={sessionInfo.modeOfTraining === '2' || sessionInfo.modeOfTraining === '4'}
                                      />
                                      {(sessionInfo.modeOfTraining === '2' || sessionInfo.modeOfTraining === '4') && (
                                        <p className="text-xs text-gray-500 mt-1">
                                          Not required for {sessionInfo.modeOfTraining === '2' ? 'Asynchronous E-learning' : 'On-the-Job Training'}
                                        </p>
                                      )}
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Room *
                                      </label>
                                      <input
                                        type="text"
                                        value={sessionInfo.sessionRoom || ''}
                                        onChange={(e) => updateSessionField(sessionIndex, 'sessionRoom', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                        maxLength={255}
                                      />
                                    </div>
                                  </div>
                                  
                                  {/* Optional venue fields */}
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={!!sessionInfo.sessionBlock}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateSessionField(sessionIndex, 'sessionBlock', '');
                                          } else {
                                            updateSessionField(sessionIndex, 'sessionBlock', ' ');
                                          }
                                        }}
                                        className="h-4 w-4 text-blue-600"
                                      />
                                      <label className="text-sm font-medium text-gray-700">Specify Block?</label>
                                      {!!sessionInfo.sessionBlock && (
                                        <input
                                          type="text"
                                          value={sessionInfo.sessionBlock || ''}
                                          onChange={(e) => updateSessionField(sessionIndex, 'sessionBlock', e.target.value)}
                                          className="flex-1 p-2 border border-gray-300 rounded-md"
                                          maxLength={10}
                                        />
                                      )}
                                    </div>
                                    
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={!!sessionInfo.sessionStreet}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateSessionField(sessionIndex, 'sessionStreet', '');
                                          } else {
                                            updateSessionField(sessionIndex, 'sessionStreet', ' ');
                                          }
                                        }}
                                        className="h-4 w-4 text-blue-600"
                                      />
                                      <label className="text-sm font-medium text-gray-700">Specify Street?</label>
                                      {!!sessionInfo.sessionStreet && (
                                        <input
                                          type="text"
                                          value={sessionInfo.sessionStreet || ''}
                                          onChange={(e) => updateSessionField(sessionIndex, 'sessionStreet', e.target.value)}
                                          className="flex-1 p-2 border border-gray-300 rounded-md"
                                          maxLength={32}
                                        />
                                      )}
                                    </div>
                                    
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={!!sessionInfo.sessionBuilding}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateSessionField(sessionIndex, 'sessionBuilding', '');
                                          } else {
                                            updateSessionField(sessionIndex, 'sessionBuilding', ' ');
                                          }
                                        }}
                                        className="h-4 w-4 text-blue-600"
                                      />
                                      <label className="text-sm font-medium text-gray-700">Specify Building?</label>
                                      {!!sessionInfo.sessionBuilding && (
                                        <input
                                          type="text"
                                          value={sessionInfo.sessionBuilding || ''}
                                          onChange={(e) => updateSessionField(sessionIndex, 'sessionBuilding', e.target.value)}
                                          className="flex-1 p-2 border border-gray-300 rounded-md"
                                          maxLength={66}
                                        />
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Additional venue options */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={!!sessionInfo.sessionWheelchairAccess}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateSessionField(sessionIndex, 'sessionWheelchairAccess', '');
                                          } else {
                                            updateSessionField(sessionIndex, 'sessionWheelchairAccess', OptionalSelector.NO);
                                          }
                                        }}
                                        className="h-4 w-4 text-blue-600"
                                      />
                                      <label className="text-sm font-medium text-gray-700">Specify Wheelchair Access?</label>
                                      {!!sessionInfo.sessionWheelchairAccess && (
                                        <select
                                          value={sessionInfo.sessionWheelchairAccess || OptionalSelector.NO}
                                          onChange={(e) => updateSessionField(sessionIndex, 'sessionWheelchairAccess', e.target.value)}
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
                                    
                                    <div className="flex items-center space-x-3">
                                      <input
                                        type="checkbox"
                                        checked={!!sessionInfo.sessionPrimaryVenue}
                                        onChange={(e) => {
                                          if (!e.target.checked) {
                                            updateSessionField(sessionIndex, 'sessionPrimaryVenue', '');
                                          } else {
                                            updateSessionField(sessionIndex, 'sessionPrimaryVenue', OptionalSelector.NO);
                                          }
                                        }}
                                        className="h-4 w-4 text-blue-600"
                                      />
                                      <label className="text-sm font-medium text-gray-700">Specify Primary Venue?</label>
                                      {!!sessionInfo.sessionPrimaryVenue && (
                                        <select
                                          value={sessionInfo.sessionPrimaryVenue || OptionalSelector.NO}
                                          onChange={(e) => updateSessionField(sessionIndex, 'sessionPrimaryVenue', e.target.value)}
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
                              </div>
                            </div>
                          );
                        })}

                        {/* Add Session Button */}
                        {sessionCount > 0 && (
                          <button
                            type="button"
                            onClick={() => updateSessionCount(sessionCount + 1)}
                            className="w-full py-2 px-4 border border-gray-300 rounded-md text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            + Add Another Session
                          </button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Trainer Management Section */}
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      checked={isOptionalFieldEnabled('trainers')}
                      onChange={(e) => updateOptionalField('trainers', e.target.checked)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <label className="text-sm font-medium text-gray-700">Specify Trainer Details?</label>
                  </div>
                  
                  {isOptionalFieldEnabled('trainers') && (
                    <Card className="border-l-4 border-l-purple-500">
                      <CardHeader>
                        <CardTitle className="text-lg">Trainer Information</CardTitle>
                        <p className="text-sm text-gray-600">
                          Configure the trainers for this course run. You can link existing trainers or add new ones.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Number of Trainers */}
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Number of Linked Course Run Trainers *
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="99"
                            value={trainerCount}
                            onChange={(e) => updateTrainerCount(parseInt(e.target.value) || 0)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                          />
                          <p className="text-xs text-gray-500">
                            Specify how many trainers you want to configure (minimum 0)
                          </p>
                        </div>

                        {/* Individual Trainer Forms */}
                        {Array.from({ length: trainerCount }, (_, trainerIndex) => {
                          const trainerInfo = trainerData[trainerIndex] || {};
                          
                          return (
                            <div key={trainerIndex} className="space-y-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                              <div className="flex items-center justify-between">
                                <h5 className="text-md font-medium text-gray-800">
                                  Trainer {trainerIndex + 1}
                                </h5>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (trainerCount > 1) {
                                      updateTrainerCount(trainerCount - 1);
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-800 text-sm"
                                  disabled={trainerCount <= 1}
                                >
                                  Remove Trainer
                                </button>
                              </div>

                              {/* Trainer Type */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Trainer Type *
                                </label>
                                <select
                                  value={trainerInfo.trainerTypeCode || ''}
                                  onChange={(e) => updateTrainerField(trainerIndex, 'trainerTypeCode', e.target.value)}
                                  className="w-full p-2 border border-gray-300 rounded-md"
                                >
                                  <option value="">Select trainer type</option>
                                  <option value="1">1 - Existing</option>
                                  <option value="2">2 - New</option>
                                </select>
                              </div>

                              {/* Existing Trainer Fields */}
                              {trainerInfo.trainerTypeCode === '1' && (
                                <div className="space-y-3">
                                  <h6 className="text-sm font-medium text-gray-700">Existing Trainer Information</h6>
                                  
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Trainer ID Number *
                                    </label>
                                    <input
                                      type="text"
                                      value={trainerInfo.trainerIdNumber || ''}
                                      onChange={(e) => updateTrainerField(trainerIndex, 'trainerIdNumber', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      maxLength={50}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* New Trainer Fields */}
                              {trainerInfo.trainerTypeCode === '2' && (
                                <div className="space-y-4">
                                  <h6 className="text-sm font-medium text-gray-700">New Trainer Information</h6>
                                  
                                  {/* Optional Trainer Index */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerIndexNumber !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerIndexNumber', 0);
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerIndexNumber', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Trainer Index Number?</label>
                                    {trainerInfo.trainerIndexNumber !== undefined && (
                                      <input
                                        type="number"
                                        min="0"
                                        value={trainerInfo.trainerIndexNumber}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerIndexNumber', parseInt(e.target.value) || 0)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                      />
                                    )}
                                  </div>

                                  {/* Optional Trainer ID */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerUniqueId !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerUniqueId', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerUniqueId', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Trainer ID?</label>
                                    {trainerInfo.trainerUniqueId !== undefined && (
                                      <input
                                        type="text"
                                        value={trainerInfo.trainerUniqueId}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerUniqueId', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={50}
                                      />
                                    )}
                                  </div>

                                  {/* Required Name and Email */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Trainer Name *
                                      </label>
                                      <input
                                        type="text"
                                        value={trainerInfo.trainerName || ''}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerName', e.target.value)}
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
                                        value={trainerInfo.trainerEmail || ''}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerEmail', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                        maxLength={320}
                                      />
                                    </div>
                                  </div>

                                  {/* ID Type and Number */}
                                  <div>
                                    <h6 className="text-sm font-medium text-gray-700 mb-2">Trainer ID</h6>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Trainer ID Code *
                                        </label>
                                        <select
                                          value={trainerInfo.trainerIdType || ''}
                                          onChange={(e) => updateTrainerField(trainerIndex, 'trainerIdType', e.target.value)}
                                          className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                          <option value="">Select ID type</option>
                                          <option value="SB">Singapore Blue IC</option>
                                          <option value="SP">Singapore Pink IC</option>
                                          <option value="FIN">FIN/Work Permit</option>
                                          <option value="OTHERS">Others</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Trainer ID Number *
                                        </label>
                                        <input
                                          type="text"
                                          value={trainerInfo.trainerIdNumber || ''}
                                          onChange={(e) => updateTrainerField(trainerIndex, 'trainerIdNumber', e.target.value)}
                                          className="w-full p-2 border border-gray-300 rounded-md"
                                          maxLength={50}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Optional Training Provider Profile */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerInTrainingProviderProfile !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerInTrainingProviderProfile', OptionalSelector.YES);
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerInTrainingProviderProfile', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify In Training Provider Profile?</label>
                                    {trainerInfo.trainerInTrainingProviderProfile !== undefined && (
                                      <select
                                        value={trainerInfo.trainerInTrainingProviderProfile}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerInTrainingProviderProfile', e.target.value as OptionalSelector)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                      >
                                        <option value={OptionalSelector.YES}>Yes</option>
                                        <option value={OptionalSelector.NO}>No</option>
                                      </select>
                                    )}
                                  </div>

                                  {/* Optional Domain Area of Practice */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerDomainAreaOfPractice !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerDomainAreaOfPractice', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerDomainAreaOfPractice', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Domain Area of Practice?</label>
                                  </div>
                                  {trainerInfo.trainerDomainAreaOfPractice !== undefined && (
                                    <textarea
                                      value={trainerInfo.trainerDomainAreaOfPractice}
                                      onChange={(e) => updateTrainerField(trainerIndex, 'trainerDomainAreaOfPractice', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      rows={3}
                                      maxLength={1000}
                                    />
                                  )}

                                  {/* Optional Experience */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerExperience !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerExperience', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerExperience', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Experience?</label>
                                  </div>
                                  {trainerInfo.trainerExperience !== undefined && (
                                    <textarea
                                      value={trainerInfo.trainerExperience}
                                      onChange={(e) => updateTrainerField(trainerIndex, 'trainerExperience', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      rows={3}
                                      maxLength={1000}
                                    />
                                  )}

                                  {/* Optional LinkedIn URL */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerLinkedinURL !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerLinkedinURL', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerLinkedinURL', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify LinkedIn URL?</label>
                                    {trainerInfo.trainerLinkedinURL !== undefined && (
                                      <input
                                        type="url"
                                        value={trainerInfo.trainerLinkedinURL}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerLinkedinURL', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={255}
                                      />
                                    )}
                                  </div>

                                  {/* Optional Salutation */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerSalutationId !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerSalutationId', 'MR');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerSalutationId', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Salutation ID?</label>
                                    {trainerInfo.trainerSalutationId !== undefined && (
                                      <select
                                        value={trainerInfo.trainerSalutationId}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerSalutationId', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                      >
                                        <option value="MR">Mr</option>
                                        <option value="MS">Ms</option>
                                        <option value="MRS">Mrs</option>
                                        <option value="MDM">Mdm</option>
                                        <option value="DR">Dr</option>
                                        <option value="PROF">Prof</option>
                                      </select>
                                    )}
                                  </div>

                                  {/* Optional Photo Name */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerPhotoName !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerPhotoName', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerPhotoName', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Photo Name?</label>
                                    {trainerInfo.trainerPhotoName !== undefined && (
                                      <input
                                        type="text"
                                        value={trainerInfo.trainerPhotoName}
                                        onChange={(e) => updateTrainerField(trainerIndex, 'trainerPhotoName', e.target.value)}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        maxLength={255}
                                      />
                                    )}
                                  </div>

                                  {/* Optional Photo Content */}
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={trainerInfo.trainerPhotoContent !== undefined}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateTrainerField(trainerIndex, 'trainerPhotoContent', '');
                                        } else {
                                          updateTrainerField(trainerIndex, 'trainerPhotoContent', undefined);
                                        }
                                      }}
                                      className="h-4 w-4 text-blue-600"
                                    />
                                    <label className="text-sm font-medium text-gray-700">Specify Photo Content?</label>
                                  </div>
                                  {trainerInfo.trainerPhotoContent !== undefined && (
                                    <textarea
                                      value={trainerInfo.trainerPhotoContent}
                                      onChange={(e) => updateTrainerField(trainerIndex, 'trainerPhotoContent', e.target.value)}
                                      className="w-full p-2 border border-gray-300 rounded-md"
                                      rows={2}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Add Trainer Button */}
                        {trainerCount > 0 && (
                          <button
                            type="button"
                            onClick={() => updateTrainerCount(trainerCount + 1)}
                            className="w-full py-2 px-4 border border-gray-300 rounded-md text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            + Add Another Trainer
                          </button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {action === 'delete' && (
            <Card className="border-l-4 border-l-red-500">
              <CardHeader>
                <CardTitle className="text-red-700">Delete Course Run</CardTitle>
                <p className="text-sm text-gray-600">
                  This action will permanently delete the course run. This cannot be undone.
                </p>
              </CardHeader>
              <CardContent>
                <Alert variant="destructive">
                  <div className="text-sm">
                    <strong>Warning:</strong> You are about to delete the course run with ID: {courseRunId || 'Not specified'}
                    <br />
                    This action cannot be undone. Please make sure you have the correct Course Run ID.
                  </div>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            {/* Debug Button - Test Request Construction */}
            <Button
              onClick={() => {
                let debugRequestBody;
                if (action === 'delete') {
                  debugRequestBody = { courseReferenceNumber };
                } else {
                  debugRequestBody = { 
                    ...editFormData, 
                    courseReferenceNumber 
                  };
                  
                  if (isOptionalFieldEnabled('sessions') && sessionCount > 0) {
                    const sessions = [];
                    for (let i = 0; i < sessionCount; i++) {
                      const session = getSessionData(i);
                      if (session && Object.keys(session).length > 0) {
                        // Transform session field names to match server expectations
                        const transformedSession: any = {};
                        
                        // Map frontend session field names to backend expected names
                        if (session.sessionId) transformedSession.sessionId = session.sessionId;
                        if (session.modeOfTraining) transformedSession.modeOfTraining = session.modeOfTraining;
                        
                        // Date fields: sessionStartDate -> startDate, sessionEndDate -> endDate
                        if (session.sessionStartDate) transformedSession.startDate = session.sessionStartDate;
                        if (session.sessionEndDate) transformedSession.endDate = session.sessionEndDate;
                        if (session.sessionStartTime) transformedSession.startTime = session.sessionStartTime;
                        if (session.sessionEndTime) transformedSession.endTime = session.sessionEndTime;
                        
                        // Venue fields: sessionFloor -> floor, etc.
                        if (session.sessionBlock) transformedSession.block = session.sessionBlock;
                        if (session.sessionStreet) transformedSession.street = session.sessionStreet;
                        if (session.sessionFloor) transformedSession.floor = session.sessionFloor;
                        if (session.sessionUnit) transformedSession.unit = session.sessionUnit;
                        if (session.sessionBuilding) transformedSession.building = session.sessionBuilding;
                        if (session.sessionPostalCode) transformedSession.postalCode = session.sessionPostalCode;
                        if (session.sessionRoom) transformedSession.room = session.sessionRoom;
                        if (session.sessionWheelchairAccess) transformedSession.wheelChairAccess = session.sessionWheelchairAccess;
                        if (session.sessionPrimaryVenue) transformedSession.primaryVenue = session.sessionPrimaryVenue;
                        
                        sessions.push(transformedSession);
                      }
                    }
                    if (sessions.length > 0) {
                      debugRequestBody.sessions = sessions;
                    }
                  }
                  
                  if (isOptionalFieldEnabled('trainers') && trainerCount > 0) {
                    const trainers = [];
                    for (let i = 0; i < trainerCount; i++) {
                      const trainer = getTrainerData(i);
                      if (trainer && Object.keys(trainer).length > 0) {
                        // Transform trainer field names to match server expectations
                        const transformedTrainer: any = {};
                        
                        // Map frontend trainer field names to backend expected names
                        if (trainer.trainerTypeCode) {
                          transformedTrainer.trainerTypeCode = trainer.trainerTypeCode;
                          // Add description based on type code
                          transformedTrainer.trainerTypeDescription = trainer.trainerTypeCode === '1' ? 'Existing' : 'New';
                        }
                        
                        // Basic trainer fields
                        if (trainer.trainerIdNumber) transformedTrainer.trainerIdNumber = trainer.trainerIdNumber;
                        if (trainer.trainerIndexNumber !== undefined) transformedTrainer.trainerIndexNumber = trainer.trainerIndexNumber;
                        if (trainer.trainerUniqueId) transformedTrainer.trainerUniqueId = trainer.trainerUniqueId;
                        if (trainer.trainerName) transformedTrainer.trainerName = trainer.trainerName;
                        if (trainer.trainerEmail) transformedTrainer.trainerEmail = trainer.trainerEmail;
                        if (trainer.trainerIdType) transformedTrainer.idType = trainer.trainerIdType;
                        
                        // Optional trainer fields
                        if (trainer.trainerInTrainingProviderProfile) transformedTrainer.inTrainingProviderProfile = trainer.trainerInTrainingProviderProfile;
                        if (trainer.trainerDomainAreaOfPractice) transformedTrainer.domainAreaOfPractice = trainer.trainerDomainAreaOfPractice;
                        if (trainer.trainerExperience) transformedTrainer.experience = trainer.trainerExperience;
                        if (trainer.trainerLinkedinURL) transformedTrainer.linkedinURL = trainer.trainerLinkedinURL;
                        if (trainer.trainerSalutationId) transformedTrainer.salutationId = trainer.trainerSalutationId;
                        if (trainer.trainerPhotoName) transformedTrainer.photoName = trainer.trainerPhotoName;
                        if (trainer.trainerPhotoContent) transformedTrainer.photoContent = trainer.trainerPhotoContent;
                        
                        // Add roles if trainer type is Existing and trainer roles exist
                        if (trainer.trainerRoles && Array.isArray(trainer.trainerRoles) && trainer.trainerRoles.length > 0) {
                          transformedTrainer.trainerRoles = trainer.trainerRoles;
                        }
                        
                        trainers.push(transformedTrainer);
                      }
                    }
                    if (trainers.length > 0) {
                      debugRequestBody.linkCourseRunTrainer = trainers;
                    }
                  }
                }
                
                console.log('=== DEBUG REQUEST BODY ===');
                console.log(debugRequestBody);
                console.log('Session count:', sessionCount);
                console.log('Session data:', sessionData);
                console.log('Trainer count:', trainerCount);
                console.log('Trainer data:', trainerData);
                console.log('Optional fields enabled:', optionalFields);
                
                alert('Debug info logged to console. Check browser developer tools console.');
              }}
              variant="outline"
              className="px-4 py-2 text-gray-600 border-gray-300"
            >
              Debug Request
            </Button>
            
            <Button
              onClick={handleSubmit}
              disabled={loading || !courseRunId.trim()}
              className={`px-6 py-2 ${
                action === 'delete' 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {loading ? (action === 'delete' ? 'Deleting...' : 'Updating...') : (action === 'delete' ? 'Delete Course Run' : 'Update Course Run')}
            </Button>
          </div>

          {/* Response Display */}
          {response && (
            <Alert variant={(response.status === 200 || response.status === 201) ? 'default' : 'destructive'}>
              <div className="text-sm">
                {(response.status === 200 || response.status === 201) ? (
                  <div>
                    <strong>Success (Status {response.status}):</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(response, null, 2)}</pre>
                  </div>
                ) : (
                  <div>
                    <strong>Error (Status {response.status || 'Unknown'}):</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(response, null, 2)}</pre>
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