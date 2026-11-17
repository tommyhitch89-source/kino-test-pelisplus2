
const PLUGIN_VERSION = "1.0.114";
const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

const CATEGORIES = [
  {
    id: "peliculas",
    title: "Películas",
    path: "/peliculas",
    genre: "peliculas",
    kind: "movie"
  },
  {
    id: "series",
    title: "Series",
    path: "/series",
    genre: "series",
    kind: "series"
  },
  {
    id: "animes",
    title: "Anime",
    path: "/animes",
    genre: "anime",
    kind: "series"
  },
  {
    id: "doramas",
    title: "Doramas",
    path: "/doramas",
    genre: "series",
    kind: "series"
  }
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
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(Number(n));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) {
      return String.fromCharCode(parseInt(n, 16));
    });
}

function cleanText(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
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
    const slug = parts[parts.length - 1] || "titulo";

    return slug
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 110) || "titulo";
  } catch (_) {
    return "titulo";
  }
}

function getKind(url, fallback) {
  const path = String(url || "").toLowerCase();

  if (/\/pelicula\//.test(path)) return "movie";
  if (/\/serie\//.test(path)) return "series";
  if (/\/anime\//.test(path)) return "series";
  if (/\/dorama\//.test(path)) return "series";

  return fallback || "movie";
}

function getPoster(anchor, base) {
  const image = anchor.match(/<img\b[^>]*>/i);

  if (!image) return "";

  const tag = image[0];

  const candidates = [
    getAttribute(tag, "data-src"),
    getAttribute(tag, "data-original"),
    getAttribute(tag, "data-lazy-src"),
    getAttribute(tag, "src")
  ];

  for (const candidate of candidates) {
    if (candidate && !candidate.startsWith("data:image")) {
      return absoluteUrl(candidate, base);
    }
  }

  return "";
}

function getTitle(anchor, url) {
  const image = anchor.match(/<img\b[^>]*>/i);
  const imageTag = image ? image[0] : "";

  const candidates = [
    getAttribute(anchor, "title"),
    getAttribute(anchor, "data-title"),
    getAttribute(imageTag, "alt"),
    getAttribute(imageTag, "title")
  ];

  for (const candidate of candidates) {
    const title = cleanText(candidate);
    if (title.length > 1) return title.slice(0, 200);
  }

  const text = cleanText(anchor);

  if (text.length > 1) return text.slice(0, 200);

  return slugFromUrl(url).replace(/[-_]/g, " ");
}

function getYear(text) {
  const match = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : undefined;
}

function isEpisodeUrl(url) {
  return /episodio|episode|temporada|season/i.test(url);
}

function isCatalogItemUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parts.length < 2) return false;
    if (isEpisodeUrl(url)) return false;

    return /pelicula|serie|anime|dorama/i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

// --------------------------------------------------
// PETICIONES HTTP
// --------------------------------------------------

async function getHtml(url) {
  const response = await kino.fetch(url, {
    headers: HEADERS,
    timeoutMs: 18000
  });

  if (response.status === 404) {
    throw kino.error("not_found", "Página no encontrada");
  }

  if (response.status === 429) {
    throw kino.error("rate_limited", "El sitio está limitando las peticiones");
  }

  if (!response.ok) {
    throw kino.error(
      "unavailable",
      "PelisplusHD respondió con código " + response.status
    );
  }

  return response.text();
}

// --------------------------------------------------
// EXTRACCIÓN DE PELÍCULAS Y SERIES
// --------------------------------------------------

function extractCards(html, fallbackKind, base) {
  const results = [];
  const seen = new Set();

  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  for (const anchor of anchors) {
    const href = getAttribute(anchor, "href");
    if (!href) continue;

    const url = absoluteUrl(href, base);
    if (!url || !isCatalogItemUrl(url)) continue;

    if (seen.has(url)) continue;

    const title = getTitle(anchor, url);
    if (!title || title.length < 2) continue;

    const kind = getKind(url, fallbackKind);
    const poster = getPoster(anchor, base);
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
// PAGINACIÓN
// --------------------------------------------------

function getPageNumber(url) {
  try {
    return Number(new URL(url).searchParams.get("page")) || 1;
  } catch (_) {
    return 1;
  }
}

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

    const rel = getAttribute(anchor, "rel").toLowerCase();
    const text = cleanText(anchor).toLowerCase();

    if (rel === "next" || /^(siguiente|next|›|»|→)$/.test(text)) {
      return url;
    }

    try {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get("page")) || 0;

      if (page > currentPage) {
        candidates.push({
          page: page,
          url: url
        });
      }
    } catch (_) {
      // Enlace inválido: se ignora.
    }
  }

  candidates.sort(function (a, b) {
    return a.page - b.page;
  });

  return candidates.length ? candidates[0].url : undefined;
}

function categoryFromRef(ref) {
  if (!ref) return null;

  const id = String(ref).replace(/^cat:/, "");

  return CATEGORIES.find(function (category) {
    return category.id === id;
  }) || null;
}

async function loadCategory(category, cursor) {
  const url = cursor || absoluteUrl(category.path);
  const html = await getHtml(url);

  const items = extractCards(
    html,
    category.kind,
    url
  );

  return {
    items: items.slice(0, 100),
    next: findNextPage(html, url)
  };
}

// --------------------------------------------------
// INICIO
// --------------------------------------------------

export async function home() {
  await null;

  const rows = [];

  const pages = await Promise.all(
    CATEGORIES.map(async function (category) {
      try {
        return {
          category: category,
          page: await loadCategory(category, null)
        };
      } catch (error) {
        kino.log(
          "Categoría no disponible:",
          category.id,
          error.code || "error"
        );

        return null;
      }
    })
  );

  for (const result of pages) {
    if (!result || !result.page.items.length) continue;

    rows.push({
      id: result.category.id,
      title: result.category.title,
      ref: "cat:" + result.category.id,
      genre: result.category.genre,
      items: result.page.items.slice(0, 60)
    });
  }

  return rows;
}

// --------------------------------------------------
// EXPLORAR CATÁLOGO COMPLETO
// --------------------------------------------------

export async function browse(ref, cursor) {
  await null;

  const category = categoryFromRef(ref);

  if (!category) {
    throw kino.error("not_found", "Categoría no encontrada");
  }

  return loadCategory(category, cursor);
}

// --------------------------------------------------
// BÚSQUEDA
// --------------------------------------------------

async function searchPage(url) {
  const html = await getHtml(url);

  return {
    items: extractCards(html, "movie", url).slice(0, 100),
    next: findNextPage(html, url)
  };
}

export async function search(query) {
  await null;

  const q = String(query && query.q || "").trim();

  if (!q) return [];

  if (query && query.cursor) {
    return searchPage(query.cursor);
  }

  const terms = [q];

  if (query && query.originalTitle && query.originalTitle !== q) {
    terms.push(query.originalTitle);
  }

  if (query && Array.isArray(query.altTitles)) {
    for (const title of query.altTitles.slice(0, 2)) {
      if (title && !terms.includes(title)) {
        terms.push(title);
      }
    }
  }

  for (const term of terms) {
    const urls = [
      absoluteUrl("/search?s=" + encodeURIComponent(term)),
      absoluteUrl("/search/" + encodeURIComponent(term))
    ];

    for (const url of urls) {
      try {
        const result = await searchPage(url);

        if (result.items.length) return result;
      } catch (error) {
        if (
          error.code === "rate_limited" ||
          error.code === "blocked"
        ) {
          return [];
        }

        kino.log("Búsqueda alternativa:", error.code || "error");
      }
    }
  }

  return [];
}

// --------------------------------------------------
// DATOS DE LA PÁGINA DE UNA SERIE
// --------------------------------------------------

function getPageTitle(html, fallback) {
  const match = String(html || "").match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  return match
    ? cleanText(match[1]).slice(0, 200)
    : fallback || "Serie sin título";
}

function getPagePoster(html, base) {
  const tags = String(html || "").match(
    /<meta\b[^>]*>/gi
  ) || [];

  for (const tag of tags) {
    const property =
      getAttribute(tag, "property") ||
      getAttribute(tag, "name");

    if (/og:image|twitter:image/i.test(property)) {
      const content = getAttribute(tag, "content");
      if (content) return absoluteUrl(content, base);
    }
  }

  const images = String(html || "").match(
    /<img\b[^>]*>/gi
  ) || [];

  for (const image of images) {
    const src =
      getAttribute(image, "data-src") ||
      getAttribute(image, "src");

    if (src && !src.startsWith("data:image")) {
      return absoluteUrl(src, base);
    }
  }

  return "";
}

// --------------------------------------------------
// TEMPORADAS Y EPISODIOS
// --------------------------------------------------

function getEpisodeNumbers(url, title, fallbackNumber) {
  const source = url + " " + title;

  let season = 1;
  let number = 0;

  const combined = source.match(/(\d+)\s*x\s*(\d+)/i);

  if (combined) {
    season = Number(combined[1]);
    number = Number(combined[2]);
  }

  if (!number) {
    const seasonMatch = source.match(
      /temporada[-_/\s]*(\d+)/i
    );

    const episodeMatch = source.match(
      /episodio[-_/\s]*(\d+)/i
    );

    const sMatch = source.match(/s(\d{1,2})e(\d{1,3})/i);

    if (seasonMatch) season = Number(seasonMatch[1]);
    if (episodeMatch) number = Number(episodeMatch[1]);

    if (sMatch) {
      season = Number(sMatch[1]);
      number = Number(sMatch[2]);
    }
  }

  if (!number) {
    const textMatch = String(title || "").match(
      /(?:episodio|episode|cap[ií]tulo)\s*(\d+)/i
    );

    if (textMatch) number = Number(textMatch[1]);
  }

  if (!number) number = fallbackNumber;

  return {
    season: season >= 1 && season <= 999 ? season : 1,
    number: number
  };
}

export async function episodes(ref) {
  await null;

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

    if (!episodeUrl || !isEpisodeUrl(episodeUrl)) continue;
    if (seen.has(episodeUrl)) continue;

    const title = getTitle(anchor, episodeUrl);

    const numbers = getEpisodeNumbers(
      episodeUrl,
      title,
      found.length + 1
    );

    if (
      numbers.number < 1 ||
      numbers.number > 99999
    ) {
      continue;
    }

    const episode = {
      season: numbers.season,
      number: numbers.number,
      title: title.slice(0, 200),
      ref: episodeUrl
    };

    const poster = getPoster(anchor, url);
    if (poster) episode.still = poster;

    found.push(episode);
    seen.add(episodeUrl);
  }

  found.sort(function (a, b) {
    return a.season - b.season || a.number - b.number;
  });

  const seriesInfo = {
    title: getPageTitle(html, "Serie"),
    overview: "Sin descripción disponible"
  };

  const poster = getPagePoster(html, url);
  if (poster) seriesInfo.poster = poster;

  return {
    series: seriesInfo,
    episodes: found
  };
}

// --------------------------------------------------
// EXTRACCIÓN DE SERVIDORES DE REPRODUCCIÓN
// --------------------------------------------------

function isDirectVideo(url) {
  return /\.(m3u8|mp4|mpd)(\?|#|$)/i.test(url);
}

function isAllowedEmbed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return EMBED_HOSTS.some(function (allowed) {
      return host === allowed || host.endsWith("." + allowed);
    });
  } catch (_) {
    return false;
  }
}

