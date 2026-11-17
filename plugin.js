
const PLUGIN_VERSION = "1.1.1";
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

const CATALOG_LIMIT = 100;
const MAX_ALTERNATIVES = 8;
const SERVER_SEPARATOR = "|kino-server|";

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

function clip(value, max) {
  let result = String(value || "").slice(0, max);

  if (/[\uD800-\uDBFF]$/.test(result)) {
    result = result.slice(0, -1);
  }

  return result;
}

function slugFromUrl(url) {
  try {
    const parsed = new URL(url);

    const value = parsed.pathname
      .split("/")
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100);

    return value || "titulo";
  } catch (_) {
    return "titulo";
  }
}

// Identificador estable para evitar colisiones entre títulos.
function hashString(value) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function catalogId(url) {
  return "p_" + hashString(url) + "_" + slugFromUrl(url);
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
  return /episodio|episode|temporada|season|capitulo|capítulo/i.test(url);
}

function isDetailUrl(url) {
  const kind = getContentKind(url);

  if (!kind || isEpisodeUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const base = new URL(BASE_URL);

    if (parsed.hostname !== base.hostname) return false;

    const parts = parsed.pathname.split("/").filter(Boolean);

    return parts.length >= 2;
  } catch (_) {
    return false;
  }
}

function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : undefined;
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

    if (title.length > 1) {
      return clip(title, 200);
    }
  }

  const text = cleanText(anchor);

  if (text.length > 1) {
    return clip(text, 200);
  }

  return slugFromUrl(url).replace(/[-_]/g, " ");
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
// EXTRACTOR DEL CATÁLOGO
// --------------------------------------------------

function extractCards(html, base) {
  const results = [];
  const seen = new Set();

  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  for (const anchor of anchors) {
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
      id: catalogId(url),
      ref: url,
      title,
      kind,
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
    let current;

    try {
      parsed = new URL(url);
      current = new URL(currentUrl);
    } catch (_) {
      continue;
    }

    const rel = getAttribute(anchor, "rel").toLowerCase();
    const text = cleanText(anchor).toLowerCase();

    if (
      rel.split(/\s+/).includes("next") ||
      /^(siguiente|next|›|»|→|>)$/.test(text)
    ) {
      if (parsed.origin === current.origin) {
        return url;
      }
    }

    const page = Number(parsed.searchParams.get("page")) || 0;

    if (
      page > currentPage &&
      parsed.origin === current.origin &&
      parsed.pathname === current.pathname
    ) {
      candidates.push({ page, url });
    }
  }

  candidates.sort((a, b) => a.page - b.page);

  return candidates.length
    ? candidates[0].url
    : undefined;
}

// --------------------------------------------------
// BASE DE DATOS LOCAL SQLITE
// --------------------------------------------------

function ensureCatalog() {
  if (!kino.catalog) {
    throw kino.error(
      "unavailable",
      "El catálogo SQLite no está disponible. Comprueba que el manifiesto declare apiVersion 13 y catalog."
    );
  }
}

function toCatalogRecord(item) {
  if (!item || !item.ref || !item.title) return null;

  const record = {
    id: catalogId(item.ref),
    title: clip(cleanText(item.title) || "Sin título", 300),
    sort: Date.now(),
    data: {
      ref: clip(item.ref, 1000),
      kind: item.kind === "series" ? "series" : "movie"
    }
  };

  if (item.poster) {
    record.data.poster = clip(item.poster, 800);
  }

  if (item.overview && item.overview !== "Sin descripción disponible") {
    record.data.overview = clip(item.overview, 700);
  }

  if (item.year) {
    record.data.year = String(item.year);
  }

  if (item.genres && item.genres.length) {
    record.data.genres = item.genres
      .slice(0, 8)
      .map(g => clip(g, 50));
  }

  return record;
}

async function saveCatalogItems(items) {
  ensureCatalog();

  const records = items
    .map(toCatalogRecord)
    .filter(Boolean);

  for (let i = 0; i < records.length; i += 500) {
    await kino.catalog.upsert(records.slice(i, i + 500));
  }

  return records.length;
}

