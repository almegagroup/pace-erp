// 🔒 DEV MODE → disable service worker (prevent cache issues)
if (import.meta.env.DEV) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => {
        regs.forEach(reg => reg.unregister());
      });
  }
}

// 🚀 PROD MODE → register service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      // 🔥 force update check
      registration.update();

      // 🔁 detect new SW and reload automatically
      if (registration.waiting) {
        console.log('🔄 New version available, reloading...');
        window.location.reload();
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;

        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('🆕 New content available → reload');
              window.location.reload();
            }
          }
        });
      });

    } catch (err) {
      console.error('❌ Service Worker registration failed:', err);
    }
  });
}