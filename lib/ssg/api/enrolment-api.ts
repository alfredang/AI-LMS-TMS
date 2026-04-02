/**
 * SSG Enrolment API client
 * Covers: create, view, search, update, update-fee-collection, cancel enrolments
 * Mirrors Python core/enrolment/ modules
 */

import { HttpClient, HTTPRequestBuilder, HttpMethod, handleRequest } from '../utils/http-utils';
import { Cryptography } from '../utils/cryptography';
import { SSGCredentials } from '../services/credentials-service';
import { SSGApiResponse } from '../models/course-runs';
import {
  CreateEnrolmentPayload,
  SearchEnrolmentPayload,
  UpdateEnrolmentPayload,
  UpdateFeeCollectionPayload,
  CancelEnrolmentPayload,
  CreateEnrolmentResponse,
  SearchEnrolmentResponse,
  ViewEnrolmentResponse
} from '../models/enrolment';

export class SSGEnrolmentAPI {
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

  /**
   * SSG API responses are AES-256-CBC encrypted. Decrypt and parse the nested result.
   * Returns { data, status, error } mirroring SSGApiResponse.
   */
  private decryptSSGResponse<T>(raw: SSGApiResponse<any>): SSGApiResponse<T> {
    if (raw.error && !raw.data) return raw;
    try {
      const decrypted = Cryptography.decryptJSON(this.credentials.encryptionKey, raw.data);
      console.log('📦 SSG decrypted response:', JSON.stringify(decrypted, null, 2));
      const hasError = decrypted?.error && Object.keys(decrypted.error).length > 0;
      if (hasError) {
        console.error('❌ SSG API error in response:', JSON.stringify(decrypted.error, null, 2));
      }
      return {
        data: decrypted?.data ?? decrypted,
        status: Number(decrypted?.status ?? raw.status),
        error: hasError ? decrypted.error : undefined
      };
    } catch (e) {
      console.error('❌ Failed to decrypt SSG response:', e);
      return { error: { code: 'DECRYPT_ERROR', message: 'Failed to decrypt SSG response' }, status: raw.status };
    }
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

  // ── Create Enrolment ───────────────────────────────────────────────────────

  async createEnrolment(payload: CreateEnrolmentPayload): Promise<CreateEnrolmentResponse> {
    try {
      const builder = this.encryptAndBuild('/tpg/enrolments');
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'CREATE_ENROLMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── View Enrolment ─────────────────────────────────────────────────────────

  async viewEnrolment(enrolmentReferenceNumber: string): Promise<ViewEnrolmentResponse> {
    try {
      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/tpg/enrolments/details/${enrolmentReferenceNumber}`)
        .withMethod(HttpMethod.GET)
        .withParam('uen', this.credentials.uen);

      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Get the raw HTTP response — do NOT JSON-parse before decrypting
      const config = builder.build();
      const httpResponse = await this.httpClient.request(config);

      if (httpResponse.status !== 200) {
        return { error: { code: String(httpResponse.status), message: httpResponse.statusText || 'Request failed' }, status: httpResponse.status };
      }

      // Decrypt the raw response body directly (same as JS implementation)
      const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
      console.log('🔍 rawBody type:', typeof httpResponse.data, '| preview:', rawBody.slice(0, 120));

      const encKey = Buffer.from(this.credentials.encryptionKey, 'base64');
      const iv = Buffer.from('SSGAPIInitVector', 'utf8');
      const crypto = require('crypto');
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
      let decrypted = decipher.update(rawBody, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      const parsed = JSON.parse(decrypted);
      console.log('✅ Decrypted view enrolment status:', parsed?.status);

      if (parsed?.status && String(parsed.status) !== '200') {
        return { error: parsed?.error ?? { code: String(parsed.status), message: 'SSG error' }, status: Number(parsed.status) };
      }

      return { data: parsed?.data ?? parsed, status: Number(parsed?.status ?? 200) };
    } catch (err) {
      return { error: { code: 'VIEW_ENROLMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Search Enrolment ───────────────────────────────────────────────────────

  async searchEnrolment(payload: SearchEnrolmentPayload): Promise<SearchEnrolmentResponse> {
    try {
      const builder = this.encryptAndBuild('/tpg/enrolments/search');
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      const raw = await handleRequest(this.httpClient, builder.build());
      return this.decryptSSGResponse(raw);
    } catch (err) {
      return { error: { code: 'SEARCH_ENROLMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Update Enrolment ───────────────────────────────────────────────────────

  async updateEnrolment(enrolmentReferenceNumber: string, payload: UpdateEnrolmentPayload): Promise<SSGApiResponse<any>> {
    try {
      const builder = this.encryptAndBuild(`/tpg/enrolments/${enrolmentReferenceNumber}`);
      builder.withParam('uen', this.credentials.uen);
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      const raw = await handleRequest(this.httpClient, builder.build());
      return this.decryptSSGResponse(raw);
    } catch (err) {
      return { error: { code: 'UPDATE_ENROLMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Update Fee Collection ──────────────────────────────────────────────────

  async updateFeeCollection(enrolmentReferenceNumber: string, payload: UpdateFeeCollectionPayload): Promise<SSGApiResponse<any>> {
    try {
      const builder = this.encryptAndBuild(`/tpg/enrolments/feeCollections/${enrolmentReferenceNumber}`);
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      const raw = await handleRequest(this.httpClient, builder.build());
      return this.decryptSSGResponse(raw);
    } catch (err) {
      return { error: { code: 'UPDATE_FEE_COLLECTION_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── Cancel Enrolment ───────────────────────────────────────────────────────

  async cancelEnrolment(enrolmentReferenceNumber: string, payload: CancelEnrolmentPayload): Promise<SSGApiResponse<any>> {
    try {
      const builder = this.encryptAndBuild(`/tpg/enrolments/${enrolmentReferenceNumber}/cancel`);
      builder.withBody(this.encrypt(this.removeNullFields(payload)));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'CANCEL_ENROLMENT_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  updateCredentials(credentials: SSGCredentials): void {
    this.credentials = credentials;
  }
}

export const createSSGEnrolmentAPI = (baseUrl: string, credentials: SSGCredentials): SSGEnrolmentAPI =>
  new SSGEnrolmentAPI(baseUrl, credentials);
