
const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/"
};

const CATEGORIES = [
  {
    id: "peliculas",
    title: "Películas",
    path: "/peliculas",
    genre: "peliculas"
  },
  {
    id: "series",
    title: "Series",
    path: "/series",
    genre: "series"
  },
  {
    id: "animes",
    title: "Anime",
    path: "/animes",
    genre: "anime"
  },
  {
    id: "doramas",
    title: "Doramas",
    path: "/doramas",
    genre: "series"
  }
];

const EMBED_HOSTS = [
  "streamwish.to",
  "filemoon.sx",
  "vidhide.com",
  "ok.ru",
  "voe.sx"
];

function absoluteUrl(url) {
  if (!url) return "";

  try {
    return new URL(url, BASE_URL).href;
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
    );
}

function cleanText(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
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
    return parsed.pathname
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      .split("/")
      .filter(Boolean)
      .join("-")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(-100);
  } catch (_) {
    return "titulo";
  }
}

function getKind(url, fallback) {
  const path = String(url || "").toLowerCase();

  if (/\/pelicula(s)?\//.test(path)) return "movie";
  if (/\/serie(s)?\//.test(path)) return "series";
  if (/\/anime(s)?\//.test(path)) return "series";
  if (/\/dorama(s)?\//.test(path)) return "series";

  return fallback || "movie";
}

function getPoster(anchor) {
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
    if (
      candidate &&
      !candidate.startsWith("data:image")
    ) {
      return absoluteUrl(candidate);
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
    if (title.length > 1) return title;
  }

  const text = cleanText(anchor);

  if (text.length > 1) return text.slice(0, 180);

  const slug = slugFromUrl(url)
    .replace(/-/g, " ")
    .trim();

  return slug || "Título sin nombre";
}

function getYear(text) {
  const match = String(text || "").match(
    /\b(19\d{2}|20\d{2})\b/
  );

  return match ? match[1] : undefined;
}

function extractCards(html, fallbackKind) {
  const results = [];
  const seen = new Set();

  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  for (const anchor of anchors) {
    const href = getAttribute(anchor, "href");

    if (!href) continue;

    const url = absoluteUrl(href);
    if (!url) continue;

    if (!/pelicula|serie|anime|dorama/i.test(url)) {
      continue;
    }

    if (
      /episodio|temporada|categoria|genero|page=/i.test(url)
    ) {
      continue;
    }

    if (seen.has(url)) continue;

    const title = getTitle(anchor, url);
    const poster = getPoster(anchor);

    if (!title || title === "Título sin nombre") continue;

    const kind = getKind(url, fallbackKind);
    const text = cleanText(anchor);

    const item = {
      id: slugFromUrl(url),
      ref: url,
      title,
      kind,
      poster: poster || undefined,
      year: getYear(text),
      overview: "Sin descripción disponible",
      genres: ["Sin clasificar"]
    };

    results.push(item);
    seen.add(url);
  }

  return results;
}

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
      "El sitio respondió con el código " + response.status
    );
  }

  return response.text();
}

function pageNumber(url) {
  try {
    return Number(new URL(url).searchParams.get("page")) || 1;
  } catch (_) {
    return 1;
  }
}

function nextPageUrl(html, currentUrl) {
  const current = pageNumber(currentUrl);
  const links = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  const candidates = [];

  for (const link of links) {
    const href = getAttribute(link, "href");
    if (!href) continue;

    const url = absoluteUrl(href);
    if (!url) continue;

    let page = 0;

    try {
      const parsed = new URL(url);
      page = Number(parsed.searchParams.get("page")) || 0;
    } catch (_) {
      continue;
    }

    if (page > current) {
      candidates.push({ page, url });
    }
  }

  candidates.sort((a, b) => a.page - b.page);

  if (candidates.length) {
    return candidates[0].url;
  }

  // PelisplusHD utiliza paginación mediante ?page=N.
  // Solo se genera el siguiente enlace si la página muestra
  // que existe una paginación posterior.
  const paginationExists =
    /pagination|paginacion|page-numbers|class=["'][^"']*pages/i.test(
      html
    );

  if (paginationExists) {
    const next = new URL(currentUrl);
    next.searchParams.set("page", String(current + 1));
    return next.href;
  }

  return undefined;
}

async function loadCategory(category, cursor) {
  const url = cursor || absoluteUrl(category.path);
  const html = await getHtml(url);

  return {
    items: extractCards(html, category.id === "peliculas" ? "movie" : "series"),
    next: nextPageUrl(html, url)
  };
}

function findCategory(ref) {
  return CATEGORIES.find(
    category => ref === "cat:" + category.id
  );
}

// --------------------------------------------------
// INICIO: filas principales del catálogo
// --------------------------------------------------

export async function home() {
  await null;

  const rows = [];

  for (const category of CATEGORIES) {
    try {
      const page = await loadCategory(category, null);

      if (page.items.length) {
        rows.push({
          id: category.id,
          title: category.title,
          ref: "cat:" + category.id,
          genre: category.genre,
          items: page.items
        });
      }
    } catch (error) {
      kino.log(
        "No se pudo cargar la categoría:",
        category.id,
        error.code || "error"
      );
    }
  }

  return rows;
}

// --------------------------------------------------
// CATÁLOGO: paginación de todas las categorías
// --------------------------------------------------

export async function browse(ref, cursor) {
  await null;

  const category = findCategory(ref);

  if (!category) {
    throw kino.error("not_found", "Categoría no encontrada");
  }

  return loadCategory(category, cursor);
}

// --------------------------------------------------
// BÚSQUEDA
// --------------------------------------------------

export async function search(query) {
  await null;

  const term = String(query && query.q || "").trim();

  if (!term) return [];

  const urls = [
    absoluteUrl("/search?s=" + encodeURIComponent(term)),
    absoluteUrl("/search/" + encodeURIComponent(term))
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const html = await getHtml(url);
      const items = extractCards(html);

      if (items.length) {
        const current = url;
        return {
          items,
          next: nextPageUrl(html, current)
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError && lastError.code === "rate_limited") {
    throw lastError;
  }

  return [];
}

// --------------------------------------------------
// INFORMACIÓN DE UNA SERIE
// --------------------------------------------------

function getPageTitle(html, fallback) {
  const match = String(html || "").match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  return match
    ? cleanText(match[1])
    : fallback || "Serie sin título";
}

function getPagePoster(html) {
  const meta = String(html || "").match(
    /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i
  );

  if (meta) {
    const content = getAttribute(meta[0], "content");
    if (content) return absoluteUrl(content);
  }

  const images = String(html || "").match(
    /<img\b[^>]*>/gi
  ) || [];

  for (const image of images) {
    const src =
      getAttribute(image, "data-src") ||
      getAttribute(image, "src");

    if (src && !src.startsWith("data:image")) {
      return absoluteUrl(src);
    }
  }

  return "";
}

// --------------------------------------------------
// TEMPORADAS Y EPISODIOS
// --------------------------------------------------

export async function episodes(ref) {
  await null;

  const url = absoluteUrl(ref);

  if (!url) {
    throw kino.error("not_found", "Serie no encontrada");
  }

  const html = await getHtml(url);

  const anchors = html.match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  const found = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const href = getAttribute(anchor, "href");
    if (!href) continue;

    const episodeUrl = absoluteUrl(href);

    if (
      !/episodio|episode|temporada/i.test(episodeUrl)
    ) {
      continue;
    }

    if (seen.has(episodeUrl)) continue;

    const title =
      getTitle(anchor, episodeUrl) ||
      "Episodio sin título";

    const seasonMatch = episodeUrl.match(
      /temporada[-/ ]?(\d+)/i
    );

    const episodeMatch = episodeUrl.match(
      /episodio[-/ ]?(\d+)/i
    );

    const combinedMatch = episodeUrl.match(
      /(\d+)x(\d+)/i
    );

    let season = seasonMatch
      ? Number(seasonMatch[1])
      : 1;

    let number = episodeMatch
      ? Number(episodeMatch[1])
      : found.length + 1;

    if (combinedMatch) {
      season = Number(combinedMatch[1]);
      number = Number(combinedMatch[2]);
    }

    found.push({
      season,
      number,
      title,
      ref: episodeUrl,
      still: getPoster(anchor) || undefined,
      overview: "Sin descripción disponible"
    });

    seen.add(episodeUrl);
  }

  found.sort((a, b) =>
    a.season - b.season || a.number - b.number
  );

  return {
    series: {
      title: getPageTitle(html, "Serie"),
      poster: getPagePoster(html) || undefined,
      overview: "Sin descripción disponible"
    },
    episodes: found
  };
}

// --------------------------------------------------
// REPRODUCCIÓN
// --------------------------------------------------

function isDirectVideo(url) {
  return /\.(m3u8|mp4|mpd)(\?|#|$)/i.test(url);
}

function isAllowedEmbed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return EMBED_HOSTS.some(
      allowed => host === allowed ||
        host.endsWith("." + allowed)
    );
  } catch (_) {
    return false;
  }
}

function extractVideoLinks(html, pageUrl) {
  const links = [];
  const seen = new Set();

  const patterns = [
    /<video\b[^>]*src=["']([^"']+)["']/gi,
    /<source\b[^>]*src=["']([^"']+)["']/gi,
    /<iframe\b[^>]*src=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const url = absoluteUrl(match[1]);

      if (!url || seen.has(url)) continue;

      if (
        isDirectVideo(url) ||
        isAllowedEmbed(url)
      ) {
        links.push(url);
        seen.add(url);
      }
    }
  }

  // Algunos reproductores guardan el enlace en data-src.
  const dataSrcPattern =
    /data-src=["']([^"']+)["']/gi;

  let dataMatch;

  while ((dataMatch = dataSrcPattern.exec(html)) !== null) {
    const url = absoluteUrl(dataMatch[1]);

    if (
      url &&
      !seen.has(url) &&
      (isDirectVideo(url) || isAllowedEmbed(url))
    ) {
      links.push(url);
      seen.add(url);
    }
  }

  return links;
}

