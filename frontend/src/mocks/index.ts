export async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK === 'false') return;
  const { worker } = await import('./browser');
  await worker.start({ serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` }, onUnhandledFrame: 'bypass' });
}
