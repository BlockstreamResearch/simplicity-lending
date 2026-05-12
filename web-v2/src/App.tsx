import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import AppLayout from '@/components/AppLayout'
import { RoutePath } from '@/constants/routes'
import { AppProviders } from '@/providers/AppProviders'

import BorrowPage from './pages/Borrow'
import DashboardPage from './pages/Dashboard'
import SupplyPage from './pages/Supply'

const router = createBrowserRouter([
  {
    path: RoutePath.Dashboard,
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: RoutePath.Borrow,
        element: <BorrowPage />,
      },
      {
        path: RoutePath.Supply,
        element: <SupplyPage />,
      },
    ],
  },
])

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
