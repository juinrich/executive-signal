// api/news-collector.js - Vercel 서버사이드 RSS 수집기
// fast-xml-parser로 XML 파싱 (regex 사용 안 함)
import { XMLParser } from 'fast-xml-parser';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const feeds = [
    { name: '한국경제', url: 'https://www.hankyung.com/feed/economy' },
    { name: '연합뉴스', url: 'https://www.yna.co.kr/RSS/economy.xml' },
    { name: '이데일리', url: 'https://rss.edaily.co.kr/edailyrss/economy.xml' },
    { name: '머니투데이', url: 'https://news.mt.co.kr/mtadmin/etc/rss.html?type=1' },
  ];

  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });

  async function fetchOne(feed) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(feed.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml, text/xml, */*' },
      });
      clearTimeout(t);
      if (!r.ok) return [];
      const xml = await r.text();
      const obj = parser.parse(xml);
      const channel = obj?.rss?.channel || obj?.feed || {};
      const rawItems = channel.item || channel.entry || [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      return items.slice(0, 6).map(it => ({
        title: String(it.title?.__cdata || it.title || '').trim(),
        link: String(it.link || it.guid || '#').trim(),
        pub: String(it.pubDate || it.updated || '').trim(),
        src: feed.name,
      })).filter(it => it.title);
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
