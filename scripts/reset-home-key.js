// `npm run reset-home-key`: forget the registered laptop key (run this on the server). The next start prints a new one-time setup code.
import { loadConfig } from '../server/config.js';
import { openStore } from '../server/store.js';
import { makeHomeAuth } from '../server/homeauth.js';
const store = openStore(loadConfig().dbPath);
makeHomeAuth({ store }).reset();
store.log('home_key_reset', null, {}, true);
console.log('Home key removed. Restart Carry to get a new setup code.');
