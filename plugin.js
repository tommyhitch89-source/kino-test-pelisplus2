const BASE_URL = "https://pelisplushd.bz";
const DEFAULT_YEAR = "2025";

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

function normalizeText(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function titleFromUrl(fullUrl) {
  const slug = fullUrl
    .replace(/^https?:\/\/[^/]+\/(?:pelicula|serie|anime|dorama)\//i, "")
    .replace(/\/+$/, "")
    .replace(/-/g, " ")
    .trim();
  if (!slug) return "";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
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
    let title = cleanTitle(rawLabel);
    if (!title || title.length < 2) {
      title = titleFromUrl(fullUrl);
    }
    if (!title || title.length < 2) continue;

    const yearMatch = rawLabel.match(/\((\d{4})\)/) || innerHtml.match(/\b(19\d{2}|20\d{2})\b/);
    const extractedYear = yearMatch ? getGroup(yearMatch, 1) : "";
    const finalYear = extractedYear && extractedYear.length === 4 ? extractedYear : DEFAULT_YEAR;

    seen.add(fullUrl);
    const isMovie = /\/pelicula\//i.test(fullUrl);

    items.push({
      id: makeSlugId(fullUrl),
      ref: fullUrl,
      kind: isMovie ? "movie" : "series",
      title: title,
      year: finalYear,
      poster: poster
    });
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
      items: movies.slice(0, 40)
    });
  }
  if (series.length > 0) {
    rows.push({
      id: "pelisplushd-series",
      title: "Series, Animes y Doramas",
      items: series.slice(0, 40)
    });
  }

  if (typeof kino.log === "function") {
    kino.log("HOME v1.1.3 -> " + rows.length + " filas (" + allItems.length + " items)");
  }

  return rows;
}

export async function search(query) {
  const rawQ = typeof query === "string" ? query : (query && (query.q || query.query)) || "";
  const cleanQ = rawQ.trim();
  if (!cleanQ) return [];

  const normQ = normalizeText(cleanQ);
  const slugQ = normQ.replace(/\s+/g, "-");

  // 1. Endpoints directos de búsqueda de PelisplusHD (se acepta TODO lo que devuelva la página)
  const directSearchUrls = [
    BASE_URL + "/search?s=" + encodeURIComponent(cleanQ),
    BASE_URL + "/search?s=" + encodeURIComponent(cleanQ) + "&page=2",
    BASE_URL + "/search/" + encodeURIComponent(slugQ),
    BASE_URL + "/?s=" + encodeURIComponent(cleanQ)
  ];

  // 2. Páginas de categorías como respaldo (se filtra cualquier coincidencia en título o URL)
  const catalogUrls = [
    BASE_URL + "/",
    BASE_URL + "/peliculas",
    BASE_URL + "/peliculas?page=2",
    BASE_URL + "/series",
    BASE_URL + "/series?page=2",
    BASE_URL + "/animes",
    BASE_URL + "/animes?page=2",
    BASE_URL + "/doramas"
  ];

  const allUrls = directSearchUrls.concat(catalogUrls);

  const responses = await Promise.all(
    allUrls.map(function (u) {
      return kino.fetch(u, { headers: HEADERS }).catch(function () { return null; });
    })
  );

  const results = [];
  const seen = new Set();

  for (let i = 0; i < responses.length; i++) {
    const res = responses.at(i);
    if (!res || !res.ok) continue;

    const cards = extractCards(res.text());
    const isDirectSearch = i < directSearchUrls.length;

    for (let c = 0; c < cards.length; c++) {
      const item = cards.at(c);
      if (!item || seen.has(item.ref)) continue;

      if (isDirectSearch) {
        // Conserva todos los resultados que entregó el buscador de PelisplusHD
        seen.add(item.ref);
        results.push(item);
      } else {
        // En el catálogo general busca coincidencia en el título o en la URL
        const haystack = normalizeText(item.title + " " + item.ref);
        if (haystack.includes(normQ)) {
          seen.add(item.ref);
          results.push(item);
        }
      }
    }
  }

  if (typeof kino.log === "function") {
    kino.log("SEARCH v1.1.3 '" + cleanQ + "' -> " + results.length + " items totales");
  }

  return results.slice(0, 100);
}

