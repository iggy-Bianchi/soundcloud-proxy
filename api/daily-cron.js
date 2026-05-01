import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const CM_ARTIST_ID = 9194995;

async function getSoundcloudStats() {
  const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;
  try {
    const cached = await redis.get('sc_token');
    let token = cached;
    console.log('[SC] cached token present:', !!token);
    if (!token) {
      console.log('[SC] fetching new OAuth token');
      const tokenRes = await fetch('https://api.soundcloud.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
      });
      if (!tokenRes.ok) {
        console.error('[SC] token fetch failed:', tokenRes.status, await tokenRes.text());
        return {};
      }
      const { access_token, expires_in } = await tokenRes.json();
      token = access_token;
      await redis.set('sc_token', token, { ex: (expires_in || 3600) - 60 });
      console.log('[SC] new token cached, expires_in:', expires_in);
    }
    const headers = { Authorization: `OAuth ${token}` };
    const userRes = await fetch('https://api.soundcloud.com/resolve?url=https://soundcloud.com/iamdoomsayer', { headers });
    if (!userRes.ok) {
      console.error('[SC] user resolve failed:', userRes.status);
      if (userRes.status === 401) { await redis.del('sc_token'); console.log('[SC] evicted stale token'); }
      return {};
    }
    const user = await userRes.json();
    console.log('[SC] user resolved: id=%s followers=%d', user.id, user.followers_count);
    const tracksRes = await fetch(`https://api.soundcloud.com/users/${user.id}/tracks?limit=20`, { headers });
    if (!tracksRes.ok) {
      console.error('[SC] tracks fetch failed:', tracksRes.status);
      if (tracksRes.status === 401) { await redis.del('sc_token'); console.log('[SC] evicted stale token'); }
      return {};
    }
    const tracks = await tracksRes.json();
    let plays = 0, reposts = 0, downloads = 0;
    if (Array.isArray(tracks)) {
      tracks.forEach(t => {
        plays += parseInt(t.playback_count || 0);
        reposts += parseInt(t.reposts_count || 0);
        downloads += parseInt(t.download_count || 0);
      });
    }
    const eng = plays > 0 ? (reposts / plays * 100) : 0;
    console.log('[SC] stats: plays=%d reposts=%d downloads=%d', plays, reposts, downloads);
    return { sc_followers: user.followers_count, sc_plays: plays, sc_reposts: reposts, sc_downloads: downloads, sc_tracks: user.track_count, sc_eng: eng };
  } catch (e) {
    console.error('[SC] error:', e.message, e.stack);
    return {};
  }
}

async function getChartmetricToken() {
  try { const cached = await redis.get('cm_token'); if (cached) return cached; } catch (e) {}
  const res = await fetch('https://api.chartmetric.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: process.env.CHARTMETRIC_API_KEY })
  });
  if (!res.ok) throw new Error('Chartmetric token failed: ' + await res.text());
  const { token, expires_in } = await res.json();
  try { await redis.set('cm_token', token, { ex: (expires_in || 3600) - 60 }); } catch (e) {}
  return token;
}

async function getChartmetricStats() {
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
    console.log('[CM] spotify ok=%s tiktok ok=%s ig ok=%s', spotifyRes.ok, tiktokRes.ok, igRes.ok);
    return {
      spotify_followers: spotify?.obj?.followers ?? spotify?.obj?.data ?? null,
      spotify_monthly_listeners: listeners?.obj?.listeners ?? listeners?.obj?.data ?? spotify?.obj?.monthly_listeners ?? spotify?.obj?.listeners ?? null,
      tiktok_followers: tiktok?.obj?.followers ?? [],
      tiktok_likes: tiktok?.obj?.likes ?? [],
      ig_followers: ig?.obj?.followers ?? [],
      ig_engagement: ig?.obj?.engagement_rate ?? null
    };
  } catch (e) {
    console.error('[CM] error:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  const isCron = req.headers['x-vercel-cron'] === '1';

  // Only run via cron GET or manual POST
  if (req.method === 'GET' && !isCron) {
    return res.status(200).json({ ok: true, message: 'daily-cron — trigger via POST or scheduled cron' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[daily-cron] started at', new Date().toISOString());

    // Fetch SC and CM in parallel
    const [sc, cmStats] = await Promise.all([getSoundcloudStats(), getChartmetricStats()]);

    const now = new Date();
    const label = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    console.log('[daily-cron] label:', label);

    // Append SC stats to history
    if (sc.sc_followers || sc.sc_plays) {
      const history = await redis.get('snapshots') || [];
      const last = history[history.length - 1];
      console.log('[daily-cron] history length:', history.length, '| last label:', last?.label ?? 'none');
      if (last && last.label === label) {
        console.log('[daily-cron] updating existing entry for', label);
        history[history.length - 1] = { ...last, followers: sc.sc_followers, plays: sc.sc_plays, reposts: sc.sc_reposts, downloads: sc.sc_downloads, eng: sc.sc_eng };
      } else {
        console.log('[daily-cron] appending new entry for', label);
        history.push({ label, ts: Date.now(), followers: sc.sc_followers, plays: sc.sc_plays, likes: 0, reposts: sc.sc_reposts, downloads: sc.sc_downloads, eng: sc.sc_eng });
      }
      if (history.length > 90) history.splice(0, history.length - 90);
      await redis.set('snapshots', history);
      console.log('[daily-cron] history saved, length now:', history.length);
    } else {
      console.error('[daily-cron] SC stats empty — skipping history append');
    }

    // Merge SC + CM into latest_snapshot
    const existing = await redis.get('latest_snapshot') || {};
    const merged = { ...existing, ...sc, label, ts: Date.now() };
    if (cmStats) Object.assign(merged, cmStats, { cm_updated: Date.now() });
    await redis.set('latest_snapshot', merged);
    console.log('[daily-cron] latest_snapshot updated');

    return res.status(200).json({ ok: true, sc, cm: cmStats });
  } catch (err) {
    console.error('[daily-cron] error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
