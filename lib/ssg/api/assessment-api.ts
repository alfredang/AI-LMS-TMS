/**
 * SSG Assessment API client
 * Covers: create, view, search, update/void assessments
 * Mirrors Python core/assessments/ modules
 */

import { HttpClient, HTTPRequestBuilder, HttpMethod, handleRequest } from '../utils/http-utils';
import { Cryptography } from '../utils/cryptography';
import { SSGCredentials } from '../services/credentials-service';
import { SSGApiResponse } from '../models/course-runs';
import {
  CreateAssessmentPayload,
  SearchAssessmentPayload,
  UpdateVoidAssessmentPayload,
  CreateAssessmentResponse,
  SearchAssessmentResponse,
  ViewAssessmentResponse
} from '../models/assessment';

export class SSGAssessmentAPI {
  private httpClient: HttpClient;
  private baseUrl: string;
  private credentials: SSGCredentials;

  constructor(baseUrl: string, credentials: SSGCredentials) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.httpClient = new HttpClient(baseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private encryptAndBuild(path: string): HTTPRequestBuilder {
    const builder = new HTTPRequestBuilder()
      .withEndpoint(this.baseUrl, path)
      .withMethod(HttpMethod.POST);

    if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
      builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
    }
    return builder;
  }

  private encrypt(payload: object): string {
    if (!this.credentials.encryptionKey) throw new Error('Encryption key is required');
    return Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
  }

  private removeNullFields(obj: any): any {
    if (obj === null || obj === undefined) return undefined;
    if (Array.isArray(obj)) return obj.map(i => this.removeNullFields(i)).filter(i => i !== undefined);
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(obj)) {
        const val = this.removeNullFields(v);
        if (val !== undefined) cleaned[k] = val;
      }
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }
    return obj;
  }

  // ── Create Assessment ──────────────────────────────────────────────────────

  async createAssessment(payload: CreateAssessmentPayload): Promise<CreateAssessmentResponse> {
    try {
      const builder = this.encryptAndBuild('/tpg/assessments');
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'CREATE_ASSESSMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── View Assessment ────────────────────────────────────────────────────────

  async viewAssessment(assessmentReferenceNumber: string): Promise<ViewAssessmentResponse> {
    try {
      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/tpg/assessments/${assessmentReferenceNumber}`)
        .withMethod(HttpMethod.GET)
        .withParam('uen', this.credentials.uen);

      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'VIEW_ASSESSMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Search Assessment ──────────────────────────────────────────────────────

  async searchAssessment(payload: SearchAssessmentPayload): Promise<SearchAssessmentResponse> {
    try {
      const builder = this.encryptAndBuild('/tpg/assessments/search');
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'SEARCH_ASSESSMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Update / Void Assessment ───────────────────────────────────────────────

  async updateOrVoidAssessment(assessmentReferenceNumber: string, payload: UpdateVoidAssessmentPayload): Promise<SSGApiResponse<any>> {
    try {
      const builder = this.encryptAndBuild(`/tpg/assessments/${assessmentReferenceNumber}`);
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'UPDATE_VOID_ASSESSMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  updateCredentials(credentials: SSGCredentials): void {
    this.credentials = credentials;
  }
}

export const createSSGAssessmentAPI = (baseUrl: string, credentials: SSGCredentials): SSGAssessmentAPI =>
  new SSGAssessmentAPI(baseUrl, credentials);
