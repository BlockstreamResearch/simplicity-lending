import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import AppLayout from '@/components/AppLayout'
import { RoutePath } from '@/constants/routes'
import { AppProviders } from '@/providers/AppProviders'

import ErrorBoundary from './components/ErrorBoundary'
import BorrowPage from './pages/Borrow'
import DashboardPage from './pages/Dashboard'
import DesignSystemPage from './pages/DesignSystem'
import SupplyPage from './pages/Supply'

const router = createBrowserRouter([
  {
    path: RoutePath.Dashboard,
    element: <AppLayout />,
    errorElement: <ErrorBoundary />,
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
      ...(import.meta.env.DEV
        ? [
            {
              path: RoutePath.DesignSystem,
              element: <DesignSystemPage />,
            },
          ]
        : []),
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
