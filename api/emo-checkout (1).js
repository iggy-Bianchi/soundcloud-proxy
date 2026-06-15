import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// The Emo Night presale product already lives in your Stripe account.
const PRESALE_PRODUCT = "prod_UVmPVWd5t5Soo0";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // quantity comes from the page's stepper (clamped 1-6)
  let quantity = parseInt(req.body?.quantity, 10);
  if (!Number.isFinite(quantity)) quantity = 1;
  quantity = Math.min(Math.max(quantity, 1), 6);

  const origin =
    req.headers.origin ||
    `https://${req.headers.host}` ||
    "https://www.iamdoomsayer.com";

  try {
    // Use a pinned price if you set one, otherwise grab the active price
    // attached to the presale product so this keeps working untouched.
    let priceId = process.env.EMO_PRESALE_PRICE_ID;

    if (!priceId) {
      const prices = await stripe.prices.list({
        product: PRESALE_PRODUCT,
        active: true,
        limit: 1,
      });
      if (!prices.data.length) {
        return res
          .status(500)
          .json({ error: "No active price found for the presale product." });
      }
      priceId = prices.data[0].id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity }],
      // collect email so the existing post-purchase automation can fire
      customer_creation: "always",
      phone_number_collection: { enabled: false },
      success_url: `${origin}/emo-night?status=success`,
      cancel_url: `${origin}/emo-night?status=cancelled`,
      metadata: { event: "emo_night_pink_is_punk", date: "2026-06-19" },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("emo-checkout error:", err);
    return res.status(500).json({ error: "Could not start checkout." });
  }
}
