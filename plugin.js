
const PLUGIN_VERSION = "1.0.115";
const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

const CATEGORIES = [
  { id: "peliculas", title: "Películas", path: "/peliculas", kind: "movie" },
  { id: "series", title: "Series", path: "/series", kind: "series" },
  { id: "animes", title: "Anime", path: "/animes", kind: "series" },
  { id: "doramas", title: "Doramas", path: "/doramas", kind: "series" }
];

const EMBED_HOSTS = [
  "streamwish.to",
  "filemoon.sx",
  "vidhide.com",
  "ok.ru",
  "voe.sx"
];

// --------------------------------------------------
// UTILIDADES
// --------------------------------------------------

function absoluteUrl(value, base) {
  if (!value) return "";

  try {
    return new URL(value, base || BASE_URL).href;
  } catch (_) {
    return "";
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function cleanText(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i"
  );

  const match = String(html || "").match(regex);

  return match
    ? decodeHtml(match[1] || match[2] || match[3] || "")
    : "";
}

function slugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.join("-")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "titulo";
  } catch (_) {
    return "titulo";
  }
}

function getPageNumber(url) {
  try {
    return Number(new URL(url).searchParams.get("page")) || 1;
  } catch (_) {
    return 1;
  }
}

function getContentKind(url) {
  try {
    const parts = new URL(url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);

    if (parts.length < 2) return null;

    const section = parts[0];

    if (["pelicula", "peliculas"].includes(section)) {
      return "movie";
    }

    if (
      ["serie", "series", "anime", "animes", "dorama", "doramas"]
        .includes(section)
    ) {
      return "series";
    }

    return null;
  } catch (_) {
    return null;
  }
}

function isEpisodeUrl(url) {
  return /episodio|episode|temporada|season/i.test(url);
}

function isDetailUrl(url) {
  const kind = getContentKind(url);
  if (!kind || isEpisodeUrl(url)) return false;

  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2;
  } catch (_) {
    return false;
  }
}

// --------------------------------------------------
// IMÁGENES Y TÍTULOS
// --------------------------------------------------

function getImageFromAnchor(anchor, base) {
  const image = anchor.match(/<img\b[^>]*>/i);
  if (!image) return "";

  const tag = image[0];

  const values = [
    getAttribute(tag, "data-src"),
    getAttribute(tag, "data-original"),
    getAttribute(tag, "data-lazy-src"),
    getAttribute(tag, "src")
  ];

  for (const value of values) {
    if (value && !/^data:image/i.test(value)) {
      return absoluteUrl(value, base);
    }
  }

  return "";
}

function getAnchorTitle(anchor, url) {
  const image = anchor.match(/<img\b[^>]*>/i);
  const imageTag = image ? image[0] : "";

  const values = [
    getAttribute(anchor, "title"),
    getAttribute(anchor, "data-title"),
    getAttribute(imageTag, "alt"),
    getAttribute(imageTag, "title")
  ];

  for (const value of values) {
    const title = cleanText(value);
    if (title.length > 1) return title.slice(0, 200);
  }

  const text = cleanText(anchor);

  if (text.length > 1) {
    return text.slice(0, 200);
  }

  return slugFromUrl(url).replace(/[-_]/g, " ");
}

function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : undefined;
}

// --------------------------------------------------
// PETICIONES
// --------------------------------------------------

async function getHtml(url) {
  const response = await kino.fetch(url, {
    headers: HEADERS,
    timeoutMs: 20000
  });

  if (response.status === 404) {
    throw kino.error("not_found", "Página no encontrada");
  }

  if (response.status === 429) {
    throw kino.error("rate_limited", "Demasiadas peticiones");
  }

  if (!response.ok) {
    throw kino.error(
      "unavailable",
      "Error HTTP " + response.status
    );
  }

  return await response.text();
}

// --------------------------------------------------
// EXTRACTOR GENERAL DEL CATÁLOGO
// --------------------------------------------------

