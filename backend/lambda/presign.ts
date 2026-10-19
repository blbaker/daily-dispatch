// Zero-dependency S3 SigV4 query presigning using the Lambda's own temporary
// credentials. Avoids relying on @aws-sdk/s3-request-presigner being present
// in the managed runtime.
import * as crypto from "crypto";

export interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface PresignOpts {
  method?: "GET" | "PUT" | "HEAD";
  bucket: string;
  key: string;
  region: string;
  creds: AwsCreds;
  /** Seconds the URL stays valid. */
  expires?: number;
  now?: Date;
}

const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function presign(o: PresignOpts): string {
  const method = o.method ?? "GET";
  const expires = o.expires ?? 3600;
  const now = o.now ?? new Date();
  const host = `${o.bucket}.s3.${o.region}.amazonaws.com`;
  const path = "/" + o.key.split("/").map(rfc3986).join("/");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${o.creds.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  if (o.creds.sessionToken) q["X-Amz-Security-Token"] = o.creds.sessionToken;
  const cq = Object.keys(q)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`)
    .join("&");
  const canonical = [method, path, cq, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kDate = hmac("AWS4" + o.creds.secretAccessKey, day);
  const kSigning = hmac(hmac(hmac(kDate, o.region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return `https://${host}${path}?${cq}&X-Amz-Signature=${sig}`;
}

export function lambdaCreds(): AwsCreds {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}
