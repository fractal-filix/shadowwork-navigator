const REQUIRED_ENV = ['QDRANT_URL', 'QDRANT_API_KEY'];

function readEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing required env: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new Error('QDRANT_URL must use https:// (TLS required)');
  }
  return url.toString().replace(/\/$/, '');
}

async function main() {
  for (const key of REQUIRED_ENV) {
    readEnv(key);
  }

  const baseUrl = normalizeBaseUrl(readEnv('QDRANT_URL'));
  const apiKey = readEnv('QDRANT_API_KEY');
  const expectedCollection = process.env.QDRANT_COLLECTION?.trim();

  const res = await fetch(`${baseUrl}/collections`, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Qdrant request failed: HTTP ${res.status} ${res.statusText} / ${body}`);
  }

  const data = await res.json();
  const collections = Array.isArray(data?.result?.collections)
    ? data.result.collections.map((c) => c?.name).filter(Boolean)
    : [];

  if (expectedCollection && !collections.includes(expectedCollection)) {
    throw new Error(
      `QDRANT_COLLECTION not found: ${expectedCollection}. existing: ${collections.join(', ') || '(none)'}`,
    );
  }

  console.log('Qdrant connectivity check: OK');
  console.log(`- endpoint: ${baseUrl}`);
  console.log(`- tls: https`);
  console.log(`- collections: ${collections.length}`);
  if (expectedCollection) {
    console.log(`- expected collection: ${expectedCollection} (found)`);
  }
}

main().catch((err) => {
  console.error('Qdrant connectivity check: NG');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
