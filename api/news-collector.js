// api/news-collector.js - Vercel 서버사이드 RSS 수집기
// Google News RSS (글로벌 접근 가능) + fast-xml-parser
import { XMLParser } from 'fast-xml-parser';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const feeds = [
    { name: '구글뉴스-증시', url: 'https://news.google.com/rss/search?q=%EC%A3%BC%EC%8B%9D+%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko' },
    { name: '구글뉴스-반도체', url: 'https://news.google.com/rss/search?q=%EB%B0%98%EB%8F%84%EC%B2%B4+%EC%82%BC%EC%84%B1&hl=ko&gl=KR&ceid=KR:ko' },
    { name: '구글뉴스-경제', url: 'https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD%EA%B2%BD%EC%A0%9C+%EC%9E%84%EC%9B%90%EB%A7%A4%EC%88%98&hl=ko&gl=KR&ceid=KR:ko' },
    { name: '구글뉴스-금리', url: 'https://news.google.com/rss/search?q=%EA%B8%88%EB%A6%AC+%EC%99%B8%EA%B5%AD%EC%9D%B8&hl=ko&gl=KR&ceid=KR:ko' },
  ];

  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });

  async function fetchOne(feed) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(feed.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      });
      clearTimeout(t);
      if (!r.ok) return [];
      const xml = await r.text();
      const obj = parser.parse(xml);
      const channel = obj?.rss?.channel || {};
      const rawItems = channel.item || [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      return items.slice(0, 5).map(it => {
        const title = String(it.title?.__cdata || it.title || '').trim();
        const link = String(it.link || '#').trim();
        const pub = String(it.pubDate || '').trim();
        return { title, link, pub, src: feed.name };
      }).filter(it => it.title);
    } catch (e) {
      clearTimeout(t);
      console.warn('[news-collector]', feed.name, e.message);
      return [];
    }
  }

  try {
    const results = await Promise.allSettled(feeds.map(f => fetchOne(f)));
    const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    return res.status(200).json({ ok: true, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
