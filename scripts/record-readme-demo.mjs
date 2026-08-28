import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const target = process.argv[2] || "https://oosuhada.github.io/pear.no/";
const outputDir = process.argv[3] || "/tmp/pear-readme-recording";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: outputDir,
    size: { width: 1280, height: 720 },
  },
});

// Warm the Service Worker and compressed frame packs before the take.
const warmup = await context.newPage();
await warmup.goto(`${target}?readme-warmup=${Date.now()}`, {
  waitUntil: "domcontentloaded",
});
await warmup.waitForFunction(() => !document.querySelector(".boot"), null, {
  timeout: 90_000,
});
await warmup.waitForFunction(
  () => document.documentElement.dataset.pearDetailDone === "true",
  null,
  { timeout: 120_000 },
);
await warmup.close();

const page = await context.newPage();
const video = page.video();
const takeStartedAt = Date.now();

await page.goto(`${target}?readme-take=${Date.now()}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => !document.querySelector(".boot"), null, {
  timeout: 90_000,
});
await page.waitForTimeout(900);

const trimStart = (Date.now() - takeStartedAt) / 1000;
const metrics = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  viewportHeight: innerHeight,
}));

const maxScroll = metrics.scrollHeight - metrics.viewportHeight;
const steps = 420;
const delta = Math.ceil(maxScroll / steps);

for (let index = 0; index < steps; index += 1) {
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(33);
}

await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1600);

const trimDuration = (Date.now() - takeStartedAt) / 1000 - trimStart;
await page.close();
await context.close();
await browser.close();

console.log(JSON.stringify({
  rawVideo: await video.path(),
  trimStart,
  trimDuration,
  ...metrics,
}));
