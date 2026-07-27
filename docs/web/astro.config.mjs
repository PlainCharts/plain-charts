// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://plaincharts.github.io',
	markdown: {
		shikiConfig: {
			theme: 'night-owl-light',
		},
	},
});
