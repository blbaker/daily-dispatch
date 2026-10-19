import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// Ids are the ones scripts/sync-docs.mts gives each synced page. A missing id
// fails the build.
const sidebars: SidebarsConfig = {
  docs: [
    { type: 'doc', id: 'setup', label: 'Get started' },
    { type: 'doc', id: 'pipeline', label: 'Pipeline' },
    {
      type: 'category',
      label: 'Podcast',
      collapsed: false,
      items: [
        { type: 'doc', id: 'podcast-providers', label: 'Podcast providers' },
        { type: 'doc', id: 'daily-podcast', label: 'Daily schedule' },
        { type: 'doc', id: 'podcast-style-guide', label: 'Script style guide' },
      ],
    },
    {
      type: 'category',
      label: 'Push notifications',
      collapsed: false,
      items: [
        { type: 'doc', id: 'push-setup', label: 'Push setup' },
        { type: 'doc', id: 'push-clients', label: 'Push in the app' },
      ],
    },
    { type: 'doc', id: 'desktop', label: 'Desktop' },
    { type: 'doc', id: 'backend', label: 'Backend' },
    {
      type: 'category',
      label: 'Builds and releases',
      collapsed: false,
      items: [
        { type: 'doc', id: 'builds', label: 'App builds' },
        { type: 'doc', id: 'releasing', label: 'Releasing' },
        { type: 'doc', id: 'releasing-npm', label: 'Releasing to npm' },
      ],
    },
    { type: 'doc', id: 'contributing', label: 'Contributing' },
  ],
};

export default sidebars;
