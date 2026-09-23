import WalletLogin from './WalletLogin';
import RestrictedArea from './RestrictedArea';

// Full-page navigation in these examples also rechecks the server session.
export default function App() {
  return window.location.pathname === '/arearestrita'
    ? <RestrictedArea />
    : <WalletLogin />;
}
