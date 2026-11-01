import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import AppRoutes from './routes/routes'
import ChunkErrorBoundary from './components/layout/ChunkErrorBoundary'

// Jeff, 2026-11-02: "最近有發生兩次登入都會卡白屏...新因為有更新的關係嗎" —
// see ChunkErrorBoundary.jsx for the full diagnosis. Wrapped around
// literally everything (including AuthProvider) so a crash during login
// itself is caught too, not just one inside an already-authenticated page.
export default function App() {
  return (
    <ChunkErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ChunkErrorBoundary>
  )
}
