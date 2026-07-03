/**
 * Registers the built-in adapters. Called once at sync-engine init. Adding a new
 * provider is a single line here plus its mapping module.
 */
import { registerAdapter } from '../registry';
import { githubAdapter } from './github';
import { notionAdapter } from './notion';
import { googleCalendarAdapter } from './googleCalendar';
import { slackAdapter } from './slack';

export function registerBuiltinAdapters(): void {
  registerAdapter(githubAdapter);
  registerAdapter(notionAdapter);
  registerAdapter(googleCalendarAdapter);
  registerAdapter(slackAdapter);
}
