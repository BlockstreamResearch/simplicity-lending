import type {ComponentType, ReactNode, SVGProps} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import CoinsIcon from '@site/src/components/icons/CoinsIcon';
import FileTextIcon from '@site/src/components/icons/FileTextIcon';
import HandCoinsIcon from '@site/src/components/icons/HandCoinsIcon';

import styles from './index.module.css';

const roles: {
  title: string;
  description: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    title: 'Borrower',
    description: 'Borrow against your collateral.',
    href: '/docs/borrower/create-account',
    icon: CoinsIcon,
  },
  {
    title: 'Lender',
    description: 'Fund offers and earn interest.',
    href: '/docs/lender/review-offer',
    icon: HandCoinsIcon,
  },
  {
    title: 'Developer',
    description: 'Read the contracts and build.',
    href: '/docs/contracts/lending',
    icon: FileTextIcon,
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.kicker}>powered by Simplicity</p>
        <Heading as="h1" className={styles.title}>
          {siteConfig.title}
        </Heading>
        <p className={styles.subtitle}>{siteConfig.tagline}</p>
        <Link className={styles.cta} to="/docs/intro">
          Read the docs
        </Link>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout description="Documentation for the Simplicity lending protocol.">
      <HomepageHeader />
      <main>
        <div className={`container ${styles.home}`}>
          <div className={styles.roles}>
            {roles.map(({title, description, href, icon: Icon}) => (
              <Link key={title} className={styles.roleCard} to={href}>
                <span className={styles.roleIcon}>
                  <Icon width={24} height={24} />
                </span>
                <span className={styles.roleTitle}>{title}</span>
                <span className={styles.roleText}>{description}</span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
