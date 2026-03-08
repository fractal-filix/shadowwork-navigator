import { signAwsRequest } from './aws_sigv4.js';

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

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
  durationSeconds = 900
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

  const url = `https://sts.${region}.amazonaws.com/?${query.toString()}`;
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
    throw new Error(`AssumeRole failed (${response.status}): ${xml}`);
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
  }
): Promise<{ plaintextBase64: string; keyId?: string }> {
  const url = `https://kms.${region}.amazonaws.com/`;
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
    throw new Error(`KMS Decrypt failed (${response.status}): ${text}`);
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