async function captureEmbed(url) {
  if (!isAllowedEmbed(url)) {
    throw kino.error(
      "unavailable",
      "El servidor no está incluido en los hosts permitidos"
    );
  }

  if (
    !kino.browser ||
    typeof kino.browser.capture !== "function"
  ) {
    throw kino.error(
      "unavailable",
      "El navegador de captura no está disponible"
    );
  }

  const result = await kino.browser.capture(url, {
    timeoutMs: 18000
  });

  const media = result.media || [];

  if (!media.length) {
    throw kino.error(
      "unavailable",
      "El reproductor no proporcionó un enlace de vídeo"
    );
  }

  const first = media[0];

  if (!first || !first.url) {
    throw kino.error(
      "unavailable",
      "No se encontró una fuente reproducible"
    );
  }

  return {
    url: first.url,
    headers: first.headers || HEADERS,
    alternatives: media.slice(1).map(item => ({
      url: item.url,
      headers: item.headers || HEADERS
    }))
  };
}

export async function resolve(ref) {
  await null;

  const url = absoluteUrl(ref);

  if (!url) {
    throw kino.error("not_found", "Contenido no encontrado");
  }

  const html = await getHtml(url);
  const links = extractVideoLinks(html, url);

  if (!links.length) {
    throw kino.error(
      "unavailable",
      "No se encontró un reproductor compatible en esta página"
    );
  }

  // Primero se prueban las fuentes directas.
  const direct = links.find(isDirectVideo);

  if (direct) {
    return {
      url: direct,
      headers: {
        ...HEADERS,
        "Referer": url
      }
    };
  }

  // Si no hay una fuente directa, se intenta capturar
  // el reproductor público durante la acción de Play.
  let lastError = null;

  for (const embed of links) {
    try {
      return await captureEmbed(embed);
    } catch (error) {
      lastError = error;

      // No se intenta superar verificaciones humanas.
      if (
        error.code === "blocked" ||
        error.code === "not_allowed"
      ) {
        throw error;
      }
    }
  }

  throw kino.error(
    "unavailable",
    lastError
      ? "No fue posible obtener una fuente compatible"
      : "No se encontró un servidor disponible"
  );
}
