import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTIFY_SHOP = '27188929';
const SITE_URL = 'https://iamdoomsayer.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Missing items' });
    }

    const totalQty = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const shippingCents = totalQty === 1 ? 800 : 1199;

    const line_items = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.title,
          images: item.image ? [item.image] : [],
          metadata: {
            printify_product_id: String(item.productId),
            printify_variant_id: String(item.variantId),
            printify_shop_id: PRINTIFY_SHOP,
          },
        },
        unit_amount: item.price,
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingCents, currency: 'usd' },
            display_name: 'Standard Shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 10 },
            },
          },
        },
      ],
      line_items,
      metadata: {
        printify_shop_id: PRINTIFY_SHOP,
        items: JSON.stringify(items.map(i => ({ pid: String(i.productId), vid: String(i.variantId), qty: i.quantity || 1 }))),
      },
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Checkout error', details: err.message });
  }
}
