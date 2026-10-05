import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'simplicity',
    {
      type: 'category',
      label: 'Protocol',
      link: {
        type: 'generated-index',
        title: 'Protocol',
        description:
          'How a loan is split between a borrower and a lender, which actions each of them can take and when, and the collateral, principal, fee, and term that an offer fixes when it is created.',
        slug: '/protocol',
      },
      items: ['protocol/roles', 'protocol/offer-parameters'],
    },
    {
      type: 'category',
      label: 'Borrower',
      items: [
        'borrower/create-account',
        'borrower/create-offer',
        'borrower/cancel-offer',
        'borrower/repay',
      ],
    },
    {
      type: 'category',
      label: 'Lender',
      items: [
        'lender/review-offer',
        'lender/fund-offer',
        'lender/claim-repayment',
        'lender/liquidate',
      ],
    },
    {
      type: 'category',
      label: 'Contracts',
      items: [
        'contracts/lending',
        'contracts/asset-auth',
        'contracts/asset-auth-vault',
        'contracts/script-auth',
        'contracts/issuance-factory',
      ],
    },
    {
      type: 'category',
      label: 'Developers',
      items: [
        'developers/versions',
        'developers/build',
        'developers/docker',
        'developers/local-setup',
      ],
    },
  ],
};

export default sidebars;
