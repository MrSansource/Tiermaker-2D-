import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { data, id } = await req.json(); // data = string compressée (LZString)
    if (!data || typeof data !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'data' string" }), { status: 400 });
    }
    const seedId = (id && String(id).trim()) || crypto.randomUUID();
    const key = `seeds/${seedId}.txt`;

    const blob = await put(key, data, {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false, // permet d'écraser le même ID
    });

    return Response.json({ id: seedId, url: blob.url });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "POST /seed failed" }), { status: 500 });
  }
}
