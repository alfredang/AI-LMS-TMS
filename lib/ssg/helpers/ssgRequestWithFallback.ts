/**
 * SSG Request with Certificate Fallback
 *
 * Tries the selected app first, then falls back through app1 → app2 → app3
 * if the request returns 401 or 403 (auth failure).
 */

import { getSSGCredentialsService, SSGCredentials } from '../services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../utils/http-utils';

const FALLBACK_ORDER = ['app1', 'app2', 'app3'];

interface SsgRequestOptions {
  /** The API path (e.g. '/grantCalculators/individual') */
  path: string;
  /** HTTP method */
  method: HttpMethod;
  /** Request body (will be sent as-is if string, JSON.stringify'd if object) */
  body?: any;
  /** Extra headers */
  headers?: Record<string, string>;
  /** The user-selected app (from SSG App Selector or request header) */
  selectedApp?: string;
}

interface SsgResponse {
  status: number;
  data: any;
  usedApp: string;
  credentials: SSGCredentials;
}

export async function ssgRequestWithFallback(options: SsgRequestOptions): Promise<SsgResponse> {
  const { path, method, body, headers = {}, selectedApp } = options;

  // Build the list of apps to try: selected app first, then fallback order (skip duplicates)
  const appsToTry: string[] = [];
  if (selectedApp) appsToTry.push(selectedApp);
  for (const app of FALLBACK_ORDER) {
    if (!appsToTry.includes(app)) appsToTry.push(app);
  }

  let lastError: any = null;
  let lastStatus = 0;
  let lastData: any = null;

  for (const app of appsToTry) {
    try {
      const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app);
      if (!credentials) {
        console.warn(`[ssg-fallback] No credentials for ${app}, skipping`);
        continue;
      }

      // Skip if no cert content (can't authenticate)
      if (!credentials.certificateContent && !credentials.privateKeyContent && !credentials.oauthClientId) {
        console.warn(`[ssg-fallback] No cert/key/oauth for ${app}, skipping`);
        continue;
      }

      const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

      const builder = new HTTPRequestBuilder()
        .withEndpoint(ssgBaseUrl, path)
        .withMethod(method);

      // Add headers
      for (const [key, value] of Object.entries(headers)) {
        builder.withHeader(key, value);
      }

      // Add body
      if (body !== undefined) {
        builder.withBody(body);
      }

      // Add auth
      if (credentials.oauthClientId && credentials.oauthClientSecret) {
        const basic = Buffer.from(`${credentials.oauthClientId}:${credentials.oauthClientSecret}`).toString('base64');
        const tokenResp = await fetch(`${ssgBaseUrl}/dp-oauth/oauth/token`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
        if (tokenResp.ok) {
          const tokenData = await tokenResp.json();
          builder.withHeader('Authorization', `Bearer ${tokenData.access_token}`);
        }
      } else if (credentials.certificateContent && credentials.privateKeyContent) {
        builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
      }

      const httpClient = new HttpClient(ssgBaseUrl, {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });

      const resp = await httpClient.request(builder.build());

      // Success — return immediately
      if (resp.status >= 200 && resp.status < 400) {
        if (app !== appsToTry[0]) {
          console.log(`[ssg-fallback] ${appsToTry[0]} failed, succeeded with ${app} for ${path}`);
        }
        return { status: resp.status, data: resp.data, usedApp: app, credentials };
      }

      // Auth failure — try next app
      if (resp.status === 401 || resp.status === 403) {
        console.warn(`[ssg-fallback] ${app} returned ${resp.status} for ${path}, trying next...`);
        lastStatus = resp.status;
        lastData = resp.data;
        continue;
      }

      // Other error — return as-is (not an auth issue)
      return { status: resp.status, data: resp.data, usedApp: app, credentials };

    } catch (err) {
      console.warn(`[ssg-fallback] ${app} threw error for ${path}:`, err instanceof Error ? err.message : err);
      lastError = err;
      continue;
    }
  }

  // All apps failed
  throw new Error(
    lastError?.message ||
    `All SSG apps failed for ${path}. Last status: ${lastStatus}. Details: ${JSON.stringify(lastData)}`
  );
}
