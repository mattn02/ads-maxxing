import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { WorkflowError } from "./validation";

const MAX_BYTES = 20 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    // Only ordinary global unicast IPv6. Exclude mapped IPv4, local, multicast and transition ranges.
    const value = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith("2001:") && !value.startsWith("2002:");
  }
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && [0,168].includes(p[1])) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && [18,19,51].includes(p[1])) || (p[0] === 203 && p[1] === 0));
}
export async function downloadImage(input: string, provider = false, limits: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Buffer> {
  const maxBytes = Math.max(1, Math.min(MAX_BYTES, limits.maxBytes ?? MAX_BYTES));
  const deadline = Date.now() + Math.max(1, Math.min(30000, limits.timeoutMs ?? 30000));
  let url = new URL(input);
  for (let redirects = 0; redirects < 5; redirects++) {
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80","443"].includes(url.port))) throw new WorkflowError("Unsafe image URL.");
    if (provider && (url.protocol !== "https:" || !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")))) throw new WorkflowError("Untrusted image provider host.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new WorkflowError("Image host resolves to a private or reserved network.");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new WorkflowError("Image download timed out.", 502);
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const address = addresses[0];
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.get(url, { autoSelectFamily: false, headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity" }, lookup: (_host, _options, callback) => callback(null, address.address, address.family), signal: AbortSignal.timeout(remaining) }, resolve);
      request.on("error", reject);
    });
    if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location; response.destroy();
      if (!location) throw new WorkflowError("Image redirect has no destination.");
      url = new URL(location, url); continue;
    }
    if (response.statusCode !== 200 || Number(response.headers["content-length"] ?? 0) > maxBytes) { response.destroy(); throw new WorkflowError("Image is unavailable or exceeds the configured download limit."); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > maxBytes) { response.destroy(); throw new WorkflowError("Image exceeds the configured download limit."); } chunks.push(bytes); }
    const bytes = Buffer.concat(chunks); imageMetadata(bytes); return bytes;
  }
  throw new WorkflowError("Image has too many redirects.");
}
export function imageMetadata(bytes: Buffer) {
  let width = 0, height = 0, mime = "", extension = "";
  if (bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime="image/png";extension="png"; }
  else if (bytes.length>=10 && ["GIF87a","GIF89a"].includes(bytes.toString("ascii",0,6))) { width=bytes.readUInt16LE(6);height=bytes.readUInt16LE(8);mime="image/gif";extension="gif"; }
  else if (bytes.length>=30 && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP") {
    const kind=bytes.toString("ascii",12,16);
    if(kind==="VP8X") { width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3); }
    else if(kind==="VP8 " && bytes.length>=30) { width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff; }
    else if(kind==="VP8L" && bytes[20]===0x2f) { const n=bytes.readUInt32LE(21);width=(n&0x3fff)+1;height=((n>>>14)&0x3fff)+1; }
    mime="image/webp";extension="webp";
  } else if(bytes.length>4 && bytes[0]===255 && bytes[1]===216) {
    let at=2;
    while(at+9<bytes.length) { if(bytes[at]!==255) break; const marker=bytes[at+1];if(marker===0xd9||marker===0xda)break; const length=bytes.readUInt16BE(at+2);if(length<2)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=bytes.readUInt16BE(at+5);width=bytes.readUInt16BE(at+7);break;}at+=length+2; }
    mime="image/jpeg";extension="jpg";
  }
  if(!mime||width<1||height<1||width>16000||height>16000||width*height>40000000||bytes.length>MAX_BYTES) throw new WorkflowError("Unsupported or oversized image. Use a valid PNG, JPEG, WebP or GIF under 20 MB and 40 megapixels.");
  return { width,height,mime,extension };
}
