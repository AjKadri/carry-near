import { loadConfig } from './config.js';
import { createServices } from './services.js';
import { createHomeApp, createPublicApp } from './app.js';

const config = loadConfig();
const svc = createServices(config);
console.log(`Carry (${config.mode} mode) starting...`);
console.log('Wallets:', await svc.start());
createHomeApp(svc).listen(config.homePort, config.homeHost, () => console.log(`Home   http://${config.homeHost}:${config.homePort}/home   (loopback only)`));
createPublicApp(svc).listen(config.publicPort, config.publicHost, () => console.log(`Public http://${config.publicHost}:${config.publicPort}/pay/${config.handle}  and /phone`));
if (config.mode === 'mock') console.log('Mock mode: no network calls, no keys used.');
setInterval(() => svc.tick(), config.tickMs);
