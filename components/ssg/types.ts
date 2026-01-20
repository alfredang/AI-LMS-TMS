/**
 * Shared types for SSG components
 */

export interface SSGConfig {
  apiEndpoint: string;
  selectedTrainingProviderId: string;
  availableProviders: Array<{ id: number; uen: string; name?: string }>;
}

export interface SSGCoursesProps {
  apiEndpoint?: string;
}