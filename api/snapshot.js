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

async function getChartmetricStats() {
  try {
    const token = await getChartmetricToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [spotifyRes, tiktokRes, igRes] = await Promise.all([
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/spotify`, { headers }),
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/tiktok`, { headers }),
      fetch(`https://api.chartmetric.com/api/artist/${CM_ARTIST_ID}/stat/instagram`, { headers })
    ]);

    const [spotify, tiktok, ig] = await Promise.all([
      spotifyRes.ok ? spotifyRes.json() : null,
      tiktokRes.ok ? tiktokRes.json() : null,
      igRes.ok ? igRes.json() : null
    ]);

    return {
      spotify_followers: spotify?.obj?.followers ?? null,
      spotify_monthly_listeners: spotify?.obj?.monthly_listeners ?? null,
      tiktok_followers: tiktok?.obj?.followers ?? null,
      tiktok_likes: tiktok?.obj?.likes ?? null,
      ig_followers: ig?.obj?.followers ?? null,
      ig_engagement: ig?.obj?.engagement_rate ?? null
    };
  } catch (e) {
    console.error('Chartmetric error:', e.message);
    return {};
  }
}

async function getSoundcloudStats() {
  const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;

  try {
    const cached = await redis.get('sc_token');
    let token = cached;

    if (!token) {
      const tokenRes = await fetch('https://api.soundcloud.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
      });
      const { access_token, expires_in } = await tokenRes.json();
      token = access_token;
      await redis.set('sc_token', token, { ex: (expires_in || 3600) - 60 });
    }

    const headers = { Authorization: `OAuth ${token}` };
    const userRes = await fetch('https://api.soundcloud.com/resolve?url=https://soundcloud.com/iamdoomsayer', { headers });
    const user = await userRes.json();

    const tracksRes = await fetch(`https://api.soundcloud.com/users/${user.id}/tracks?limit=20`, { headers });
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

    return {
      sc_followers: user.followers_count,
      sc_plays: plays,
      sc_reposts: reposts,
      sc_downloads: downloads,
      sc_tracks: user.track_count,
      sc_eng: eng
    };
  } catch (e) {
    console.error('SoundCloud error:', e.message);
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  // GET — return latest snapshot
  if (req.method === 'GET') {
    try {
      const data = await redis.get('latest_snapshot');
      const history = await redis.get('snapshots') || [];
      return res.status(200).json({ latest: data || {}, history });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — seed baseline or run full snapshot
  if (req.method === 'POST') {
    const body = req.body;

    // Seed baseline history
    if (body && body.seed && Array.isArray(body.seed)) {
      await redis.set('snapshots', body.seed);
      return res.status(200).json({ ok: true, seeded: body.seed.length });
    }

    // Full snapshot run
    try {
      const [sc, cm] = await Promise.all([getSoundcloudStats(), getChartmetricStats()]);

      const now = new Date();
      const label = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const snapshot = { label, ts: Date.now(), ...sc, ...cm };

      // Save as latest
      await redis.set('latest_snapshot', snapshot);

      // Append to history
      const existing = await redis.get('snapshots') || [];
      const last = existing[existing.length - 1];
      if (last && last.label === label) {
        existing[existing.length - 1] = { ...last, ...sc, ...cm };
      } else {
        existing.push({ label, ts: Date.now(), followers: sc.sc_followers, plays: sc.sc_plays, likes: 0, reposts: sc.sc_reposts, downloads: sc.sc_downloads, eng: sc.sc_eng });
      }
      if (existing.length > 90) existing.splice(0, existing.length - 90);
      await redis.set('snapshots', existing);

      return res.status(200).json({ ok: true, snapshot });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
