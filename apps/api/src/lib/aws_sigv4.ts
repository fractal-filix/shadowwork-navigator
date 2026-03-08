type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type SignRequestInput = {
  method: string;
  url: string;
  service: string;
  region: string;
  headers?: Record<string, string>;
  body?: string;
  credentials: AwsCredentials;
  amzDate?: string;
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return signature;
}

function getAmzDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function getDateStamp(amzDate: string): string {
  return amzDate.slice(0, 8);
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(url: URL): string {
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    entries.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  entries.sort((left, right) => {
    if (left[0] === right[0]) return left[1].localeCompare(right[1]);
    return left[0].localeCompare(right[0]);
  });
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    normalized[lower] = value.trim().replace(/\s+/g, ' ');
  }
  return normalized;
}

export async function signAwsRequest(input: SignRequestInput): Promise<{ headers: Record<string, string> }> {
  const method = input.method.toUpperCase();
  const url = new URL(input.url);
  const body = input.body ?? '';

  const amzDate = input.amzDate ?? getAmzDate(new Date());
  const dateStamp = getDateStamp(amzDate);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': amzDate,
    ...(input.headers ?? {}),
  };

  if (input.credentials.sessionToken) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const sortedHeaderKeys = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key}:${normalizedHeaders[key]}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const hashedPayload = await sha256Hex(body);
  const canonicalRequest = [
    method,
    url.pathname || '/',
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${input.credentials.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, input.region);
  const kService = await hmacSha256(kRegion, input.service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      ...normalizedHeaders,
      authorization,
      'x-amz-content-sha256': hashedPayload,
    },
  };
}
