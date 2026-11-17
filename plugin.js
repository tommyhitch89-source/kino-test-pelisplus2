const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9",
  "Referer": BASE_URL + "/"
};

function fixUrl(url) {
  if (!url || typeof url !== "string") return "";
  const clean = url.trim();
  if (clean.startsWith("//")) return "https:" + clean;
  if (clean.startsWith("/")) return BASE_URL + clean;
  return clean;
}

function cleanTitle(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/^VER\s+/i, "")
    .replace(/\s+Online\s+Gratis.*$/i, "")
    .replace(/\s+\(\d{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getGroup(matchObj, index) {
  if (!matchObj) return "";
  if (typeof matchObj.at === "function") {
    return matchObj.at(index) || "";
  }
  return matchObj.slice(index, index + 1).pop() || "";
}

function makeSlugId(fullUrl) {
  return fullUrl
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "") || fullUrl;
}

function extractCards(html) {
  const items = [];
  const seen = new Set();
  if (!html || typeof html !== "string") return items;

  const cardRegex = /<a\b[^>]*href=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const rawHref = getGroup(match, 1);
    const innerHtml = getGroup(match, 2);

    if (!/\/(?:pelicula|serie|anime|dorama)\//i.test(rawHref)) continue;
    if (/\/temporada(?:\/|-)\d+|\/(?:episodio|capitulo)(?:\/|-)\d+/i.test(rawHref)) continue;

    const fullUrl = fixUrl(rawHref);
    if (!fullUrl || seen.has(fullUrl)) continue;

    const imgMatch = innerHtml.match(/<img\b[^>]*>/i);
    if (!imgMatch) continue;

    const imgTag = getGroup(imgMatch, 0);
    const dataSrc = getGroup(imgTag.match(/data-src=["']([^"']+)["']/i), 1);
    const src = getGroup(imgTag.match(/\bsrc=["']([^"']+)["']/i), 1);
    const alt = getGroup(imgTag.match(/\balt=["']([^"']+)["']/i), 1);

    const poster = fixUrl(dataSrc || src);
    if (!poster || poster.startsWith("data:")) continue;

    const rawLabel = alt || innerHtml;
    const title = cleanTitle(rawLabel);
    if (!title || title.length < 2) continue;

    seen.add(fullUrl);
    const isMovie = /\/pelicula\//i.test(fullUrl);

    const card = {
      id: makeSlugId(fullUrl),
      ref: fullUrl,
      kind: isMovie ? "movie" : "series",
      title: title,
      poster: poster
    };

    const yearMatch = rawLabel.match(/\((\d{4})\)/);
    const yearStr = yearMatch ? getGroup(yearMatch, 1) : "";
    if (yearStr && yearStr.length === 4) {
      card.year = yearStr;
    }

    items.push(card);
  }

  return items;
}

export async function home() {
  const res = await kino.fetch(BASE_URL + "/", { headers: HEADERS });
  if (!res.ok) {
    throw kino.error("unavailable", "HTTP " + res.status, {
      userMessage: "No se pudo conectar con PelisplusHD."
    });
  }

  const allItems = extractCards(res.text());
  const movies = allItems.filter(function (i) { return i.kind === "movie"; });
  const series = allItems.filter(function (i) { return i.kind === "series"; });

  const rows = [];
  if (movies.length > 0) {
    rows.push({
      id: "pelisplushd-peliculas",
      title: "Películas recientes",
      items: movies.slice(0, 30)
    });
  }
  if (series.length > 0) {
    rows.push({
      id: "pelisplushd-series",
      title: "Series, Animes y Doramas",
      items: series.slice(0, 30)
    });
  }

  if (typeof kino.log === "function") {
    kino.log("HOME v1.1.1 -> " + rows.length + " filas (" + allItems.length + " items)");
  }

  return rows;
}

export async function search(query) {
  const rawQ = typeof query === "string" ? query : (query && (query.q || query.query)) || "";
  const cleanQ = rawQ.trim();
  if (!cleanQ) return [];

  const lowerQ = cleanQ.toLowerCase();
  const slugQ = lowerQ.replace(/\s+/g, "-");

  const urls = [
    BASE_URL + "/search?s=" + encodeURIComponent(cleanQ),
    BASE_URL + "/search/" + encodeURIComponent(slugQ),
    BASE_URL + "/",
    BASE_URL + "/peliculas",
    BASE_URL + "/series",
    BASE_URL + "/animes",
    BASE_URL + "/doramas"
  ];

  const responses = await Promise.all(
    urls.map(function (u) {
      return kino.fetch(u, { headers: HEADERS }).catch(function () { return null; });
    })
  );

  const results = [];
  const seen = new Set();

  for (let i = 0; i < responses.length; i++) {
    const res = responses.at(i);
    if (!res || !res.ok) continue;

    const cards = extractCards(res.text());
    for (let c = 0; c < cards.length; c++) {
      const item = cards.at(c);
      if (!item || seen.has(item.ref)) continue;

      if (i < 2 || item.title.toLowerCase().includes(lowerQ)) {
        seen.add(item.ref);
        results.push(item);
      }
    }
  }

  if (typeof kino.log === "function") {
    kino.log("SEARCH v1.1.1 '" + cleanQ + "' -> " + results.length + " items");
  }

  return results.slice(0, 50);
}

export async function episodes(input) {
  const ref = typeof input === "string" ? input : (input && input.ref) || "";
  const res = await kino.fetch(fixUrl(ref), { headers: HEADERS });
  if (!res.ok) return [];

  const html = res.text();
  const list = [];
  const seen = new Set();

  const epRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = epRegex.exec(html)) !== null) {
    const epUrl = fixUrl(getGroup(match, 1));
    const epText = cleanTitle(getGroup(match, 2));

    if (!epUrl || seen.has(epUrl) || epUrl === fixUrl(ref)) continue;

    const urlMatch = epUrl.match(/temporada(?:\/|-)(\d+)\/(?:episodio|capitulo)(?:\/|-)(\d+)/i);
    const textMatch = epText.match(/(\d+)\s*[xXeE-]\s*(\d+)/);

    if (urlMatch || textMatch) {
      seen.add(epUrl);
      const seasonStr = urlMatch ? getGroup(urlMatch, 1) : getGroup(textMatch, 1);
      const numberStr = urlMatch ? getGroup(urlMatch, 2) : getGroup(textMatch, 2);
      const season = parseInt(seasonStr, 10) || 1;
      const number = parseInt(numberStr, 10) || 1;

      list.push({
        ref: epUrl,
        season: season,
        number: number,
        title: epText || "Episodio " + number
      });
    }
  }

  if (typeof kino.log === "function") {
    kino.log("EPISODES v1.1.1 -> " + list.length);
  }

  return list;
}

