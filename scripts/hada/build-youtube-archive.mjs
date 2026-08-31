import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const manifestPath = path.join(root, 'scripts/hada/youtube-archive-manifest.json');
const manifestOverridesPath = path.join(root, 'scripts/hada/youtube-archive-manifest-overrides.json');
const outRoot = path.join(root, 'hada/reference/source-library-v1');
const mediaDir = path.join(outRoot, 'media');
const thumbsDir = path.join(outRoot, 'thumbs');
const tmpDir = path.join(outRoot, '.youtube-tmp');
const resolvedPath = path.join(outRoot, 'youtube-resolved.json');
const dataPath = path.join(root, 'hada/review/source-library-youtube-data.js');
const ytDlp = '/opt/homebrew/bin/yt-dlp';
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';
const genericProviders = new Set(['pexels', 'pixabay', 'mixkit', 'stock']);

const cliArgs = process.argv.slice(2);
const args = new Set(cliArgs);
const metadataOnly = args.has('--metadata-only');
const rebuild = args.has('--rebuild');
const lowresOnly = args.has('--lowres');
const reindexLocal = args.has('--reindex-local');
const fromId = Number(cliArgs.find(arg => arg.startsWith('--from='))?.split('=')[1] || 0);
const onlyIds = new Set((cliArgs.find(arg => arg.startsWith('--ids='))?.split('=')[1] || '').split(',').filter(Boolean));

