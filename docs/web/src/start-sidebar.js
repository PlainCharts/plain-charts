// Single source of truth for the Getting Started sidebar. To add a page: append a { href, label } here
// and create the matching markdown file under src/pages/start/. DocsLayout marks the active link from the
// URL, so pages never declare it themselves.
//
// This is the entry-level space — how to set up the app and cover the basics. Deep-dive material lives in
// the Docs space (see docs-sidebar.js).
export const START_SIDEBAR = [
	{
		links: [
			{ href: '/start', label: 'Getting started' },
			{ href: '/start/configure', label: 'Configure' },
			{ href: '/start/customize', label: 'Customize' },
		],
	},
	{
		title: 'Features',
		collapsible: true,
		links: [
			{ href: '/start/features/trade-desk', label: 'Trade Desk' },
			{ href: '/start/features/order-dialog', label: 'Order dialog' },
			{ href: '/start/features/quick-placement', label: 'Quick placement' },
			{ href: '/start/features/quick-buttons', label: 'Quick buttons' },
			{ href: '/start/features/ai-workspace', label: 'AI Workspace' },
			{ href: '/start/features/study-boards', label: 'Study boards' },
			{ href: '/start/features/study-display', label: 'Study display' },
			{ href: '/start/features/object-tree', label: 'Object tree' },
			{ href: '/start/features/drawing-properties', label: 'Drawing properties' },
			{ href: '/start/features/tool-tips', label: 'Tool tips' },
			{ href: '/start/features/watchlist', label: 'Watchlist' },
			{ href: '/start/features/alerts', label: 'Alerts' },
		],
	},
];