export async function episodes(input) {
  const ref = typeof input === "string" ? input : (input && input.ref) || "";
  const cleanRef = fixUrl(ref);
  const res = await kino.fetch(cleanRef, { headers: HEADERS });
  if (!res.ok) {
    throw kino.error("not_found", "HTTP " + res.status);
  }

  const html = res.text();
  const list = [];
  const seen = new Set();

  const basePath = cleanRef.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  const epRegex = /<a\b[^>]*href=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = epRegex.exec(html)) !== null) {
    const rawHref = getGroup(match, 1);
    const epUrl = fixUrl(rawHref);
    const epText = cleanTitle(getGroup(match, 2));

    if (!epUrl || seen.has(epUrl) || epUrl.replace(/\/+$/, "") === cleanRef.replace(/\/+$/, "")) continue;

    const isChildOfSeries = basePath.length > 5 && rawHref.includes(basePath + "/");
    const urlMatch = epUrl.match(/temporada(?:\/|-)(\d+)\/(?:episodio|capitulo)(?:\/|-)(\d+)/i);
    const singleEpUrlMatch = epUrl.match(/\/(?:episodio|capitulo)(?:\/|-)(\d+)/i);
    const textPairMatch = epText.match(/(\d+)\s*[xXeE-]\s*(\d+)/);
    const textSingleMatch = epText.match(/(?:episodio|cap[íi]tulo|ep\.?)\s*(\d+)/i);

    if (isChildOfSeries || urlMatch || singleEpUrlMatch || textPairMatch || textSingleMatch) {
      let season = 1;
      let number = list.length + 1;

      if (urlMatch) {
        season = parseInt(getGroup(urlMatch, 1), 10) || 1;
        number = parseInt(getGroup(urlMatch, 2), 10) || number;
      } else if (textPairMatch) {
        season = parseInt(getGroup(textPairMatch, 1), 10) || 1;
        number = parseInt(getGroup(textPairMatch, 2), 10) || number;
      } else if (singleEpUrlMatch) {
        number = parseInt(getGroup(singleEpUrlMatch, 1), 10) || number;
      } else if (textSingleMatch) {
        number = parseInt(getGroup(textSingleMatch, 1), 10) || number;
      }

      seen.add(epUrl);
      list.push({
        id: makeSlugId(epUrl),
        ref: epUrl,
        season: season,
        number: number,
        title: epText || "Episodio " + number
      });
    }
  }

  if (typeof kino.log === "function") {
    kino.log("EPISODES v1.1.3 -> " + list.length);
  }

  if (list.length === 0) {
    throw kino.error("not_found", "Sin episodios", {
      userMessage: "No se encontraron capítulos disponibles para esta serie."
    });
  }

  const seasonsMap = {};
  for (let i = 0; i < list.length; i++) {
    const ep = list.at(i);
    const sNum = ep.season || 1;
    if (!seasonsMap[sNum]) {
      seasonsMap[sNum] = [];
    }
    seasonsMap[sNum].push(ep);
  }

  const seasons = Object.keys(seasonsMap)
    .map(function (k) { return parseInt(k, 10); })
    .sort(function (a, b) { return a - b; })
    .map(function (sNum) {
      return {
        number: sNum,
        episodes: seasonsMap[sNum]
      };
    });

  return { seasons: seasons };
}

export async function resolve(input) {
  const ref = typeof input === "string" ? input : (input && input.ref) || "";
  const res = await kino.fetch(fixUrl(ref), { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("not_found", "HTTP " + res.status);
  }

