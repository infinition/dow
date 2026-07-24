(() => {
  const text = `${document.title}\n${location.href}`;
  const fallbackCopy = () => {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
})();