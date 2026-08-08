/**
 * Home tab route (Mobile M1-09). The screen lives in src/screens so it stays
 * testable and reusable; this route file is a thin binding for expo-router.
 */
import { HomeScreen } from '../src/screens/HomeScreen';

export default function HomeRoute(): JSX.Element {
  return <HomeScreen />;
}
