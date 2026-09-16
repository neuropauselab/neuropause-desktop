import { Link, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import SignIn from './pages/SignIn';
import Dashboard from './pages/Dashboard';
import Download from './pages/Download';
import Pilot from './pages/Pilot';
import Legal from './pages/Legal';
import VerifyEmail from './pages/VerifyEmail';
import ResetPassword from './pages/ResetPassword';

// Every page carries the DEVELOPMENT banner until publication gates are
// cleared (publisher identity, domain custody, legal review).
export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <div
        style={{
          background: '#7c2d12',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        DEVELOPMENT — NOT PUBLIC — NOT A PRODUCTION SERVICE
      </div>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Link to="/">NeuroPause</Link>
        <Link to="/pilot">Global Pilot</Link>
        <Link to="/download">Download</Link>
        <Link to="/sign-in">Sign in</Link>
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/legal">Legal</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/download" element={<Download />} />
        <Route path="/pilot" element={<Pilot />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </div>
  );
}
