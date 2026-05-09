import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const html = readFileSync('/Users/suwamakoto/Desktop/temp1/Claude/corporateGallery/index.html', 'utf8');

// Extract verified=false entries
const rowRe = /\["(\w+)",\s*"(\w+)",\s*"([^"]+)",\s*"(https?:\/\/[^"]+)",\s*false\]/g;
const entries = [];
for (const m of html.matchAll(rowRe)) {
  entries.push({ iid: m[1], cid: m[2], pt: m[3], url: m[4] });
}
console.log(`チェック対象: ${entries.length} URLs`);

const DEAD_KEYWORDS = [
  '404', 'not found', 'notfound', 'not_found',
  'sorry', 'お探しのページ', 'ページが見つかりません',
  'ページは見つかりません', 'ページが存在しません',
  'このページは存在しません', 'お探しのページは見つかりません',
  'page does not exist', 'page not found',
  'error 404', '404 error',
  'このページは移動または削除', 'ページが移動',
  '削除されました', 'アクセスできません',
  'お探しのページが見つかり', '存在しないページ',
  'お探しのページは現在', 'お探しのページはございません',
];

const CONCURRENCY = 8;
const TIMEOUT_MS  = 15000;

async function checkWithBrowser(page, url) {
  try {
    const res = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });
    const status = res?.status() ?? 0;
    if (status === 404 || status === 410) return 'dead_404';

    const title = (await page.title()).toLowerCase();
    const bodyText = await page.evaluate(() =>
      document.body?.innerText?.slice(0, 5000)?.toLowerCase() ?? ''
    );
    const combined = title + ' ' + bodyText;
    if (DEAD_KEYWORDS.some(k => combined.includes(k.toLowerCase()))) return 'dead_body';
    return 'ok';
  } catch (e) {
    if (e.message?.includes('net::ERR') || e.message?.includes('NS_ERROR')) return 'dead_err';
    return `skip_${e.message?.slice(0, 20)}`;
  }
}

const browser = await chromium.launch({ headless: true });
const dead = [];
let done = 0;

async function worker(items) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  // Abort images/fonts/media to speed up
  await page.route('**/*', route => {
    const rt = route.request().resourceType();
    if (['image','media','font','stylesheet'].includes(rt)) route.abort();
    else route.continue();
  });

  for (const entry of items) {
    const status = await checkWithBrowser(page, entry.url);
    if (status.startsWith('dead')) dead.push({ ...entry, status });
    done++;
    if (done % 50 === 0) process.stderr.write(`  ${done}/${entries.length} (dead: ${dead.length})\n`);
  }
  await ctx.close();
}

// Split into CONCURRENCY chunks
const chunkSize = Math.ceil(entries.length / CONCURRENCY);
const chunks = Array.from({ length: CONCURRENCY }, (_, i) =>
  entries.slice(i * chunkSize, (i + 1) * chunkSize)
);

await Promise.all(chunks.map(worker));
await browser.close();

console.log(`\n完了: DEAD=${dead.length} / ${entries.length}`);

writeFileSync('/Users/suwamakoto/Desktop/temp1/Claude/corporateGallery/dead_browser.json',
  JSON.stringify(dead, null, 2));
console.log(`dead_browser.json に保存`);
