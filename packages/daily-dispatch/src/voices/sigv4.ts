import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignableRequest {
  method: string;
  url: string;
  /** Headers to send and sign. Host and x-amz-date are added. */
  headers: Record<string, string>;
  body: string;
}

const sha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding, which is stricter than encodeURIComponent about !'()*. */
const rfc3986 = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * AWS Signature Version 4 for one request. Returns the headers to send:
 * the caller's headers plus host, x-amz-date, x-amz-security-token (for
 * temporary credentials) and authorization. Written against the published
 * signing steps and checked against AWS's own test-suite vector, so the
 * package needs no AWS SDK.
 */
export function signV4(
  req: SignableRequest,
  creds: AwsCredentials,
  opts: { region: string; service: string; now: Date },
): Record<string, string> {
  const url = new URL(req.url);
  const amzDate = opts.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
  headers['host'] = url.host;
  headers['x-amz-date'] = amzDate;
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = url.pathname.split('/').map((seg) => rfc3986(decodeURIComponent(seg))).join('/') || '/';
  const canonical = [req.method, path, query, canonicalHeaders, signedHeaders, sha256(req.body)].join('\n');

  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), opts.region), opts.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');

  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
