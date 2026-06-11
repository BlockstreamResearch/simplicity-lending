import { Skeleton, Table } from '@heroui/react'
import { useState } from 'react'

import CoinsIcon from '@/components/icons/CoinsIcon'
import PlusIcon from '@/components/icons/PlusIcon'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrows } from '@/pages/Dashboard/hooks/useBorrows'
import { formatAmount, formatTermLeft } from '@/utils/format'
import { bpsToPercent, calcInterest, getOfferDisplayStatus, getOfferTermLeft } from '@/utils/offers'

import { useBorrowerAccountRefs } from '../hooks/useBorrowerAccountRefs'
import CreateBorrowerAccountModal from './CreateBorrowerAccountModal'
import CreateBorrowOfferModal from './CreateBorrowOfferModal'

export default function YourBorrows() {
  const { offers, currentBlockHeight, isLoading } = useBorrows()
  const { hasAccount } = useBorrowerAccountRefs()
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false)

  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const handleCreateOffer = () => {
    if (hasAccount) setIsOfferModalOpen(true)
    else setIsAccountModalOpen(true)
  }

  return (
    <section className='bg-surface-secondary flex flex-col gap-6 rounded-3xl p-6'>
      <header className='flex items-center gap-2'>
        <CoinsIcon className='size-5' />
        <h2 className='text-foreground text-[11px] font-semibold tracking-wide uppercase'>
          Your Borrows
        </h2>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-1'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-14 w-full rounded' />
          ))}
        </div>
      ) : offers.length === 0 ? (
        <div className='border-muted flex h-14 items-center rounded border border-dashed px-4 opacity-50'>
          <span className='text-foreground text-sm font-medium'>No borrow offers yet.</span>
        </div>
      ) : (
        <Table variant='secondary'>
          <Table.ScrollContainer>
            <Table.Content aria-label='Your borrows'>
              <Table.Header>
                <Table.Column isRowHeader>Collateral ({collateralAsset.symbol})</Table.Column>
                <Table.Column>Loan Amount ({principalAsset.symbol})</Table.Column>
                <Table.Column>Earn ({principalAsset.symbol})</Table.Column>
                <Table.Column>APR(%)</Table.Column>
                <Table.Column>Term Left</Table.Column>
                <Table.Column>Status</Table.Column>
              </Table.Header>
              <Table.Body items={offers}>
                {offer => (
                  <Table.Row id={offer.id}>
                    <Table.Cell>
                      {formatAmount(offer.collateral_amount, collateralAsset.decimals)}
                    </Table.Cell>
                    <Table.Cell>
                      {formatAmount(offer.principal_amount, principalAsset.decimals)}
                    </Table.Cell>
                    <Table.Cell>
                      {formatAmount(
                        calcInterest(offer.principal_amount, offer.interest_rate),
                        principalAsset.decimals,
                      )}
                    </Table.Cell>
                    <Table.Cell>{bpsToPercent(offer.interest_rate)}</Table.Cell>
                    <Table.Cell>
                      {formatTermLeft(getOfferTermLeft(offer, currentBlockHeight))}
                    </Table.Cell>
                    <Table.Cell>
                      <OfferStatusChip status={getOfferDisplayStatus(offer, currentBlockHeight)} />
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      <UiButton variant='primary' className='self-start' onPress={handleCreateOffer}>
        <PlusIcon className='size-4' />
        Create Borrow Offer
      </UiButton>

      <CreateBorrowerAccountModal
        isOpen={isAccountModalOpen}
        onOpenChange={setIsAccountModalOpen}
      />
      <CreateBorrowOfferModal isOpen={isOfferModalOpen} onOpenChange={setIsOfferModalOpen} />
    </section>
  )
}
