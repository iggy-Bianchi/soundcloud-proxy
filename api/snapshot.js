import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

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

  // GET — return latest snapshot + history
  if (req.method === 'GET') {
    try {
      const latest = await redis.get('latest_snapshot');
      const history = await redis.get('snapshots') || [];
      return res.status(200).json({ latest: latest || {}, history });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — seed baseline or run SoundCloud snapshot
  if (req.method === 'POST') {
    const body = req.body;

    // Seed baseline history
    if (body && body.seed && Array.isArray(body.seed)) {
      await redis.set('snapshots', body.seed);
      return res.status(200).json({ ok: true, seeded: body.seed.length });
    }

    // SoundCloud snapshot
    try {
      const sc = await getSoundcloudStats();
      const now = new Date();
      const label = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Merge SC stats into latest snapshot (preserve CM stats)
      const existing = await redis.get('latest_snapshot') || {};
      const snapshot = { ...existing, ...sc, label, ts: Date.now() };
      await redis.set('latest_snapshot', snapshot);

      // Append to history
      const history = await redis.get('snapshots') || [];
      const last = history[history.length - 1];
      if (last && last.label === label) {
        history[history.length - 1] = { ...last, followers: sc.sc_followers, plays: sc.sc_plays, reposts: sc.sc_reposts, downloads: sc.sc_downloads, eng: sc.sc_eng };
      } else {
        history.push({ label, ts: Date.now(), followers: sc.sc_followers, plays: sc.sc_plays, likes: 0, reposts: sc.sc_reposts, downloads: sc.sc_downloads, eng: sc.sc_eng });
      }
      if (history.length > 90) history.splice(0, history.length - 90);
      await redis.set('snapshots', history);

      return res.status(200).json({ ok: true, snapshot });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
