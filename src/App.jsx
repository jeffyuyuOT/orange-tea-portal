import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import AppRoutes from './routes/routes'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
