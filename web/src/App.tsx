import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WalletAbiProvider } from './walletAbi/session'
import { AppShell } from './routes/AppShell'
import { DashboardRoute } from './routes/DashboardRoute'
import { BorrowerRoute } from './routes/BorrowerRoute'
import { LenderRoute } from './routes/LenderRoute'
import { UtilityRoute } from './routes/UtilityRoute'
import { TestRoute } from './routes/TestRoute'
import { TestHelpRoute } from './routes/TestHelpRoute'

export type Tab = 'dashboard' | 'borrower' | 'lender' | 'utility' | 'test'

export default function App() {
  return (
    <WalletAbiProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardRoute />} />
            <Route path="borrower" element={<BorrowerRoute />} />
            <Route path="lender" element={<LenderRoute />} />
            <Route path="utility" element={<UtilityRoute />} />
            <Route path="test" element={<TestRoute />} />
            <Route path="test/help" element={<TestHelpRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </WalletAbiProvider>
  )
}
