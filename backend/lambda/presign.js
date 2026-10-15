"use strict";
// Zero-dependency S3 SigV4 query presign (GET) using the Lambda's own
// temporary credentials. Avoids relying on @aws-sdk/s3-request-presigner
// being present in the managed runtime.
const crypto = require("crypto");

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (data) => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function presignGet({ bucket, key, region, expires = 3600, creds, now = new Date() }) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = "/" + key.split("/").map(rfc3986).join("/");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${creds.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  if (creds.sessionToken) q["X-Amz-Security-Token"] = creds.sessionToken;
  const cq = Object.keys(q).sort().map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`).join("&");
  const canonical = ["GET", path, cq, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + creds.secretAccessKey, day), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return `https://${host}${path}?${cq}&X-Amz-Signature=${sig}`;
}

function lambdaCreds() {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

module.exports = { presignGet, lambdaCreds };
