(function startPearPreload() {
  const state = (window.__pearPreload = {
    progress: 0,
    done: false,
    supported: "serviceWorker" in navigator && "caches" in window,
  });

  const scriptUrl = new URL(document.currentScript.src);
  const baseUrl = new URL("./", scriptUrl);
  const manifestUrl = new URL("packs/asset-manifest.json", baseUrl);
  const update = (loaded, total) => {
    state.progress = total ? Math.min(0.995, loaded / total) : 0;
    document.documentElement.dataset.pearPreload = String(
      Math.round(state.progress * 100),
    );
  };

  state.promise = (async () => {
    if (!state.supported) return;

    const registration = await navigator.serviceWorker.register(
      new URL("sw.js", baseUrl),
      { scope: baseUrl.pathname },
    );
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        });
        registration.active?.postMessage({ type: "CLAIM_CLIENTS" });
        setTimeout(resolve, 1500);
      });
    }
    const worker = navigator.serviceWorker.controller || registration.active;

    const manifestResponse = await fetch(manifestUrl, { cache: "no-cache" });
    if (!manifestResponse.ok) throw new Error("Asset manifest unavailable");
    const manifest = await manifestResponse.json();
    const tier = matchMedia("(max-width: 820px)").matches
      ? "mobile"
      : "desktop";
    const cacheName = `pear-assets-${manifest.version}-${tier}`;
    const cache = await caches.open(cacheName);
    await cache.put(manifestUrl, new Response(JSON.stringify(manifest), {
      headers: { "content-type": "application/json" },
    }));

    const staleCaches = (await caches.keys()).filter(
      (name) => name.startsWith("pear-assets-") && name !== cacheName,
    );
    await Promise.all(staleCaches.map((name) => caches.delete(name)));

    const resources = [...manifest.tiers[tier].packs, ...manifest.shared];
    const criticalResources = resources.filter((item) => item.phase === "critical");
    const detailResources = resources.filter((item) => item.phase !== "critical");
    const totalBytes = criticalResources.reduce((sum, item) => sum + item.size, 0);
    let loadedBytes = 0;
    let trackingProgress = true;

    async function cacheResource(item) {
      document.documentElement.dataset.pearPreloadCurrent = item.url;
      const url = new URL(item.url, baseUrl);
      if (await cache.match(url)) {
        loadedBytes += item.size;
        update(loadedBytes, totalBytes);
        return;
      }

      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Asset unavailable: ${item.url}`);
      const chunks = [];

      if (response.body) {
        const reader = response.body.getReader();
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (trackingProgress) {
            update(loadedBytes + Math.min(received, item.size), totalBytes);
          }
        }
      } else {
        chunks.push(new Uint8Array(await response.arrayBuffer()));
      }

      const body = new Blob(chunks);
      if (item.url.endsWith(".pack")) {
        worker?.postMessage({
          type: "PACK_READY",
          url: url.href,
          blob: body,
        });
      }
      cache.put(
        url,
        new Response(body, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        }),
      ).catch((error) => console.warn("Pear cache write skipped.", error));
      loadedBytes += item.size;
      if (trackingProgress) update(loadedBytes, totalBytes);
    }

    async function loadResources(items, concurrency) {
      let cursor = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < items.length) {
          const item = items[cursor++];
          await cacheResource(item);
        }
      });
      await Promise.all(workers);
    }

    await loadResources(criticalResources, 6);

    worker?.postMessage({
      type: "ASSETS_READY",
      cacheName,
      version: manifest.version,
      tier,
    });

    state.progress = 1;
    state.done = true;
    document.documentElement.dataset.pearPreload = "100";
    document.documentElement.dataset.pearPreloadDone = "true";
    window.dispatchEvent(new Event("pearpreloadcomplete"));

    trackingProgress = false;
    const beginDetailLoad = () => loadResources(detailResources, 3)
      .then(() => {
        state.detailDone = true;
        document.documentElement.dataset.pearDetailDone = "true";
      })
      .catch((error) => console.warn("Pear detail preload paused.", error));
    if ("requestIdleCallback" in window) {
      requestIdleCallback(beginDetailLoad, { timeout: 1200 });
    } else {
      setTimeout(beginDetailLoad, 300);
    }
  })()
    .catch((error) => {
      console.warn("Pear compressed preload fell back to direct loading.", error);
      state.error = String(error);
      document.documentElement.dataset.pearPreloadError = state.error;
    })
    .finally(() => {
      if (!state.done) {
        state.progress = 1;
        state.done = true;
        document.documentElement.dataset.pearPreload = "100";
        document.documentElement.dataset.pearPreloadDone = "true";
        window.dispatchEvent(new Event("pearpreloadcomplete"));
      }
    });
})();
