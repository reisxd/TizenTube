// TizenTube Cobalt - Shorts Remix Butonunu Gizleme Modülü (v1.1.0)
(function () {
  'use strict';

  // CSS Enjeksiyonu için Benzersiz Kimlik
  const STYLE_ID = 'tizentube-hide-remix-style';

  /**
   * Remix butonlarını hem TV (Cobalt) hem de Web arayüzünde gizleyen CSS kurallarını hazırlar.
   */
  function injectHideStyle() {
    // Stil zaten eklenmişse tekrar ekleme yapma (Çift enjeksiyonu önler)
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    
    style.textContent = `
      /* ===============================================================
         TizenTube - Shorts Remix & Pivot Buton Gizleme Kuralları
         =============================================================== */

      /* 1. TV / Cobalt Leanback Arayüzü Seçicileri */
      .ytlr-pivot-button-renderer,
      .ytlr-reel-player-overlay-renderer [aria-label*="Remix"],
      .ytlr-reel-player-overlay-renderer [aria-label*="karıştır"],

      /* 2. Standart YouTube Web & Mobil Shorts Seçicileri */
      ytd-reel-player-overlay-renderer #remix-button,
      yt-reel-player-overlay-renderer .remix-button,
      ytd-reel-player-overlay-renderer ytd-pivot-button-renderer,
      
      /* 3. Dinamik Attribute Seçicileri */
      [aria-label*="Remix" i],
      [aria-label*="Yeniden karıştır" i],
      button[aria-label*="Remix" i] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        
        /* Smart TV D-Pad Kumanda Odağını Devre Dışı Bırakma */
        max-width: 0 !important;
        max-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
    `;

    // DOM henüz tam yüklenmemişse documentElement (<html>) seviyesinde ekle
    const targetContainer = document.head || document.documentElement;
    if (targetContainer) {
      targetContainer.appendChild(style);
    }
  }

  // Yükleme Durumuna Göre Tetikleme
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHideStyle);
  } else {
    injectHideStyle();
  }

  // SPA (Single Page Application) Sayfa Geçişlerini Dinleme
  window.addEventListener('yt-navigate-finish', injectHideStyle);
})();
