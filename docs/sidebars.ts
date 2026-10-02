import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/participants',
        'concepts/offer-parameters',
        'concepts/position-states',
      ],
    },
    {
      type: 'category',
      label: 'Lifecycle',
      items: [
        'lifecycle/create-offer',
        'lifecycle/cancel-offer',
        'lifecycle/accept-offer',
        'lifecycle/repay',
        'lifecycle/liquidate',
      ],
    },
    {
      type: 'category',
      label: 'Components',
      items: [
        'components/contracts',
        'components/cli',
        'components/indexer',
        'components/web',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: ['guides/docker', 'guides/local-setup'],
    },
  ],
};

export default sidebars;
