import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './style.css';
// One request first: in the public sandbox it gives this browser its session cookie before the page fires several requests at once
// (without it each of them would start its own world). On the live instance it is just a cheap health check.
await fetch('/api/mode', { cache: 'no-store' }).catch(() => {});
createRoot(document.getElementById('root')).render(<App />);
