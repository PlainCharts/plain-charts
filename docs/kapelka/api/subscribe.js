import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { email } = req.body;

	if (!email || !email.includes('@')) {
		return res.status(400).json({ error: 'Invalid email' });
	}

	const { error } = await supabase
		.from('subscribers')
		.insert({ email: email.toLowerCase().trim() });

	if (error) {
		if (error.code === '23505') {
			return res.status(200).json({ message: 'Already subscribed' });
		}
		return res.status(500).json({ error: 'Failed to subscribe' });
	}

	return res.status(200).json({ message: 'Subscribed' });
}
