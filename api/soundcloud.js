export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { endpoint } = req.query;
  const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;

  try {
    // Get OAuth token using client credentials flow
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
      return res.status(401).json({ error: 'Token fetch failed', details: err });
    }

    const { access_token } = await tokenRes.json();

    // Call the actual SoundCloud endpoint
    const apiRes = await fetch(`https://api.soundcloud.com/${endpoint}`, {
      headers: { Authorization: `OAuth ${access_token}` }
    });

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
