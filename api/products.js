import { authed } from './_lib.js';
import PRODUCTS from './_products.js';

// White Wing's product list with prices, for the item picker on order and estimate tasks.
export default function handler(req, res) {
  if (!authed(req)) { res.setHeader('Cache-Control', 'no-store'); return res.status(401).json({ error: 'Sign in again.' }); }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ products: PRODUCTS });
}
