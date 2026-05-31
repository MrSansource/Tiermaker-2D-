export const runtime = "nodejs";

type SerpImageResult = {
  title?: string;
  imageUrl?: string;
  pageUrl?: string;
  source?: string;
};

export async function GET(req: Request) {
  try {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing SERPAPI_API_KEY" }), { status: 500 });
    }

    const url = new URL(req.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return Response.json({ imageUrl: null });

    const params = new URLSearchParams({
      engine: "google_images",
      api_key: apiKey,
      q: query,
      hl: "fr",
      gl: "fr",
      google_domain: "google.fr",
      safe: "off",
      ijn: "0",
    });

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    if (!res.ok || data?.error) {
      return new Response(
        JSON.stringify({ error: data?.error || "SerpAPI image lookup failed" }),
        { status: res.ok ? 500 : res.status }
      );
    }

    const item = Array.isArray(data?.images_results) ? data.images_results[0] : null;
    const result: SerpImageResult = {
      title: item?.title,
      imageUrl: item?.original || item?.thumbnail,
      pageUrl: item?.link,
      source: item?.source,
    };

    return Response.json(result.imageUrl ? result : { imageUrl: null });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "SerpAPI image lookup failed" }), { status: 500 });
  }
}
