import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();
const CM_ARTIST_ID = 9194995;

async function getChartmetricToken() {
  try {
    const cached = await redis.get('cm_token');
    if (cached) return cached;
  } catch (e) {}
  const res = await fetch('https://api.chartmetric.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: process.env.CHARTMETRIC_API_KEY })
  });
  if (!res.ok) throw new Error('Chartmetric token failed: ' + await res.text());
  const { token, expires_in } = await res.json();
  try {
    await redis.set('cm_token', token, { ex: (expires_in || 3600) - 60 });
  } catch (e) {}
  return token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const token = await getChartmetricToken();
    const headers = { Authorization: `Bearer ${token}` };

    const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const [spotifyRes, tiktokRes, igRes, listenersRes] = await Promise.all([
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/spotify?since=${since}`, { headers }),
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/tiktok?since=${since}`, { headers }),
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/instagram?since=${since}`, { headers }),
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/spotify?since=${since}&field=listeners`, { headers })
    ]);

    const [spotify, tiktok, ig, listeners] = await Promise.all([
      spotifyRes.ok ? spotifyRes.json() : null,
      tiktokRes.ok ? tiktokRes.json() : null,
      igRes.ok ? igRes.json() : null,
      listenersRes.ok ? listenersRes.json() : null
    ]);

    const cmStats = {
      spotify_followers: spotify?.obj?.followers ?? spotify?.obj?.data ?? null,
      spotify_monthly_listeners: listeners?.obj?.listeners ?? listeners?.obj?.data ?? spotify?.obj?.monthly_listeners ?? spotify?.obj?.listeners ?? null,
      tiktok_followers: tiktok?.obj?.followers ?? [],
      tiktok_likes: tiktok?.obj?.likes ?? [],
      ig_followers: ig?.obj?.followers ?? [],
      ig_engagement: ig?.obj?.engagement_rate ?? null
    };

    // Merge into latest snapshot
    const existing = await redis.get('latest_snapshot') || {};
    await redis.set('latest_snapshot', { ...existing, ...cmStats, cm_updated: Date.now() });
    return res.status(200).json({ ok: true, cmStats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
