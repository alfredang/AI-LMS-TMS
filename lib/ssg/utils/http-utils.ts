/**
 * HTTP utilities for SSG API interactions
 * Converted from Python http_utils.py
 */

import { SSGApiResponse } from '../models/course-runs';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH'
}

export interface HttpRequestConfig {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: any;
  timeout?: number;
  cert?: string;  // Certificate content for mTLS
  key?: string;   // Private key content for mTLS
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export class HTTPRequestBuilder {
  private endpoint: string | null = null;
  private headers: Record<string, string> = {
    'accept': 'application/json',
    'Content-Type': 'application/json'
  };
  private params: Record<string, string> = {};
  private body: any = {};
  private method: HttpMethod = HttpMethod.GET;
  private cert?: string;
  private key?: string;

  constructor() {}

  withEndpoint(endpoint: string, directArgument: string = ''): HTTPRequestBuilder {
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Endpoint must be a non-empty string!');
    }

    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      throw new Error('Endpoint URL must start with http:// or https://!');
    }

    this.endpoint = endpoint;

    if (directArgument && directArgument.length > 0) {
      // Remove leading slashes from direct argument
      while (directArgument.startsWith('/')) {
        directArgument = directArgument.substring(1);
      }

      // Append direct argument to endpoint
      this.endpoint = this.endpoint.endsWith('/') 
        ? `${this.endpoint}${directArgument}`
        : `${this.endpoint}/${directArgument}`;
    }

    // Remove trailing slashes
    while (this.endpoint.endsWith('/')) {
      this.endpoint = this.endpoint.substring(0, this.endpoint.length - 1);
    }

    return this;
  }

  withMethod(method: HttpMethod): HTTPRequestBuilder {
    this.method = method;
    return this;
  }

  withHeader(key: string, value: string): HTTPRequestBuilder {
    if (!key || !value) {
      throw new Error('Header key and value must be non-empty strings!');
    }
    this.headers[key] = value;
    return this;
  }

  withHeaders(headers: Record<string, string>): HTTPRequestBuilder {
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  withParam(key: string, value: string): HTTPRequestBuilder {
    if (!key) {
      throw new Error('Parameter key must be a non-empty string!');
    }
    this.params[key] = value;
    return this;
  }

  withParams(params: Record<string, string>): HTTPRequestBuilder {
    this.params = { ...this.params, ...params };
    return this;
  }

  withBody(body: any): HTTPRequestBuilder {
    this.body = body;
    return this;
  }

  withCertificate(cert: string, key: string): HTTPRequestBuilder {
    this.cert = cert;
    this.key = key;
    return this;
  }

  build(): HttpRequestConfig {
    if (!this.endpoint) {
      throw new Error('Endpoint must be specified!');
    }

    // Build URL with query parameters
    let url = this.endpoint;
    const paramEntries = Object.entries(this.params);
    if (paramEntries.length > 0) {
      const queryString = paramEntries
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      url += `?${queryString}`;
    }

    return {
      method: this.method,
      url,
      headers: this.headers,
      body: this.body,
      timeout: 30000, // 30 seconds default timeout
      cert: this.cert,
      key: this.key
    };
  }

  repr(): string {
    const config = this.build();
    return JSON.stringify({
      method: config.method,
      url: config.url,
      headers: config.headers,
      body: config.body
    }, null, 2);
  }
}

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string = '', defaultHeaders: Record<string, string> = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...defaultHeaders
    };
  }

  async request<T = any>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const url = config.url.startsWith('http') ? config.url : `${this.baseUrl}${config.url}`;
    
    // If certificate authentication is required, use Node.js https module
    if (config.cert && config.key) {
      return this.requestWithCertificate<T>(config, url);
    }
    
    // Otherwise, use standard fetch API
    const requestInit: RequestInit = {
      method: config.method,
      headers: {
        ...this.defaultHeaders,
        ...config.headers
      },
      signal: AbortSignal.timeout(config.timeout || 30000)
    };

    // Add body for methods that support it
    if (config.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(config.method)) {
      requestInit.body = typeof config.body === 'string' 
        ? config.body 
        : JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, requestInit);
      
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      let data: T;
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text() as unknown as T;
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`HTTP request failed: ${error.message}`);
      }
      throw new Error('HTTP request failed with unknown error');
    }
  }

  private async requestWithCertificate<T = any>(config: HttpRequestConfig, url: string): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: config.method,
        headers: {
          ...this.defaultHeaders,
          ...config.headers
        },
        cert: config.cert,
        key: config.key,
        rejectUnauthorized: false // For development - should be true in production
      };

      const requestBody = config.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(config.method)
        ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body))
        : undefined;

      if (requestBody) {
        options.headers['Content-Length'] = Buffer.byteLength(requestBody).toString();
      }

      const request = (isHttps ? https : http).request(options, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          const headers: Record<string, string> = {};
          Object.entries(response.headers).forEach(([key, value]) => {
            headers[key] = Array.isArray(value) ? value.join(', ') : value || '';
          });

          let parsedData: T;
          try {
            parsedData = JSON.parse(data);
          } catch {
            parsedData = data as unknown as T;
          }

          resolve({
            data: parsedData,
            status: response.statusCode || 0,
            statusText: response.statusMessage || '',
            headers
          });
        });
      });

      request.on('error', (error) => {
        reject(new Error(`HTTPS request failed: ${error.message}`));
      });

      if (requestBody) {
        request.write(requestBody);
      }

      request.end();
    });
  }

  async get<T = any>(url: string, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    return this.request<T>({ method: HttpMethod.GET, url, ...config });
  }

  async post<T = any>(url: string, body?: any, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    return this.request<T>({ method: HttpMethod.POST, url, body, ...config });
  }

  async put<T = any>(url: string, body?: any, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    return this.request<T>({ method: HttpMethod.PUT, url, body, ...config });
  }

  async patch<T = any>(url: string, body?: any, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    return this.request<T>({ method: HttpMethod.PATCH, url, body, ...config });
  }

  async delete<T = any>(url: string, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    return this.request<T>({ method: HttpMethod.DELETE, url, ...config });
  }
}

