import Stripe from 'stripe';
import { getSupabaseAdmin, getAuthUser, json, CORS } from './_utils.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

console.log("Stripe key exists:", !!process.env.STRIPE_SECRET_KEY);

const BASE_URL = 'https://ticket-marketplace-lyart.vercel.app'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST' && req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return }

  try {
    // Auth is optional — if we have a valid session we link the
    // Stripe account to the user's profile; otherwise we still create
    // a standalone onboarding link so the endpoint never 401s.
    const user = await getAuthUser(req).catch(() => null)
    console.log("stripe-connect: user =", user?.id || '(none)')

    let accountId = null
    const supabase = user ? getSupabaseAdmin() : null

    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('stripe_account_id').eq('id', user.id).single()
      accountId = profile?.stripe_account_id || null
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        ...(user ? { metadata: { supabase_user_id: user.id } } : {}),
      })
      accountId = account.id

      if (user) {
        await supabase.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id)
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/dashboard`,
      return_url:  `${BASE_URL}/dashboard`,
      type: "account_onboarding",
    })

    res.status(200).json({ url: accountLink.url })
  } catch (err) {
    console.error('stripe-connect error:', err)
    json(res, 500, { error: err.message || 'Stripe connect failed' })
  }
}
