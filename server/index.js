import { loadConfig } from './config.js';
import { createServices } from './services.js';
import { createApp } from './app.js';

const config = loadConfig();
const svc = createServices(config);
console.log(`Carry (${config.mode} mode) starting...`);
console.log('Wallets:', await svc.start());
const code = svc.auth.setupCode();
if (code) console.log(`\nNo laptop key is registered yet. Open /home on the laptop you want to control Carry from and enter this one-time setup code:\n\n    ${code}\n`);
createApp(svc).listen(config.port, config.host, () => console.log(`Carry on http://${config.host}:${config.port}  (home: /home, pay link: /pay/${config.handle}, phone: /phone)`));
if (config.mode === 'mock') console.log('Mock mode: no network calls, no keys used.');
setInterval(() => svc.tick(), config.tickMs);