function toKinoItem(record) {
  const data = record.data || {};

  const item = {
    id: record.id,
    ref: data.ref,
    title: record.title,
    kind: data.kind || "movie"
  };

  if (data.poster) item.poster = data.poster;
  if (data.overview) item.overview = data.overview;
  if (data.genres) item.genres = data.genres;
  if (data.year) item.year = data.year;

  return item;
}

async function searchLocalCatalog(query, offset) {
  ensureCatalog();

  const page = await kino.catalog.search({
    q: clip(String(query || "").trim(), 256),
    limit: CATALOG_LIMIT,
    offset: Math.max(0, Number(offset) || 0),
    order: "newest"
  });

  return {
    items: page.items.map(toKinoItem),
    total: page.total
  };
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

  await saveCatalogItems(items);

  return {
    items,
    next: findNextPage(html, url)
  };
}

// --------------------------------------------------
// INICIO E INDEXACIÓN
// --------------------------------------------------

export async function home() {
  ensureCatalog();

  const rows = [];

  // Actualizamos la primera página de cada categoría.
  // Las siguientes páginas se indexan al explorar.
  for (const category of CATEGORIES) {
    try {
      await loadCategory(category, null);
    } catch (error) {
      kino.log(
        "Error actualizando " + category.title,
        error.code || "error"
      );
    }

    try {
      const page = await kino.catalog.search({
        q: "",
        limit: CATALOG_LIMIT,
        order: "newest"
      });

      const items = page.items
        .map(toKinoItem)
        .filter(item => item.kind === category.kind);

      if (items.length) {
        rows.push({
          id: category.id,
          title: category.title,
          ref: "cat:" + category.id,
          items
        });
      }
    } catch (error) {
      kino.log("Error leyendo catálogo:", error.code || "error");
    }
  }

  return rows;
}

// --------------------------------------------------
// EXPLORAR CATEGORÍAS
// --------------------------------------------------

export async function browse(ref, cursor) {
  const category = getCategory(ref);

  if (!category) {
    throw kino.error("not_found", "Categoría no encontrada");
  }

  const page = await loadCategory(category, cursor || null);

  return {
    items: page.items.map(item => ({
      id: item.id,
      ref: item.ref,
      title: item.title,
      kind: item.kind,
      poster: item.poster,
      year: item.year
    })),
    next: page.next
  };
}

// --------------------------------------------------
// BÚSQUEDA LOCAL
// --------------------------------------------------

export async function search(query) {
  ensureCatalog();

  const term = String(
    typeof query === "string"
      ? query
      : query && (query.q || query.query) || ""
  ).trim();

  if (!term) return [];

  const offset = query && typeof query === "object"
    ? Number(query.offset || query.cursor || 0)
    : 0;

  // La búsqueda no hace peticiones remotas.
  // Primero consulta SQLite y devuelve únicamente
  // las referencias que ya están indexadas.
  const result = await searchLocalCatalog(term, offset);

  return result.items;
}

// --------------------------------------------------
// METADATOS DE LAS FICHAS
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

  const ogTitle = getMetaContent(html, "og:title");

  return cleanText(ogTitle || fallback || "Título sin nombre");
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
      getAttribute(image, "data-original") ||
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

  return match
    ? cleanText(match[1])
    : "Sin descripción disponible";
}

function getDetailGenres(html) {
  const match = String(html || "").match(
    /Géneros?\s*:\s*([\s\S]{0,1200}?)(?:<\/(?:div|p|li)>)/i
  );

  if (!match) return ["Sin clasificar"];

  const links = match[1].match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  const genres = links
    .map(cleanText)
    .filter(Boolean);

  return genres.length
    ? genres.slice(0, 10)
    : ["Sin clasificar"];
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
    /\btemporada\s*\d+.*episodio\s*\d+/i.test(title) ||
    /\bS\d{1,2}E\d{1,3}\b/i.test(title) ||
    /\b\d+\s*x\s*\d+\b/i.test(title)
  );
}