export async function resolve(input) {
  const ref = typeof input === "string" ? input : (input && input.ref) || "";
  const res = await kino.fetch(fixUrl(ref), { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("not_found", "HTTP " + res.status);
  }

  const html = res.text();
  const servers = [];
  const seen = new Set();

  const dataAttrRegex = /data-(?:url|video|src)=["']([^"']+)["'][^>]*>([^<]*)</gi;
  let match;

  while ((match = dataAttrRegex.exec(html)) !== null) {
    const url = fixUrl(getGroup(match, 1));
    const label = cleanTitle(getGroup(match, 2)) || "Servidor " + (servers.length + 1);
    if (url && url.startsWith("http") && !seen.has(url)) {
      seen.add(url);
      servers.push({ label: label, ref: url });
    }
  }

  if (servers.length === 0) {
    const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["']/gi;
    while ((match = iframeRegex.exec(html)) !== null) {
      const url = fixUrl(getGroup(match, 1));
      if (url && url.startsWith("http") && !seen.has(url)) {
        seen.add(url);
        servers.push({ label: "Reproductor " + (servers.length + 1), ref: url });
      }
    }
  }

  if (typeof kino.log === "function") {
    kino.log("RESOLVE v1.1.1 servidores: " + servers.length);
  }

  const firstServer = servers.at(0);
  if (!firstServer) {
    throw kino.error("not_found", "Sin servidores", {
      userMessage: "No se encontraron servidores de video en esta ficha."
    });
  }

  let targetUrl = firstServer.ref;

  if (targetUrl.includes("/ir/") || targetUrl.includes("/goto/")) {
    const redirRes = await kino.fetch(targetUrl, { headers: HEADERS });
    if (redirRes.url) targetUrl = redirRes.url;
  }

  if (typeof kino.browser !== "undefined" && typeof kino.browser.capture === "function") {
    const captured = await kino.browser.capture(targetUrl, {
      headers: { Referer: BASE_URL + "/" }
    });
    if (captured && captured.url) {
      return {
        url: captured.url,
        headers: captured.headers || HEADERS,
        alternatives: servers.slice(1, 8)
      };
    }
  }

  return {
    url: targetUrl,
    headers: HEADERS,
    alternatives: servers.slice(1, 8)
  };
}
