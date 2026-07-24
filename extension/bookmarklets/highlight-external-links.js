(() => {
  const className = 'dow-bm-ext-link';
  const styleId = 'dow-bm-ext-link-style';
  const existingStyle = document.getElementById(styleId);

  if (existingStyle) {
    existingStyle.remove();
    document.querySelectorAll('.' + className).forEach(a => a.classList.remove(className));
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `.${className} { outline: 2px solid #a3e635 !important; outline-offset: 2px !important; border-radius: 2px !important; }`;
  document.documentElement.append(style);

  document.querySelectorAll('a[href]').forEach(a => {
    try {
      if (a.hostname && a.hostname !== location.hostname && /^https?:/i.test(a.protocol)) {
        a.classList.add(className);
      }
    } catch (e) {}
  });
})();