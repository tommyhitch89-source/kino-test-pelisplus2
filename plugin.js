const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
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
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/^VER\s+/i, "")
    .replace(/\s+Online\s+Gratis.*$/i, "")
    .replace(/\s+\(\d{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCards(html) {
  const items = [];
  const seen = new Set();
  if (!html) return items;

  // Estrategia 1: Enlaces que envuelven la tarjeta e imagen
  const cardRegex = /<a\b[^>]*href=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const innerHtml = match[2];

    if (!/\/(?:pelicula|serie|anime|dorama|ver)\//i.test(rawHref)) continue;
    if (/\/temporada-\d+|\/episodio-\d+|\/capitulo-\d+/i.test(rawHref)) continue;

    const fullUrl = fixUrl(rawHref);
    if (!fullUrl || seen.has(fullUrl)) continue;

    const imgMatch = innerHtml.match(/<img\b[^>]*>/i);
    if (!imgMatch) continue;

    const imgTag = imgMatch[0];
    const dataSrc = imgTag.match(/data-src=["']([^"']+)["']/i);
    const src = imgTag.match(/\bsrc=["']([^"']+)["']/i);
    const alt = imgTag.match(/\balt=["']([^"']+)["']/i);

    const poster = fixUrl((dataSrc && dataSrc[1]) || (src && src[1]) || "");
    if (!poster || poster.startsWith("data:")) continue;

    let title = cleanTitle((alt && alt[1]) || innerHtml);
    if (!title || title.length < 2) continue;

    seen.add(fullUrl);
    const isMovie = /\/pelicula\//i.test(fullUrl);
    items.push({
      id: fullUrl,
      ref: fullUrl,
      kind: isMovie ? "movie" : "series",
      title: title,
      poster: poster
    });
  }

  // Estrategia 2 (Respaldo): Si la imagen y el enlace están separados en contenedores hermanos
  if (items.length === 0) {
    const blockRegex = /<(?:article|div|li)\b[^>]*class=["'][^"']*(?:item|post|poster|card|col-)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div|li)>/gi;
    while ((match = blockRegex.exec(html)) !== null) {
      const block = match[1];
      const hrefMatch = block.match(/<a\b[^>]*href=["']([^"'#?]+)["']/i);
      const imgMatch = block.match(/<img\b[^>]*>/i);
      if (!hrefMatch || !imgMatch) continue;

      const fullUrl = fixUrl(hrefMatch[1]);
      if (!fullUrl || seen.has(fullUrl)) continue;
      if (!/\/(?:pelicula|serie|anime|dorama)\//i.test(fullUrl)) continue;

      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src=["']([^"']+)["']/i);
      const src = imgTag.match(/\bsrc=["']([^"']+)["']/i);
      const alt = imgTag.match(/\balt=["']([^"']+)["']/i);

      const poster = fixUrl((dataSrc && dataSrc[1]) || (src && src[1]) || "");
      const title = cleanTitle((alt && alt[1]) || block);

      if (poster && !poster.startsWith("data:") && title && title.length >= 2) {
        seen.add(fullUrl);
        items.push({
          id: fullUrl,
          ref: fullUrl,
          kind: /\/pelicula\//i.test(fullUrl) ? "movie" : "series",
          title: title,
          poster: poster
        });
      }
    }
  }

  return items;
}

export async function home() {
  const res = await kino.fetch(BASE_URL + "/", { headers: HEADERS });
  if (typeof kino.log === "function") {
    kino.log("HOME status: " + res.status);
  }

  if (!res.ok) {
    throw kino.error("unavailable", "HTTP " + res.status, {
      userMessage: "PelisplusHD respondió con error HTTP " + res.status
    });
  }

  const html = res.text();
  if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
    throw kino.error("blocked", "Cloudflare activo", {
      userMessage: "PelisplusHD está bloqueado por protección anti-bots en tu red."
    });
  }

  const allItems = extractCards(html);
  if (typeof kino.log === "function") {
    kino.log("HOME items extraídos: " + allItems.length);
  }

  const movies = allItems.filter(function (i) { return i.kind === "movie"; });
  const series = allItems.filter(function (i) { return i.kind === "series"; });

  const rows = [];
  if (movies.length > 0) {
    rows.push({
      id: "peliculas",
      title: "Películas recientes",
      items: movies.slice(0, 24)
    });
  }
  if (series.length > 0) {
    rows.push({
      id: "series",
      title: "Series, Animes y Doramas",
      items: series.slice(0, 24)
    });
  }

  return rows;
}

export async function search(input) {
  const query = typeof input === "string" ? input : (input && input.q) || "";
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const urls = [
    BASE_URL + "/search?s=" + encodeURIComponent(cleanQ),
    BASE_URL + "/?s=" + encodeURIComponent(cleanQ)
  ];

  for (let i = 0; i < urls.length; i++) {
    const res = await kino.fetch(urls[i], { headers: HEADERS });
    if (typeof kino.log === "function") {
      kino.log("SEARCH " + urls[i] + " -> HTTP " + res.status);
    }
    if (res.ok) {
      const html = res.text();
      const found = extractCards(html);
      if (found.length > 0) {
        return found;
      }
    }
  }

  return [];
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
    const epUrl = fixUrl(match[1]);
    const epText = cleanTitle(match[2]);

    if (!epUrl || seen.has(epUrl) || epUrl === fixUrl(ref)) continue;

    const urlMatch = epUrl.match(/temporada-(\d+)\/(?:episodio|capitulo)-(\d+)/i);
    const textMatch = epText.match(/(\d+)\s*[xXeE-]\s*(\d+)/);

    if (urlMatch || textMatch) {
      seen.add(epUrl);
      const season = urlMatch ? parseInt(urlMatch[1], 10) : parseInt(textMatch[1], 10);
      const number = urlMatch ? parseInt(urlMatch[2], 10) : parseInt(textMatch[2], 10);

      list.push({
        ref: epUrl,
        season: season,
        number: number,
        title: epText || "Episodio " + number
      });
    }
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
    const url = fixUrl(match[1]);
    const label = cleanTitle(match[2]) || "Servidor " + (servers.length + 1);
    if (url && url.startsWith("http") && !seen.has(url)) {
      seen.add(url);
      servers.push({ label: label, ref: url });
    }
  }

  if (servers.length === 0) {
    const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["']/gi;
    while ((match = iframeRegex.exec(html)) !== null) {
      const url = fixUrl(match[1]);
      if (url && url.startsWith("http") && !seen.has(url)) {
        seen.add(url);
        servers.push({ label: "Reproductor " + (servers.length + 1), ref: url });
      }
    }
  }

  if (servers.length === 0) {
    throw kino.error("not_found", "Sin servidores", {
      userMessage: "No se encontraron servidores de video en esta ficha."
    });
  }

  let targetUrl = servers[0].ref;

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
