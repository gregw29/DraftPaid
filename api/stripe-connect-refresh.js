// Called by Stripe when an Account Link expires before the user completes onboarding.
// Redirects back to the connect page which detects ?refresh=true and
// automatically requests a new Account Link (user's session is still active).
module.exports = async function handler(req, res) {
  res.writeHead(302, { Location: 'https://draftpaid.com/connect-stripe.html?refresh=true' });
  res.end();
};