// Utility functions for handling responses
export const handleResponse = <T = any>(response: HttpResponse<T>): SSGApiResponse<T> => {
  if (response.status >= 200 && response.status < 300) {
    // Success response - check if it's the SSG API format
    const data = response.data as any;
    if (data && typeof data === 'object' && 'data' in data && 'status' in data) {
      // This is SSG API format with nested data/error/meta/status structure
      return {
        data: data.data,
        error: data.error,
        status: data.status || response.status
      };
    }
    // Regular success response
    return {
      data: response.data,
      status: response.status
    };
  } else {
    // Error response - parse SSG API error format
    const data = response.data as any;
    
    // Check if response contains SSG API error format
    if (data && typeof data === 'object' && 'error' in data) {
      // Extract the nested error details if present
      const errorData = data.error;
      
      if (errorData && typeof errorData === 'object') {
        return {
          error: {
            code: errorData.code?.toString() || response.status.toString(),
            message: errorData.message || response.statusText || 'Request failed',
            details: errorData.details, // Include details array if present
            errorId: errorData.errorId // Include errorId if present
          },
          status: data.status || response.status
        };
      }
    }
    
    // Fallback to basic error format
    return {
      error: {
        code: response.status.toString(),
        message: response.statusText || 'Request failed'
      },
      status: response.status
    };
  }
};

export const handleRequest = async <T = any>(
  client: HttpClient,
  config: HttpRequestConfig
): Promise<SSGApiResponse<T>> => {
  try {
    const response = await client.request<T>(config);
    return handleResponse(response);
  } catch (error) {
    return {
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error'
      },
      status: 0
    };
  }
};

// HTTP status code helpers
export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;
export const isClientError = (status: number): boolean => status >= 400 && status < 500;
export const isServerError = (status: number): boolean => status >= 500 && status < 600;

// Default HTTP client instance
export const createSSGHttpClient = (baseUrl: string, authToken?: string): HttpClient => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  return new HttpClient(baseUrl, headers);
};