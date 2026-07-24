self.DOW_BOOKMARKLETS = [
  {
    id: 'copy-page-link',
    name: 'Copy Page Link',
    description: 'Copy the current page title and URL to the clipboard.',
    tags: ['Utility', 'Clipboard'],
    icon: 'fa-link',
    file: 'bookmarklets/copy-page-link.js',
    bookmarklet: 'javascript:(()=>{const t=document.title+"\\n"+location.href,f=()=>{const e=document.createElement("textarea");e.value=t,e.style.cssText="position:fixed;opacity:0;pointer-events:none",document.body.append(e),e.select(),document.execCommand("copy"),e.remove()};navigator.clipboard?.writeText?navigator.clipboard.writeText(t).catch(f):f()})()'
  },
  {
    id: 'focus-reading',
    name: 'Focus Reading',
    description: 'Toggle a cleaner reading view by hiding common navigation and sidebars.',
    tags: ['Reading', 'Focus'],
    icon: 'fa-book-open',
    file: 'bookmarklets/focus-reading.js',
    bookmarklet: 'javascript:(()=>{const i="dow-bookmarklet-focus-reading",e=document.getElementById(i);if(e){e.remove();return}const s=document.createElement("style");s.id=i,s.textContent="header,nav,aside,footer,[role=\\"banner\\"],[role=\\"navigation\\"],.sidebar,.side-bar{display:none!important}main,article,[role=\\"main\\"]{max-width:900px!important;margin-left:auto!important;margin-right:auto!important}",document.documentElement.append(s)})()'
  },
  {
    id: 'highlight-external-links',
    name: 'Highlight External Links',
    description: 'Toggle a clear outline around links that point to another website.',
    tags: ['Utility', 'Links'],
    icon: 'fa-arrow-up-right-from-square',
    file: 'bookmarklets/highlight-external-links.js',
    bookmarklet: 'javascript:(()=>{const className="dow-bm-ext-link",styleId="dow-bm-ext-link-style",existingStyle=document.getElementById(styleId);if(existingStyle){existingStyle.remove();document.querySelectorAll("."+className).forEach(a=>a.classList.remove(className));return}const style=document.createElement("style");style.id=styleId,style.textContent="."+className+"{outline:2px solid #a3e635!important;outline-offset:2px!important;border-radius:2px!important}",document.documentElement.append(style);document.querySelectorAll("a[href]").forEach(a=>{try{a.hostname&&a.hostname!==location.hostname&&/^https?:/i.test(a.protocol)&&a.classList.add(className)}catch(e){}})})()'
  },
  {
    id: 'outline-headings',
    name: 'Outline Headings',
    description: 'Toggle visible markers on headings to scan a page structure quickly.',
    tags: ['Reading', 'Structure'],
    icon: 'fa-list-ol',
    file: 'bookmarklets/outline-headings.js',
    bookmarklet: 'javascript:(()=>{const i="dow-bookmarklet-outline-headings",e=document.getElementById(i);if(e){e.remove();return}const s=document.createElement("style");s.id=i,s.textContent="h1,h2,h3,h4,h5,h6{outline:2px solid #f97316!important;outline-offset:4px!important;scroll-margin-top:24px!important}",document.documentElement.append(s)})()'
  }
];