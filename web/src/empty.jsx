import React from 'react';
import { Ico } from './icons.jsx';

// An empty state: one line saying what is missing and the next action.
export function Empty({ icon, head, next, children }) {
  return <div className="empty"><span className="empty-ico"><Ico as={icon} /></span><div><p><b>{head}</b> {next}</p>{children}</div></div>;
}
