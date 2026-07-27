// Single source of truth for the docs sidebar. To add a page: append a { href, label } here and create
// the matching markdown file under src/pages/docs/. DocsLayout marks the active link from the URL, so
// pages never declare it themselves.
//
// A section with `title` + `collapsible: true` renders as a collapsible dropdown on the left (click the
// header to expand/collapse). A section with no title is just a flat list of links.
export const SIDEBAR = [
	{
		links: [
			{ href: '/docs/overview', label: 'Overview' },
			{ href: '/docs/getting-started', label: 'Getting started' },
			{ href: '/docs/the-ether', label: 'The ether' },
			{ href: '/docs/your-own-environment', label: 'Your own environment' },
			{ href: '/docs/panes-and-coordinates', label: 'Panes and coordinates' },
			{ href: '/docs/indexed-time', label: 'Indexed time' },
			{ href: '/docs/navigation', label: 'Navigation and zoom' },
		],
	},
	{
		title: 'Reference',
		collapsible: true,
		links: [
			{ href: '/docs/series', label: 'Series' },
			{ href: '/docs/price-format', label: 'Price format' },
			{ href: '/docs/time-axis', label: 'Time axis' },
			{ href: '/docs/streaming-and-performance', label: 'Streaming and performance' },
			{ href: '/docs/library-structure', label: 'Library structure' },
			{ href: '/docs/changelog', label: 'Changelog' },
		],
	},
	{
		title: 'Studies',
		collapsible: true,
		links: [
			{ href: '/docs/studies', label: 'Overview' },
			{ href: '/docs/studies-data-flow', label: 'The data-flow model' },
			{ href: '/docs/studies-calc', label: 'The calc function' },
			{ href: '/docs/studies-step', label: 'The step function' },
			{ href: '/docs/studies-channels', label: 'Render channels' },
			{ href: '/docs/studies-host', label: 'Running studies' },
			{ href: '/docs/studies-capabilities', label: 'Special capabilities' },
			{ href: '/docs/studies-shapes', label: 'Shapes' },
		],
	},
	{
		title: 'API reference',
		collapsible: true,
		links: [
			{ href: '/docs/api', label: 'Overview' },
			{ href: '/docs/api/engine', label: 'Engine' },
			{ href: '/docs/api/skin', label: 'Skin' },
			{ href: '/docs/api/studies', label: 'Studies' },
		],
	},
];
