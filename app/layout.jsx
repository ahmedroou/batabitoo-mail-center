import './globals.css';

export const metadata = {
  title: 'مركز بريد بطابيطو',
  description: 'مركز بريد بطابيطو لإدارة الصناديق والرسائل الرسمية والسريعة وأمازون',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  const preCheckScript = `
    (function() {
      try {
        var token = localStorage.getItem('batabitoo_session_token') || sessionStorage.getItem('batabitoo_session_token');
        var hasCookie = document.cookie.split(';').some(function(c) {
          return c.trim().indexOf('batabitoo_session=') === 0;
        });
        if (token || hasCookie) {
          document.documentElement.classList.add('pin-pre-unlocked');
        }
      } catch(e) {}
    })();
  `;

  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: preCheckScript }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
