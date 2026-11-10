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
          'Who the borrower and the lender are, which actions an offer allows in each state, and the collateral, principal, fee, and term fixed when the offer is created.',
        slug: '/protocol',
      },
      items: [
        {type: 'doc', id: 'protocol/roles', label: '👥 Roles'},
        {type: 'doc', id: 'protocol/actions', label: '⚡ Actions'},
        {type: 'doc', id: 'protocol/offer-parameters', label: '📋 Offer parameters'},
      ],
    },
    {
      type: 'category',
      label: 'Borrower',
      link: {
        type: 'generated-index',
        title: 'Borrower',
        description:
          'The steps a borrower takes: create an account, publish an offer, cancel it or claim the principal, and repay.',
        slug: '/borrower',
      },
      items: [
        {type: 'doc', id: 'borrower/create-account', label: '🪪 Create an account'},
        {type: 'doc', id: 'borrower/create-offer', label: '📝 Create an offer'},
        {type: 'doc', id: 'borrower/cancel-offer', label: '❌ Cancel an offer'},
        {type: 'doc', id: 'borrower/claim-principal', label: '💵 Claim the principal'},
        {type: 'doc', id: 'borrower/repay', label: '↩️ Repay'},
      ],
    },
    {
      type: 'category',
      label: 'Lender',
      link: {
        type: 'generated-index',
        title: 'Lender',
        description:
          'The steps a lender takes: review and fund an offer, claim the repayment, or liquidate an unpaid loan.',
        slug: '/lender',
      },
      items: [
        {type: 'doc', id: 'lender/review-offer', label: '🔍 Review an offer'},
        {type: 'doc', id: 'lender/fund-offer', label: '💸 Fund an offer'},
        {type: 'doc', id: 'lender/claim-repayment', label: '💰 Claim repayment'},
        {type: 'doc', id: 'lender/liquidate', label: '⚠️ Liquidate'},
      ],
    },
    {
      type: 'category',
      label: 'Contracts',
      link: {
        type: 'generated-index',
        title: 'Contracts',
        description:
          'The five programs that guard the outputs a loan moves through, and what each one checks before it lets an output be spent.',
        slug: '/contracts',
      },
      items: [
        {type: 'doc', id: 'contracts/lending', label: '🤝 Lending'},
        {type: 'doc', id: 'contracts/asset-auth', label: '🔑 Asset auth'},
        {type: 'doc', id: 'contracts/asset-auth-vault', label: '🏦 Asset auth vault'},
        {type: 'doc', id: 'contracts/script-auth', label: '📜 Script auth'},
        {type: 'doc', id: 'contracts/issuance-factory', label: '🏭 Issuance factory'},
      ],
    },
    {
      type: 'category',
      label: 'Developers',
      items: [
        {type: 'doc', id: 'developers/versions', label: '🏷️ Versions'},
        {type: 'doc', id: 'developers/build', label: '🔨 Build'},
        {type: 'doc', id: 'developers/docker', label: '🐳 Run with Docker'},
        {type: 'doc', id: 'developers/local-setup', label: '💻 Run locally'},
      ],
    },
  ],
};

export default sidebars;
