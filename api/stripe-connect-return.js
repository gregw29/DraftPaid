const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cvgbtprhovdtwygzilyx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Called from connect-stripe.html after user returns from Stripe onboarding.
// Fetches live account status from Stripe and updates Supabase.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── AUTH ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  const userEmail = user.email;

  // ── GET CONNECT ID FROM DB ──
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('stripe_connect_id, stripe_connect_status')
    .eq('email', userEmail)
    .single();

  if (subErr || !sub?.stripe_connect_id) {
    return res.status(404).json({ error: 'No connected account found', status: 'not_connected' });
  }

  const connectId = sub.stripe_connect_id;

  try {
    // Fetch live account status from Stripe
    const account = await stripe.accounts.retrieve(connectId);

    const chargesEnabled = account.charges_enabled;
    const payoutsEnabled = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;

    let connectStatus;
    if (chargesEnabled && payoutsEnabled) {
      connectStatus = 'active';
    } else if (detailsSubmitted) {
      connectStatus = 'pending';  // submitted but awaiting Stripe verification
    } else {
      connectStatus = 'incomplete';  // onboarding not finished
    }

    // Update Supabase with latest status
    await supabase
      .from('subscriptions')
      .update({
        stripe_connect_status:           connectStatus,
        stripe_connect_charges_enabled:  chargesEnabled,
        stripe_connect_payouts_enabled:  payoutsEnabled,
        updated_at:                      new Date().toISOString(),
      })
      .eq('email', userEmail);

    console.log(`Connect return for ${connectId}: status=${connectStatus}, charges=${chargesEnabled}, payouts=${payoutsEnabled}`);

    return res.status(200).json({
      status:          connectStatus,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
    });

  } catch (err) {
    console.error('stripe-connect-return error:', err);
    return res.status(500).json({ error: err.message });
  }
};
