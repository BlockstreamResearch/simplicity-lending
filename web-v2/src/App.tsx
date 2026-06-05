import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import AppLayout from '@/components/AppLayout'
import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'
import { AppProviders } from '@/providers/AppProviders'

import ErrorBoundary from './components/ErrorBoundary'
import BorrowPage from './pages/Borrow'
import DashboardPage from './pages/Dashboard'
import DemoPage from './pages/Demo'
import DesignSystemPage from './pages/DesignSystem'
import SupplyPage from './pages/Supply'
import WalletDemoPage from './pages/WalletDemo'

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
      ...(env.DEV
        ? [
            {
              path: RoutePath.DesignSystem,
              element: <DesignSystemPage />,
            },
            {
              path: RoutePath.WalletDemo,
              element: <WalletDemoPage />,
            },
            {
              path: RoutePath.Demo,
              element: <DemoPage />,
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
