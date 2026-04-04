const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cvgbtprhovdtwygzilyx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Disable body parsing — Stripe needs the raw body to verify signatures
module.exports.config = {
  api: { bodyParser: false }
};

// Read raw body from the request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const now = new Date().toISOString();

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        // ── Invoice payment (Pay Now feature) ──
        if (session.metadata?.type === 'invoice_payment') {
          await supabase
            .from('invoice_payments')
            .update({
              payment_status:           'paid',
              paid_at:                   now,
              stripe_payment_intent_id:  session.payment_intent || null,
            })
            .eq('stripe_session_id', session.id);
          console.log(`Invoice payment completed: session ${session.id}`);
          break;
        }

        // ── Pro subscription activation ──
        const email    = session.customer_email;
        const customer = session.customer;

        if (!email) {
          console.warn('checkout.session.completed — no customer_email on session');
          break;
        }

        await supabase.from('subscriptions').upsert({
          email,
          stripe_customer_id: customer,
          status: 'pro',
          updated_at: now
        }, { onConflict: 'email' });

        console.log(`Pro activated for ${email}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const customer = event.data.object.customer;

        await supabase
          .from('subscriptions')
          .update({ status: 'free', updated_at: now })
          .eq('stripe_customer_id', customer);

        console.log(`Subscription deleted — downgraded to free for customer ${customer}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customer     = subscription.customer;
        const subStatus    = subscription.status;

        let newStatus;
        if (subStatus === 'active') {
          newStatus = 'pro';
        } else if (subStatus === 'canceled' || subStatus === 'past_due') {
          newStatus = 'free';
        } else {
          // trialing, incomplete, etc — no change
          break;
        }

        await supabase
          .from('subscriptions')
          .update({ status: newStatus, updated_at: now })
          .eq('stripe_customer_id', customer);

        console.log(`Subscription updated to "${newStatus}" for customer ${customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const customer = event.data.object.customer;

        await supabase
          .from('subscriptions')
          .update({ status: 'free', updated_at: now })
          .eq('stripe_customer_id', customer);

        console.log(`Payment failed — downgraded to free for customer ${customer}`);
        break;
      }

      // ── Stripe Connect account capability updates ──
      case 'account.updated': {
        const account = event.data.object;
        const chargesEnabled = account.charges_enabled;
        const payoutsEnabled = account.payouts_enabled;
        const detailsSubmitted = account.details_submitted;

        let connectStatus;
        if (chargesEnabled && payoutsEnabled) {
          connectStatus = 'active';
        } else if (detailsSubmitted) {
          connectStatus = 'pending';
        } else {
          connectStatus = 'incomplete';
        }

        await supabase
          .from('subscriptions')
          .update({
            stripe_connect_status:          connectStatus,
            stripe_connect_charges_enabled: chargesEnabled,
            stripe_connect_payouts_enabled: payoutsEnabled,
            updated_at:                     now,
          })
          .eq('stripe_connect_id', account.id);

        console.log(`account.updated ${account.id}: status=${connectStatus}, charges=${chargesEnabled}, payouts=${payoutsEnabled}`);
        break;
      }

      default:
        // Unhandled event type — acknowledge and ignore
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(400).json({ error: err.message });
  }
}
