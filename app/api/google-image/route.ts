export const runtime = "nodejs";

type GoogleImageResult = {
  title?: string;
  imageUrl?: string;
  pageUrl?: string;
  source?: string;
};

export async function GET(req: Request) {
  try {
    const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX;
    if (!apiKey || !cx) {
      return new Response(
        JSON.stringify({ error: "Missing GOOGLE_CUSTOM_SEARCH_API_KEY or GOOGLE_CUSTOM_SEARCH_CX" }),
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return Response.json({ imageUrl: null });

    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      searchType: "image",
      num: "1",
      safe: "active",
      hl: "fr",
      imgSize: "medium",
    });

    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data?.error?.message || "Google image lookup failed" }),
        { status: res.status }
      );
    }

    const item = Array.isArray(data?.items) ? data.items[0] : null;
    const result: GoogleImageResult = {
      title: item?.title,
      imageUrl: item?.link,
      pageUrl: item?.image?.contextLink,
      source: item?.displayLink,
    };

    return Response.json(result.imageUrl ? result : { imageUrl: null });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Google image lookup failed" }), { status: 500 });
  }
}
