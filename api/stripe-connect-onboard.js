const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cvgbtprhovdtwygzilyx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = 'https://draftpaid.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── AUTH: verify Supabase session token ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  const userEmail = user.email;

  // ── PRO CHECK ──
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('status, stripe_connect_id')
    .eq('email', userEmail)
    .single();

  if (subErr || sub?.status !== 'pro') {
    return res.status(403).json({ error: 'Pro subscription required to connect Stripe' });
  }

  try {
    let connectId = sub?.stripe_connect_id;

    // Create Express account if this user doesn't have one yet
    if (!connectId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: userEmail,
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
      });
      connectId = account.id;
      console.log(`Created Express account ${connectId} for ${userEmail}`);

      await supabase
        .from('subscriptions')
        .update({
          stripe_connect_id:     connectId,
          stripe_connect_status: 'pending',
          updated_at:            new Date().toISOString(),
        })
        .eq('email', userEmail);
    }

    // Generate an Account Link (works for both fresh onboarding and resuming)
    const accountLink = await stripe.accountLinks.create({
      account:     connectId,
      refresh_url: `${BASE_URL}/api/stripe-connect-refresh`,
      return_url:  `${BASE_URL}/connect-stripe.html?return=true`,
      type:        'account_onboarding',
    });

    console.log(`Account Link created for ${connectId}`);
    return res.status(200).json({ url: accountLink.url });

  } catch (err) {
    console.error('stripe-connect-onboard error:', err);
    return res.status(500).json({ error: err.message });
  }
};
