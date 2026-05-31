export const runtime = "nodejs";

type WikiImageResult = {
  title: string;
  pageUrl?: string;
  imageUrl?: string;
  lang: string;
};

const LANGS = ["fr", "en"];

function pageResult(page: any, lang: string): WikiImageResult | null {
  const imageUrl = page?.original?.source || page?.thumbnail?.source;
  if (!page || page.missing !== undefined || !imageUrl) return null;
  return {
    title: page.title,
    pageUrl: page.fullurl,
    imageUrl,
    lang,
  };
}

async function lookupExactWikiImage(query: string, lang: string): Promise<WikiImageResult | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: query,
    prop: "pageimages|info",
    piprop: "original|thumbnail",
    pithumbsize: "800",
    inprop: "url",
    redirects: "1",
  });

  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Tiermaker-2D/1.0 image-prefill",
    },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {}) as any[];
  for (const page of pages) {
    const result = pageResult(page, lang);
    if (result) return result;
  }
  return null;
}

async function searchWikiImage(query: string, lang: string): Promise<WikiImageResult | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "6",
    prop: "pageimages|info",
    piprop: "original|thumbnail",
    pithumbsize: "800",
    inprop: "url",
    redirects: "1",
  });

  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Tiermaker-2D/1.0 image-prefill",
    },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {}) as any[];
  const sorted = pages.sort((a, b) => (a.index || 999) - (b.index || 999));
  for (const page of sorted) {
    const result = pageResult(page, lang);
    if (result) return result;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return Response.json({ imageUrl: null });

    for (const lang of LANGS) {
      const result = await lookupExactWikiImage(query, lang);
      if (result?.imageUrl) return Response.json(result);
    }

    const searchQuery = `intitle:"${query.replaceAll('"', " ")}" ${query}`;
    for (const lang of LANGS) {
      const result = await searchWikiImage(searchQuery, lang);
      if (result?.imageUrl) return Response.json(result);
    }

    return Response.json({ imageUrl: null });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Wikipedia image lookup failed" }), { status: 500 });
  }
}
