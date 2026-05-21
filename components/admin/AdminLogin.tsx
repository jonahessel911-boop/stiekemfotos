'use client';

import React, { useState } from 'react';

type Props = {
  loading: boolean;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
};

export default function AdminLogin({ loading, error, onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-box">
        <h1>Admin login</h1>
        <p>Stiekemfotos backoffice — alleen /admin</p>
        {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onLogin(email, password);
          }}
        >
          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 'bold' }}>E-mail</p>
          <input
            className="admin-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 'bold' }}>Wachtwoord</p>
          <input
            type="password"
            className="admin-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <button className="admin-btn admin-btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Laden…' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  );
}