function extractCards(html, base) {
  const results = [];
  const seen = new Set();

  // Extrae enlaces individualmente. No exige que el enlace
  // tenga una estructura concreta de tarjeta.
  const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a>/gi;

  let match;

  while ((match = anchorPattern.exec(String(html || ""))) !== null) {
    const anchor = match[0];
    const href = getAttribute(anchor, "href");

    if (!href) continue;

    const url = absoluteUrl(href, base);

    if (!url || !isDetailUrl(url)) continue;
    if (seen.has(url)) continue;

    const title = getAnchorTitle(anchor, url);

    if (!title || title.length < 2) continue;

    const kind = getContentKind(url);
    const poster = getImageFromAnchor(anchor, base);
    const year = getYear(cleanText(anchor));

    const item = {
      id: slugFromUrl(url),
      ref: url,
      title: title,
      kind: kind,
      overview: "Sin descripción disponible",
      genres: ["Sin clasificar"]
    };

    if (poster) item.poster = poster;
    if (year) item.year = year;

    results.push(item);
    seen.add(url);
  }

  return results;
}

// --------------------------------------------------
// PAGINACIÓN REAL
// --------------------------------------------------

function findNextPage(html, currentUrl) {
  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  const currentPage = getPageNumber(currentUrl);
  const candidates = [];

  for (const anchor of anchors) {
    const href = getAttribute(anchor, "href");
    if (!href) continue;

    const url = absoluteUrl(href, currentUrl);
    if (!url) continue;

    let parsed;

    try {
      parsed = new URL(url);
    } catch (_) {
      continue;
    }

    const rel = getAttribute(anchor, "rel").toLowerCase();
    const text = cleanText(anchor).toLowerCase();

    if (
      rel.split(/\s+/).includes("next") ||
      /^(siguiente|next|›|»|→|>)$/.test(text)
    ) {
      return url;
    }

    const page = Number(parsed.searchParams.get("page")) || 0;

    if (
      page > currentPage &&
      parsed.origin === new URL(currentUrl).origin &&
      parsed.pathname === new URL(currentUrl).pathname
    ) {
      candidates.push({ page, url });
    }
  }

  candidates.sort((a, b) => a.page - b.page);

  if (candidates.length) {
    return candidates[0].url;
  }

  return undefined;
}

// --------------------------------------------------
// CATEGORÍAS
// --------------------------------------------------

function getCategory(ref) {
  const id = String(ref || "").replace(/^cat:/, "");

  return CATEGORIES.find(category => category.id === id) || null;
}

async function loadCategory(category, cursor) {
  const url = cursor || absoluteUrl(category.path);
  const html = await getHtml(url);

  const items = extractCards(html, url);

  return {
    items,
    next: findNextPage(html, url)
  };
}

// --------------------------------------------------
// INICIO
// --------------------------------------------------

export async function home() {
  const rows = [];

  for (const category of CATEGORIES) {
    try {
      const page = await loadCategory(category, null);

      if (page.items.length > 0) {
        rows.push({
          id: category.id,
          title: category.title,
          ref: "cat:" + category.id,
          items: page.items
        });
      }
    } catch (error) {
      kino.log(
        "Error cargando " + category.title,
        error.code || "error"
      );
    }
  }

  return rows;
}

// --------------------------------------------------
// EXPLORAR TODAS LAS PÁGINAS
// --------------------------------------------------

export async function browse(ref, cursor) {
  const category = getCategory(ref);

  if (!category) {
    throw kino.error("not_found", "Categoría no encontrada");
  }

  return loadCategory(category, cursor);
}

// --------------------------------------------------
// BÚSQUEDA
// --------------------------------------------------

