/**
 * Root layout (Mobile M1-09). Wraps the app in the CompanionProvider and gates
 * the whole UI on the launch/auth phase: the tab navigator only mounts once the
 * session is paired AND biometrics have been passed, so no enterprise data can
 * render before then. Boot / pairing / lock / error each show their own screen.
 */
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { CompanionProvider, useCompanion } from '../src/state/CompanionProvider';
import { ErrorScreen, LockScreen, Splash } from '../src/screens/GateScreens';
import { PairScreen } from '../src/screens/PairScreen';
import {
  BellIcon,
  ChecklistIcon,
  GridIcon,
  HomeIcon,
  LayersIcon,
  SearchIcon,
  TimelineIcon,
} from '../src/components/icons';
import { colors } from '../src/theme/tokens';

function Gate(): JSX.Element {
  const { phase } = useCompanion();
  switch (phase) {
    case 'unpaired':
      return <PairScreen />;
    case 'locked':
      return <LockScreen />;
    case 'error':
      return <ErrorScreen />;
    case 'ready':
      return (
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarActiveTintColor: colors.ink,
            tabBarInactiveTintColor: colors.faint,
            tabBarLabelStyle: styles.tabLabel,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Home',
              tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="approvals"
            options={{
              title: 'Approvals',
              tabBarIcon: ({ color, size }) => <ChecklistIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="notifications"
            options={{
              title: 'Alerts',
              tabBarIcon: ({ color, size }) => <BellIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="timeline"
            options={{
              title: 'Timeline',
              tabBarIcon: ({ color, size }) => <TimelineIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="search"
            options={{
              title: 'Search',
              tabBarIcon: ({ color, size }) => <SearchIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="dashboard"
            options={{
              title: 'Dashboard',
              tabBarIcon: ({ color, size }) => <GridIcon color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="industry"
            options={{
              title: 'Industry',
              tabBarIcon: ({ color, size }) => <LayersIcon color={color} size={size} />,
            }}
          />
        </Tabs>
      );
    case 'booting':
    default:
      return <Splash />;
  }
}

export default function RootLayout(): JSX.Element {
  return (
    <CompanionProvider>
      <StatusBar style="light" />
      <Gate />
    </CompanionProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabLabel: { fontSize: 11 },
});
