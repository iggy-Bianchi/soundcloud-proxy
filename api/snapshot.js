import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  // GET — return all snapshots
  if (req.method === 'GET') {
    try {
      const data = await redis.get('snapshots');
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — save a new snapshot (called by cron or manually)
  if (req.method === 'POST') {
    const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
    const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;

    try {
      // Get OAuth token
      const tokenRes = await fetch('https://api.soundcloud.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
      });
      const { access_token } = await tokenRes.json();

      // Fetch user
      const userRes = await fetch('https://api.soundcloud.com/resolve?url=https://soundcloud.com/iamdoomsayer', {
        headers: { Authorization: `OAuth ${access_token}` }
      });
      const user = await userRes.json();

      // Fetch tracks
      const tracksRes = await fetch(`https://api.soundcloud.com/users/${user.id}/tracks?limit=20`, {
        headers: { Authorization: `OAuth ${access_token}` }
      });
      const tracks = await tracksRes.json();

      let totalPlays = 0, totalLikes = 0, totalReposts = 0, totalDownloads = 0;
      if (Array.isArray(tracks)) {
        tracks.forEach(t => {
          totalPlays += parseInt(t.playback_count || 0);
          totalLikes += parseInt(t.likes_count || 0);
          totalReposts += parseInt(t.reposts_count || 0);
          totalDownloads += parseInt(t.download_count || 0);
        });
      }
      const eng = totalPlays > 0 ? ((totalLikes + totalReposts) / totalPlays * 100) : 0;

      const now = new Date();
      const label = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const snapshot = { label, ts: Date.now(), followers: user.followers_count, plays: totalPlays, likes: totalLikes, reposts: totalReposts, downloads: totalDownloads, eng };

      // Load existing, append, save
      const existing = await redis.get('snapshots') || [];
      const last = existing[existing.length - 1];
      if (last && last.label === label) {
        existing[existing.length - 1] = snapshot;
      } else {
        existing.push(snapshot);
      }
      if (existing.length > 90) existing.splice(0, existing.length - 90);
      await redis.set('snapshots', existing);

      return res.status(200).json({ ok: true, snapshot });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
