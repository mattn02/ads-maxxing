import test from "node:test";
import assert from "node:assert/strict";
import { authenticated } from "../lib/supabase/server";

test("same-origin mutations use the inbound Host while rejecting foreign and malformed origins", async t => {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = names.map(name => process.env[name]);
  names.forEach(name => { process.env[name] = name === "SUPABASE_URL" ? "https://fixture.supabase.co" : "fixture-key"; });
  let identityChecks = 0;
  t.mock.method(globalThis, "fetch", async () => { identityChecks++; return Response.json({ id: "verified-user" }); });
  const cases: { url: string; headers: Record<string, string>; status: number }[] = [
    { url: "http://localhost:3100/api/sessions", headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }, status: 200 },
    { url: "http://localhost:3000/api/sessions", headers: { host: "studio.example", origin: "https://studio.example", "x-forwarded-proto": "https" }, status: 200 },
    { url: "http://localhost:3100/api/sessions", headers: { host: "STUDIO.EXAMPLE:80", origin: "http://studio.example" }, status: 200 },
    { url: "http://localhost:3100/api/sessions", headers: { host: "[::1]:3100", origin: "http://[::1]:3100" }, status: 200 },
    { url: "https://studio.example/api/sessions", headers: { origin: "https://studio.example" }, status: 200 },
    { url: "http://localhost:3100/api/sessions", headers: { host: "127.0.0.1:3100", origin: "http://localhost:3100" }, status: 403 },
    { url: "https://studio.example/api/sessions", headers: { host: "studio.example", origin: "https://evil.example", "x-forwarded-host": "evil.example" }, status: 403 },
    { url: "https://studio.example/api/sessions", headers: { host: "studio.example", origin: "http://studio.example" }, status: 403 },
    { url: "https://studio.example/api/sessions", headers: { host: "studio.example", origin: "https://studio.example:8443" }, status: 403 },
    ...["null", "https://studio.example/path", "https://studio.example@evil.example", "https://studio.example, https://evil.example"].map(origin => ({ url: "https://studio.example/api/sessions", headers: { host: "studio.example", origin }, status: 403 })),
    ...["studio.example, evil.example", "evil.example@studio.example", "studio.example/path"].map(host => ({ url: "https://studio.example/api/sessions", headers: { host, origin: "https://studio.example" }, status: 403 })),
    { url: "https://studio.example/api/sessions", headers: { host: "studio.example", origin: "https://studio.example", "x-forwarded-proto": "https,http" }, status: 403 },
  ];
  try {
    for (const sample of cases) {
      const response = await authenticated(new Request(sample.url, { method: "POST", headers: { ...sample.headers, cookie: "creative-access=fixture-token" } }), async () => Response.json({ ok: true }));
      assert.equal(response.status, sample.status, JSON.stringify(sample.headers));
    }
    assert.equal(identityChecks, cases.filter(sample => sample.status === 200).length, "Rejected requests must not contact Auth or run mutations");
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    t.mock.restoreAll();
  }
});
