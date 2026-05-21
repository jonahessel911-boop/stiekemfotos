'use client';

import React from 'react';
import { useAdmin } from '@/components/admin/AdminProvider';
export default function AdminUsers() {
  const {
    data,
    passwordEmailNotice,
    kortingEmailNotice,
    passwordEmailUserId,
    kortingEmailUserId,
    sendPasswordEmail,
    sendKortingEmail,
  } = useAdmin();
  const users = data?.users ?? [];

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        Users <small>{users.length} accounts</small>
      </div>
      <div style={{ padding: 10 }}>
        {passwordEmailNotice ? (
          <div className="admin-alert admin-alert-ok">{passwordEmailNotice}</div>
        ) : null}
        {kortingEmailNotice ? (
          <div className="admin-alert admin-alert-warn">{kortingEmailNotice}</div>
        ) : null}
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th className="num">Leeftijd</th>
              <th>Geverifieerd</th>
              <th className="num">Gesprekken</th>
              <th className="num">Berichten</th>
              <th className="num">Aankopen</th>
              <th className="num">Credits gekocht</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: '#666' }}>
                  Geen users
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>{u.naam}</td>
                  <td>{u.email}</td>
                  <td className="num">{u.leeftijd}</td>
                  <td>{u.emailVerified ? 'ja' : 'nee'}</td>
                  <td className="num">{u.conversations}</td>
                  <td className="num">{u.userMessages}</td>
                  <td className="num">{u.purchasesCount}</td>
                  <td className="num">{u.purchasedCredits}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button
                        type="button"
                        className="admin-btn"
                        disabled={
                          passwordEmailUserId === u.id || kortingEmailUserId === u.id
                        }
                        onClick={() => void sendKortingEmail(u.id, u.email)}
                      >
                        {kortingEmailUserId === u.id ? '…' : 'Korting e-mail'}
                      </button>
                      <button
                        type="button"
                        className="admin-btn"
                        disabled={
                          passwordEmailUserId === u.id || kortingEmailUserId === u.id
                        }
                        onClick={() => void sendPasswordEmail(u.id, u.email)}
                      >
                        {passwordEmailUserId === u.id ? '…' : 'Toegangs-e-mail'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p style={{ padding: '8px 12px', margin: 0, fontSize: 11, color: '#666' }}>
        Aangemaakt-tijden staan onder Signups. Open <a href="/admin/chats">Chats</a> voor gesprekken.
      </p>
    </div>
  );
}
