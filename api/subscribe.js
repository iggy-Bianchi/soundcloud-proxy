import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST - add email
  if (req.method === 'POST') {
    try {
      const { email } = req.body;
      if (!email || !email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: 'Invalid email' });
      }

      const cleaned = email.trim().toLowerCase();
      const timestamp = Date.now();

      // Store in a Redis sorted set with timestamp as score (for ordering)
      await redis.zadd('mailing_list', { score: timestamp, member: cleaned });

      // Get total count
      const count = await redis.zcard('mailing_list');

      return res.status(200).json({ ok: true, count });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save', details: err.message });
    }
  }

  // GET - list all emails (for your admin use)
  if (req.method === 'GET') {
    try {
      const { key } = req.query;
      // Simple admin key check - change this to something secret
      if (key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const emails = await redis.zrange('mailing_list', 0, -1, { withScores: true });
      const count = await redis.zcard('mailing_list');

      // Format as list with signup dates
      const list = [];
      for (let i = 0; i < emails.length; i += 2) {
        list.push({
          email: emails[i],
          signed_up: new Date(emails[i + 1]).toISOString()
        });
      }

      return res.status(200).json({ count, emails: list });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