export async function search(query) {
  const term = String(
    typeof query === "string"
      ? query
      : query && (query.q || query.query) || ""
  ).trim();

  if (!term) return [];

  const cursor = query && typeof query === "object"
    ? query.cursor
    : null;

  if (cursor) {
    const html = await getHtml(cursor);

    return {
      items: extractCards(html, cursor),
      next: findNextPage(html, cursor)
    };
  }

  const searchUrls = [
    absoluteUrl("/search?s=" + encodeURIComponent(term)),
    absoluteUrl("/search/" + encodeURIComponent(term))
  ];

  for (const url of searchUrls) {
    try {
      const html = await getHtml(url);
      const items = extractCards(html, url);

      if (items.length) {
        return {
          items,
          next: findNextPage(html, url)
        };
      }
    } catch (error) {
      if (error.code === "rate_limited") throw error;

      kino.log("Búsqueda alternativa:", error.code || "error");
    }
  }

  return [];
}

// --------------------------------------------------
// DETALLES DE UNA FICHA
// --------------------------------------------------

function getMetaContent(html, property) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const key =
      getAttribute(tag, "property") ||
      getAttribute(tag, "name");

    if (key.toLowerCase() === property.toLowerCase()) {
      return getAttribute(tag, "content");
    }
  }

  return "";
}

function getDetailTitle(html, fallback) {
  const match = String(html || "").match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  if (match) return cleanText(match[1]);

  return fallback || "Título sin nombre";
}

function getDetailPoster(html, base) {
  const meta = getMetaContent(html, "og:image");

  if (meta) return absoluteUrl(meta, base);

  const twitter = getMetaContent(html, "twitter:image");

  if (twitter) return absoluteUrl(twitter, base);

  const images = String(html || "").match(/<img\b[^>]*>/gi) || [];

  for (const image of images) {
    const src =
      getAttribute(image, "data-src") ||
      getAttribute(image, "src");

    if (src && !/^data:image/i.test(src)) {
      return absoluteUrl(src, base);
    }
  }

  return "";
}

function getDetailDescription(html) {
  const description =
    getMetaContent(html, "description") ||
    getMetaContent(html, "og:description");

  if (description) return cleanText(description);

  const match = String(html || "").match(
    /<h[1-6][^>]*>\s*Sinopsis\s*<\/h[1-6]>([\s\S]{0,4000}?)(?:<h[1-6]|<footer)/i
  );

  if (match) return cleanText(match[1]);

  return "Sin descripción disponible";
}

function getDetailGenres(html) {
  const match = String(html || "").match(
    /Géneros?\s*:\s*([\s\S]{0,1200}?)(?:<\/(?:div|p|li)>)/i
  );

  if (!match) return ["Sin clasificar"];

  const links = match[1].match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  const genres = links.map(cleanText).filter(Boolean);

  return genres.length ? genres : ["Sin clasificar"];
}

function getDetailYear(html) {
  const match = String(html || "").match(
    /Año\s*:\s*(?:<[^>]+>\s*)*(19\d{2}|20\d{2})/i
  );

  return match ? match[1] : getYear(html);
}

// --------------------------------------------------
// EPISODIOS
// --------------------------------------------------

function isEpisodeAnchor(anchor, url) {
  const title = cleanText(anchor);

  return (
    isEpisodeUrl(url) ||
    /\bT\d+\s*[-–]\s*E\d+\b/i.test(title) ||
    /\btemporada\s*\d+.*episodio\s*\d+/i.test(title)
  );
}

