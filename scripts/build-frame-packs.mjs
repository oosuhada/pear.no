import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const filmsRoot = path.join(projectRoot, "films");
const outputRoot = path.join(projectRoot, "public", "packs");

const regularSequences = ["flysky", "trans", "plan", "tree", "coda"];
const modelSequences = ["v28", "v51", "v61", "renaissance"];
const sharedAssets = [
  "films/reveal.mp4",
  "films/reveal-poster.jpg",
  "films/signal.mp4",
  "films/signal-poster.jpg",
  "films/colossus.mp4",
  "films/colossus-poster.jpg",
  "films/footer-loop.mp4",
  "art/scaffold_expand.jpg",
];

const toWebPath = (value) => value.split(path.sep).join("/");

async function listFrames(directory) {
  const names = await fs.readdir(directory);
  return names.filter((name) => name.endsWith(".webp")).sort();
}

async function makePack(tier, name, directory) {
  const names = await listFrames(directory);
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
  const filename = `${tier}-${name}-${digest}.pack`;
  await fs.writeFile(path.join(outputRoot, filename), payload);

  return {
    url: `packs/${filename}`,
    size: payload.length,
    entries,
  };
}

async function buildTier(tier) {
  const packs = [];
  const regularSubdirectory = tier === "mobile" ? "768" : "";
  const modelSubdirectory = tier === "mobile" ? "768" : "1440";

  for (const name of regularSequences) {
    packs.push(
      await makePack(
        tier,
        name,
        path.join(filmsRoot, name, regularSubdirectory),
      ),
    );
  }

  for (const name of modelSequences) {
    packs.push(
      await makePack(
        tier,
        `model-${name}`,
        path.join(filmsRoot, "model", name, modelSubdirectory),
      ),
    );
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
  sharedAssets.map(async (url) => ({
    url,
    size: (await fs.stat(path.join(projectRoot, url))).size,
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
