import { list, put } from "@vercel/blob";

export const runtime = "nodejs";

const DEFAULT_CATEGORY = "rap-francais";
const SAFE_SEGMENT_RE = /[^a-z0-9-]+/g;
const EDGE_DASH_RE = /(^-|-$)+/g;

function safeSegment(value: unknown, fallback: string) {
  const clean = String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SAFE_SEGMENT_RE, "-")
    .replace(EDGE_DASH_RE, "");
  return clean || fallback;
}

export async function POST(req: Request) {
  try {
    const { data, id, categorySlug } = await req.json();
    if (!data || typeof data !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'data' string" }), { status: 400 });
    }

    const category = safeSegment(categorySlug, DEFAULT_CATEGORY);
    const seedId = safeSegment(id, crypto.randomUUID());
    const key = `seeds/${category}/${seedId}.txt`;

    const blob = await put(key, data, {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
    });

    return Response.json({ id: seedId, categorySlug: category, url: blob.url });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "POST /seed failed" }), { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("categories") === "1") {
      const { blobs } = await list({ prefix: "seeds/", limit: 1000 });
      const categories = new Map<string, { slug: string; label: string; seedCount: number; updatedAt?: string }>();

      for (const blob of blobs.filter(blob => blob.pathname.endsWith(".txt"))) {
        const match = blob.pathname.match(/^seeds\/([^/]+)\//);
        const slug = match ? match[1] : DEFAULT_CATEGORY;
        const current = categories.get(slug) || {
          slug,
          label: slug.split("-").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
          seedCount: 0,
          updatedAt: undefined,
        };

        current.seedCount += 1;
        if (!current.updatedAt || String(blob.uploadedAt || "") > String(current.updatedAt || "")) {
          current.updatedAt = blob.uploadedAt ? String(blob.uploadedAt) : undefined;
        }
        categories.set(slug, current);
      }

      return Response.json({
        categories: Array.from(categories.values())
          .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
      });
    }

    const category = safeSegment(url.searchParams.get("category"), DEFAULT_CATEGORY);
    const prefix = `seeds/${category}/`;
    const { blobs } = await list({ prefix, limit: 1000 });
    const legacy = category === DEFAULT_CATEGORY
      ? (await list({ prefix: "seeds/", limit: 1000 })).blobs.filter(blob => /^seeds\/[^/]+\.txt$/.test(blob.pathname))
      : [];

    const seeds = [...blobs, ...legacy]
      .filter(blob => blob.pathname.endsWith(".txt"))
      .map(blob => ({
        id: blob.pathname.startsWith(prefix)
          ? blob.pathname.slice(prefix.length).replace(/\.txt$/, "")
          : blob.pathname.slice("seeds/".length).replace(/\.txt$/, ""),
        categorySlug: category,
        uploadedAt: blob.uploadedAt,
        url: blob.url,
      }))
      .sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));

    return Response.json({ categorySlug: category, seeds });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "GET /seed failed" }), { status: 500 });
  }
}
