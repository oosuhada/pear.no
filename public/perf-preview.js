(function startPearPerfPreview() {
  const state = (window.__pearPerfPreview = {
    images: new Map(),
    loaded: 0,
    failed: 0,
    phase: "hero",
  });

  const isMobile = matchMedia("(max-width: 820px)").matches;
  const tier = isMobile ? "768" : "1440";
  const params = new URLSearchParams(location.search);
  const hero = (params.get("hero") || "reveal").toLowerCase();
  const bridges = {
    signal: "v28",
    colossus: "v51",
    reveal: "v61",
  };
  const bridge = bridges[hero] || bridges.reveal;

  let busyUntil = 0;
  const markBusy = () => {
    busyUntil = performance.now() + 220;
  };
  addEventListener("wheel", markBusy, { passive: true });
  addEventListener("touchmove", markBusy, { passive: true });
  addEventListener("pointermove", (event) => {
    if (event.buttons) markBusy();
  }, { passive: true });

  const pad = (value) => String(value).padStart(3, "0");
  const reel = Array.from({ length: 18 }, (_, index) =>
    `./films/model/${bridge}/${tier}/f_${pad(index + 1)}.webp?r=13`,
  );
  const planBase = isMobile ? "./films/plan/768" : "./films/plan";
  const plan = Array.from({ length: 18 }, (_, index) =>
    `${planBase}/f_${pad(index + 1)}.webp?r=13`,
  );

  async function decode(url) {
    if (state.images.has(url)) return;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      state.images.set(url, image);
      state.loaded += 1;
    } catch {
      state.failed += 1;
    }
  }

  async function runQueue(urls, concurrency, waitForIdle) {
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < urls.length) {
        if (waitForIdle && performance.now() < busyUntil) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }
        const url = urls[cursor++];
        await decode(url);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    await Promise.all(workers);
  }

  // The first reel frames are decoded while the loader/hero is still on
  // screen. Keep this deliberately small: enough to absorb the first scroll
  // without pinning hundreds of 1280x720 decoded surfaces in memory.
  runQueue(reel, 2, false)
    .then(() => {
      state.phase = "plan";
      const beginPlan = () => runQueue(plan, 2, true).then(() => {
        state.phase = "ready";
      });
      if ("requestIdleCallback" in window) {
        requestIdleCallback(beginPlan, { timeout: 900 });
      } else {
        setTimeout(beginPlan, 350);
      }
    })
    .catch(() => {
      state.phase = "fallback";
    });
})();
