import { Table, type TableProps } from '@heroui/react'

export type UiTableProps = TableProps

export const UiTable = Object.assign((props: UiTableProps) => <Table {...props} />, {
  ScrollContainer: Table.ScrollContainer,
  Content: Table.Content,
  Header: Table.Header,
  Column: Table.Column,
  Body: Table.Body,
  Row: Table.Row,
  Cell: Table.Cell,
  Footer: Table.Footer,
})
