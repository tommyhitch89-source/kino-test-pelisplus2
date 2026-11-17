const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/"
};

function fixUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE_URL + url;
  return url;
}

function cleanTitle(raw) {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/^VER\s+/i, "")
    .replace(/\s+Online\s+Gratis.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCards(html) {
  const items = [];
  const seen = new Set();

  // Busca todos los bloques de enlace hacia /pelicula/, /serie/, /anime/ o /dorama/
  const linkRegex = /<a\b[^>]*href=["']([^"']*\/(?:pelicula|serie|anime|dorama)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const fullUrl = fixUrl(match[1]);
    const innerHtml = match[2];

    if (!fullUrl || seen.has(fullUrl)) continue;

    // Extrae imagen (prioriza data-src sobre src)
    const imgMatch = innerHtml.match(/<img\b[^>]*>/i);
    let poster = "";
    let altTitle = "";

    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src=["']([^"']+)["']/i);
      const src = imgTag.match(/\bsrc=["']([^"']+)["']/i);
      const alt = imgTag.match(/\balt=["']([^"']+)["']/i);

      poster = fixUrl((dataSrc && dataSrc[1]) || (src && src[1]) || "");
      altTitle = alt ? alt[1] : "";
    }

    // Extrae título desde el texto interno o el atributo alt
    let title = cleanTitle(innerHtml);
    if (!title || title.length < 2) {
      title = cleanTitle(altTitle);
    }

    if (title && poster) {
      seen.add(fullUrl);
      const isMovie = fullUrl.includes("/pelicula/");
      items.push({
        id: fullUrl,
        ref: fullUrl,
        kind: isMovie ? "movie" : "series",
        title: title,
        poster: poster
      });
    }
  }

  return items;
}

export async function home() {
  const res = await kino.fetch(BASE_URL + "/", { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("unavailable", "HTTP " + res.status, {
      userMessage: "No se pudo conectar con PelisplusHD (error " + res.status + ")."
    });
  }

  const html = res.text();
  const allItems = extractCards(html);

  const movies = allItems.filter(function (i) { return i.kind === "movie"; });
  const series = allItems.filter(function (i) { return i.kind === "series"; });

  const rows = [];

  if (movies.length > 0) {
    rows.push({
      id: "peliculas-recientes",
      title: "Películas recientes",
      items: movies.slice(0, 24)
    });
  }

  if (series.length > 0) {
    rows.push({
      id: "series-animes",
      title: "Series, Animes y Doramas",
      items: series.slice(0, 24)
    });
  }

  return rows;
}

export async function search(input) {
  const query = typeof input === "string" ? input : (input && input.q) || "";
  const q = encodeURIComponent(query.trim());
  const res = await kino.fetch(BASE_URL + "/search?s=" + q, { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("unavailable", "HTTP " + res.status);
  }

  return extractCards(res.text());
}

export async function episodes(input) {
  const ref = typeof input === "string" ? input : (input && input.ref) || "";
  const res = await kino.fetch(fixUrl(ref), { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("not_found", "HTTP " + res.status);
  }

  const html = res.text();
  const list = [];
  const seen = new Set();

  // Busca enlaces de capítulos dentro de la ficha de la serie
  const epRegex = /<a\b[^>]*href=["']([^"']*\/(?:ver|episodio|capitulo|serie)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = epRegex.exec(html)) !== null) {
    const epUrl = fixUrl(match[1]);
    const epText = cleanTitle(match[2]);

    if (!epUrl || seen.has(epUrl) || epUrl === fixUrl(ref)) continue;

    const numMatch = epText.match(/(\d+)\s*[xX-]\s*(\d+)/) || epText.match(/(\d+)/);
    if (numMatch) {
      seen.add(epUrl);
      const season = numMatch[2] ? parseInt(numMatch[1], 10) : 1;
      const number = numMatch[2] ? parseInt(numMatch[2], 10) : parseInt(numMatch[1], 10);

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

  // Busca botones con data-url, data-video o data-src
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

  // Respaldo: busca iframes incrustados directamente en el HTML
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
      userMessage: "No se encontraron enlaces de reproducción para este título."
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
