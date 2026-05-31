export const runtime = "nodejs";

const ALLOWED_EXACT_HOSTS = new Set([
  "facebook.com",
  "lookaside.fbsbx.com",
  "lookaside.instagram.com",
  "m.facebook.com",
  "www.facebook.com",
  "www.instagram.com",
]);

const ALLOWED_HOST_SUFFIXES = [
  ".fbcdn.net",
  ".cdninstagram.com",
];

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  Referer: "https://www.google.com/",
};

function isAllowedImageHost(hostname: string) {
  const host = hostname.toLowerCase();
  return ALLOWED_EXACT_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!isAllowedImageHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaImage(html: string) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }

  return null;
}

function extractHtmlRedirect(html: string) {
  const patterns = [
    /location\.href\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["'][^"']*url=([^"']+)["'][^>]+http-equiv=["']refresh["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].replace(/\\\//g, "/"));
  }

  return null;
}

async function fetchUrl(url: URL) {
  return fetch(url.toString(), {
    headers: FETCH_HEADERS,
    redirect: "follow",
  });
}

async function imageResponseFrom(url: URL, depth = 0): Promise<Response> {
  const res = await fetchUrl(url);
  const contentType = res.headers.get("content-type") || "";

  if (contentType.toLowerCase().startsWith("image/")) {
    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  }

  if (depth < 3 && contentType.toLowerCase().includes("text/html")) {
    const html = await res.text();
    const extracted = extractMetaImage(html);
    const extractedUrl = extracted ? safeUrl(extracted) : null;
    if (extractedUrl) return imageResponseFrom(extractedUrl, depth + 1);

    const redirected = extractHtmlRedirect(html);
    const redirectedUrl = redirected ? safeUrl(redirected) : null;
    if (redirectedUrl) return imageResponseFrom(redirectedUrl, depth + 1);
  }

  return Response.json(
    {
      error: "URL did not expose a direct image",
      status: res.status,
      contentType,
    },
    { status: 502 }
  );
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const rawUrl = requestUrl.searchParams.get("url") || "";
  const url = safeUrl(rawUrl);

  if (!url) {
    return Response.json({ error: "Unsupported image URL" }, { status: 400 });
  }

  try {
    return await imageResponseFrom(url);
  } catch (e: any) {
    return Response.json({ error: e?.message || "Image proxy failed" }, { status: 502 });
  }
}
