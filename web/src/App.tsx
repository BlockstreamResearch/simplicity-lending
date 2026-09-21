import { useState } from 'react'
import { createBrowserRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'

import AppLayout from '@/components/AppLayout'
import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'
import { AppProviders } from '@/providers/AppProviders'

import ErrorBoundary from './components/ErrorBoundary'
import BorrowPage from './pages/Borrow'
import DashboardPage from './pages/Dashboard'
import DemoPage from './pages/Demo'
import DesignSystemPage from './pages/DesignSystem'
import LandingPage from './pages/Landing'
import SupplyPage from './pages/Supply'

function ProvidersLayout() {
  const { pathname } = useLocation()
  const [hasEnteredApp, setHasEnteredApp] = useState(() => isAppPath(pathname))

  if (!hasEnteredApp && isAppPath(pathname)) setHasEnteredApp(true)

  return hasEnteredApp ? (
    <AppProviders>
      <Outlet />
    </AppProviders>
  ) : (
    <Outlet />
  )
}

function isAppPath(pathname: string) {
  return pathname === RoutePath.Dashboard || pathname.startsWith(`${RoutePath.Dashboard}/`)
}

const router = createBrowserRouter([
  {
    element: <ProvidersLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        path: RoutePath.Landing,
        element: <LandingPage />,
      },
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
          ...(env.DEV
            ? [
                {
                  path: RoutePath.DesignSystem,
                  element: <DesignSystemPage />,
                },
                {
                  path: RoutePath.Demo,
                  element: <DemoPage />,
                },
              ]
            : []),
        ],
      },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
