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
    const { productId, variantId, title, price, image } = req.body;

    if (!productId || !variantId || !title || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: title,
              images: image ? [image] : [],
              metadata: {
                printify_product_id: productId,
                printify_variant_id: String(variantId),
                printify_shop_id: PRINTIFY_SHOP,
              },
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],
      metadata: {
        printify_product_id: productId,
        printify_variant_id: String(variantId),
        printify_shop_id: PRINTIFY_SHOP,
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
