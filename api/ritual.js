import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

function getWeekKey() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return `ritual:week:${monday.getFullYear()}-${monday.getMonth()+1}-${monday.getDate()}`;
}

function isAdmin(req) {
  const { key } = req.query;
  if (key && key === process.env.ADMIN_KEY) return true;
  // Vercel cron requests carry Authorization: Bearer CRON_SECRET
  const auth = req.headers.authorization;
  if (auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ADMIN: return full leaderboard including IG handles
  if (req.method === 'GET' && action === 'winners') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const weekKey = getWeekKey();
    const scores = await redis.get(weekKey) || [];
    return res.status(200).json({ scores, week: weekKey });
  }

  // ADMIN: reset leaderboard, archive top scorer first
  if (action === 'reset') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const weekKey = getWeekKey();
    const scores = await redis.get(weekKey) || [];
    let archivedName = null;
    if (scores.length > 0) {
      const winner = scores[0];
      archivedName = winner.name;
      const archive = await redis.get('ritual:past_winners') || [];
      archive.push({ ...winner, week: weekKey, archived: Date.now() });
      if (archive.length > 52) archive.splice(0, archive.length - 52);
      await redis.set('ritual:past_winners', archive);
    }
    await redis.del(weekKey);
    return res.status(200).json({ ok: true, archived: archivedName });
  }

  // PUBLIC GET: leaderboard — name + score only, no IG handle
  if (req.method === 'GET') {
    try {
      const weekKey = getWeekKey();
      const scores = await redis.get(weekKey) || [];
      const publicScores = scores.slice(0, 10).map(({ name, score }) => ({ name, score }));
      return res.status(200).json({ scores: publicScores });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: submit score with name, instagram, score
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) { body = {}; }
      }
      const { name, score, instagram, ts } = body || {};
      if (!name || !score) return res.status(400).json({ error: 'Missing name or score' });
      const weekKey = getWeekKey();
      const scores = await redis.get(weekKey) || [];
      scores.push({
        name: String(name).substring(0, 20).toUpperCase(),
        score: parseInt(score),
        instagram: instagram ? String(instagram).replace(/[<>"]/g, '').substring(0, 30) : '',
        ts: ts || Date.now()
      });
      scores.sort((a, b) => b.score - a.score);
      const top25 = scores.slice(0, 25);
      await redis.set(weekKey, top25, { ex: 60 * 60 * 24 * 14 });
      const publicScores = top25.slice(0, 10).map(({ name, score }) => ({ name, score }));
      return res.status(200).json({ ok: true, scores: publicScores });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
