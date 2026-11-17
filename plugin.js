const BASE_URL = "https://pelisplushd.bz";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/"
};

const SELECTORS = {
  catalogItems: ".Posters-link, .item, .TPost",
  itemTitle: ".Posters-title, .Title, h2",
  itemPoster: "img",
  seasonContainer: ".episodes-list, .TPTblCn",
  episodeLink: "a.btn-episode, li a",
  serverButtons: ".server-list li, .player-options li, [data-url], [data-video]",
  playerIframe: "#player iframe, .player-box iframe, iframe"
};

function fixUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE_URL + url;
  return url;
}

function extractCards(html) {
  const items = [];
  const seen = new Set();

  if (typeof kino.html !== "undefined" && typeof kino.html.select === "function") {
    const cards = kino.html.select(html, SELECTORS.catalogItems) || [];
    for (const card of cards) {
      const cardHtml = card.html || "";
      const href = card.attrs?.href || (kino.html.select(cardHtml, "a")[0]?.attrs?.href);
      const titleNode = kino.html.select(cardHtml, SELECTORS.itemTitle)[0];
      const imgNode = kino.html.select(cardHtml, SELECTORS.itemPoster)[0];

      const fullUrl = fixUrl(href);
      const title = (titleNode?.text || card.attrs?.title || "").trim();
      const rawPoster = imgNode?.attrs?.["data-src"] || imgNode?.attrs?.src || "";

      if (fullUrl && title && !seen.has(fullUrl)) {
        seen.add(fullUrl);
        const isMovie = fullUrl.includes("/pelicula");
        items.push({
          id: fullUrl,
          ref: fullUrl,
          kind: isMovie ? "movie" : "series",
          title,
          poster: fixUrl(rawPoster)
        });
      }
    }
  }

  return items;
}

export async function home() {
  const [resMovies, resSeries, resAnimes] = await Promise.all([
    kino.fetch(`${BASE_URL}/peliculas`, { headers: HEADERS }),
    kino.fetch(`${BASE_URL}/series`, { headers: HEADERS }),
    kino.fetch(`${BASE_URL}/animes`, { headers: HEADERS })
  ]);

  const rows = [];

  if (resMovies.ok) {
    const movies = extractCards(resMovies.text());
    if (movies.length > 0) {
      rows.push({ id: "peliculas", title: "Películas recientes", genre: "peliculas", items: movies });
    }
  }

  if (resSeries.ok) {
    const series = extractCards(resSeries.text());
    if (series.length > 0) {
      rows.push({ id: "series", title: "Series destacadas", genre: "series", items: series });
    }
  }

  if (resAnimes.ok) {
    const animes = extractCards(resAnimes.text());
    if (animes.length > 0) {
      rows.push({ id: "animes", title: "Animes", genre: "anime", items: animes });
    }
  }

  return rows;
}

export async function search(query) {
  const text = typeof query === "string" ? query : (query?.q || "");
  const q = encodeURIComponent(text.trim());
  const res = await kino.fetch(`${BASE_URL}/search?s=${q}`, { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("unavailable", `HTTP ${res.status}`);
  }

  return extractCards(res.text());
}

export async function episodes(ref) {
  const res = await kino.fetch(fixUrl(ref), { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("not_found", `HTTP ${res.status}`);
  }

  const html = res.text();
  const list = [];

  if (typeof kino.html !== "undefined" && typeof kino.html.select === "function") {
    const epNodes = kino.html.select(html, `${SELECTORS.seasonContainer} ${SELECTORS.episodeLink}`) || [];
    epNodes.forEach((node, index) => {
      const epUrl = fixUrl(node.attrs?.href);
      const epText = (node.text || "").trim();
      const match = epText.match(/(\d+)\s*[xX-]\s*(\d+)/);

      if (epUrl) {
        list.push({
          ref: epUrl,
          season: match ? parseInt(match[1], 10) : 1,
          number: match ? parseInt(match[2], 10) : index + 1,
          title: epText || `Episodio ${index + 1}`
        });
      }
    });
  }

  return list;
}

export async function resolve(ref) {
  const rawRef = typeof ref === "string" ? ref : (ref?.ref || "");
  const [pageUrl, selectedIndexStr] = rawRef.split("#srv=");
  const selectedIndex = selectedIndexStr ? parseInt(selectedIndexStr, 10) : 0;

  const res = await kino.fetch(fixUrl(pageUrl), { headers: HEADERS });

  if (!res.ok) {
    throw kino.error("not_found", `HTTP ${res.status}`);
  }

  const html = res.text();
  const servers = [];

  if (typeof kino.html !== "undefined" && typeof kino.html.select === "function") {
    const nodes = kino.html.select(html, SELECTORS.serverButtons) || [];
    for (const node of nodes) {
      const rawUrl = node.attrs?.["data-url"] || node.attrs?.["data-video"] || node.attrs?.["data-src"];
      if (rawUrl) {
        servers.push({
          label: (node.text || "Servidor").trim(),
          url: fixUrl(rawUrl)
        });
      }
    }

    if (servers.length === 0) {
      const iframes = kino.html.select(html, SELECTORS.playerIframe) || [];
      if (iframes[0]?.attrs?.src) {
        servers.push({
          label: "Reproductor Principal",
          url: fixUrl(iframes[0].attrs.src)
        });
      }
    }
  }

  if (servers.length === 0) {
    throw kino.error("not_found", "No se encontraron servidores de video", {
      userMessage: "Este título no tiene enlaces disponibles en este momento."
    });
  }

  const chosen = servers[selectedIndex] || servers[0];
  let targetUrl = chosen.url;

  if (targetUrl.includes("/ir/") || targetUrl.includes("/goto/")) {
    const redirRes = await kino.fetch(targetUrl, { headers: HEADERS });
    if (redirRes.url) targetUrl = redirRes.url;
  }

  const alternatives = servers
    .map((srv, idx) => ({
      label: srv.label || `Servidor ${idx + 1}`,
      ref: `${pageUrl}#srv=${idx}`
    }))
    .filter((_, idx) => idx !== selectedIndex)
    .slice(0, 8);

  if (typeof kino.browser !== "undefined" && typeof kino.browser.capture === "function") {
    const captured = await kino.browser.capture(targetUrl, {
      headers: { Referer: BASE_URL + "/" }
    });
    if (captured && captured.url) {
      return {
        url: captured.url,
        headers: captured.headers || HEADERS,
        alternatives
      };
    }
  }

  throw kino.error("unavailable", "No se pudo extraer el flujo de video", {
    userMessage: "No se pudo reproducir el video desde este servidor."
  });
}
