import { readFileSync, writeFileSync } from 'fs';

const html = readFileSync('/Users/suwamakoto/Desktop/temp1/Claude/corporateGallery/index.html', 'utf8');

// Extract RAW entries where verified===false and url is non-null
const rowRe = /\["(\w+)",\s*"(\w+)",\s*"([^"]+)",\s*"(https?:\/\/[^"]+)",\s*false\]/g;
const entries = [];
for (const m of html.matchAll(rowRe)) {
  entries.push({ iid: m[1], cid: m[2], pt: m[3], url: m[4] });
}
console.log(`チェック対象: ${entries.length} URLs`);

const DEAD_KEYWORDS = [
  '404', 'not found', 'not_found', 'notfound',
  'sorry', 'お探しのページ', 'ページが見つかりません',
  'ページは見つかりません', 'お探しのページは', 'このページは存在しません',
  'ページが存在しません', 'page does not exist', 'エラーが発生しました',
  'このページは移動', 'ページが移動', '削除されました',
  'アクセスできません', 'error 404', '404 error',
];

const CONCURRENCY = 30;
const TIMEOUT_MS  = 8000;

async function checkUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-checker/1.0)' },
    });
    clearTimeout(timer);
    if (res.status === 404 || res.status === 410) return 'dead';
    if (res.status >= 400) return `http_${res.status}`;
    // Read partial body to check for not-found patterns
    const reader = res.body.getReader();
    let text = '';
    for (let i = 0; i < 6; i++) { // read up to ~6 chunks
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if (text.length > 8000) break;
    }
    reader.cancel().catch(() => {});
    const lower = text.toLowerCase();
    if (DEAD_KEYWORDS.some(k => lower.includes(k))) return 'dead_body';
    return 'ok';
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return 'timeout';
    return `err_${e.code ?? e.message?.slice(0,20)}`;
  }
}

// Run with concurrency limit
async function runAll(items, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const status = await checkUrl(items[i].url);
      results[i] = { ...items[i], status };
      if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const results = await runAll(entries, CONCURRENCY);

const dead    = results.filter(r => r.status === 'dead' || r.status === 'dead_body');
const timeout = results.filter(r => r.status === 'timeout');
const errors  = results.filter(r => r.status.startsWith('err_') || r.status.startsWith('http_'));
const ok      = results.filter(r => r.status === 'ok');

console.log(`\n結果: OK=${ok.length}  DEAD=${dead.length}  TIMEOUT=${timeout.length}  ERROR=${errors.length}`);

writeFileSync('/Users/suwamakoto/Desktop/temp1/Claude/corporateGallery/dead_urls.json',
  JSON.stringify(dead.map(r => ({ iid: r.iid, cid: r.cid, pt: r.pt, url: r.url, status: r.status })), null, 2));

console.log(`\ndead_urls.json に ${dead.length} 件保存しました`);
if (timeout.length) {
  writeFileSync('/Users/suwamakoto/Desktop/temp1/Claude/corporateGallery/timeout_urls.json',
    JSON.stringify(timeout.map(r => ({ iid: r.iid, cid: r.cid, pt: r.pt, url: r.url })), null, 2));
  console.log(`timeout_urls.json に ${timeout.length} 件保存しました`);
}