const run = (bin, argv, { quiet = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(bin, argv, { cwd: root, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${path.basename(bin)} exited ${code}\n${stderr.slice(-3000)}`));
  });
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deterministicThumbOffset = key => {
  const numericKey = Number(key);
  if (Number.isFinite(numericKey)) return 2 + ((numericKey * 73) % 201) / 100;
  let hash = 2166136261;
  for (const ch of String(key)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 2 + (hash % 201) / 100;
};
const round3 = v => Math.round(v * 1000) / 1000;

function resolveRange(item, duration) {
  const safeEnd = Math.max(0.1, duration - 0.12);
  let start = Number.isFinite(item.start) ? item.start : null;
  let end = Number.isFinite(item.end) ? item.end : null;
  const auto = item.autoSeconds ?? 30;

  if (item.full) {
    start = 0;
    end = Math.max(0.1, safeEnd - (Number.isFinite(item.trimTail) ? item.trimTail : 0));
  } else if (start !== null && end !== null) {
    start = clamp(start, 0, safeEnd - 0.1);
    end = clamp(end, start + 0.1, safeEnd);
  } else if (start !== null) {
    start = clamp(start, 0, safeEnd - 0.1);
    end = Math.min(safeEnd, start + auto);
  } else if (end !== null) {
    start = 0;
    end = clamp(end, 0.1, safeEnd);
  } else if (duration <= auto + 2) {
    start = 0;
    end = safeEnd;
  } else if (duration <= 90) {
    start = Math.max(0, (duration - auto) / 2);
    end = Math.min(safeEnd, start + auto);
  } else {
    start = Math.min(safeEnd - auto, Math.max(5, duration * 0.15));
    end = Math.min(safeEnd, start + auto);
  }

  return [round3(start), round3(end)];
}

async function metadataFor(item) {
  const isGeneric = genericProviders.has(item.provider);
  if (item.youtubeSources?.length) {
    const sourceMeta = [];
    for (let index = 0; index < item.youtubeSources.length; index++) {
      const sourceUrl = item.youtubeSources[index];
      let stdout;
      try {
        ({ stdout } = await run(ytDlp, [
          '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
          '--extractor-args', 'youtube:player_client=mweb', sourceUrl,
        ], { quiet: true }));
      } catch {
        ({ stdout } = await run(ytDlp, [
          '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
          '--extractor-args', 'youtube:player_client=android', sourceUrl,
        ], { quiet: true }));
      }
      const meta = JSON.parse(stdout);
      const duration = Number(meta.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`missing duration for ${sourceUrl}`);
      const cut = item.sourceCuts?.[index];
      const start = Array.isArray(cut) && Number.isFinite(cut[0]) ? clamp(Number(cut[0]), 0, Math.max(0, duration - 0.1)) : 0;
      const end = Array.isArray(cut) && Number.isFinite(cut[1]) ? clamp(Number(cut[1]), start + 0.1, duration) : duration;
      sourceMeta.push({
        url: sourceUrl,
        youtubeTitle: meta.title,
        sourceDuration: round3(duration),
        start: round3(start),
        end: round3(end),
        duration: round3(end - start),
        width: meta.width ?? null,
        height: meta.height ?? null,
      });
    }
    const duration = round3(sourceMeta.reduce((sum, source) => sum + source.duration, 0));
    return {
      ...item,
      duration,
      start: 0,
      end: duration,
      sourceMeta,
      qualityUpgradePossible: true,
    };
  }
  if (item.sources?.length) {
    const sourceMeta = [];
    for (let index = 0; index < item.sources.length; index++) {
      const sourceUrl = item.sources[index];
      const { stdout } = await run(ytDlp, [
        '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
        '--extractor-args', 'generic:impersonate', sourceUrl,
      ], { quiet: true });
      const meta = JSON.parse(stdout);
      const duration = Number(meta.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`missing duration for ${sourceUrl}`);
      const cut = item.sourceCuts?.[index];
      const start = Array.isArray(cut) && Number.isFinite(cut[0]) ? clamp(Number(cut[0]), 0, Math.max(0, duration - 0.1)) : 0;
      const end = Array.isArray(cut) && Number.isFinite(cut[1]) ? clamp(Number(cut[1]), start + 0.1, duration) : duration;
      sourceMeta.push({ url: sourceUrl, sourceDuration: round3(duration), start: round3(start), end: round3(end), duration: round3(end - start), width: meta.width ?? null, height: meta.height ?? null });
    }
    const duration = round3(sourceMeta.reduce((sum, source) => sum + source.duration, 0));
    return {
      ...item,
      duration,
      start: 0,
      end: duration,
      sourceMeta,
      qualityUpgradePossible: true,
    };
  }
  const url = item.url ?? `https://www.youtube.com/watch?v=${item.videoId}`;
  let stdout;
  if (isGeneric) {
    ({ stdout } = await run(ytDlp, [
      '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
      '--extractor-args', 'generic:impersonate', url,
    ], { quiet: true }));
  } else {
    try {
      ({ stdout } = await run(ytDlp, [
        '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
        '--extractor-args', 'youtube:player_client=mweb', url,
      ], { quiet: true }));
    } catch {
      ({ stdout } = await run(ytDlp, [
        '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings',
        '--extractor-args', 'youtube:player_client=android', url,
      ], { quiet: true }));
    }
  }
  const meta = JSON.parse(stdout);
  const duration = Number(meta.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('missing duration');
  const [start, end] = resolveRange(item, duration);
  const ranges = Array.isArray(item.ranges)
    ? item.ranges.map(([rangeStart, rangeEnd]) => {
        const safeEnd = Math.max(0.1, duration - 0.12);
        const s = clamp(Number(rangeStart), 0, safeEnd - 0.1);
        const e = clamp(Number(rangeEnd), s + 0.1, safeEnd);
        return [round3(s), round3(e)];
      })
    : null;
  let autoPreferredFormat = null;
  let autoPreferredHeight = null;
  if (!isGeneric && !item.preferredFormat) {
    const maxSafeBytes = 80 * 1024 * 1024;
    const candidates = (meta.formats ?? [])
      .filter(format => format.vcodec && format.vcodec !== 'none' && format.height >= 480 && format.height <= 1080 && format.protocol === 'https')
      .map(format => ({ ...format, estimatedSize: format.filesize ?? format.filesize_approx ?? Infinity }))
      .filter(format => format.estimatedSize <= maxSafeBytes)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || a.estimatedSize - b.estimatedSize);
    if (candidates.length) {
      autoPreferredFormat = candidates[0].format_id;
      autoPreferredHeight = candidates[0].height;
    }
  }
  return {
    ...item,
    url,
    youtubeTitle: meta.title,
    duration: round3(duration),
    width: meta.width ?? null,
    height: meta.height ?? null,
    start,
    end,
    ...(autoPreferredFormat ? { preferredFormat: autoPreferredFormat, preferredHeight: autoPreferredHeight } : {}),
    qualityUpgradePossible: !lowresOnly || isGeneric || ((item.preferredFormat || autoPreferredFormat) && (item.currentHeight == null || (item.preferredHeight ?? autoPreferredHeight ?? 0) > item.currentHeight)),
    ...(ranges ? { ranges } : {}),
  };
}

async function currentVideoSize(item) {
  const names = await fs.readdir(mediaDir);
  const file = names.find(name => name.startsWith(`${item.id}_`) && name.endsWith('.mp4'));
  if (!file) return null;
  try {
    const { stdout } = await run(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path.join(mediaDir, file),
    ], { quiet: true });
    return JSON.parse(stdout).streams?.[0] ?? null;
  } catch { return null; }
}

async function writeLocalIndex(fullManifest) {
  const records = [];
  for (const item of fullManifest) {
    const clip = `${item.id}_${item.slug}.mp4`;
    const thumb = `${item.id}_${item.slug}.jpg`;
    try {
      await fs.access(path.join(mediaDir, clip));
      await fs.access(path.join(thumbsDir, thumb));
    } catch { continue; }
    let clipDuration = null;
    try {
      const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(mediaDir, clip)], { quiet: true });
      clipDuration = Number(stdout.trim());
    } catch {}
    const ranges = item.ranges ?? [[item.start ?? 0, item.end ?? (Number.isFinite(clipDuration) ? round3(clipDuration) : null)]];
    records.push({
      id: item.id,
      title: item.title,
      clip,
      thumb,
      source: item.youtubeSources?.length ? `youtube:${item.youtubeSources[0]}` : item.sources?.length ? `stock:${item.sources[0]}` : genericProviders.has(item.provider) ? `${item.provider}:${item.url}` : `youtube:${item.videoId}`,
      ranges,
      theme: item.theme,
      ...(item.category ? { category: item.category } : {}),
      ...(item.keywords?.length ? { keywords: item.keywords } : {}),
      ...(item.scrollHeightVh ? { scrollHeightVh: item.scrollHeightVh } : {}),
      ...(item.reverse ? { edit: 'reverse' } : {}),
      ...(item.crop16x9 ? { edit: '16:9 crop' } : {}),
      ...(item.crop ? { crop: item.crop } : {}),
    });
  }
  const js = `window.SOURCE_LIBRARY = (window.SOURCE_LIBRARY || []).concat(${JSON.stringify(records, null, 2)});\n`;
  await fs.writeFile(dataPath, js);
  console.log(`Reindexed ${records.length} local archive records`);
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error: String(error.message || error), item: items[index] }; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