function getEpisodeNumbers(url, title, fallback) {
  const source = url + " " + title;

  let season = 1;
  let number = 0;

  const combined = source.match(/T(\d+)\s*[-–]\s*E(\d+)/i) ||
    source.match(/(\d+)\s*x\s*(\d+)/i);

  if (combined) {
    season = Number(combined[1]);
    number = Number(combined[2]);
  }

  if (!number) {
    const sxe = source.match(/s(\d{1,2})e(\d{1,3})/i);
    if (sxe) {
      season = Number(sxe[1]);
      number = Number(sxe[2]);
    }
  }

  if (!number) {
    const episode = source.match(
      /(?:episodio|episode|cap[ií]tulo|e)\s*[-:#]?\s*(\d+)/i
    );

    if (episode) number = Number(episode[1]);
  }

  if (!number) {
    const label = String(title || "").match(/E(\d+)/i);
    if (label) number = Number(label[1]);
  }

  if (!number) number = fallback;

  return { season, number };
}

export async function episodes(ref) {
  const url = absoluteUrl(ref);

  if (!url) {
    throw kino.error("not_found", "Serie no encontrada");
  }

  const html = await getHtml(url);
  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  const found = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const href = getAttribute(anchor, "href");
    if (!href) continue;

    const episodeUrl = absoluteUrl(href, url);
    if (!episodeUrl || seen.has(episodeUrl)) continue;

    if (!isEpisodeAnchor(anchor, episodeUrl)) continue;

    const title = getAnchorTitle(anchor, episodeUrl);
    const numbers = getEpisodeNumbers(
      episodeUrl,
      title,
      found.length + 1
    );

    if (
      numbers.number < 1 ||
      numbers.number > 9999
    ) continue;

    found.push({
      season: numbers.season,
      number: numbers.number,
      title,
      ref: episodeUrl
    });

    seen.add(episodeUrl);
  }

  found.sort((a, b) =>
    a.season - b.season || a.number - b.number
  );

  const series = {
    title: getDetailTitle(html, "Serie"),
    overview: getDetailDescription(html),
    genres: getDetailGenres(html)
  };

  const poster = getDetailPoster(html, url);
  const year = getDetailYear(html);

  if (poster) series.poster = poster;
  if (year) series.year = year;

  return {
    series,
    episodes: found
  };
}

// --------------------------------------------------
// REPRODUCTOR
// --------------------------------------------------

function isDirectVideo(url) {
  return /\.(m3u8|mp4|mpd)(\?|#|$)/i.test(url);
}

function isAllowedEmbed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return EMBED_HOSTS.some(domain =>
      host === domain || host.endsWith("." + domain)
    );
  } catch (_) {
    return false;
  }
}

function extractVideoSources(html, base) {
  const direct = [];
  const embeds = [];
  const seen = new Set();

  const patterns = [
    /<(?:video|source|iframe)\b[^>]*>/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const tag = match[0];

      const raw =
        getAttribute(tag, "src") ||
        getAttribute(tag, "data-src") ||
        getAttribute(tag, "data-lazy-src");

      if (!raw) continue;

      const url = absoluteUrl(raw, base);
      if (!url || seen.has(url)) continue;

      if (isDirectVideo(url)) {
        direct.push(url);
        seen.add(url);
      } else if (isAllowedEmbed(url)) {
        embeds.push(url);
        seen.add(url);
      }
    }
  }

  return { direct, embeds };
}

async function capturePlayer(url, referer) {
  if (!isAllowedEmbed(url)) {
    throw kino.error("unavailable", "Servidor no permitido");
  }

  if (
    !kino.browser ||
    typeof kino.browser.capture !== "function"
  ) {
    throw kino.error(
      "unavailable",
      "Captura del navegador no disponible"
    );
  }

  const result = await kino.browser.capture(url, {
    timeoutMs: 20000,
    headers: {
      Referer: referer || BASE_URL + "/"
    }
  });

  const media = result.media || [];

  if (!media.length || !media[0].url) {
    throw kino.error(
      "unavailable",
      "El reproductor no proporcionó una fuente compatible"
    );
  }

  const first = media[0];

  return {
    url: first.url,
    headers: first.headers || {}
  };
}

export async function resolve(ref) {
  const url = absoluteUrl(ref);

  if (!url) {
    throw kino.error("not_found", "Contenido no encontrado");
  }

  const html = await getHtml(url);
  const sources = extractVideoSources(html, url);

  if (sources.direct.length) {
    return {
      url: sources.direct[0],
      headers: { Referer: url },
      alternatives: sources.direct.slice(1).map(videoUrl => ({
        url: videoUrl,
        headers: { Referer: url }
      }))
    };
  }

  for (const embed of sources.embeds) {
    try {
      return await capturePlayer(embed, url);
    } catch (error) {
      kino.log("Servidor no disponible:", error.code || "error");
    }
  }

  throw kino.error(
    "unavailable",
    "No se encontró una fuente de vídeo compatible"
  );
}
