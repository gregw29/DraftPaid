const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cvgbtprhovdtwygzilyx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Currency symbol → Stripe ISO code + zero-decimal flag
const CURRENCY_MAP = {
  '$':   { code: 'usd', zeroDecimal: false },
  '€':   { code: 'eur', zeroDecimal: false },
  '£':   { code: 'gbp', zeroDecimal: false },
  '¥':   { code: 'jpy', zeroDecimal: true  },
  'CA$': { code: 'cad', zeroDecimal: false },
};

module.exports = async function handler(req, res) {
  console.log('STRIPE_KEY_PREFIX:', process.env.STRIPE_SECRET_KEY?.slice(0, 12) || 'MISSING');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── AUTH: verify Supabase session token from Authorization header ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const userEmail = user.email;

  // ── PRO CHECK: verify via DB, not just client-provided email ──
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('email', userEmail)
    .single();

  if (subErr || sub?.status !== 'pro') {
    return res.status(403).json({ error: 'Pro subscription required for payment links' });
  }

  // ── PARSE BODY ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { amount, currencySymbol, invoiceNumber, clientName, clientEmail } = body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (!invoiceNumber) {
    return res.status(400).json({ error: 'Invoice number required' });
  }

  // ── CURRENCY ──
  const cur = CURRENCY_MAP[currencySymbol] || CURRENCY_MAP['$'];
  const unitAmount = cur.zeroDecimal
    ? Math.round(amount)
    : Math.round(amount * 100);

  const baseUrl = 'https://draftpaid.com';

  try {
    // ── CREATE STRIPE CHECKOUT SESSION ──
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: cur.code,
          unit_amount: unitAmount,
          product_data: {
            name: `Invoice ${invoiceNumber}`,
            description: clientName ? `Billed to ${clientName}` : 'Invoice payment',
          },
        },
        quantity: 1,
      }],
      customer_email: clientEmail || undefined,
      success_url: `${baseUrl}/payment-paid.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/invoice-generator.html`,
      metadata: {
        type:            'invoice_payment',
        invoice_number:  invoiceNumber,
        user_email:      userEmail,
        client_email:    clientEmail || '',
        client_name:     clientName  || '',
      },
      payment_intent_data: {
        description: `Invoice ${invoiceNumber}${clientName ? ` — ${clientName}` : ''}`,
        metadata: {
          invoice_number: invoiceNumber,
          user_email:     userEmail,
        },
      },
    });

    // ── STORE IN SUPABASE ──
    await supabase.from('invoice_payments').insert({
      user_email:        userEmail,
      invoice_number:    invoiceNumber,
      client_name:       clientName  || null,
      client_email:      clientEmail || null,
      amount:            unitAmount,
      currency:          cur.code,
      stripe_session_id: session.id,
      payment_url:       session.url,
      payment_status:    'pending',
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('create-payment error:', err);
    return res.status(500).json({ error: err.message });
  }
};