async function locateRaw(prefix) {
  const names = await fs.readdir(tmpDir);
  const match = names.find(name => name.startsWith(prefix + '.') && !name.endsWith('.part') && !name.endsWith('.ytdl'));
  if (!match) throw new Error(`downloaded file not found for ${prefix}`);
  return path.join(tmpDir, match);
}

async function downloadRaw(item, prefix) {
  const outputTemplate = path.join(tmpDir, `${prefix}.%(ext)s`);
  const cleanup = async () => {
    for (const name of await fs.readdir(tmpDir)) {
      if (name.startsWith(prefix + '.')) await fs.rm(path.join(tmpDir, name), { force: true });
    }
  };

  if (item.youtubeSources?.length) {
    const sourcePaths = [];
    try {
      for (let i = 0; i < item.youtubeSources.length; i++) {
        const sourcePrefix = `${prefix}-source-${i}`;
        const sourceTemplate = path.join(tmpDir, `${sourcePrefix}.%(ext)s`);
        try {
          await run(ytDlp, [
            '--no-playlist', '--no-warnings',
            '--impersonate', 'Chrome-136:Macos-15',
            '--extractor-args', 'youtube:player_client=mweb',
            '-f', 'bv*[vcodec^=avc1][height<=1080][ext=mp4]/bv*[height<=1080]/18',
            '-o', sourceTemplate,
            item.youtubeSources[i],
          ], { quiet: true });
        } catch (error) {
          console.warn(`[multi-youtube mweb fallback] ${item.id} ${item.title} source ${i + 1}: ${error.message.split('\n')[0]}`);
          try {
            await run(ytDlp, [
              '--no-playlist', '--no-warnings',
              '--extractor-args', 'youtube:player_client=web_embedded',
              '-f', 'bv*[vcodec^=avc1][height<=1080][ext=mp4]/bv*[height<=1080]/18',
              '-o', sourceTemplate,
              item.youtubeSources[i],
            ], { quiet: true });
          } catch (embeddedError) {
            console.warn(`[multi-youtube embedded fallback] ${item.id} ${item.title} source ${i + 1}: ${embeddedError.message.split('\n')[0]}`);
            await run(ytDlp, [
              '--no-playlist', '--no-warnings',
              '--extractor-args', 'youtube:player_client=android',
              '-f', '18/b[height<=720]/best',
              '-o', sourceTemplate,
              item.youtubeSources[i],
            ], { quiet: true });
          }
        }
        sourcePaths.push(await locateRaw(sourcePrefix));
      }
      return { path: sourcePaths[0], sourcePaths, sectioned: false };
    } catch (error) {
      for (const sourcePath of sourcePaths) await fs.rm(sourcePath, { force: true });
      throw error;
    }
  }

  if (item.sources?.length) {
    const sourcePaths = [];
    try {
      for (let i = 0; i < item.sources.length; i++) {
        const sourcePrefix = `${prefix}-source-${i}`;
        const sourceTemplate = path.join(tmpDir, `${sourcePrefix}.%(ext)s`);
        await run(ytDlp, [
          '--no-playlist', '--no-warnings',
          '--extractor-args', 'generic:impersonate',
          '-f', '0/best',
          '-o', sourceTemplate,
          item.sources[i],
        ], { quiet: true });
        sourcePaths.push(await locateRaw(sourcePrefix));
      }
      return { path: sourcePaths[0], sourcePaths, sectioned: false };
    } catch (error) {
      for (const sourcePath of sourcePaths) await fs.rm(sourcePath, { force: true });
      throw error;
    }
  }

  if (genericProviders.has(item.provider)) {
    await run(ytDlp, [
      '--no-playlist', '--no-warnings',
      '--extractor-args', 'generic:impersonate',
      '-f', '0/best',
      '-o', outputTemplate,
      item.url,
    ], { quiet: true });
    return { path: await locateRaw(prefix), sectioned: false };
  }

  if (item.ranges?.length && item.sectionFormat) {
    const sectionPaths = [];
    try {
      for (let i = 0; i < item.ranges.length; i++) {
        const [s, e] = item.ranges[i];
        const sectionPrefix = `${prefix}-section-${i}`;
        const sectionTemplate = path.join(tmpDir, `${sectionPrefix}.%(ext)s`);
        await run(ytDlp, [
          '--no-playlist', '--no-warnings',
          '--impersonate', 'Chrome-136:Macos-15',
          '--extractor-args', 'youtube:player_client=mweb',
          '-f', String(item.sectionFormat),
          '--download-sections', `*${s}-${e}`,
          '--force-keyframes-at-cuts',
          '-o', sectionTemplate,
          item.url,
        ], { quiet: true });
        sectionPaths.push(await locateRaw(sectionPrefix));
      }
      return { path: sectionPaths[0], sectionPaths, sectioned: true };
    } catch (error) {
      console.warn(`[multi-section HQ fallback] ${item.id} ${item.title}: ${error.message.split('\n')[0]}`);
      for (const sectionPath of sectionPaths) await fs.rm(sectionPath, { force: true });
    }
  }

  // Long YouTube sources can have multi-hundred-MB/GB full files even when
  // the archive only needs a short excerpt. With the local PO-token provider
  // active, mweb can stream just the requested high-quality section reliably.
  if (item.sectionDownload && item.sectionFormat && !item.ranges?.length) {
    try {
      await run(ytDlp, [
        '--no-playlist', '--no-warnings',
        '--impersonate', 'Chrome-136:Macos-15',
        '--extractor-args', 'youtube:player_client=mweb',
        '-f', String(item.sectionFormat),
        '--download-sections', `*${item.start}-${item.end}`,
        '--force-keyframes-at-cuts',
        '-o', outputTemplate,
        item.url,
      ], { quiet: true });
      return { path: await locateRaw(prefix), sectioned: true };
    } catch (error) {
      console.warn(`[section mweb fallback] ${item.id} ${item.title}: ${error.message.split('\n')[0]}`);
      await cleanup();
      try {
        await run(ytDlp, [
          '--no-playlist', '--no-warnings',
          '--extractor-args', 'youtube:player_client=web_embedded',
          '-f', String(item.sectionFormat),
          '--download-sections', `*${item.start}-${item.end}`,
          '--force-keyframes-at-cuts',
          '-o', outputTemplate,
          item.url,
        ], { quiet: true });
        return { path: await locateRaw(prefix), sectioned: true };
      } catch (embeddedError) {
        console.warn(`[section embedded fallback] ${item.id} ${item.title}: ${embeddedError.message.split('\n')[0]}`);
        await cleanup();
      }
    }
  }

  if (item.preferredFormat) {
    try {
      await run(ytDlp, [
        '--no-playlist', '--no-warnings',
        '--impersonate', 'Chrome-136:Macos-15',
        '--extractor-args', 'youtube:player_client=mweb',
        '-f', String(item.preferredFormat),
        '-o', outputTemplate,
        item.url,
      ], { quiet: true });
      return { path: await locateRaw(prefix), sectioned: false };
    } catch (error) {
      console.warn(`[preferred fallback] ${item.id} ${item.title}: ${error.message.split('\n')[0]}`);
      await cleanup();
    }
  }

  if (item.sectionDownload) {
    await run(ytDlp, [
      '--no-playlist', '--no-warnings',
      '--extractor-args', 'youtube:player_client=android',
      '-f', '18/b[height<=360]/best',
      '--download-sections', `*${item.start}-${item.end}`,
      '--force-keyframes-at-cuts',
      '-o', outputTemplate,
      item.url,
    ], { quiet: true });
    return { path: await locateRaw(prefix), sectioned: true };
  }

  // Short stock clips usually fit inside YouTube's current DASH range window,
  // so prefer a 720p AVC stream. Long sources fall back to the stable 360p
  // progressive Android stream to avoid multi-range 403 errors.
  if (item.duration <= 50) {
    const maxHeight = item.maxHeight ?? 720;
    try {
      await run(ytDlp, [
        '--no-playlist', '--no-warnings',
        '--impersonate', 'Chrome-136:Macos-15',
        '--extractor-args', 'youtube:player_client=mweb',
        '-f', `bv*[vcodec^=avc1][height<=${maxHeight}][ext=mp4]/18`,
        '-o', outputTemplate,
        item.url,
      ], { quiet: true });
      return { path: await locateRaw(prefix), sectioned: false };
    } catch (error) {
      console.warn(`[720p fallback] ${item.id} ${item.title}: ${error.message.split('\n')[0]}`);
      await cleanup();
    }
  }

  await run(ytDlp, [
    '--no-playlist', '--no-warnings',
    '--extractor-args', 'youtube:player_client=android',
    '-f', '18/b[height<=360]/best',
    '-o', outputTemplate,
    item.url,
  ], { quiet: true });
  return { path: await locateRaw(prefix), sectioned: false };
}

