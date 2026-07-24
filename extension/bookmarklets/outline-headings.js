(() => {
  const styleId = 'dow-bookmarklet-outline-headings';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = 'h1, h2, h3, h4, h5, h6 { outline: 2px solid #f97316 !important; outline-offset: 4px !important; scroll-margin-top: 24px !important; }';
  document.documentElement.append(style);
})();