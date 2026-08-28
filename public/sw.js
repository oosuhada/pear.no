const PACK_CACHE_PREFIX = "pear-assets-";
let activeCacheName = "";
let manifestPromise;
const packBlobs = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLAIM_CLIENTS") self.clients.claim();
  if (event.data?.type === "PACK_READY" && event.data.url && event.data.blob) {
    packBlobs.set(event.data.url, event.data.blob);
  }
  if (event.data?.type === "ASSETS_READY") {
    activeCacheName = event.data.cacheName;
    manifestPromise = undefined;
  }
});

const relativePath = (url) => {
  const scopePath = new URL(self.registration.scope).pathname;
  return decodeURIComponent(url.pathname.slice(scopePath.length));
};

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const url = new URL("packs/asset-manifest.json", self.registration.scope);
      const cached = await caches.match(url);
      const response = cached || (await fetch(url, { cache: "no-cache" }));
      return response.json();
    })();
  }
  return manifestPromise;
}

async function currentCache(manifest, tier) {
  const expected = `${PACK_CACHE_PREFIX}${manifest.version}-${tier}`;
  const names = await caches.keys();
  if (names.includes(expected)) return caches.open(expected);
  if (activeCacheName) return caches.open(activeCacheName);
  return null;
}

async function frameResponse(request, entry, manifest) {
  const cache = await currentCache(manifest, entry.tier);
  if (!cache) return fetch(request);

  const packUrl = new URL(entry.pack, self.registration.scope);
  let blob = packBlobs.get(packUrl.href);
  if (!blob) {
    const packed = await cache.match(packUrl);
    if (!packed) return fetch(request);
    blob = await packed.blob();
    packBlobs.set(packUrl.href, blob);
  }

  return new Response(blob.slice(entry.offset, entry.offset + entry.length), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
      "x-pear-frame-pack": "1",
    },
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const relative = relativePath(url);
  if (relative.endsWith(".webp") && relative.startsWith("films/")) {
    event.respondWith(
      loadManifest()
        .then((manifest) => {
          const entry = manifest.frames[relative];
          return entry
            ? frameResponse(event.request, entry, manifest)
            : fetch(event.request);
        })
        .catch(() => fetch(event.request)),
    );
    return;
  }

  if (
    relative.startsWith("films/") ||
    relative.startsWith("art/") ||
    relative.startsWith("packs/")
  ) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
  }
});
