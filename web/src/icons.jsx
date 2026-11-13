// Outline icons: lucide-react (ISC licence, with MIT for the icons derived from Feather; see README Disclosure and
// web/public/licenses/LUCIDE-LICENSE.txt). They are bundled into the app's own JavaScript: no CDN, nothing loaded from another origin.
import React from 'react';
export { Wallet, ShieldCheck, ShieldAlert, Lock, Send, ReceiptText, LogOut, Smartphone, History, ArrowDownLeft, ArrowRightLeft, Split, Server, TriangleAlert, Check, Ban, QrCode, Landmark } from 'lucide-react';

// <Ico as={Wallet} />: decorative (hidden from screen readers; the words next to it carry the meaning).
export const Ico = ({ as: C, className = '' }) => <C className={`ico ${className}`.trim()} aria-hidden="true" focusable="false" strokeWidth={2} />;
