import type {ReactNode} from 'react';
import Details from '@theme/Details';
import useBaseUrl from '@docusaurus/useBaseUrl';

type Props = {
  children: ReactNode;
};

export default function TxDiagram({children}: Props): ReactNode {
  const legendSrc = useBaseUrl('/img/schemas-legend.svg');

  return (
    <Details summary={<summary>Transaction structure</summary>}>
      {children}
      <Details summary={<summary>Legend</summary>}>
        <img src={legendSrc} alt="Transaction diagram legend" loading="lazy" />
      </Details>
    </Details>
  );
}
