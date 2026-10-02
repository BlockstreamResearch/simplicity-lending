import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Simplicity Lending',
  tagline: 'Peer-to-peer lending on Simplicity',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://blockstreamresearch.github.io',
  baseUrl: '/simplicity-lending/',

  organizationName: 'BlockstreamResearch',
  projectName: 'simplicity-lending',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/BlockstreamResearch/simplicity-lending/tree/main/docs/',
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
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Lending',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/BlockstreamResearch/simplicity-lending',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Introduction', to: '/docs/intro'},
            {label: 'Roles', to: '/docs/roles'},
            {label: 'Offer parameters', to: '/docs/offer-parameters'},
            {label: 'Contracts', to: '/docs/contracts/lending'},
          ],
        },
        {
          title: 'Simplicity',
          items: [
            {label: 'About Simplicity', href: 'https://simplicity-lang.org/'},
            {
              label: 'SimplicityHL reference',
              href: 'https://docs.simplicity-lang.org/simplicityhl-reference/',
            },
            {label: 'Liquid testnet faucet', href: 'https://liquidtestnet.com/faucet'},
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/BlockstreamResearch/simplicity-lending',
            },
            {
              label: 'Forum',
              href: 'https://community.simplicity-lang.org/c/share-your-projects/simplicity-lending-protocol/12',
            },
            {
              label: 'Report an issue',
              href: 'https://github.com/BlockstreamResearch/simplicity-lending/issues/new/choose',
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Simplicity. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.github,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
