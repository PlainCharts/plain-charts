import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	// Check secret key
	if (req.headers['x-api-key'] !== process.env.NEWSLETTER_SECRET) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const { subject, html } = req.body;

	if (!subject || !html) {
		return res.status(400).json({ error: 'Missing subject or html' });
	}

	// Get all subscribers
	const { data: subscribers, error: dbError } = await supabase
		.from('subscribers')
		.select('email');

	if (dbError) {
		return res.status(500).json({ error: 'Failed to fetch subscribers' });
	}

	if (!subscribers.length) {
		return res.status(200).json({ message: 'No subscribers' });
	}

	// Send via Resend
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: 'Plain Charts <notify@example.com>',
			to: subscribers.map(s => s.email),
			subject,
			html
		})
	});

	const result = await response.json();

	if (!response.ok) {
		return res.status(500).json({ error: 'Failed to send', details: result });
	}

	return res.status(200).json({
		message: 'Sent',
		count: subscribers.length
	});
}
