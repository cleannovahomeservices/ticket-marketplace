import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

const BASE_URL = 'https://ticket-marketplace-lyart.vercel.app'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST' && req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const supabase = getSupabaseAdmin()

  // Check if user already has a Stripe account
  const { data: profile } = await supabase
    .from('profiles').select('stripe_account_id').eq('id', user.id).single()

  let accountId = profile?.stripe_account_id

  if (!accountId) {
    // Create new Stripe Express account
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { supabase_user_id: user.id },
    })
    accountId = account.id

    // Save to profile
    await supabase.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id)
  }

  // Create onboarding link
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${BASE_URL}/reauth`,
    return_url: `${BASE_URL}/dashboard`,
    type: 'account_onboarding',
  })

  json(res, 200, { url: link.url })
}
