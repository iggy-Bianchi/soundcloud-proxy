import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

function getWeekKey() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return `ritual:week:${monday.getFullYear()}-${monday.getMonth()+1}-${monday.getDate()}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  const key = getWeekKey();

  // GET — return top 10 for current week
  if (req.method === 'GET') {
    try {
      const scores = await redis.get(key) || [];
      return res.status(200).json({ scores: scores.slice(0, 10) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — submit a score
  if (req.method === 'POST') {
    try {
      const { name, score, ts } = req.body;
      if (!name || !score) return res.status(400).json({ error: 'Missing name or score' });

      const scores = await redis.get(key) || [];
      scores.push({ name: name.substring(0, 20).toUpperCase(), score: parseInt(score), ts });
      scores.sort((a, b) => b.score - a.score);

      // Keep top 25 in storage, return top 10
      const top25 = scores.slice(0, 25);
      await redis.set(key, top25, { ex: 60 * 60 * 24 * 14 }); // expires after 2 weeks

      return res.status(200).json({ ok: true, scores: top25.slice(0, 10) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
