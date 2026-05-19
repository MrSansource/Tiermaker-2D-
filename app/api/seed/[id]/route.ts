import { list } from "@vercel/blob";

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

async function fetchSeedByKey(key: string) {
  const { blobs } = await list({ prefix: key, limit: 1 });
  if (!blobs.length) return null;

  const r = await fetch(blobs[0].url);
  if (!r.ok) throw new Error("Blob fetch failed");
  return {
    url: blobs[0].url,
    uploadedAt: blobs[0].uploadedAt,
    data: await r.text(),
  };
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const url = new URL(req.url);
    const id = safeSegment(ctx.params.id, "");
    const category = safeSegment(url.searchParams.get("category"), DEFAULT_CATEGORY);
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing seed id" }), { status: 400 });
    }

    const categorizedKey = `seeds/${category}/${id}.txt`;
    const legacyKey = `seeds/${id}.txt`;
    const seed = await fetchSeedByKey(categorizedKey) || await fetchSeedByKey(legacyKey);

    if (!seed) {
      return new Response(JSON.stringify({ error: "Seed not found" }), { status: 404 });
    }

    return Response.json({ id, categorySlug: category, ...seed });
  } catch (e: any) {
    const status = e?.message === "Blob fetch failed" ? 502 : 500;
    return new Response(JSON.stringify({ error: e?.message || "GET /seed/:id failed" }), { status });
  }
}
