// @ts-check
/** public/pilot/hub.html — the pilot hub on the real server (local data, import, CSV download; no sync). */
import { mountHub } from './hub.js';

/** ?lang=he|en wins; otherwise the hub remembers the last language chosen with its own switch (default Hebrew). */
const q = new URLSearchParams(location.search).get('lang');
const el = document.getElementById('pilot-hub');
if (el) void mountHub(el, { lang: q === 'en' || q === 'he' ? q : null, sessionUrl: 'session.html', useClaude: false, setDocumentLang: true });
