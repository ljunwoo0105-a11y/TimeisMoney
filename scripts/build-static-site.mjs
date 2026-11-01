import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = existsSync(join(root, "deploy")) ? "deploy" : ".";
const dist = join(root, "dist");
const client = join(dist, "client");
const server = join(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

const entries = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "service-worker.js", "icons"];
for (const entry of entries) {
  const from = join(root, source, entry);
  if (existsSync(from)) {
    await cp(from, join(client, entry), { recursive: true });
  }
}

await writeFile(
  join(server, "index.js"),
  `const INDEX_PATH = "/index.html";

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function withCacheHeaders(response, pathname) {
  if (response.status >= 400) {
    return response;
  }

  const headers = new Headers(response.headers);
  if (pathname === "/service-worker.js" || pathname === INDEX_PATH || pathname === "/manifest.webmanifest") {
    headers.set("Cache-Control", "no-cache");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(request, env, pathname) {
  if (!env || !env.ASSETS) {
    return new Response("Static assets are not configured.", { status: 500 });
  }

  const normalizedPath = pathname === "/" || pathname.endsWith("/") ? INDEX_PATH : pathname;
  const response = await env.ASSETS.fetch(assetRequest(request, normalizedPath));
  return withCacheHeaders(response, normalizedPath);
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const response = await fetchAsset(request, env, url.pathname);
    if (response.status !== 404) {
      return response;
    }

    return fetchAsset(request, env, INDEX_PATH);
  },
};
`
);
