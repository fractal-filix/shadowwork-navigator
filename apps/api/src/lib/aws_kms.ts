import { signAwsRequest } from './aws_sigv4.js';

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

const SENSITIVE_AWS_RESPONSE_FIELDS = ['Plaintext', 'CiphertextBlob'];

export type AssumeRoleResult = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readXmlTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  if (!match?.[1]) return null;
  return match[1].trim();
}

function redactSensitiveAwsFields(value: string): string {
  return SENSITIVE_AWS_RESPONSE_FIELDS.reduce((currentValue, fieldName) => {
    const jsonPattern = new RegExp(`("${fieldName}"\\s*:\\s*")([^"]*)(")`, 'gi');
    const xmlPattern = new RegExp(`(<${fieldName}>)([\\s\\S]*?)(<\\/${fieldName}>)`, 'gi');
    const assignmentPattern = new RegExp(`(${fieldName}\\s*=\\s*)([^\\s,;]+)`, 'gi');

    return currentValue
      .replace(jsonPattern, '$1[REDACTED]$3')
      .replace(xmlPattern, '$1[REDACTED]$3')
      .replace(assignmentPattern, '$1[REDACTED]');
  }, value);
}

function buildAwsServiceError(prefix: string, status: number, responseText?: string): Error {
  const sanitizedText = responseText ? redactSensitiveAwsFields(responseText) : '';
  if (!sanitizedText) {
    return new Error(`${prefix} (${status})`);
  }

  return new Error(`${prefix} (${status}): ${sanitizedText}`);
}

async function signedFetch(
  url: string,
  method: string,
  service: string,
  region: string,
  credentials: AwsCredentials,
  body: string,
  headers: Record<string, string>
): Promise<Response> {
  const signed = await signAwsRequest({
    method,
    url,
    service,
    region,
    credentials,
    body,
    headers,
  });

  return fetch(url, {
    method,
    headers: signed.headers,
    body,
  });
}

export async function assumeRole(
  credentials: AwsCredentials,
  roleArn: string,
  roleSessionName: string,
  region: string,
  durationSeconds = 900,
  endpoint?: string
): Promise<AssumeRoleResult> {
  const safeRoleArn = escapeXml(roleArn);
  const safeSessionName = escapeXml(roleSessionName);
  const query = new URLSearchParams({
    Action: 'AssumeRole',
    Version: '2011-06-15',
    RoleArn: safeRoleArn,
    RoleSessionName: safeSessionName,
    DurationSeconds: String(durationSeconds),
  });

  const url = endpoint?.trim()
    ? `${endpoint.replace(/\/$/, '')}?${query.toString()}`
    : `https://sts.${region}.amazonaws.com/?${query.toString()}`;
  const response = await signedFetch(
    url,
    'POST',
    'sts',
    region,
    credentials,
    '',
    {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    }
  );

  const xml = await response.text();
  if (!response.ok) {
    throw buildAwsServiceError('AssumeRole failed', response.status, xml);
  }

  const accessKeyId = readXmlTag(xml, 'AccessKeyId');
  const secretAccessKey = readXmlTag(xml, 'SecretAccessKey');
  const sessionToken = readXmlTag(xml, 'SessionToken');
  const expiration = readXmlTag(xml, 'Expiration');

  if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) {
    throw new Error('AssumeRole response missing credentials');
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiration,
  };
}

export async function kmsDecrypt(
  credentials: AwsCredentials,
  region: string,
  params: {
    ciphertextBlobBase64: string;
    keyId?: string;
    encryptionAlgorithm?: string;
    endpoint?: string;
  }
): Promise<{ plaintextBase64: string; keyId?: string }> {
  const url = params.endpoint?.trim() || `https://kms.${region}.amazonaws.com/`;
  const body = JSON.stringify({
    CiphertextBlob: params.ciphertextBlobBase64,
    ...(params.keyId ? { KeyId: params.keyId } : {}),
    ...(params.encryptionAlgorithm ? { EncryptionAlgorithm: params.encryptionAlgorithm } : {}),
  });

  const response = await signedFetch(
    url,
    'POST',
    'kms',
    region,
    credentials,
    body,
    {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'TrentService.Decrypt',
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw buildAwsServiceError('KMS Decrypt failed', response.status, text);
  }

  const data = JSON.parse(text) as { Plaintext?: string; KeyId?: string };
  if (!data.Plaintext) {
    throw new Error('KMS Decrypt response missing Plaintext');
  }

  return {
    plaintextBase64: data.Plaintext,
    keyId: data.KeyId,
  };
}

export async function kmsGetPublicKey(
  credentials: AwsCredentials,
  region: string,
  params: {
    keyId: string;
    endpoint?: string;
  }
): Promise<{ publicKeyBase64: string; keyId?: string; keySpec?: string; encryptionAlgorithms?: string[] }> {
  const url = params.endpoint?.trim() || `https://kms.${region}.amazonaws.com/`;
  const body = JSON.stringify({ KeyId: params.keyId });

  const response = await signedFetch(
    url,
    'POST',
    'kms',
    region,
    credentials,
    body,
    {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'TrentService.GetPublicKey',
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw buildAwsServiceError('KMS GetPublicKey failed', response.status, text);
  }

  const data = JSON.parse(text) as {
    PublicKey?: string;
    KeyId?: string;
    KeySpec?: string;
    EncryptionAlgorithms?: string[];
  };

  if (!data.PublicKey) {
    throw new Error('KMS GetPublicKey response missing PublicKey');
  }

  return {
    publicKeyBase64: data.PublicKey,
    keyId: data.KeyId,
    keySpec: data.KeySpec,
    encryptionAlgorithms: data.EncryptionAlgorithms,
  };
}

export function publicKeyBase64ToPem(publicKeyBase64: string): string {
  const lines = publicKeyBase64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}
