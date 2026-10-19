import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const REPO = 'https://github.com/blbaker/daily-dispatch';

// Pages come from ../docs and ../CONTRIBUTING.md. scripts/sync-docs.mts copies
// them into ./docs (gitignored) before every start and build.
const config: Config = {
  title: 'Daily Dispatch',
  tagline: 'A daily digest and podcast made from the links you send yourself',
  favicon: 'img/favicon.svg',

  url: 'https://blbaker.github.io',
  baseUrl: '/daily-dispatch/',
  organizationName: 'blbaker',
  projectName: 'daily-dispatch',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    // The docs are GitHub Markdown first, so parse .md files as CommonMark
    // rather than MDX. A stray `<` or `{` in prose then never breaks the build.
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'throw',
    },
  },

  // The README screenshots in ../docs/assets also serve the home page.
  staticDirectories: ['static', '../docs/assets'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          showLastUpdateTime: false,
          breadcrumbs: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Daily Dispatch',
      hideOnScroll: false,
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { href: REPO, position: 'right', className: 'header-github-link', 'aria-label': 'GitHub repository' },
      ],
    },
    footer: {
      style: 'light',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