async function encodeItem(item) {
  const outputBase = `${item.id}_${item.slug}`;
  const output = path.join(mediaDir, `${outputBase}.mp4`);
  const thumb = path.join(thumbsDir, `${outputBase}.jpg`);
  if (!rebuild) {
    try {
      await fs.access(output);
      await fs.access(thumb);
      console.log(`[skip] ${item.id} ${item.title}`);
      return { ...item, clip: `${outputBase}.mp4`, thumb: `${outputBase}.jpg` };
    } catch {}
  }

  const sourceKey = item.videoId ?? item.slug;
  const prefix = `${item.provider ?? 'yt'}-${item.id}-${sourceKey}`;
  for (const name of await fs.readdir(tmpDir)) {
    if (name.startsWith(prefix + '.')) await fs.rm(path.join(tmpDir, name), { force: true });
  }

  const rangeLabel = item.ranges
    ? item.ranges.map(([s, e]) => `${s}s–${e}s`).join(' + ')
    : `${item.start}s–${item.end}s`;
  console.log(`[download] ${item.id} ${item.title} ${rangeLabel}`);
  const download = await downloadRaw(item, prefix);
  const raw = download.path;
  let vf;
  const speedPrefix = Number.isFinite(item.speed) && item.speed > 0 && item.speed !== 1 ? `setpts=PTS/${item.speed},` : '';
  const rotatePrefix = item.rotate === 90 ? 'transpose=1,' : item.rotate === -90 ? 'transpose=2,' : '';
  if (item.crop16x9) {
    vf = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30";
  } else if (item.crop && item.fillAfterCrop) {
    vf = `crop=${item.crop},scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30`;
  } else if (item.crop && item.reverse) {
    vf = `crop=${item.crop},scale='min(1280,iw)':-2,reverse,fps=30`;
  } else if (item.crop && item.normalize1280) {
    vf = `crop=${item.crop},scale=1280:720,fps=30`;
  } else if (item.crop) {
    vf = `crop=${item.crop},scale='min(1920,iw)':-2,fps=30`;
  } else if (item.reverse) {
    vf = "scale='min(1280,iw)':-2,reverse,fps=30";
  } else {
    vf = "scale='min(1920,iw)':-2,fps=30";
  }
  vf = `${speedPrefix}${rotatePrefix}${vf}`;

  console.log(`[encode]   ${item.id} ${item.title}`);
  if (download.sourcePaths?.length) {
    const inputArgs = download.sourcePaths.flatMap(sourcePath => ['-i', sourcePath]);
    const normalized = download.sourcePaths.map((_, i) => {
      const source = item.sourceMeta?.[i];
      const trim = source ? `trim=start=${source.start}:end=${source.end},` : '';
      return `[${i}:v]${trim}scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30,setsar=1,setpts=PTS-STARTPTS[v${i}]`;
    }).join(';');
    const inputs = download.sourcePaths.map((_, i) => `[v${i}]`).join('');
    const post = Number.isFinite(item.speed) && item.speed > 0 && item.speed !== 1 ? `setpts=PTS/${item.speed},` : '';
    const rotate = item.rotate === 90 ? 'transpose=1,' : item.rotate === -90 ? 'transpose=2,' : '';
    const filter = `${normalized};${inputs}concat=n=${download.sourcePaths.length}:v=1:a=0[joined];[joined]${post}${rotate}fps=30[outv]`;
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', ...inputArgs,
      '-filter_complex', filter, '-map', '[outv]', '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-movflags', '+faststart', output,
    ], { quiet: true });
  } else if (download.sectionPaths?.length) {
    const inputArgs = download.sectionPaths.flatMap(sectionPath => ['-i', sectionPath]);
    const normalized = download.sectionPaths.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}]`).join(';');
    const inputs = download.sectionPaths.map((_, i) => `[v${i}]`).join('');
    const filter = `${normalized};${inputs}concat=n=${download.sectionPaths.length}:v=1:a=0[joined];[joined]${vf}[outv]`;
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', ...inputArgs,
      '-filter_complex', filter, '-map', '[outv]', '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-movflags', '+faststart', output,
    ], { quiet: true });
  } else if (item.ranges?.length) {
    const trims = item.ranges.map(([s, e], i) => `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`).join(';');
    const inputs = item.ranges.map((_, i) => `[v${i}]`).join('');
    const filter = `${trims};${inputs}concat=n=${item.ranges.length}:v=1:a=0[joined];[joined]${vf}[outv]`;
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
      '-filter_complex', filter, '-map', '[outv]', '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-movflags', '+faststart', output,
    ], { quiet: true });
  } else {
    const inputArgs = download.sectioned
      ? ['-i', raw]
      : ['-ss', String(item.start), '-to', String(item.end), '-i', raw];
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputArgs,
      '-an', '-vf', vf,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-movflags', '+faststart', output,
    ], { quiet: true });
  }

  const { stdout: durationOut } = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output,
  ], { quiet: true });
  const clipDuration = Number(durationOut.trim());
  const thumbTime = Number.isFinite(item.thumbOffset)
    ? clamp(item.thumbOffset, 0.1, Math.max(0.1, clipDuration - 0.1))
    : clamp(deterministicThumbOffset(item.id), 0.1, Math.max(0.1, clipDuration - 0.1));
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', thumbTime.toFixed(3), '-i', output,
    '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '2', thumb,
  ], { quiet: true });

  if (download.sourcePaths?.length) {
    for (const sourcePath of download.sourcePaths) await fs.rm(sourcePath, { force: true });
  } else if (download.sectionPaths?.length) {
    for (const sectionPath of download.sectionPaths) await fs.rm(sectionPath, { force: true });
  } else {
    await fs.rm(raw, { force: true });
  }
  return { ...item, clip: `${outputBase}.mp4`, thumb: `${outputBase}.jpg`, clipDuration: round3(clipDuration) };
}

async function main() {
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(thumbsDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  const baseManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  let manifestOverrides = [];
  try {
    manifestOverrides = JSON.parse(await fs.readFile(manifestOverridesPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const overrideById = new Map(manifestOverrides.map(item => [item.id, item]));
  const fullManifest = baseManifest.map(item => ({ ...item, ...(overrideById.get(item.id) ?? {}) }));
  for (const override of manifestOverrides) {
    if (!baseManifest.some(item => item.id === override.id)) fullManifest.push(override);
  }
  if (reindexLocal) {
    await writeLocalIndex(fullManifest);
    return;
  }
  let manifest = onlyIds.size
    ? fullManifest.filter(item => onlyIds.has(item.id))
    : fromId ? fullManifest.filter(item => Number(item.id) >= fromId) : fullManifest;
  if (lowresOnly) {
    const candidates = [];
    for (const item of manifest) {
      if (item.provider === 'pexels') continue;
      const size = await currentVideoSize(item);
      if (size?.width <= 640) candidates.push({ ...item, currentWidth: size.width, currentHeight: size.height });
    }
    manifest = candidates;
  }

  console.log(`Resolving ${manifest.length} archive sources${onlyIds.size ? ` ids=${[...onlyIds].join(',')}` : fromId ? ` from ${fromId}` : ''}…`);
  const metadataResults = await pool(manifest, 4, async item => {
    try {
      const meta = await metadataFor(item);
      console.log(`[meta] ${meta.id} ${meta.title}: ${meta.duration}s -> ${meta.start}-${meta.end}`);
      return meta;
    } catch (error) {
      console.error(`[meta-fail] ${item.id} ${item.title}: ${error.message}`);
      throw error;
    }
  });
  const resolved = metadataResults.filter(x => x && !x.error && (!lowresOnly || x.qualityUpgradePossible));
  const failedMeta = metadataResults.filter(x => x?.error);
  await fs.writeFile(resolvedPath, JSON.stringify({ resolved, failed: failedMeta }, null, 2));
  console.log(`Metadata: ${resolved.length} ok / ${failedMeta.length} failed`);
  if (metadataOnly) return;

  const buildResults = await pool(resolved, 3, async item => {
    try { return await encodeItem(item); }
    catch (error) {
      console.error(`[build-fail] ${item.id} ${item.title}: ${error.message}`);
      throw error;
    }
  });
  const built = buildResults.filter(x => x && !x.error);
  const failedBuild = buildResults.filter(x => x?.error);

  const records = built.map(item => ({
    id: item.id,
    title: item.title,
    clip: item.clip,
    thumb: item.thumb,
    source: item.youtubeSources?.length ? `youtube:${item.youtubeSources[0]}` : item.sources?.length ? `stock:${item.sources[0]}` : genericProviders.has(item.provider) ? `${item.provider}:${item.url}` : `youtube:${item.videoId}`,
    ranges: item.ranges ?? [[item.start, item.end]],
    theme: item.theme,
    ...(item.category ? { category: item.category } : {}),
    ...(item.keywords?.length ? { keywords: item.keywords } : {}),
    ...(item.scrollHeightVh ? { scrollHeightVh: item.scrollHeightVh } : {}),
    ...(item.reverse ? { edit: 'reverse' } : {}),
    ...(item.crop16x9 ? { edit: '16:9 crop' } : {}),
    ...(item.crop ? { crop: item.crop } : {}),
  }));
  let outputRecords = records;
  if (fromId || onlyIds.size || lowresOnly) {
    try {
      const existingText = await fs.readFile(dataPath, 'utf8');
      const match = existingText.match(/\.concat\(([\s\S]*)\);\s*$/);
      const existing = match ? JSON.parse(match[1]) : [];
      const byId = new Map(existing.map(record => [record.id, record]));
      records.forEach(record => byId.set(record.id, record));
      outputRecords = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
    } catch {}
  }
  const js = `window.SOURCE_LIBRARY = (window.SOURCE_LIBRARY || []).concat(${JSON.stringify(outputRecords, null, 2)});\n`;
  await fs.writeFile(dataPath, js);
  await fs.writeFile(resolvedPath, JSON.stringify({ resolved, built, failed: [...failedMeta, ...failedBuild] }, null, 2));
  console.log(`Built: ${built.length} ok / ${failedBuild.length} failed`);
  console.log(`Data: ${path.relative(root, dataPath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
