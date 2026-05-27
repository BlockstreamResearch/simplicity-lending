import { Card, type CardProps } from '@heroui/react'

export type UiCardProps = CardProps

export const UiCard = Object.assign((props: UiCardProps) => <Card {...props} />, {
  Header: Card.Header,
  Title: Card.Title,
  Description: Card.Description,
  Content: Card.Content,
  Footer: Card.Footer,
})
