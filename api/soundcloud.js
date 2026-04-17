export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { endpoint } = req.query;
  const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  
  try {
    const response = await fetch(`https://api.soundcloud.com/${endpoint}&client_id=${CLIENT_ID}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
}
