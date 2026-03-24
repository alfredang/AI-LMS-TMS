/**
 * SSG Attendance API client
 * Covers: upload course session attendance, view attendance
 * Mirrors Python core/attendance/ modules
 */

import { HttpClient, HTTPRequestBuilder, HttpMethod, handleRequest } from '../utils/http-utils';
import { Cryptography } from '../utils/cryptography';
import { SSGCredentials } from '../services/credentials-service';
import { SSGApiResponse } from '../models/course-runs';
import {
  UploadAttendancePayload,
  UploadAttendanceResponse,
  ViewAttendanceResponse
} from '../models/attendance';

export class SSGAttendanceAPI {
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

  private encrypt(payload: object): string {
    if (!this.credentials.encryptionKey) throw new Error('Encryption key is required');
    return Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
  }

  private withCert(builder: HTTPRequestBuilder): HTTPRequestBuilder {
    if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
      builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
    }
    return builder;
  }

  // ── Upload Attendance ──────────────────────────────────────────────────────

  /**
   * Upload attendance for a single trainee in a course session.
   * @param runId  - SSG course run ID (e.g. "1067920")
   * @param payload - Attendance payload
   */
  async uploadAttendance(runId: string, payload: UploadAttendancePayload): Promise<UploadAttendanceResponse> {
    try {
      const builder = this.withCert(
        new HTTPRequestBuilder()
          .withEndpoint(this.baseUrl, `/courses/runs/${runId}/sessions/attendance`)
          .withMethod(HttpMethod.POST)
      );
      builder.withBody(this.encrypt(payload));
      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'UPLOAD_ATTENDANCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  // ── View Attendance ────────────────────────────────────────────────────────

  /**
   * View attendance records for a course run.
   * @param runId               - SSG course run ID
   * @param courseReferenceNumber - SSG course reference number (e.g. "TGS-2020505315")
   * @param sessionId           - Optional session ID to filter
   */
  async viewAttendance(runId: string, courseReferenceNumber: string, sessionId?: string): Promise<ViewAttendanceResponse> {
    try {
      const builder = this.withCert(
        new HTTPRequestBuilder()
          .withEndpoint(this.baseUrl, `/courses/runs/${runId}/sessions/attendance`)
          .withMethod(HttpMethod.GET)
          .withParam('uen', this.credentials.uen)
          .withParam('courseReferenceNumber', courseReferenceNumber)
      );

      if (sessionId) builder.withParam('sessionId', sessionId);

      return await handleRequest(this.httpClient, builder.build());
    } catch (err) {
      return { error: { code: 'VIEW_ATTENDANCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }, status: 0 };
    }
  }

  updateCredentials(credentials: SSGCredentials): void {
    this.credentials = credentials;
  }
}

export const createSSGAttendanceAPI = (baseUrl: string, credentials: SSGCredentials): SSGAttendanceAPI =>
  new SSGAttendanceAPI(baseUrl, credentials);