function getEpisodeNumbers(url, title, fallback) {
  const source = url + " " + title;

  let season = 1;
  let number = 0;

  const combined =
    source.match(/T(\d+)\s*[-–]\s*E(\d+)/i) ||
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

  if (!url || !isDetailUrl(url)) {
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
// SERVIDORES Y REPRODUCTORES
// --------------------------------------------------

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function isDirectVideo(url) {
  return /\.(m3u8|mp4|mpd)(\?|#|$)/i.test(url);
}

function isAllowedEmbed(url) {
  const host = getHostname(url);

  if (!host) return false;

  return EMBED_HOSTS.some(domain =>
    host === domain || host.endsWith("." + domain)
  );
}

function getServerName(url, index) {
  const host = getHostname(url)
    .replace(/^www\./, "");

  const known = {
    "streamwish.to": "StreamWish",
    "filemoon.sx": "FileMoon",
    "vidhide.com": "VidHide",
    "ok.ru": "OK.ru",
    "voe.sx": "VOE"
  };

  if (known[host]) return known[host];

  return host || "Servidor " + (index + 1);
}

function addServer(list, seen, url, type) {
  if (!url || seen.has(url)) return;

  if (type === "embed" && !isAllowedEmbed(url)) return;

  if (type === "direct" && !isDirectVideo(url)) return;

  list.push({
    id: String(list.length),
    name: getServerName(url, list.length),
    url,
    type
  });

  seen.add(url);
}

function extractVideoSources(html, base) {
  const servers = [];
  const seen = new Set();

  const tags = String(html || "").match(
    /<(?:video|source|iframe)\b[^>]*>/gi
  ) || [];

  for (const tag of tags) {
    const raw =
      getAttribute(tag, "src") ||
      getAttribute(tag, "data-src") ||
      getAttribute(tag, "data-lazy-src") ||
      getAttribute(tag, "data-url") ||
      getAttribute(tag, "data-link");

    if (!raw) continue;

    const url = absoluteUrl(raw, base);

    if (!url) continue;

    if (isDirectVideo(url)) {
      addServer(servers, seen, url, "direct");
    } else if (isAllowedEmbed(url)) {
      addServer(servers, seen, url, "embed");
    }
  }

  // Algunos sitios colocan los servidores como enlaces.
  const anchors = String(html || "").match(
    /<a\b[^>]*>[\s\S]*?<\/a>/gi
  ) || [];

  for (const anchor of anchors) {
    const raw =
      getAttribute(anchor, "href") ||
      getAttribute(anchor, "data-src") ||
      getAttribute(anchor, "data-url");

    if (!raw) continue;

    const url = absoluteUrl(raw, base);

    if (!url) continue;

    if (isDirectVideo(url)) {
      addServer(servers, seen, url, "direct");
    } else if (isAllowedEmbed(url)) {
      addServer(servers, seen, url, "embed");
    }
  }

  return servers;
}

// --------------------------------------------------
// REFERENCIAS DE SERVIDORES
// --------------------------------------------------

function createServerRef(episodeUrl, serverUrl) {
  return (
    episodeUrl +
    SERVER_SEPARATOR +
    encodeURIComponent(serverUrl)
  );
}

function parseServerRef(ref) {
  const index = ref.indexOf(SERVER_SEPARATOR);

  if (index < 0) return null;

  const episodeUrl = ref.slice(0, index);
  const encodedServer = ref.slice(
    index + SERVER_SEPARATOR.length
  );

  try {
    return {
      episodeUrl,
      serverUrl: decodeURIComponent(encodedServer)
    };
  } catch (_) {
    return null;
  }
}

// --------------------------------------------------
// CAPTURA DE REPRODUCTORES
// --------------------------------------------------

async function capturePlayer(url, referer) {
  if (!isAllowedEmbed(url)) {
    throw kino.error(
      "unavailable",
      "Servidor no permitido"
    );
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
    timeoutMs: 18000,
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
    headers: first.headers || {},
    alternatives: media.slice(1).map((video, index) => ({
      url: video.url,
      headers: video.headers || {},
      label: "Fuente adicional " + (index + 1)
    }))
  };
}

// --------------------------------------------------
// RESOLUCIÓN DE UN SERVIDOR ESPECÍFICO
// --------------------------------------------------

async function resolveSelectedServer(episodeUrl, serverUrl) {
  if (isDirectVideo(serverUrl)) {
    return {
      url: serverUrl,
      headers: {
        Referer: episodeUrl
      }
    };
  }

  if (!isAllowedEmbed(serverUrl)) {
    throw kino.error(
      "unavailable",
      "Servidor no permitido"
    );
  }

  return capturePlayer(serverUrl, episodeUrl);
}

// --------------------------------------------------
// RESOLUCIÓN PRINCIPAL
// --------------------------------------------------

export async function resolve(ref) {
  const value = String(ref || "");

  if (!value) {
    throw kino.error(
      "not_found",
      "Contenido no encontrado"
    );
  }

  // Una alternativa seleccionada por la persona.
  const selected = parseServerRef(value);

  if (selected) {
    const result = await resolveSelectedServer(
      selected.episodeUrl,
      selected.serverUrl
    );

    return {
      url: result.url,
      headers: result.headers || {},
      alternatives: result.alternatives || []
    };
  }

  const episodeUrl = absoluteUrl(value);

  if (!episodeUrl) {
    throw kino.error(
      "not_found",
      "Referencia no válida"
    );
  }

  // Leer la página y obtener los servidores disponibles.
  const html = await getHtml(episodeUrl);
  const servers = extractVideoSources(html, episodeUrl);

  if (!servers.length) {
    throw kino.error(
      "unavailable",
      "No se encontraron reproductores compatibles en este recurso"
    );
  }

  let firstResult = null;
  let selectedIndex = -1;
  let lastError = null;

  // Intentar como máximo dos servidores inicialmente.
  // El resto aparecerá como alternativas seleccionables.
  const attempts = Math.min(servers.length, 2);

  for (let i = 0; i < attempts; i++) {
    const server = servers[i];

    try {
      if (server.type === "direct") {
        firstResult = {
          url: server.url,
          headers: {
            Referer: episodeUrl
          },
          alternatives: []
        };
      } else {
        firstResult = await capturePlayer(
          server.url,
          episodeUrl
        );
      }

      selectedIndex = i;
      break;

    } catch (error) {
      lastError = error;

      kino.log(
        "Servidor no disponible:",
        server.name,
        error.code || "error"
      );

      // CAPTCHA, bloqueo o timeout:
      // no intentar resolverlo ni repetirlo en bucle.
      if (
        error.code === "blocked" ||
        error.code === "busy" ||
        error.code === "browser_unavailable" ||
        error.code === "not_allowed"
      ) {
        continue;
      }
    }
  }

  if (!firstResult) {
    if (lastError) throw lastError;

    throw kino.error(
      "unavailable",
      "Ningún servidor pudo proporcionar una fuente de vídeo"
    );
  }

  // Añadir los servidores restantes como alternativas
  // perezosas: Kino solo los resolverá cuando se seleccionen.
  const alternatives = [];

  for (let i = 0; i < servers.length; i++) {
    if (i === selectedIndex) continue;

    const server = servers[i];

    alternatives.push({
      label: server.name,
      ref: createServerRef(
        episodeUrl,
        server.url
      )
    });

    if (alternatives.length >= MAX_ALTERNATIVES) break;
  }

  // Las fuentes adicionales que devolvió el mismo reproductor.
  for (const alternative of firstResult.alternatives || []) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;

    alternatives.push({
      label: alternative.label || "Fuente adicional",
      url: alternative.url,
      headers: alternative.headers || {}
    });
  }

  return {
    url: firstResult.url,
    headers: firstResult.headers || {},
    alternatives
  };
}
