import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const filmsRoot = path.join(projectRoot, "films");
const outputRoot = path.join(projectRoot, "public", "packs");

const regularSequences = ["flysky", "trans", "plan", "tree", "coda"];
const modelSequences = ["v28", "v51", "v61", "renaissance"];
const sharedAssets = [
  ["films/reveal.mp4", true],
  ["films/reveal-poster.jpg", true],
  ["art/scaffold_expand.jpg", true],
  ["films/signal.mp4", false],
  ["films/signal-poster.jpg", false],
  ["films/colossus.mp4", false],
  ["films/colossus-poster.jpg", false],
  ["films/footer-loop.mp4", false],
];

const toWebPath = (value) => value.split(path.sep).join("/");

async function listFrames(directory) {
  const names = await fs.readdir(directory);
  return names.filter((name) => name.endsWith(".webp")).sort();
}

async function makePack(tier, name, phase, directory, select) {
  const names = (await listFrames(directory)).filter(select);
  const chunks = [];
  const entries = [];
  let offset = 0;

  for (const filename of names) {
    const absolutePath = path.join(directory, filename);
    const bytes = await fs.readFile(absolutePath);
    const framePath = toWebPath(path.relative(projectRoot, absolutePath));
    chunks.push(bytes);
    entries.push([framePath, offset, bytes.length]);
    offset += bytes.length;
  }

  const payload = Buffer.concat(chunks);
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 12);
  const filename = `${tier}-${name}-${phase}-${digest}.pack`;
  await fs.writeFile(path.join(outputRoot, filename), payload);

  return {
    url: `packs/${filename}`,
    size: payload.length,
    phase,
    entries,
  };
}

async function buildTier(tier) {
  const packs = [];
  const modelSubdirectory = tier === "mobile" ? "768" : "1440";

  for (const name of regularSequences) {
    const regularSubdirectory = tier === "mobile"
      ? "768"
      : name === "plan"
        ? "960"
        : "";
    const directory = path.join(filmsRoot, name, regularSubdirectory);
    packs.push(await makePack(tier, name, "critical", directory, (_, index) => index % 8 === 0));
    packs.push(await makePack(tier, name, "detail", directory, (_, index) => index % 8 !== 0));
  }

  for (const name of modelSequences) {
    const directory = path.join(filmsRoot, "model", name, modelSubdirectory);
    packs.push(await makePack(tier, `model-${name}`, "critical", directory, (_, index) => index % 8 === 0));
    packs.push(await makePack(tier, `model-${name}`, "detail", directory, (_, index) => index % 8 !== 0));
  }

  return packs;
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const [desktopPacks, mobilePacks] = await Promise.all([
  buildTier("desktop"),
  buildTier("mobile"),
]);

const shared = await Promise.all(
  sharedAssets.map(async ([url, critical]) => ({
    url,
    size: (await fs.stat(path.join(projectRoot, url))).size,
    phase: critical ? "critical" : "detail",
  })),
);

const frames = {};
for (const [tier, packs] of [
  ["desktop", desktopPacks],
  ["mobile", mobilePacks],
]) {
  for (const pack of packs) {
    for (const [url, offset, length] of pack.entries) {
      frames[url] = { pack: pack.url, offset, length, tier };
    }
    delete pack.entries;
  }
}

const versionHash = createHash("sha256");
for (const pack of [...desktopPacks, ...mobilePacks]) {
  versionHash.update(`${pack.url}:${pack.size};`);
}
for (const asset of shared) versionHash.update(`${asset.url}:${asset.size};`);

const manifest = {
  version: versionHash.digest("hex").slice(0, 12),
  tiers: {
    desktop: { packs: desktopPacks },
    mobile: { packs: mobilePacks },
  },
  shared,
  frames,
};

await fs.writeFile(
  path.join(outputRoot, "asset-manifest.json"),
  JSON.stringify(manifest),
);

console.log(
  `Built ${Object.keys(frames).length} frame entries in ${desktopPacks.length + mobilePacks.length} packs (${manifest.version}).`,
);