function extractVideoSources(html, base) {
  const direct = [];
  const embeds = [];

  const seenDirect = new Set();
  const seenEmbeds = new Set();

  const patterns = [
    /<video\b[^>]*>/gi,
    /<source\b[^>]*>/gi,
    /<iframe\b[^>]*>/gi
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
      if (!url) continue;

      if (isDirectVideo(url) && !seenDirect.has(url)) {
        direct.push(url);
        seenDirect.add(url);
      } else if (
        isAllowedEmbed(url) &&
        !seenEmbeds.has(url)
      ) {
        embeds.push(url);
        seenEmbeds.add(url);
      }
    }
  }

  // Busca también fuentes directas declaradas en scripts.
  const scriptPattern =
    /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\\s<>]*)?/gi;

  let scriptMatch;

  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const raw = scriptMatch[0]
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const url = absoluteUrl(raw, base);

    if (url && !seenDirect.has(url)) {
      direct.push(url);
      seenDirect.add(url);
    }
  }

  // Algunos sitios guardan servidores en data-src.
  const dataPattern = /data-src=["']([^"']+)["']/gi;
  let dataMatch;

  while ((dataMatch = dataPattern.exec(html)) !== null) {
    const url = absoluteUrl(dataMatch[1], base);

    if (
      url &&
      isAllowedEmbed(url) &&
      !seenEmbeds.has(url)
    ) {
      embeds.push(url);
      seenEmbeds.add(url);
    }
  }

  return {
    direct: direct,
    embeds: embeds
  };
}

