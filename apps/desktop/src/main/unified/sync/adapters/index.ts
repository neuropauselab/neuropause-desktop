/**
 * Registers the built-in adapters. Called once at sync-engine init. Adding a new
 * provider is a single line here plus its mapping module.
 */
import { registerAdapter } from '../registry';
import { githubAdapter } from './github';
import { notionAdapter } from './notion';
import { googleCalendarAdapter } from './googleCalendar';
import { gmailAdapter } from './gmail';
import { googleDriveAdapter } from './googleDrive';
import { googlePeopleAdapter } from './googlePeople';
import { googleTasksAdapter } from './googleTasks';
import { slackAdapter } from './slack';
import { entraAdapter } from './entra';

export function registerBuiltinAdapters(): void {
  registerAdapter(githubAdapter);
  registerAdapter(notionAdapter);
  registerAdapter(googleCalendarAdapter);
  registerAdapter(gmailAdapter);
  registerAdapter(googleDriveAdapter);
  registerAdapter(googlePeopleAdapter);
  registerAdapter(googleTasksAdapter);
  registerAdapter(slackAdapter);
  registerAdapter(entraAdapter);
}
