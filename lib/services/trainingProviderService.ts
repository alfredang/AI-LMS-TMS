import { apiClient } from './apiClient';

export interface TrainingProviderData {
  companyLogoUrl: string;
  companyName: string;
  companyShortname: string;
  enableOtpLogin: boolean;
  enableDefaultOtp: boolean;
  defaultOtp: string;
  colorScheme: string | null;
  forceFirstPasswordChange: boolean;
}

export interface TrainingProviderResponse {
  success: boolean;
  data?: TrainingProviderData;
  error?: string;
}

export const trainingProviderService = {
  async getTrainingProviderInfo(): Promise<TrainingProviderResponse> {
    try {
      console.log('🔍 trainingProviderService: Making API call to /api/training-provider/info');
      const response = await apiClient.get('/api/training-provider/info') as TrainingProviderResponse;
      console.log('🔍 trainingProviderService: Raw response from apiClient:', response);
      console.log('🔍 trainingProviderService: response.success:', response.success);
      console.log('🔍 trainingProviderService: response.data:', response.data);
      return response;
    } catch (error) {
      console.error('❌ trainingProviderService: Error fetching training provider info:', error);
      return {
        success: false,
        error: 'Failed to fetch training provider information'
      };
    }
  }
};