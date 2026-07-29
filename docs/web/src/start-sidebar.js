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
		],
	},
];
