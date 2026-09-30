'use client';

import React, { useState, useEffect } from 'react';

const TOKEN_KEY = 'batabitoo_session_token';

export default function Home() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [currentTab, setCurrentTab] = useState('official');
  const [officialSubFilter, setOfficialSubFilter] = useState('all');
  const [amazonSubFilter, setAmazonSubFilter] = useState('all');
  const [stats, setStats] = useState({
    total: 1006,
    official: 6,
    officialBatabitoo: 5,
    officialGmail: 1,
    temp: 1000,
    amazon: 35,
    banned: 0,
    messages: 120,
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
      const hasCookie = document.cookie.split(';').some(c => c.trim().startsWith('batabitoo_session='));
      if (savedToken || hasCookie) {
        setIsUnlocked(true);
        document.documentElement.classList.add('pin-pre-unlocked');
        loadData(savedToken);
      }
    } catch (e) {}
  }, []);

  const loadData = async (token) => {
    setLoading(true);
    const authToken = token || localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch('/api/status', {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.counts) {
          setStats(prev => ({
            ...prev,
            total: data.counts.totalInboxes || prev.total,
            official: data.counts.official || prev.official,
            temp: data.counts.temp || prev.temp,
            amazon: data.counts.amazon || prev.amazon,
            messages: data.counts.messages || prev.messages,
          }));
        }
      } else if (res.status === 401) {
        handleLock();
      }
    } catch (err) {
      console.warn('API error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyClick = (digit) => {
    if (enteredPin.length < 4) {
      const next = enteredPin + digit;
      setEnteredPin(next);
      setPinError(false);
      if (next.length === 4) {
        setTimeout(() => checkPin(next), 80);
      }
    }
  };

  const checkPin = async (pinToCheck) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinToCheck })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success && data.token) {
          localStorage.setItem(TOKEN_KEY, data.token);
          sessionStorage.setItem(TOKEN_KEY, data.token);
          document.cookie = `batabitoo_session=${data.token}; path=/; max-age=2592000; SameSite=Lax`;
          document.documentElement.classList.add('pin-pre-unlocked');
          setIsUnlocked(true);
          setEnteredPin('');
          loadData(data.token);
          return;
        }
      } else if (res.status === 401) {
        setPinError(true);
        setEnteredPin('');
        return;
      }
    } catch (_) {
      setPinError(true);
      setEnteredPin('');
    }
  };

  const handleLock = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    document.cookie = 'batabitoo_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.documentElement.classList.remove('pin-pre-unlocked');
    setIsUnlocked(false);
    setEnteredPin('');
  };

  return (
    <>
      {/* PIN Lock Screen (Suppressed instantly if pin-pre-unlocked) */}
      {!isUnlocked && (
        <div id="pin-lock-overlay" className="pin-lock-overlay">
          <div className="pin-lock-card">
            <div className="pin-lock-badge">
              <svg viewBox="0 0 24 24" width="28" height="28"><path fill="#38bdf8" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
            </div>
            <h3 className="pin-title">مركز رسائل بطابيطو</h3>
            <p className="pin-desc">بيئة Next.js - محمية بالكامل من الخادم</p>

            <div className="pin-dots">
              {[0, 1, 2, 3].map(i => (
                <span key={i} className={`pin-dot ${i < enteredPin.length ? 'filled' : ''}`} />
              ))}
            </div>

            {pinError && (
              <div className="pin-error-msg">⚠️ رمز الأمان غير صحيح! حاول مرة أخرى</div>
            )}

            <div className="pin-keypad" id="pin-keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                <button key={d} type="button" className="pin-key" data-digit={String(d)} onClick={() => handleKeyClick(String(d))}>
                  {d}
                </button>
              ))}
              <button type="button" className="pin-key pin-key-action" onClick={() => setEnteredPin('')}>مسح</button>
              <button type="button" className="pin-key" data-digit="0" onClick={() => handleKeyClick('0')}>0</button>
              <button type="button" className="pin-key pin-key-action" onClick={() => setEnteredPin(prev => prev.slice(0, -1))}>⌫</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Authenticated Dashboard */}
      {isUnlocked && (
        <div className="app-container">
          {/* Header */}
          <header className="top-header">
            <div className="brand-section">
              <div className="brand-icon">✉️</div>
              <div className="brand-text">
                <h1>بريد بطابيطو</h1>
                <span>Next.js App Hosting</span>
              </div>
            </div>
            <div className="header-actions">
              <span className="badge-pill">● متصل بالسيرفر</span>
              <button className="btn-icon" onClick={loadData} title="تحديث">🔄</button>
              <button className="btn-icon" onClick={handleLock} title="قفل الموقع">🔒</button>
            </div>
          </header>

          {/* Compact Stats */}
          <section className="stats-grid">
            <div className={`compact-card ${currentTab === 'official' ? 'active' : ''}`} onClick={() => setCurrentTab('official')}>
              <span className="card-label">بريد رسمي</span>
              <span className="card-val">{stats.official}</span>
            </div>
            <div className={`compact-card ${currentTab === 'temp' ? 'active' : ''}`} onClick={() => setCurrentTab('temp')}>
              <span className="card-label">بريد سريع</span>
              <span className="card-val">{stats.temp}</span>
            </div>
            <div className={`compact-card ${currentTab === 'amazon' ? 'active' : ''}`} onClick={() => setCurrentTab('amazon')}>
              <span className="card-label">مركز أمازون</span>
              <span className="card-val">{stats.amazon}</span>
            </div>
          </section>

          {/* Official Sub-selector (Batabitoo vs Gmail) */}
          {currentTab === 'official' && (
            <div className="sub-tabs">
              <button
                className={`sub-tab ${officialSubFilter === 'all' ? 'active' : ''}`}
                onClick={() => setOfficialSubFilter('all')}
              >
                كل الرسمي ({stats.official})
              </button>
              <button
                className={`sub-tab ${officialSubFilter === 'batabitoo' ? 'active' : ''}`}
                onClick={() => setOfficialSubFilter('batabitoo')}
              >
                🏢 بطابيطو ({stats.officialBatabitoo})
              </button>
              <button
                className={`sub-tab ${officialSubFilter === 'gmail' ? 'active' : ''}`}
                onClick={() => setOfficialSubFilter('gmail')}
              >
                🔴 Gmail ({stats.officialGmail})
              </button>
            </div>
          )}

          {/* Amazon Sub-filter */}
          {currentTab === 'amazon' && (
            <div className="sub-tabs">
              <button
                className={`sub-tab ${amazonSubFilter === 'all' ? 'active' : ''}`}
                onClick={() => setAmazonSubFilter('all')}
              >
                كل حسابات أمازون
              </button>
              <button
                className={`sub-tab ${amazonSubFilter === 'dotted' ? 'active' : ''}`}
                onClick={() => setAmazonSubFilter('dotted')}
              >
                🎯 تمييز النقط (Gmail)
              </button>
              <button
                className={`sub-tab ${amazonSubFilter === 'batabitoo' ? 'active' : ''}`}
                onClick={() => setAmazonSubFilter('batabitoo')}
              >
                🏢 بطابيطو
              </button>
            </div>
          )}

          {/* Items / Inboxes List */}
          <div className="items-list">
            {currentTab === 'official' && officialSubFilter !== 'batabitoo' && (
              <div className="list-item">
                <div className="item-main">
                  <span className="item-email">ahmedroou1122@gmail.com</span>
                  <span className="item-sub">حساب Gmail الرسمي • متصل ومتزامن</span>
                </div>
                <span className="item-tag">🔴 Gmail</span>
              </div>
            )}

            {currentTab === 'official' && officialSubFilter !== 'gmail' && (
              <>
                <div className="list-item">
                  <div className="item-main">
                    <span className="item-email">fatima.acc1@batabitoo.com</span>
                    <span className="item-sub">حساب رسمي مخصص • متصل</span>
                  </div>
                  <span className="item-tag">🏢 بطابيطو</span>
                </div>
                <div className="list-item">
                  <div className="item-main">
                    <span className="item-email">amazon.acc@batabitoo.com</span>
                    <span className="item-sub">حساب أمازون الرئيسي</span>
                  </div>
                  <span className="item-tag">🏢 بطابيطو</span>
                </div>
              </>
            )}

            {currentTab === 'amazon' && (
              <>
                <div className="list-item">
                  <div className="item-main">
                    <span className="item-email">a.hmedroou1122@gmail.com</span>
                    <span className="item-sub">متفرع نقطي 1 • مستقل في الحظر والطلبات</span>
                  </div>
                  <span className="item-tag">🛒 أمازون نقطي</span>
                </div>
                <div className="list-item">
                  <div className="item-main">
                    <span className="item-email">ah.medroou1122@gmail.com</span>
                    <span className="item-sub">متفرع نقطي 2 • مستقل في الحظر والطلبات</span>
                  </div>
                  <span className="item-tag">🛒 أمازون نقطي</span>
                </div>
              </>
            )}

            {currentTab === 'temp' && (
              <div className="list-item">
                <div className="item-main">
                  <span className="item-email">1000 صندوق بريد سريع نشط</span>
                  <span className="item-sub">توليد فوري واستقبال أكواد تلقائي</span>
                </div>
                <span className="item-tag">⚡ سريع</span>
              </div>
            )}
          </div>

          {/* Bottom Bar */}
          <nav className="bottom-bar">
            <button className={`nav-item ${currentTab === 'official' ? 'active' : ''}`} onClick={() => setCurrentTab('official')}>
              <span>📬</span>
              <span>الرسمي</span>
            </button>
            <button className={`nav-item ${currentTab === 'temp' ? 'active' : ''}`} onClick={() => setCurrentTab('temp')}>
              <span>⚡</span>
              <span>السريع</span>
            </button>
            <button className={`nav-item ${currentTab === 'amazon' ? 'active' : ''}`} onClick={() => setCurrentTab('amazon')}>
              <span>🛒</span>
              <span>أمازون</span>
            </button>
            <button className="nav-item" onClick={handleLock}>
              <span>🔒</span>
              <span>قفل</span>
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
