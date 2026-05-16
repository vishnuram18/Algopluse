import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Controls how notifications appear while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('algopulse-targets', {
      name: 'Target Exit Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3F5E4C',
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function fireTargetNotification(
  ticker: string,
  name: string,
  price: number
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${ticker} hit its target — sell now`,
      body: `Tape ₹${fmt(price)} · Open Groww and exit your ${name} position.`,
      sound: 'default',
      data: { ticker, price, type: 'target' },
    },
    trigger: null, // fire immediately
  });
}

export async function fireStopLossNotification(
  ticker: string,
  name: string,
  price: number
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${ticker} stop-loss breached`,
      body: `Tape ₹${fmt(price)} · Consider exiting your ${name} position to limit losses.`,
      sound: 'default',
      data: { ticker, price, type: 'drawdown' },
    },
    trigger: null,
  });
}
