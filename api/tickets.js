import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SITE_URL = 'https://iamdoomsayer.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { event, quantity } = req.body || {};
  if (event !== 'pink-cactus-0619') {
    return res.status(400).json({ error: 'Unknown event' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Emo Night Rave: Pink Is Punk / Jun 19 / The Pink Cactus / Planet Doom (Presale)',
            },
            unit_amount: 1000,
          },
          quantity: quantity || 1,
          adjustable_quantity: { enabled: true, minimum: 1, maximum: 5 },
        },
      ],
      success_url: `${SITE_URL}?ticket=success`,
      cancel_url: `${SITE_URL}?ticket=cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Checkout error', details: err.message });
  }
}
