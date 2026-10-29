import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './admin/AdminApp.jsx';
import './admin/admin.css';

document.documentElement.lang = 'en';
document.documentElement.dir = 'ltr';

createRoot(document.getElementById('admin-root')).render(
  <React.StrictMode><AdminApp /></React.StrictMode>,
);
