import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>xSync</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <iframe
          src="/index.html"
          title="xSync"
          style={{ border: '0', width: '100%', height: '100%' }}
        />
      </div>
    </>
  );
}
