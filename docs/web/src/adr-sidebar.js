// Single source of truth for the ADR sidebar (same shape as docs-sidebar.js). DocsLayout marks the active
// link from the URL and shows the ADR sidebar for any /adr page automatically.
//
// Two levels of grouping:
//   - A `{ section, subsections: [...] }` entry renders a solid, non-collapsible BAND that spans the sidebar
//     width; each subsection inside it is an ordinary collapsible group.
//   - A `{ title, collapsible, links }` entry renders a single collapsible group (no band).
//   - A `{ links }` entry with no title is just a flat list.
export const ADR_SIDEBAR = [
	{
		links: [
			{ href: '/adr/overview', label: 'The schema' },
		],
	},
	{
		section: 'Engineering',
		subsections: [
			{
				title: 'Principle',
				collapsible: true,
				links: [
					{ href: '/adr/engineering-the-interface-problem', label: 'The interface problem' },
					{ href: '/adr/engineering-where-knowledge-lives', label: 'Where knowledge lives' },
					{ href: '/adr/engineering-expressiveness-and-entropy', label: 'Expressiveness and Entropy' },
					{ href: '/adr/engineering-everything-is-an-interface', label: 'Everything is an interface' },
				],
			},
			{
				title: 'Stack',
				collapsible: true,
				links: [
					{ href: '/adr/engineering-stack', label: 'Stack' },
					{ href: '/adr/engineering-framework', label: 'Framework' },
					{ href: '/adr/engineering-electron', label: 'Electron' },
					{ href: '/adr/engineering-jsdoc-not-typescript', label: 'JSDoc, not TypeScript' },
				],
			},
			{
				title: 'Method',
				collapsible: true,
				links: [
					{ href: '/adr/engineering-development-pipeline', label: 'Development pipeline' },
					{ href: '/adr/engineering-enforcing-modularity', label: 'Enforcing modularity' },
					{ href: '/adr/engineering-low-entropy-prompting', label: 'Low-entropy prompting' },
				],
			},
			{
				title: 'Freedom',
				collapsible: true,
				links: [
					{ href: '/adr/engineering-the-other-face-of-expressiveness-and-entropy', label: 'The other face of expressiveness and entropy' },
					{ href: '/adr/engineering-the-license-is-a-belief', label: 'The license is a belief' },
				],
			},
		],
	},
	{
		section: 'Design',
		subsections: [
			{
				title: 'Approach',
				collapsible: true,
				links: [
					{ href: '/adr/design-framing-the-problem', label: 'Framing the problem' },
					{ href: '/adr/design-platform-vs-product', label: 'Platform vs product' },
					{ href: '/adr/design-user-friendly-vs-user-centric', label: 'User-friendly vs user-centric' },
				],
			},
			{
				title: 'Problem space',
				collapsible: true,
				links: [
					{ href: '/adr/design-access', label: 'Access' },
					{ href: '/adr/design-commercial', label: 'Commercial' },
					{ href: '/adr/design-representation', label: 'Representation' },
					{ href: '/adr/design-interaction-expressiveness', label: 'Interaction: Expressiveness' },
					{ href: '/adr/design-interaction-affordances', label: 'Interaction: Affordances' },
					{ href: '/adr/design-ai-first-class', label: 'AI as a first-class participant' },
				],
			},
			{
				title: 'Trade Psychology',
				collapsible: true,
				links: [
					{ href: '/adr/psychology-and-phases', label: 'Psychology and phases' },
				],
			},
		],
	},
	// Records land here as they are written, e.g.
	// { title: 'Records', collapsible: true, links: [ { href: '/adr/0001-...', label: 'ADR 0001 — ...' } ] },
];
