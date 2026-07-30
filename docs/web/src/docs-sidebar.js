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
		],
	},
	{
		title: 'Concepts',
		collapsible: true,
		links: [
			{ href: '/docs/concepts/session-time', label: 'Session time & the future axis' },
			{ href: '/docs/concepts/object-tree', label: 'The object tree' },
			{ href: '/docs/concepts/workspaces', label: 'Windows, tabs & workspaces' },
			{ href: '/docs/concepts/watchlist', label: 'Watchlist' },
			{ href: '/docs/concepts/commands', label: 'Commands' },
		],
	},
	{
		title: 'Architecture',
		collapsible: true,
		links: [
			{ href: '/docs/architecture/multi-window-host-model', label: 'The multi-window host model' },
			{ href: '/docs/architecture/data-host', label: 'The data host' },
			{ href: '/docs/architecture/contracts', label: 'Contracts' },
			{ href: '/docs/architecture/execution-architecture', label: 'Execution architecture' },
			{ href: '/docs/architecture/on-chart-orders', label: 'On-chart order primitives' },
			{ href: '/docs/architecture/study-workers', label: 'Study workers' },
			{ href: '/docs/architecture/addon-host', label: 'The addon host' },
			{ href: '/docs/architecture/competition-for-resources', label: 'Competition for resources' },
		],
	},
	{
		title: 'Studies',
		collapsible: true,
		links: [
			{ href: '/docs/studies/writing', label: 'Writing a study' },
			{ href: '/docs/studies/drawing', label: 'Drawing and context' },
			{ href: '/docs/studies/settings', label: 'Settings' },
			{ href: '/docs/studies/timeframe', label: 'Timeframe' },
		],
	},
	{
		title: 'Addons',
		collapsible: true,
		links: [
			{ href: '/docs/addons/overview', label: 'The addon system' },
			{ href: '/docs/addons/api', label: 'The addon API' },
			{ href: '/docs/addons/loading', label: 'How addons load and run' },
			{ href: '/docs/addons/authoring', label: 'Writing an addon' },
			{ href: '/docs/addons/examples', label: 'Worked examples' },
		],
	},
	{
		title: 'Data',
		collapsible: true,
		links: [
			{ href: '/docs/data/broker-adapter', label: 'Broker adapters' },
			{ href: '/docs/data/connecting-brokers', label: 'Connecting brokers' },
			{ href: '/docs/data/adapter-loading', label: 'How adapters load' },
			{ href: '/docs/data/writing-an-adapter', label: 'Writing an adapter' },
		],
	},
	{
		title: 'AI',
		collapsible: true,
		links: [
			{ href: '/docs/ai/assistant', label: 'The AI assistant' },
			{ href: '/docs/ai/ai-workspace', label: 'The AI Workspace' },
		],
	},
	{
		title: 'Development',
		collapsible: true,
		links: [
			{ href: '/docs/development/design', label: 'Design' },
			{ href: '/docs/development/diagnostics', label: 'Electron diagnostics & debugging' },
		],
	},
	{
		title: 'Resources',
		collapsible: true,
		links: [
			{ href: '/docs/resources/hotkeys', label: 'Hotkeys' },
		],
	},
];
