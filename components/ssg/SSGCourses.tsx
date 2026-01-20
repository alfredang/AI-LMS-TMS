/**
 * SSG Courses Management Component
 * Converted from Python Streamlit page app/pages/1_📚Courses.py
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/Card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui/Tabs';
import { Alert, AlertDescription } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Info, AlertTriangle } from 'lucide-react';
import ViewCourseRun from './ViewCourseRun';
import { AddCourseRuns } from './AddCourseRuns';
import { EditDeleteCourseRuns } from './EditDeleteCourseRuns';
import ViewCourseSessions from './ViewCourseSessions';
import EncryptionDecryption from './EncryptionDecryption';
import { SSGConfig, SSGCoursesProps } from './types';

const SSGCourses: React.FC<SSGCoursesProps> = ({
  apiEndpoint = ''
}) => {
  const [config, setConfig] = useState<SSGConfig>({
    apiEndpoint,
    selectedTrainingProviderId: '',
    availableProviders: []
  });
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState('view');

  // Load configuration and available training providers on component mount
  useEffect(() => {
    const savedConfig = localStorage.getItem('ssg-config');
    if (savedConfig) {
      try {
        const parsedConfig = JSON.parse(savedConfig);
        setConfig(prev => ({ ...prev, ...parsedConfig }));
      } catch (error) {
        console.error('Failed to parse saved SSG config:', error);
      }
    }

    // Load available training providers
    loadTrainingProviders();
  }, []);

  const loadTrainingProviders = async () => {
    try {
      const response = await fetch('/api/ssg/training-providers');
      const data = await response.json();
      
      if (data.success) {
        setConfig(prev => ({ 
          ...prev, 
          availableProviders: data.data,
          selectedTrainingProviderId: prev.selectedTrainingProviderId || (data.data[0]?.id?.toString() || '')
        }));
      }
    } catch (error) {
      console.error('Failed to load training providers:', error);
    }
  };

  // Save configuration to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ssg-config', JSON.stringify(config));
  }, [config]);

  const updateConfig = (updates: Partial<SSGConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const ConfigDisplay = () => {
    const provider = config.availableProviders[0]; // Use the first (and only) provider

    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Current Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">API Endpoint:</label>
            <p className="text-sm text-gray-600 break-all">{config.apiEndpoint || 'Not set'}</p>
          </div>
          <div>
            <label className="text-sm font-medium">Training Provider UEN:</label>
            <p className="text-sm text-gray-600">
              {provider ? `${provider.uen}` : 'Loading...'}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium">Status:</label>
            <p className="text-sm text-gray-600">
              {config.availableProviders.length > 0 ? 'Ready for SSG operations' : 'Loading training provider...'}
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowConfig(false)}
          >
            Hide Configuration
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">SSG Courses API</h1>
            <p className="text-gray-600 mt-2">
              The Courses API allows you to search, filter and compare different SkillsFuture Credit 
              eligible courses that have been published on the MySkillsFuture portal!
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfig(!showConfig)}
            >
              {showConfig ? 'Hide' : 'Show'} Config
            </Button>
          </div>
        </div>

        {/* Configuration Display */}
        {showConfig && <ConfigDisplay />}

        {/* Important Notices */}
        <Alert className="mb-4">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <p><strong>Add Course Runs</strong> and <strong>Edit/Delete Course Runs</strong> require your <em>request payloads</em> to be encrypted!</p>
              <p><strong>View Course Runs</strong> and <strong>View Course Sessions</strong> do not require any encryption!</p>
            </div>
          </AlertDescription>
        </Alert>

        {config.availableProviders.length === 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Loading training provider credentials...</strong> Please wait while the system loads your training provider configuration from the database.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="view">View Course Runs</TabsTrigger>
          <TabsTrigger value="add">Add Course Runs</TabsTrigger>
          <TabsTrigger value="edit">Edit/Delete Course Runs</TabsTrigger>
          <TabsTrigger value="sessions">View Course Sessions</TabsTrigger>
          <TabsTrigger value="crypto">En-Decryption</TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="mt-6">
          <ViewCourseRun 
            config={config} 
            updateConfig={updateConfig}
          />
        </TabsContent>

        <TabsContent value="add" className="mt-6">
          <AddCourseRuns />
        </TabsContent>

        <TabsContent value="edit" className="mt-6">
          <EditDeleteCourseRuns />
        </TabsContent>

        <TabsContent value="sessions" className="mt-6">
          <ViewCourseSessions 
            config={config} 
            updateConfig={updateConfig}
          />
        </TabsContent>

        <TabsContent value="crypto" className="mt-6">
          <EncryptionDecryption 
            config={config} 
            updateConfig={updateConfig}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SSGCourses;