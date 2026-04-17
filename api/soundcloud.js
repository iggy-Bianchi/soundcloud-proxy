import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

async function getToken() {
  const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;

  // Try to get cached token from Redis
  try {
    const cached = await redis.get('sc_token');
    if (cached) return cached;
  } catch (e) {}

  // Fetch a fresh token
  const tokenRes = await fetch('https://api.soundcloud.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error('Token fetch failed: ' + err);
  }

  const { access_token, expires_in } = await tokenRes.json();

  // Cache token in Redis with expiry slightly before actual expiry
  try {
    await redis.set('sc_token', access_token, { ex: (expires_in || 3600) - 60 });
  } catch (e) {}

  return access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  try {
    const token = await getToken();

    const apiRes = await fetch(`https://api.soundcloud.com/${endpoint}`, {
      headers: { Authorization: `OAuth ${token}` }
    });

    // If token expired mid-session, clear cache and retry once
    if (apiRes.status === 401) {
      try { await redis.del('sc_token'); } catch (e) {}
      const freshToken = await getToken();
      const retry = await fetch(`https://api.soundcloud.com/${endpoint}`, {
        headers: { Authorization: `OAuth ${freshToken}` }
      });
      if (!retry.ok) {
        const err = await retry.text();
        return res.status(retry.status).json({ error: 'API error', details: err });
      }
      const data = await retry.json();
      return res.status(200).json(data);
    }

    if (!apiRes.ok) {
      const err = await apiRes.text();
      return res.status(apiRes.status).json({ error: 'API error', details: err });
    }

    const data = await apiRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
}
