// api/news-collector.js - Vercel 서버사이드 RSS 수집기
// 브라우저 CORS 제한 우회: 서버에서 직접 RSS를 가져와 JSON 반환

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const RSS_FEEDS = [
    { name: '한국경제', url: 'https://www.hankyung.com/feed/economy' },
    { name: '연합뉴스', url: 'https://www.yna.co.kr/RSS/economy.xml' },
    { name: '이데일리', url: 'https://rss.edaily.co.kr/edailyrss/economy.xml' },
    { name: '머니투데이', url: 'https://news.mt.co.kr/mtadmin/etc/rss.html?type=1' },
  ];

  async function fetchFeed(feed) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 7000);
    try {
      const r = await fetch(feed.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ExecutiveSignalBot/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      clearTimeout(tid);
      if (!r.ok) return [];
      const xml = await r.text();
      const items = [];
      const itemRegex = /<item[^>]*>([sS]*?)</item>/gi;
      let m;
      while ((m = itemRegex.exec(xml)) !== null && items.length < 6) {
        const block = m[1];
        const title = (block.match(/<title[^>]*>(?:<![CDATA[)?([sS]*?)(?:]]>)?</title>/) || [])[1] || '';
        const link = (block.match(/<link[^>]*>([^<]+)/) || [])[1] || '#';
        const pub = (block.match(/<pubDate[^>]*>([^<]+)/) || [])[1] || '';
        if (title.trim()) {
          items.push({
            title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim(),
            link: link.trim(),
            pub,
            src: feed.name,
          });
        }
      }
      return items;
    } catch (e) {
      clearTimeout(tid);
      console.warn('[news-collector]', feed.name, e.message);
      return [];
    }
  }

  try {
    const results = await Promise.allSettled(RSS_FEEDS.map(f => fetchFeed(f)));
    const allNews = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    return res.status(200).json({ ok: true, count: allNews.length, items: allNews });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
    }
