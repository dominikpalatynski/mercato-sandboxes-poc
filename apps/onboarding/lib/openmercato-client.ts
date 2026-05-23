export const OPENMERCATO_API_KEY_HEADER = 'x-api-key';

export type OpenMercatoQueryPrimitive = string | number | boolean | null | undefined;
export type OpenMercatoQueryValue =
  | OpenMercatoQueryPrimitive
  | OpenMercatoQueryPrimitive[];
export type OpenMercatoQuery = Record<string, OpenMercatoQueryValue>;
export type OpenMercatoResponseType = 'json' | 'text' | 'void' | 'response';
export type OpenMercatoEnv = Readonly<Record<string, string | undefined>>;

export interface OpenMercatoClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: HeadersInit;
  fetch?: typeof fetch;
}

export interface OpenMercatoRequestOptions<TBody = unknown> {
  body?: BodyInit | TBody | null;
  cache?: RequestCache;
  headers?: HeadersInit;
  method?: string;
  query?: OpenMercatoQuery;
  responseType?: OpenMercatoResponseType;
  signal?: AbortSignal;
}

export class OpenMercatoClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly method: string,
    public readonly url: string,
    public readonly requestId: string | null,
  ) {
    super(`Open Mercato ${method} ${url} failed: ${status}`);
    this.name = 'OpenMercatoClientError';
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`;
}

function appendQueryValue(search: URLSearchParams, key: string, value: OpenMercatoQueryPrimitive) {
  if (value == null) {
    return;
  }
  search.append(key, String(value));
}

function applyQuery(url: URL, query?: OpenMercatoQuery): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(url.searchParams, key, item);
      }
      continue;
    }
    appendQueryValue(url.searchParams, key, value);
  }
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string'
    || value instanceof Blob
    || value instanceof FormData
    || value instanceof URLSearchParams
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || value instanceof ReadableStream;
}

function buildRequestBody(body: unknown): BodyInit | undefined {
  if (body == null) {
    return undefined;
  }
  if (isBodyInit(body)) {
    return body;
  }
  return JSON.stringify(body);
}

function shouldSetJsonContentType(body: unknown): boolean {
  return body != null && !isBodyInit(body);
}

export function resolveOpenMercatoApiBaseUrl(
  env: OpenMercatoEnv = process.env as OpenMercatoEnv,
): string {
  const raw = env.OPENMERCATO_API_BASE_URL ?? env.OPENMERCATO_BILLING_BASE_URL;

  if (!raw) {
    throw new Error(
      'Open Mercato base URL is not configured. Set OPENMERCATO_API_BASE_URL or OPENMERCATO_BILLING_BASE_URL.',
    );
  }

  return normalizeBaseUrl(raw);
}

export function resolveOpenMercatoApiKey(
  env: OpenMercatoEnv = process.env as OpenMercatoEnv,
): string {
  const key = env.OPENMERCATO_API_KEY;
  if (!key) {
    throw new Error('OPENMERCATO_API_KEY is not configured.');
  }
  return key;
}

export class OpenMercatoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Headers;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenMercatoClientOptions = {}) {
    this.apiKey = options.apiKey ?? resolveOpenMercatoApiKey();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? resolveOpenMercatoApiBaseUrl());
    this.defaultHeaders = new Headers(options.defaultHeaders);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<TResponse = unknown, TBody = unknown>(
    path: string,
    options: OpenMercatoRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = new URL(joinUrl(this.baseUrl, path));
    applyQuery(url, options.query);

    const headers = new Headers(this.defaultHeaders);
    const requestHeaders = new Headers(options.headers);

    requestHeaders.delete('authorization');
    requestHeaders.delete(OPENMERCATO_API_KEY_HEADER);
    headers.set('Accept', 'application/json');

    for (const [key, value] of requestHeaders.entries()) {
      headers.set(key, value);
    }

    headers.set(OPENMERCATO_API_KEY_HEADER, this.apiKey);

    if (shouldSetJsonContentType(options.body) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
      body: buildRequestBody(options.body),
      signal: options.signal,
      cache: options.cache ?? 'no-store',
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new OpenMercatoClientError(
        response.status,
        body,
        method,
        url.toString(),
        response.headers.get('x-request-id'),
      );
    }

    const responseType = options.responseType ?? 'json';
    if (responseType === 'response') {
      return response as TResponse;
    }
    if (responseType === 'void' || response.status === 204) {
      return undefined as TResponse;
    }
    if (responseType === 'text') {
      return await response.text() as TResponse;
    }

    const bodyText = await response.text();
    if (!bodyText) {
      return undefined as TResponse;
    }

    return JSON.parse(bodyText) as TResponse;
  }

  get<TResponse = unknown>(
    path: string,
    options: Omit<OpenMercatoRequestOptions, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(path, { ...options, method: 'GET' });
  }

  post<TResponse = unknown, TBody = unknown>(
    path: string,
    body?: BodyInit | TBody | null,
    options: Omit<OpenMercatoRequestOptions<TBody>, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse, TBody>(path, { ...options, method: 'POST', body });
  }

  put<TResponse = unknown, TBody = unknown>(
    path: string,
    body?: BodyInit | TBody | null,
    options: Omit<OpenMercatoRequestOptions<TBody>, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse, TBody>(path, { ...options, method: 'PUT', body });
  }

  patch<TResponse = unknown, TBody = unknown>(
    path: string,
    body?: BodyInit | TBody | null,
    options: Omit<OpenMercatoRequestOptions<TBody>, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse, TBody>(path, { ...options, method: 'PATCH', body });
  }

  delete<TResponse = unknown, TBody = unknown>(
    path: string,
    body?: BodyInit | TBody | null,
    options: Omit<OpenMercatoRequestOptions<TBody>, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse, TBody>(path, { ...options, method: 'DELETE', body });
  }
}

export function createOpenMercatoClient(
  options: OpenMercatoClientOptions = {},
): OpenMercatoClient {
  return new OpenMercatoClient(options);
}
