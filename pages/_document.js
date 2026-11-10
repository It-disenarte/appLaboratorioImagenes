import Document, { Html, Head, Main, NextScript } from 'next/document';

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="es">
        <Head>
          <link rel="icon" href="/favicon.ico?v=1" sizes="48x48" />
          <link rel="icon" href="/favicon.svg?v=1" type="image/svg+xml" />
          <link rel="manifest" href="/manifest.json" />
          <meta name="theme-color" content="#7C07A6" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Laboratorio" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
