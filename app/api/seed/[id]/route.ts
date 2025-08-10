import { list } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const key = `seeds/${id}.txt`;

    const { blobs } = await list({ prefix: key, limit: 1 });
    if (!blobs.length) {
      return new Response(JSON.stringify({ error: "Seed not found" }), { status: 404 });
    }
    const url = blobs[0].url;
    const r = await fetch(url);
    if (!r.ok) return new Response(JSON.stringify({ error: "Blob fetch failed" }), { status: 502 });

    const data = await r.text(); // string compressée
    return Response.json({ id, data });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "GET /seed/:id failed" }), { status: 500 });
  }
}
