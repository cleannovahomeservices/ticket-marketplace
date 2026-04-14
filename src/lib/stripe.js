import { loadStripe } from '@stripe/stripe-js';

console.log("Stripe public key:", import.meta.env.VITE_STRIPE_PUBLIC_KEY);

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

export default stripePromise;
