import { useEffect } from 'react';
import { Poppins } from 'next/font/google';
import '../styles/globals.css';
import '../styles/herramienta.css';

// Poppins se descarga en el build y se sirve desde la app (funciona sin conexión).
const poppins = Poppins({ weight: ['300', '400', '500', '600', '700'], subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-poppins' });

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return (
    <>
      <style jsx global>{`
        :root { --font-poppins: ${poppins.style.fontFamily}; }
      `}</style>
      <Component {...pageProps} />
    </>
  );
}