// --------------------------------------------------
// CAPTURA DEL REPRODUCTOR DE KINO
// --------------------------------------------------

async function capturePlayer(embedUrl, referer) {
  if (
    !kino.browser ||
    typeof kino.browser.capture !== "function"
  ) {
    throw kino.error(
      "unavailable",
      "La captura del navegador de Kino no está disponible"
    );
  }

  if (!isAllowedEmbed(embedUrl)) {
    throw kino.error(
      "unavailable",
      "Servidor no permitido para captura"
    );
  }

  const result = await kino.browser.capture(embedUrl, {
    timeoutMs: 18000,
    headers: {
      "Referer": referer || BASE_URL + "/"
    }
  });

  const media = result.media || [];

  if (!media.length || !media[0].url) {
    throw kino.error(
      "unavailable",
      "El servidor no proporcionó un vídeo compatible"
    );
  }

  const first = media[0];

  const stream = {
    url: first.url,
    headers: first.headers || {}
  };

  if (first.mime) stream.mime = first.mime;

  const alternatives = media.slice(1, 8)
    .filter(function (item) {
      return item && item.url;
    })
    .map(function (item) {
      const alternative = {
        url: item.url,
        headers: item.headers || {}
      };

      if (item.mime) alternative.mime = item.mime;

      return alternative;
    });

  if (alternatives.length) {
    stream.alternatives = alternatives;
  }

  if (result.subtitles && result.subtitles.length) {
    stream.subtitles = result.subtitles.map(function (sub) {
      return {
        lang: "es",
        url: sub.url,
        format: /\.srt(\?|$)/i.test(sub.url) ? "srt" : "vtt"
      };
    });
  }

  return stream;
}

