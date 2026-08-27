import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (message) => {
  if (message.type() === "error") console.log("console-error", message.text());
});
page.on("requestfailed", (request) =>
  console.log("request-failed", request.url(), request.failure()?.errorText),
);
page.on("response", (response) => {
  if (response.status() >= 400) console.log("http-error", response.status(), response.url());
});
const target = process.argv[2] || "http://127.0.0.1:4173/";
const prefix = target.includes("pear.no") ? "pear-original" : "pear-scroll";
await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.waitForFunction(() => !document.querySelector(".boot"), { timeout: 90000 });
const metrics = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  viewport: innerHeight,
  canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({
    className: canvas.className,
    width: canvas.width,
    height: canvas.height,
  })),
}));
console.log(JSON.stringify(metrics));
const checkpoints = process.argv[3] ? process.argv[3].split(",").map(Number) : [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
for (const percent of checkpoints) {
  await page.evaluate((value) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * value), percent);
  await page.waitForTimeout(process.argv[4] ? Number(process.argv[4]) : 1300);
  await page.screenshot({ path: `/tmp/${prefix}-${String(percent).replace(".", "_")}.png` });
  console.log("captured", percent, await page.evaluate(() => ({
    scrollY,
    videos: [...document.querySelectorAll("video")].map((video) => ({
      className: video.className,
      src: video.currentSrc,
      readyState: video.readyState,
      networkState: video.networkState,
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      error: video.error?.message || null,
    })),
  })));
}
await browser.close();
