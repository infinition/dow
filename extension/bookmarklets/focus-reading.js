(() => {
  const styleId = 'dow-bookmarklet-focus-reading';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = 'header, nav, aside, footer, [role="banner"], [role="navigation"], .sidebar, .side-bar { display: none !important; } main, article, [role="main"] { max-width: 900px !important; margin-left: auto !important; margin-right: auto !important; }';
  document.documentElement.append(style);
})();