// --------------------------------------------------
// RESOLUCIÓN FINAL DE VÍDEO
// --------------------------------------------------

export async function resolve(ref) {
  await null;

  const url = absoluteUrl(ref);

  if (!url) {
    throw kino.error("not_found", "Contenido no encontrado");
  }

  const html = await getHtml(url);

  const sources = extractVideoSources(html, url);

  // Primera opción: fuente directa.
  if (sources.direct.length) {
    const first = sources.direct[0];

    const stream = {
      url: first,
      headers: {
        "Referer": url
      }
    };

    const alternatives = sources.direct
      .slice(1, 8)
      .map(function (videoUrl) {
        return {
          url: videoUrl,
          headers: {
            "Referer": url
          }
        };
      });

    if (alternatives.length) {
      stream.alternatives = alternatives;
    }

    return stream;
  }

  // Segunda opción: reproductores externos compatibles.
  if (sources.embeds.length) {
    let lastError = null;

    for (const embed of sources.embeds.slice(0, 3)) {
      try {
        return await capturePlayer(embed, url);
      } catch (error) {
        lastError = error;

        // No se intenta resolver verificaciones humanas.
        if (
          error.code === "blocked" ||
          error.code === "not_allowed"
        ) {
          continue;
        }

        if (error.code === "busy") {
          throw error;
        }
      }
    }

    if (lastError) {
      throw kino.error(
        "unavailable",
        "No se pudo abrir ninguno de los reproductores disponibles"
      );
    }
  }

  throw kino.error(
    "unavailable",
    "No se encontró una fuente de vídeo compatible"
  );
}
