/** The ExchangeStore singleton (organization exchange), backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { ExchangeStore } from './exchangeStore';

export const exchangeStore = new ExchangeStore(join(app.getPath('userData'), 'federation-exchange.json'));
