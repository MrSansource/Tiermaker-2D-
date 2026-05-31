export const runtime = "nodejs";

type BrightImageResult = {
  title?: string;
  imageUrl?: string;
  pageUrl?: string;
  source?: string;
};

function firstImageResult(data: any) {
  const candidates = [
    data?.images,
    data?.image_results,
    data?.images_results,
    data?.organic,
    data?.body?.images,
  ].find(Array.isArray);

  return candidates?.find((item: any) =>
    item?.original_image || item?.original || item?.image || item?.thumbnail || item?.link
  );
}

export async function GET(req: Request) {
  try {
    const apiKey =
      process.env.BRIGHTDATA_SERP_API_KEY ||
      process.env.BRIGHTDATA_SERPAPI_KEY ||
      process.env.Brightdata_SerpAPI_Key;
    const zone =
      process.env.BRIGHTDATA_SERP_ZONE ||
      process.env.Brightdata_SerpAPI_Zone ||
      "serp_api1";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing Bright Data SERP API key" }), { status: 500 });
    }

    const url = new URL(req.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return Response.json({ imageUrl: null });

    const googleParams = new URLSearchParams({
      q: query,
      udm: "2",
      tbm: "isch",
      hl: "fr",
      gl: "fr",
      safe: "off",
      brd_json: "1",
    });

    const res = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        zone,
        url: `https://www.google.com/search?${googleParams.toString()}`,
        format: "json",
        method: "GET",
        country: "fr",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      return new Response(
        JSON.stringify({ error: data?.error || data?.message || "Bright Data image lookup failed" }),
        { status: res.ok ? 500 : res.status }
      );
    }

    const item = firstImageResult(data);
    const result: BrightImageResult = {
      title: item?.title,
      imageUrl: item?.original_image || item?.original || item?.image || item?.thumbnail,
      pageUrl: item?.link || item?.url,
      source: item?.source || item?.display_link,
    };

    return Response.json(result.imageUrl ? result : { imageUrl: null, debugShape: Object.keys(data || {}) });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Bright Data image lookup failed" }), { status: 500 });
  }
}
