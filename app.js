// Hinterland web player. Everything stays in this browser: audio and listening
// positions live in IndexedDB, and nothing is uploaded.
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b)$/i;
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const SLEEP_MINUTES = [15, 30, 60];

  // ---------- formatting (mirrors ListeningFormat in the iOS app) ----------

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function durationText(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'Duration unavailable';
    const minutes = Math.floor(seconds / 60);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
    }
    return `${Math.max(1, minutes)} min`;
  }

  function bytesText(bytes) {
    if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e9).toFixed(2)} GB`;
  }

  const stem = (name) => name.replace(/\.[^./]+$/, '') || name;
  const speedText = (value) => `${value}×`;
  const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // ---------- icons ----------

  const ICONS = {
    gear: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/>',
    speed: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    playCircle: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none"/>',
    wave: '<path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/>',
    back: '<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M7.5 2.5 6.8 6.6l4.1.7"/>',
    forward: '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="m16.5 2.5.7 4.1-4.1.7"/>',
    warn: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.3" r=".9" fill="currentColor"/>',
  };
  const icon = (name, size = 22) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const skipIcon = (name, label) => `<span class="skip-icon">${icon(name, 44)}<span aria-hidden="true">${label}</span></span>`;
  const PLAY = '<svg class="icon" width="27" height="27" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"/></svg>';
  const PAUSE = '<svg class="icon" width="27" height="27" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5.5" y="4" width="4.6" height="16" rx="1.3"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.3"/></svg>';
  const BOOK = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M6.5 3h10A1.5 1.5 0 0 1 18 4.5V19a2 2 0 0 1-2 2H7.5A2.5 2.5 0 0 1 5 18.5v-14A1.5 1.5 0 0 1 6.5 3Zm1 14.5a1 1 0 0 0 0 2H16v-2H7.5Z"/></svg>';

  // ---------- storage ----------

  let database;
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('hinterland', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'id' });
        request.result.createObjectStore('audio');
      };
      request.onsuccess = () => {
        // Let another tab upgrade or clear the database instead of blocking it.
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  function transact(stores, mode, work) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(stores, mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted'));
      result = work(transaction);
    });
  }
  const requestValue = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const loadBooks = () => requestValue(database.transaction('books').objectStore('books').getAll());
  const loadAudio = (trackID) => requestValue(database.transaction('audio').objectStore('audio').get(trackID));
  const saveBook = (book) => transact(['books'], 'readwrite', (t) => { t.objectStore('books').put(book); });

  // ---------- embedded metadata ----------

  const utf8 = new TextDecoder('utf-8');
  async function readBytes(blob, start, length) {
    return new DataView(await blob.slice(start, start + length).arrayBuffer());
  }
  const fourCC = (view, offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

  // Walks the boxes directly inside [start, end) of an in-memory MP4 buffer.
  function* boxes(view, start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return;
      yield { type: fourCC(view, offset + 4), start: offset + header, end: offset + size };
      offset += size;
    }
  }
  function findBox(view, parent, ...path) {
    let current = parent;
    for (const type of path) {
      let next = null;
      // `meta` is a full box: four bytes of version and flags precede its children.
      const start = current.type === 'meta' ? current.start + 4 : current.start;
      for (const box of boxes(view, start, current.end)) {
        if (box.type === type) { next = box; break; }
      }
      if (!next) return null;
      current = next;
    }
    return current;
  }

  async function readMP4(file) {
    const result = { chapters: [] };
    let offset = 0;
    let moov = null;
    while (offset + 8 <= file.size) {
      const head = await readBytes(file, offset, 16);
      let size = head.getUint32(0);
      const type = fourCC(head, 4);
      if (size === 1 && head.byteLength >= 16) size = Number(head.getBigUint64(8));
      else if (size === 0) size = file.size - offset;
      if (size < 8) break;
      if (type === 'moov') { moov = { offset, size }; break; }
      offset += size;
    }
    if (!moov || moov.size > 64 * 1024 * 1024) return result;
    const view = await readBytes(file, moov.offset, moov.size);
    const root = { type: 'moov', start: 8, end: view.byteLength };

    const ilst = findBox(view, root, 'udta', 'meta', 'ilst');
    if (ilst) {
      for (const item of boxes(view, ilst.start, ilst.end)) {
        const data = findBox(view, item, 'data');
        if (!data || data.end - data.start < 8) continue;
        const payload = new Uint8Array(view.buffer, view.byteOffset + data.start + 8, data.end - data.start - 8);
        if (item.type === '\u00A9nam') result.title = utf8.decode(payload).trim();
        else if (item.type === '\u00A9ART' || (item.type === 'aART' && !result.author)) result.author = utf8.decode(payload).trim();
        else if (item.type === '\u00A9alb') result.album = utf8.decode(payload).trim();
        else if (item.type === 'covr' && !result.artwork) {
          const png = payload[0] === 0x89 && payload[1] === 0x50;
          result.artwork = new Blob([payload.slice()], { type: png ? 'image/png' : 'image/jpeg' });
        }
      }
    }

    // QuickTime chapter track: an audio track's `tref/chap` names a text track
    // whose samples are the chapter titles.
    const tracks = [];
    for (const trak of boxes(view, root.start, root.end)) {
      if (trak.type !== 'trak') continue;
      const tkhd = findBox(view, trak, 'tkhd');
      if (!tkhd) continue;
      const id = view.getUint32(tkhd.start + (view.getUint8(tkhd.start) === 1 ? 20 : 12));
      const chap = findBox(view, trak, 'tref', 'chap');
      tracks.push({ id, trak, chapterTrackID: chap && chap.end - chap.start >= 4 ? view.getUint32(chap.start) : null });
    }
    const reference = tracks.find((t) => t.chapterTrackID !== null);
    const chapterTrack = reference && tracks.find((t) => t.id === reference.chapterTrackID);
    if (chapterTrack) {
      try {
        result.chapters = await readChapterTrack(file, view, chapterTrack.trak);
      } catch { result.chapters = []; }
    }

    // Nero chapter list, used when there is no chapter track.
    if (!result.chapters.length) {
      const chpl = findBox(view, root, 'udta', 'chpl');
      if (chpl) {
        let at = chpl.start + 4 + (view.getUint8(chpl.start) ? 4 : 0);
        const count = view.getUint8(at); at += 1;
        for (let i = 0; i < count && at + 9 <= chpl.end; i++) {
          const start = Number(view.getBigUint64(at)) / 1e7; at += 8;
          const length = view.getUint8(at); at += 1;
          const title = utf8.decode(new Uint8Array(view.buffer, view.byteOffset + at, Math.min(length, chpl.end - at))); at += length;
          result.chapters.push({ title: title.trim() || `Chapter ${i + 1}`, start });
        }
      }
    }
    return result;
  }

  async function readChapterTrack(file, view, trak) {
    const mdhd = findBox(view, trak, 'mdia', 'mdhd');
    const stbl = findBox(view, trak, 'mdia', 'minf', 'stbl');
    if (!mdhd || !stbl) return [];
    const timescale = view.getUint32(mdhd.start + (view.getUint8(mdhd.start) === 1 ? 20 : 12));
    const table = (type) => findBox(view, stbl, type);
    const stts = table('stts'), stsz = table('stsz'), stsc = table('stsc');
    const stco = table('stco'), co64 = table('co64');
    if (!stts || !stsz || !stsc || !(stco || co64) || !timescale) return [];

    const sampleCount = view.getUint32(stsz.start + 8);
    if (sampleCount > 5000) return [];
    const fixedSize = view.getUint32(stsz.start + 4);
    const sizes = Array.from({ length: sampleCount }, (_, i) => fixedSize || view.getUint32(stsz.start + 12 + i * 4));

    const starts = [];
    let time = 0;
    for (let i = 0, entries = view.getUint32(stts.start + 4); i < entries; i++) {
      const count = view.getUint32(stts.start + 8 + i * 8);
      const delta = view.getUint32(stts.start + 12 + i * 8);
      for (let n = 0; n < count && starts.length < sampleCount; n++) { starts.push(time / timescale); time += delta; }
    }

    const chunkOffsets = [];
    const offsets = stco || co64;
    for (let i = 0, entries = view.getUint32(offsets.start + 4); i < entries; i++) {
      chunkOffsets.push(stco ? view.getUint32(stco.start + 8 + i * 4) : Number(view.getBigUint64(co64.start + 8 + i * 8)));
    }
    const runs = [];
    for (let i = 0, entries = view.getUint32(stsc.start + 4); i < entries; i++) {
      runs.push({ firstChunk: view.getUint32(stsc.start + 8 + i * 12), perChunk: view.getUint32(stsc.start + 12 + i * 12) });
    }

    const chapters = [];
    let sample = 0;
    for (let chunk = 0; chunk < chunkOffsets.length && sample < sampleCount; chunk++) {
      let perChunk = 1;
      for (const run of runs) if (chunk + 1 >= run.firstChunk) perChunk = run.perChunk;
      let position = chunkOffsets[chunk];
      for (let n = 0; n < perChunk && sample < sampleCount; n++, sample++) {
        const size = sizes[sample];
        if (size >= 2 && starts[sample] !== undefined) {
          const bytes = await readBytes(file, position, Math.min(size, 1024));
          const length = Math.min(bytes.getUint16(0), bytes.byteLength - 2);
          const raw = new Uint8Array(bytes.buffer, 2, length);
          const utf16 = length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF;
          const title = (utf16 ? new TextDecoder('utf-16be').decode(raw.subarray(2)) : utf8.decode(raw)).trim();
          chapters.push({ title: title || `Chapter ${sample + 1}`, start: starts[sample] });
        }
        position += size;
      }
    }
    return chapters;
  }

  async function readID3(file) {
    const result = { chapters: [] };
    const head = await readBytes(file, 0, 10);
    if (head.byteLength < 10 || fourCC(head, 0).slice(0, 3) !== 'ID3') return result;
    const version = head.getUint8(3);
    const synchsafe = (view, at) => (view.getUint8(at) << 21) | (view.getUint8(at + 1) << 14) | (view.getUint8(at + 2) << 7) | view.getUint8(at + 3);
    const tagSize = Math.min(synchsafe(head, 6), 16 * 1024 * 1024);
    const view = await readBytes(file, 10, tagSize);
    const bytes = new Uint8Array(view.buffer);

    const text = (encoding, data) => {
      const label = ['iso-8859-1', 'utf-16', 'utf-16be', 'utf-8'][encoding] || 'iso-8859-1';
      return new TextDecoder(label).decode(data).replace(/\0+$/, '').trim();
    };
    const idLength = version === 2 ? 3 : 4;
    const headerLength = version === 2 ? 6 : 10;
    let at = 0;
    while (at + headerLength <= bytes.length && bytes[at] !== 0) {
      const id = String.fromCharCode(...bytes.subarray(at, at + idLength));
      const size = version === 2
        ? (bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5]
        : (version === 4 ? synchsafe(view, at + 4) : view.getUint32(at + 4));
      const body = bytes.subarray(at + headerLength, at + headerLength + size);
      at += headerLength + size;
      if (size <= 0 || body.length < size) break;
      if (id === 'TIT2' || id === 'TT2') result.title = text(body[0], body.subarray(1));
      else if (id === 'TPE1' || id === 'TP1') result.author = text(body[0], body.subarray(1));
      else if (id === 'TALB' || id === 'TAL') result.album = text(body[0], body.subarray(1));
      else if ((id === 'APIC' || id === 'PIC') && !result.artwork) {
        const wide = body[0] === 1 || body[0] === 2;
        let cursor = 1;
        let mime = 'image/jpeg';
        if (id === 'PIC') {
          mime = String.fromCharCode(...body.subarray(1, 4)).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
          cursor = 4;
        } else {
          const end = body.indexOf(0, cursor);
          if (end < 0) continue;
          mime = String.fromCharCode(...body.subarray(cursor, end)) || mime;
          cursor = end + 1;
        }
        cursor += 1; // picture type
        while (cursor < body.length) { // description terminator
          if (wide ? (body[cursor] === 0 && body[cursor + 1] === 0) : body[cursor] === 0) { cursor += wide ? 2 : 1; break; }
          cursor += wide ? 2 : 1;
        }
        if (cursor < body.length) result.artwork = new Blob([body.slice(cursor)], { type: mime.includes('/') ? mime : 'image/jpeg' });
      }
    }
    return result;
  }

  async function readMetadata(file) {
    try {
      return /\.mp3$/i.test(file.name) ? await readID3(file) : await readMP4(file);
    } catch {
      return { chapters: [] };
    }
  }

  function probeDuration(file) {
    return new Promise((resolve) => {
      const probe = new Audio();
      const url = URL.createObjectURL(file);
      const finish = (value) => { probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); resolve(value); };
      const timer = setTimeout(() => finish(null), 15000);
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null); };
      probe.onerror = () => { clearTimeout(timer); finish(null); };
      probe.src = url;
    });
  }

  // ---------- state ----------

  const audio = new Audio();
  audio.preload = 'auto';
  const state = {
    books: [],
    book: null,          // open book
    track: null,         // loaded track
    completed: false,
    loading: false,
    wantsPlayback: false,
    speed: Number(localStorage.getItem('hinterland.speed')) || 1,
    sleepDeadline: null,
    scrubbing: null,
    pending: null,       // import under review
    error: null,
  };
  let objectURL = null;
  let lastSave = 0;
  const artworkURLs = new Map();

  function artworkURL(book) {
    if (!book.artwork) return null;
    if (!artworkURLs.has(book.id)) artworkURLs.set(book.id, URL.createObjectURL(book.artwork));
    return artworkURLs.get(book.id);
  }
  function artworkHTML(book, size) {
    const url = artworkURL(book);
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.17)}px`;
    return url
      ? `<span class="artwork" style="${style}"><img src="${url}" alt=""></span>`
      : `<span class="artwork placeholder" style="${style}">${BOOK}</span>`;
  }

  const totalDuration = (book) => book.tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  function progressOf(book, trackID, time, completed) {
    if (completed) return 1;
    const total = totalDuration(book);
    if (!total) return null;
    let before = 0;
    for (const track of book.tracks) {
      if (track.id === trackID) return Math.min(1, (before + time) / total);
      before += track.duration || 0;
    }
    return null;
  }
  function liveProgress() {
    if (!state.book || !state.track) return null;
    return progressOf(state.book, state.track.id, audio.currentTime || 0, state.completed);
  }
  function rowProgressText(book) {
    if (!book.position) return 'Not started';
    const progress = progressOf(book, book.position.trackID, book.position.time, book.position.completed);
    if (progress === null) return 'Position saved';
    return progress >= 1 ? 'Finished' : `${Math.floor(progress * 100)}% listened`;
  }
  function currentChapterTitle() {
    const chapters = state.track?.chapters || [];
    let title = '';
    for (const chapter of chapters) if (chapter.start <= (audio.currentTime || 0) + 0.25) title = chapter.title;
    return title;
  }
  const trackIndex = () => (state.book && state.track ? state.book.tracks.findIndex((t) => t.id === state.track.id) : -1);

  // ---------- playback ----------

  function savePosition(force = false) {
    if (!state.book || !state.track || state.loading) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    state.book.position = { trackID: state.track.id, time: audio.currentTime || 0, completed: state.completed, updated: now };
    saveBook(state.book).catch(() => {});
  }

  async function loadTrack(track, time, autoplay) {
    state.loading = true;
    state.track = track;
    renderPlayback();
    const blob = await loadAudio(track.id);
    if (!blob) {
      state.loading = false;
      showError('This book’s audio is no longer stored in this browser. Delete the book and add it again from your original files.');
      renderPlayback();
      return;
    }
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      const done = () => { audio.removeEventListener('loadedmetadata', done); audio.removeEventListener('error', done); resolve(); };
      audio.addEventListener('loadedmetadata', done);
      audio.addEventListener('error', done);
      audio.src = objectURL;
      audio.load();
    });
    if (audio.error) {
      state.loading = false;
      showError('This browser could not play that file. Protected (DRM) audio is not supported.');
      renderPlayback();
      return;
    }
    const limit = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.05) : time;
    audio.currentTime = Math.min(Math.max(0, time), limit);
    audio.defaultPlaybackRate = state.speed;
    audio.playbackRate = state.speed;
    state.loading = false;
    updateMediaSession();
    if (autoplay) await play(); else renderPlayback();
  }

  // Opening a book never starts audio; it restores the saved position.
  async function openBook(book) {
    if (state.book?.id === book.id && state.track) { renderAll(); return; }
    audio.pause();
    savePosition(true);
    state.wantsPlayback = false;
    state.book = book;
    const saved = book.position && book.tracks.find((t) => t.id === book.position.trackID);
    state.completed = Boolean(saved && book.position.completed);
    renderAll();
    await loadTrack(saved || book.tracks[0], saved ? book.position.time : 0, false);
    renderAll();
  }

  async function play() {
    if (!state.track || state.completed || state.loading) return;
    state.wantsPlayback = true;
    try { await audio.play(); } catch { state.wantsPlayback = false; }
    renderPlayback();
  }
  function pause() {
    state.wantsPlayback = false;
    audio.pause();
    savePosition(true);
    renderPlayback();
  }
  const togglePlayback = () => (audio.paused ? play() : pause());

  async function goTo(track, time, { completed = false } = {}) {
    if (!state.book) return;
    const wasPlaying = state.wantsPlayback && !audio.paused;
    state.completed = completed;
    if (completed) { state.wantsPlayback = false; audio.pause(); }
    if (state.track?.id === track.id && !audio.error) {
      const limit = Number.isFinite(audio.duration) ? audio.duration : time;
      audio.currentTime = Math.min(Math.max(0, time), limit);
    } else {
      await loadTrack(track, time, wasPlaying && !completed);
    }
    savePosition(true);
    renderAll();
  }

  // Skips move across track boundaries, like the iOS player.
  async function skip(seconds) {
    if (!state.book || !state.track || state.completed || state.loading) return;
    const tracks = state.book.tracks;
    let index = trackIndex();
    let target = (audio.currentTime || 0) + seconds;
    while (target < 0 && index > 0) { index -= 1; target += tracks[index].duration || 0; }
    while (target >= (tracks[index].duration || audio.duration || 0) && index < tracks.length - 1) {
      target -= tracks[index].duration || audio.duration || 0;
      index += 1;
    }
    const length = tracks[index].duration || audio.duration || 0;
    if (target >= length && index === tracks.length - 1) { await goTo(tracks[index], length, { completed: true }); return; }
    await goTo(tracks[index], Math.max(0, target));
  }

  async function restart() {
    if (!state.book) return;
    await goTo(state.book.tracks[0], 0);
  }

  function setSpeed(value) {
    state.speed = value;
    localStorage.setItem('hinterland.speed', String(value));
    audio.defaultPlaybackRate = value;
    audio.playbackRate = value;
    renderPlayback();
  }
  function setSleepTimer(minutes) {
    state.sleepDeadline = minutes ? Date.now() + minutes * 60000 : null;
    renderPlayback();
  }
  const sleepMinutesRemaining = () => (state.sleepDeadline ? Math.max(1, Math.ceil((state.sleepDeadline - Date.now()) / 60000)) : null);
  setInterval(() => {
    if (!state.sleepDeadline) return;
    if (Date.now() >= state.sleepDeadline) { state.sleepDeadline = null; pause(); }
    else renderPlayback();
  }, 5000);

  audio.addEventListener('timeupdate', () => { savePosition(); renderProgress(); });
  audio.addEventListener('play', renderPlayback);
  audio.addEventListener('pause', () => { if (!state.loading) savePosition(true); renderPlayback(); });
  audio.addEventListener('seeked', () => { if (!state.loading) savePosition(true); renderProgress(); });
  audio.addEventListener('ended', async () => {
    if (!state.book || !state.track) return;
    const next = state.book.tracks[trackIndex() + 1];
    if (next) {
      await loadTrack(next, 0, state.wantsPlayback);
      savePosition(true);
    } else {
      state.completed = true;
      state.wantsPlayback = false;
      savePosition(true);
      celebrate();
    }
    renderAll();
  });
  addEventListener('pagehide', () => savePosition(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(true); });

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !state.book || !state.track) return;
    const art = artworkURL(state.book);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentChapterTitle() || stem(state.track.name),
      artist: state.book.author || '',
      album: state.book.title,
      artwork: art ? [{ src: art }] : [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  if ('mediaSession' in navigator) {
    const handlers = {
      play, pause,
      seekbackward: () => skip(-15),
      seekforward: () => skip(30),
      previoustrack: () => skip(-15),
      nexttrack: () => skip(30),
      seekto: (event) => { if (Number.isFinite(event.seekTime) && !state.completed) audio.currentTime = event.seekTime; },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    }
  }

  // ---------- import ----------

  async function filesFromDrop(dataTransfer) {
    const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return { files: [...dataTransfer.files].map((file) => ({ file, path: file.name })), folder: null };
    const found = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        found.push({ file, path: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!batch.length) break;
          for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
        }
      }
    };
    for (const entry of entries) await walk(entry, '');
    const folder = entries.length === 1 && entries[0].isDirectory ? entries[0].name : null;
    return { files: found, folder };
  }

  async function prepareImport(items, folderName) {
    const token = {};
    state.pending = { token, title: '', candidates: [], busy: true, status: 'Reading selected files…', error: null, progress: 0 };
    $('#review-title').value = '';
    openSheet('review');
    renderReview();

    const audioItems = items.filter((item) => AUDIO_EXTENSIONS.test(item.file.name))
      .sort((a, b) => naturalOrder.compare(a.path, b.path));
    const unreadable = [];
    const candidates = [];
    for (const [index, item] of audioItems.entries()) {
      if (state.pending?.token !== token) return;
      state.pending.status = `Reading file ${index + 1} of ${audioItems.length}…`;
      state.pending.progress = index / audioItems.length;
      renderReview();
      const duration = await probeDuration(item.file);
      if (duration === null) { unreadable.push(item.file.name); continue; }
      const metadata = await readMetadata(item.file);
      // Strip the chosen folder's own name so tracks read like the iOS list.
      const relative = folderName && item.path.startsWith(`${folderName}/`) ? item.path.slice(folderName.length + 1) : item.path;
      candidates.push({ file: item.file, name: relative, duration, metadata });
    }
    if (state.pending?.token !== token) return;

    const first = candidates[0]?.metadata;
    const title = folderName
      || (candidates.length === 1 ? (first.title || stem(candidates[0].file.name)) : (first?.album || (candidates[0] ? stem(candidates[0].file.name) : '')))
      || 'Untitled Book';
    Object.assign(state.pending, { title, candidates, busy: false, status: '', progress: 0 });
    $('#review-title').value = title;
    if (!audioItems.length) state.pending.error = 'No MP3, M4A or M4B files were found in that selection.';
    else if (!candidates.length) state.pending.error = 'This browser could not read those files as audio. Protected (DRM) audio is not supported.';
    else if (unreadable.length) state.pending.error = `Left out because the audio could not be read: ${unreadable.join(', ')}`;
    renderReview();
  }

  async function commitImport() {
    const pending = state.pending;
    const title = pending.title.trim();
    if (!title) { pending.error = 'Enter a title for this book.'; renderReview(); return; }
    pending.busy = true;
    pending.status = 'Saving your book in this browser…';
    pending.progress = 1;
    renderReview();
    const lead = pending.candidates.find((c) => c.metadata.artwork || c.metadata.author)?.metadata || {};
    const book = {
      id: crypto.randomUUID(),
      title,
      author: pending.candidates.map((c) => c.metadata.author).find(Boolean) || '',
      artwork: pending.candidates.map((c) => c.metadata.artwork).find(Boolean) || lead.artwork || null,
      created: Date.now(),
      position: null,
      tracks: pending.candidates.map((c) => ({
        id: crypto.randomUUID(), name: c.name.split('/').pop(), duration: c.duration, size: c.file.size, chapters: c.metadata.chapters || [],
      })),
    };
    try {
      await transact(['books', 'audio'], 'readwrite', (t) => {
        book.tracks.forEach((track, i) => t.objectStore('audio').put(pending.candidates[i].file, track.id));
        t.objectStore('books').put(book);
      });
    } catch (error) {
      pending.busy = false;
      pending.error = error?.name === 'QuotaExceededError'
        ? 'This browser does not have enough storage for that book. Remove a book or free some disk space, then try again.'
        : 'The book could not be saved in this browser. Please try again.';
      renderReview();
      return;
    }
    navigator.storage?.persist?.().catch(() => {});
    state.books.unshift(book);
    state.pending = null;
    closeSheet('review');
    await openBook(book);
    celebrate();
  }

  function moveCandidate(index, delta) {
    const list = state.pending.candidates;
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    renderReview();
    $(`#review [data-move="${target}:${delta}"]`)?.focus();
  }

  async function deleteBook(book) {
    if (state.book?.id === book.id) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      Object.assign(state, { book: null, track: null, completed: false, wantsPlayback: false });
    }
    await transact(['books', 'audio'], 'readwrite', (t) => {
      book.tracks.forEach((track) => t.objectStore('audio').delete(track.id));
      t.objectStore('books').delete(book.id);
    });
    const url = artworkURLs.get(book.id);
    if (url) { URL.revokeObjectURL(url); artworkURLs.delete(book.id); }
    state.books = state.books.filter((b) => b.id !== book.id);
    renderAll();
  }

  // ---------- sheets ----------

  function openSheet(id) {
    const sheet = $(`#${id}`);
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet(id) {
    const sheet = $(`#${id}`);
    if (sheet.open) sheet.close();
  }
  function showError(message) {
    $('#alert-message').textContent = message;
    openSheet('alert');
  }

  // ---------- player view ----------

  // The player replaces the library, like a now-playing screen. The browser's
  // Back button returns to the library.
  function showPlayer() {
    renderPlayer();
    renderContents();
    $('#player').hidden = false;
    document.body.classList.add('view-player');
    scrollTo(0, 0);
    if (!history.state?.player) history.pushState({ player: true }, '');
  }
  function hidePlayer() {
    $('#player').hidden = true;
    document.body.classList.remove('view-player');
    renderLibrary();
  }
  function closePlayer() {
    if (history.state?.player) history.back(); else hidePlayer();
  }
  addEventListener('popstate', (event) => {
    if (event.state?.player && state.book) showPlayer(); else hidePlayer();
  });

  // ---------- mini player window ----------

  // A small always-on-top window (Document Picture-in-Picture), where the
  // browser supports it.
  const miniWindowSupported = 'documentPictureInPicture' in window;
  let miniWindow = null;
  let miniArtworkOnly = false;

  async function toggleMiniWindow() {
    if (miniWindow) { miniWindow.close(); return; }
    if (!miniWindowSupported || !state.book) return;
    let opened;
    try {
      opened = await window.documentPictureInPicture.requestWindow({ width: 380, height: 200 });
    } catch { return; }
    const link = opened.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('app.css', location.href).href;
    opened.document.head.append(link);
    opened.document.title = 'Hinterland';
    opened.document.documentElement.lang = 'en';
    opened.document.body.className = 'pip';
    opened.document.addEventListener('click', async (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.action === 'toggle') await togglePlayback();
      else if (target.dataset.action === 'back') await skip(-15);
      else if (target.dataset.action === 'forward') await skip(30);
      else if (target.dataset.action === 'pip-artwork') {
        miniArtworkOnly = !miniArtworkOnly;
        try { opened.resizeTo(miniArtworkOnly ? 260 : 380, miniArtworkOnly ? 260 : 200); } catch { /* size is the browser's choice */ }
        renderMiniWindow();
      }
    });
    opened.addEventListener('pagehide', () => { miniWindow = null; miniArtworkOnly = false; });
    miniWindow = opened;
    renderMiniWindow();
  }

  function renderMiniWindow() {
    if (!miniWindow) return;
    const book = state.book;
    if (!book) { miniWindow.close(); return; }
    const duration = Number.isFinite(audio.duration) ? audio.duration : (state.track?.duration || 0);
    const position = audio.currentTime || 0;
    const subtitle = currentChapterTitle() || (state.track ? stem(state.track.name) : 'Ready to listen');
    const disabled = !state.track || state.loading || state.completed ? 'disabled' : '';
    miniWindow.document.body.classList.toggle('pip-artwork-only', miniArtworkOnly);
    miniWindow.document.body.innerHTML = `
      <div class="pip-card">
        <div class="pip-head">
          <button class="pip-artwork" data-action="pip-artwork" aria-label="${miniArtworkOnly ? 'Show controls' : 'Show cover only'}">${artworkHTML(book, miniArtworkOnly ? 220 : 56)}</button>
          <div class="pip-text"><p class="pip-title">${escapeHTML(book.title)}</p><p class="pip-sub" id="pip-sub">${escapeHTML(subtitle)}</p></div>
        </div>
        <div class="pip-progress" aria-hidden="true"><span id="pip-bar" style="width:${duration ? (position / duration) * 100 : 0}%"></span></div>
        <div class="pip-times"><span id="pip-elapsed">${clock(position)}</span><span id="pip-remaining">−${clock(Math.max(0, duration - position))}</span></div>
        <div class="pip-controls">
          <button class="skip" data-action="back" aria-label="Rewind 15 seconds" ${disabled}>${skipIcon('back', '15')}</button>
          <button class="pip-play" data-action="toggle" aria-label="${audio.paused ? 'Play' : 'Pause'}" ${disabled}>${audio.paused ? PLAY : PAUSE}</button>
          <button class="skip" data-action="forward" aria-label="Forward 30 seconds" ${disabled}>${skipIcon('forward', '30')}</button>
        </div>
      </div>`;
  }

  // ---------- mascot ----------

  // The companion from Brand/mascot.svg, drawn inline so its body and eyes can
  // move. One requestAnimationFrame loop animates every mascot on the page with
  // the behaviour of MascotView.swift in the app: it breathes, blinks, glances
  // around, follows the pointer, bounces when the pointer arrives and hops when
  // clicked. Moods: idle, thinking, happy, listening, sleepy, celebrating.
  // Brand/BRAND.md ("Motion") describes it. Lengths are artwork units.
  let mascotCount = 0;
  function mascotHTML(mood, size) {
    const id = `m${mascotCount += 1}`;
    const outline = 'M229 663 C213 557 223 374 250 267 C257 239 277 230 299 248 L376 310 C455 284 552 283 631 306 L710 243 C732 225 753 237 760 266 C787 374 800 558 785 663 C772 751 710 805 626 818 C555 830 467 829 393 817 C306 803 242 750 229 663 Z';
    const eye = (x) => `<g class="mascot-eye"><ellipse cx="${x}" cy="537" rx="23" ry="34" fill="#48271F"/><ellipse class="mascot-glint" cx="${x - 7}" cy="527" rx="6" ry="8" fill="#FFF0DA" opacity=".7"/></g>`;
    const closed = (x) => `M${x - 25} 556Q${x} 568 ${x + 25} 556`;
    const squint = (x) => `M${x - 26.5} 545.5Q${x} 510 ${x + 26.5} 545.5`;
    // Lines never thinner than one pixel, however small the companion.
    const hairline = 724 / size;
    requestMascotFrame();
    return `<svg class="mascot" data-mood="${mood}" width="${size}" height="${size}" viewBox="150 170 724 724" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}b" x1=".18" y1=".02" x2=".83" y2="1"><stop stop-color="#FFAE6D"/><stop offset=".47" stop-color="#F6813D"/><stop offset="1" stop-color="#D85120"/></linearGradient>
        <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFD1A0"/><stop offset="1" stop-color="#F58A49"/></linearGradient>
        <linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFC090"/><stop offset="1" stop-color="#A93A1D"/></linearGradient>
        <clipPath id="${id}l"><rect class="mascot-lid" x="360" y="380" width="290" height="260"/></clipPath>
      </defs>
      <ellipse class="mascot-shadow" cx="507" cy="846" rx="230" ry="26" fill="#6A2514" opacity=".16"/>
      <g class="mascot-body">
        <path d="${outline}" fill="url(#${id}e)"/>
        <path d="M241 644 C225 541 235 377 261 275 C265 258 276 253 289 264 L373 331 C454 302 557 300 634 327 L719 260 C731 251 742 258 746 275 C772 378 786 541 771 644 C760 723 706 775 626 790 C556 803 466 803 396 790 C316 775 253 723 241 644 Z" fill="url(#${id}b)"/>
        <path d="M632 327 L719 260 C731 251 742 258 746 275 C752 301 757 330 762 359 C718 345 671 343 632 327 Z" fill="url(#${id}f)" opacity=".84"/>
        <path d="M636 328 C670 343 718 346 760 359" fill="none" stroke="#B84C24" stroke-opacity=".24" stroke-width="5" stroke-linecap="round"/>
        <path d="M277 397 C286 353 300 318 313 304" fill="none" stroke="#FFD3A9" stroke-opacity=".3" stroke-width="12" stroke-linecap="round"/>
        <g class="mascot-eyes">
          <g class="mascot-open" clip-path="url(#${id}l)">${eye(427)}${eye(582)}</g>
          <path class="mascot-closed" d="${closed(427)}${closed(582)}" fill="none" stroke="#48271F" stroke-width="${Math.max(11, hairline).toFixed(1)}" stroke-linecap="round" opacity="0"/>
          <path class="mascot-squint" d="${squint(427)}${squint(582)}" fill="none" stroke="#48271F" stroke-width="${Math.max(14, hairline).toFixed(1)}" stroke-linecap="round" opacity="0"/>
        </g>
      </g>
    </svg>`;
  }

  const TAU = Math.PI * 2;
  const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

  // One hop `age` seconds in: a crouch, a stretched flight of `air` seconds, a
  // squashed landing. Writes into one shared result to keep frames allocation-free.
  const hopResult = { lift: 0, stretch: 0 };
  function hop(age, air, height, squash) {
    hopResult.lift = 0;
    hopResult.stretch = 0;
    if (age < 0) return hopResult;
    if (age < 0.09) { hopResult.stretch = -squash * Math.sin((Math.PI / 2) * (age / 0.09)); return hopResult; }
    const flight = (age - 0.09) / air;
    if (flight < 1) {
      hopResult.lift = height * Math.sin(Math.PI * flight);
      hopResult.stretch = squash * Math.abs(Math.cos(Math.PI * flight));
      return hopResult;
    }
    const settle = (age - 0.09 - air) / 0.16;
    if (settle < 1) hopResult.stretch = -1.2 * squash * Math.sin(Math.PI * settle);
    return hopResult;
  }

  // Openness through one blink that started `age` seconds ago: shut after `half`, open after twice that.
  function blinkOpenness(age, half) {
    if (age < 0 || age >= 2 * half) return 1;
    return age < half ? 1 - smooth(age / half) : smooth((age - half) / half);
  }

  // What a mood contributes to a frame, so two moods can cross-fade.
  const LAYER_KEYS = ['lift', 'tilt', 'stretch', 'open', 'gazeX', 'gazeY', 'gazeWeight', 'gazeScale', 'squint'];
  const LAYER_REST = { lift: 0, tilt: 0, stretch: 0, open: 1, gazeX: 0, gazeY: 0, gazeWeight: 0, gazeScale: 1, squint: 0 };
  // Celebrating: start, flight time, height and squash of each of three shrinking hops.
  const CELEBRATION_HOPS = [[0, 0.5, 130, 0.1], [0.72, 0.46, 95, 0.09], [1.38, 0.4, 60, 0.07]];

  // Pointer and taps, in viewport pixels; read once per frame by the loop.
  const mascotPointer = { x: 0, y: 0, active: false, movedAt: -100, touchX: 0, touchY: 0, touchUntil: -100 };

  class MascotBrain {
    constructor(svg) {
      const eyes = svg.querySelectorAll('.mascot-eye');
      const glints = svg.querySelectorAll('.mascot-glint');
      this.nodes = {
        body: svg.querySelector('.mascot-body'), shadow: svg.querySelector('.mascot-shadow'),
        eyes: svg.querySelector('.mascot-eyes'), open: svg.querySelector('.mascot-open'), lid: svg.querySelector('.mascot-lid'),
        closed: svg.querySelector('.mascot-closed'), squint: svg.querySelector('.mascot-squint'),
        left: eyes[0], right: eyes[1], glintLeft: glints[0], glintRight: glints[1],
      };
      // Offsets breathing and swaying so two companions are never in step.
      this.phase = Math.random() * TAU;
      this.started = false;
      this.lastTime = 0;
      this.mood = 'idle';
      this.previousMood = 'idle';
      this.moodStart = 0;
      this.gazeX = 0; this.gazeY = 0; this.gazeVelocityX = 0; this.gazeVelocityY = 0;
      this.glanceX = 0; this.glanceY = 0; this.glanceUntil = -100; this.nextGlance = 0;
      this.blinkStart = -100; this.secondBlinkStart = -100; this.nextBlink = 0;
      this.nodStart = -100; this.nextNod = 0;
      this.softCloseStart = -100; this.nextSoftClose = 0;
      this.widen = 0;
      this.pointerX = 0; this.pointerY = 0; this.pointerActive = false; this.pointerInside = false; this.hoverStart = -100;
      this.touchX = 0; this.touchY = 0; this.touchActive = false;
      this.pokeStart = -100;
      this.aimX = 0; this.aimY = 0;
      this.layer = { ...LAYER_REST };
      this.earlier = { ...LAYER_REST };
      this.pose = { lift: 0, dx: 0, tilt: 0, stretch: 0, gazeX: 0, gazeY: 0, open: 1, eyeScale: 1, squint: false };
    }

    // A look target towards a point in artwork units: full reach half the artwork
    // away, easing off a little for points far across a large window.
    aim(ux, uy, pixelsPerUnit) {
      const dx = ux - 504.5;
      const dy = uy - 537;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) { this.aimX = 0; this.aimY = 0; return; }
      const pixels = distance * pixelsPerUnit;
      const near = Math.min(1, distance / 512);
      const far = pixels < 700 ? 1 : Math.max(0.45, 1 - (pixels - 700) / 1600);
      const reach = (near * far) / distance;
      this.aimX = dx * reach;
      this.aimY = dy * reach;
    }

    sense(rect, t) {
      const unitsPerPixel = 724 / rect.width;
      if (mascotPointer.active) {
        const ux = 150 + (mascotPointer.x - rect.left) * unitsPerPixel;
        const uy = 170 + (mascotPointer.y - rect.top) * unitsPerPixel;
        this.aim(ux, uy, 1 / unitsPerPixel);
        this.pointerX = this.aimX;
        this.pointerY = this.aimY;
        this.pointerActive = true;
        const inside = ux > 235 && ux < 780 && uy > 250 && uy < 815;
        if (inside && !this.pointerInside && t - this.hoverStart > 0.7) this.hoverStart = t;
        this.pointerInside = inside;
      } else {
        this.pointerActive = false;
        this.pointerInside = false;
      }
      this.touchActive = t < mascotPointer.touchUntil;
      if (this.touchActive) {
        this.aim(150 + (mascotPointer.touchX - rect.left) * unitsPerPixel, 170 + (mascotPointer.touchY - rect.top) * unitsPerPixel, 1 / unitsPerPixel);
        this.touchX = this.aimX;
        this.touchY = this.aimY;
      }
    }

    start(t, mood) {
      this.started = true;
      this.lastTime = t;
      this.mood = mood;
      this.previousMood = mood;
      this.moodStart = t;
      this.nextBlink = t + 0.6 + 2.4 * Math.random();
      this.nextGlance = t + 1 + 3 * Math.random();
      this.nextNod = t + 2 + 3 * Math.random();
      this.nextSoftClose = t + 3 + 4 * Math.random();
    }

    moodLayer(layer, mood, t, since) {
      Object.assign(layer, LAYER_REST);
      const sleepy = mood === 'sleepy';
      layer.stretch = (sleepy ? 0.045 : 0.035) * Math.sin((TAU * t) / (sleepy ? 5.6 : 3.6) + this.phase);
      switch (mood) {
        case 'thinking': {
          const cycle = (TAU * t) / 3.2 + this.phase;
          layer.tilt = 5 * Math.sin(cycle);
          layer.lift = 4 * (0.5 - 0.5 * Math.cos(2 * cycle));
          layer.gazeX = 0.75 * Math.sin(cycle + 0.9);
          layer.gazeY = -0.85;
          layer.gazeWeight = 0.9;
          break;
        }
        case 'happy': {
          const bounce = hop(since % 1.5, 0.4, 55, 0.07);
          layer.lift = bounce.lift;
          layer.stretch += bounce.stretch;
          layer.squint = 1;
          break;
        }
        case 'listening': {
          const beat = 0.5 - 0.5 * Math.cos((TAU * t) / 1.05);
          layer.lift = -7 * beat;
          layer.stretch -= 0.02 * beat;
          layer.tilt = 2.5 * Math.sin((TAU * t) / 2.1 + this.phase);
          layer.open = 0.9 * (1 - 0.85 * this.softClose(t));
          layer.gazeScale = 0.7;
          break;
        }
        case 'sleepy': {
          const droop = this.nod(t);
          layer.open = 0.42 * (1 - 0.9 * droop);
          layer.lift = -16 * droop;
          layer.tilt = 1.5 * Math.sin((TAU * t) / 7 + this.phase) + 3 * droop;
          layer.gazeScale = 0.45;
          break;
        }
        case 'celebrating': {
          for (const [start, air, height, squash] of CELEBRATION_HOPS) {
            const bounce = hop(since - start, air, height, squash);
            layer.lift += bounce.lift;
            layer.stretch += bounce.stretch;
          }
          if (since < 2.1) layer.tilt = 9 * Math.sin((TAU * since) / 0.72) * (1 - since / 2.1);
          layer.squint = since < 2.4 ? 1 : 0;
          break;
        }
        default:
          break;
      }
      return layer;
    }

    step(t, mood) {
      if (!this.started) this.start(t, mood);
      const dt = Math.min(Math.max(t - this.lastTime, 0), 0.25);
      this.lastTime = t;
      if (mood !== this.mood) {
        this.previousMood = this.mood;
        this.mood = mood;
        this.moodStart = t;
        this.nodStart = -100;
        this.softCloseStart = -100;
        this.nextNod = t + 2 + 3 * Math.random();
        this.nextSoftClose = t + 3 + 4 * Math.random();
      }
      const since = t - this.moodStart;
      const layer = this.moodLayer(this.layer, mood, t, since);
      if (this.previousMood !== mood && since < 0.5) {
        const earlier = this.moodLayer(this.earlier, this.previousMood, t, since + 60);
        const weight = smooth(since / 0.5);
        for (const key of LAYER_KEYS) layer[key] = earlier[key] + (layer[key] - earlier[key]) * weight;
      }

      // Where to look: own glances, overridden by a recently moved pointer, then by a fresh tap.
      if (t >= this.nextGlance) this.pickGlance(t);
      let targetX = 0;
      let targetY = 0;
      if (t < this.glanceUntil) { targetX = this.glanceX; targetY = this.glanceY; }
      if (this.pointerActive && t - mascotPointer.movedAt < 6) { targetX = this.pointerX; targetY = this.pointerY; }
      if (this.touchActive) { targetX = this.touchX; targetY = this.touchY; }
      targetX *= layer.gazeScale;
      targetY *= layer.gazeScale;
      targetX += (layer.gazeX - targetX) * layer.gazeWeight;
      targetY += (layer.gazeY - targetY) * layer.gazeWeight;
      this.stepGaze(targetX, targetY, dt);

      // A full blink about every 2.5 to 6 seconds, sometimes twice.
      const half = mood === 'sleepy' ? 0.22 : 0.12;
      if (t >= this.nextBlink) {
        this.blinkStart = t;
        this.secondBlinkStart = Math.random() < 0.22 ? t + 2 * half + 0.08 : -100;
        this.nextBlink = t + (mood === 'sleepy' ? 4 : 2.5) + 3.5 * Math.random();
      }
      const blink = Math.min(blinkOpenness(t - this.blinkStart, half), blinkOpenness(t - this.secondBlinkStart, half));

      let lift = layer.lift;
      let stretch = layer.stretch;
      let tilt = layer.tilt;
      let squint = layer.squint > 0.5;

      // The pointer arriving: a quick bounce and wide eyes.
      const hoverAge = t - this.hoverStart;
      if (hoverAge < 0.6) {
        const bounce = hop(hoverAge, 0.24, 22, 0.06);
        lift += bounce.lift;
        stretch += bounce.stretch;
      }
      this.widen += ((this.pointerInside ? 0.12 : 0) - this.widen) * Math.min(1, dt * 8);
      let eyeScale = 1 + this.widen;
      if (hoverAge < 1.5) eyeScale += 0.2 * smooth(hoverAge / 0.1) * Math.exp(-2.5 * hoverAge);

      // A click or tap: a happy hop with squinting eyes, then back to the mood.
      const pokeAge = t - this.pokeStart;
      if (pokeAge < 0.85) {
        const jump = hop(pokeAge, 0.42, 80, 0.08);
        lift += jump.lift;
        stretch += jump.stretch;
        tilt += 5 * Math.sin((TAU * pokeAge) / 0.6) * (1 - pokeAge / 0.85);
        squint = true;
      }

      // Lean into the look.
      tilt += 4 * this.gazeX;
      lift -= 5 * this.gazeY;

      const pose = this.pose;
      pose.lift = lift;
      pose.dx = 12 * this.gazeX;
      pose.tilt = tilt;
      pose.stretch = stretch;
      pose.gazeX = this.gazeX;
      pose.gazeY = this.gazeY;
      pose.open = layer.open * blink;
      pose.eyeScale = eyeScale;
      pose.squint = squint;
      return pose;
    }

    // Reduced motion: a still pose per mood whose eyes point at the pointer.
    still(mood) {
      const pose = this.pose;
      Object.assign(pose, { lift: 0, dx: 0, tilt: 0, stretch: 0, gazeX: 0, gazeY: 0, open: 1, eyeScale: 1, squint: false });
      if (this.pointerActive) {
        pose.gazeX = Math.round(this.pointerX * 10) / 10;
        pose.gazeY = Math.round(this.pointerY * 10) / 10;
      }
      switch (mood) {
        case 'thinking': pose.gazeX = -0.5; pose.gazeY = -0.8; pose.tilt = -4; break;
        case 'happy': case 'celebrating': pose.squint = true; break;
        case 'listening': pose.open = 0.85; pose.gazeX *= 0.7; pose.gazeY *= 0.7; break;
        case 'sleepy': pose.open = 0.42; pose.gazeX *= 0.45; pose.gazeY *= 0.45; break;
        default: break;
      }
      return pose;
    }

    stepGaze(x, y, dt) {
      if (dt >= 0.2) {
        this.gazeX = x; this.gazeY = y; this.gazeVelocityX = 0; this.gazeVelocityY = 0;
        return;
      }
      // A slightly underdamped spring, so the eyes trail and settle with a hint of overshoot.
      for (let remaining = dt; remaining > 0; remaining -= 1 / 120) {
        const step = Math.min(remaining, 1 / 120);
        this.gazeVelocityX += (110 * (x - this.gazeX) - 15 * this.gazeVelocityX) * step;
        this.gazeVelocityY += (110 * (y - this.gazeY) - 15 * this.gazeVelocityY) * step;
        this.gazeX += this.gazeVelocityX * step;
        this.gazeY += this.gazeVelocityY * step;
      }
    }

    // A look around every 3 to 6 seconds: mostly sideways, sometimes up.
    pickGlance(t) {
      const pick = Math.random();
      const spread = Math.random() - 0.5;
      if (pick < 0.35) { this.glanceX = -0.8; this.glanceY = 0.3 * spread; }
      else if (pick < 0.7) { this.glanceX = 0.8; this.glanceY = 0.3 * spread; }
      else if (pick < 0.87) { this.glanceX = 0.8 * spread; this.glanceY = -0.75; }
      else { this.glanceX = 1.2 * spread; this.glanceY = 0.35; }
      this.glanceUntil = t + 0.7 + 0.9 * Math.random();
      this.nextGlance = t + 3 + 3 * Math.random();
    }

    // Sleepy: every 6 to 10 seconds the head droops slowly and lifts again.
    nod(t) {
      if (t >= this.nextNod) { this.nodStart = t; this.nextNod = t + 6 + 4 * Math.random(); }
      const age = t - this.nodStart;
      if (age >= 2.4) return 0;
      const x = age / 2.4;
      return x < 0.65 ? smooth(x / 0.65) : 1 - smooth((x - 0.65) / 0.35);
    }

    // Listening: now and then the eyes close softly for a moment.
    softClose(t) {
      if (t >= this.nextSoftClose) { this.softCloseStart = t; this.nextSoftClose = t + 7 + 5 * Math.random(); }
      const age = t - this.softCloseStart;
      if (age >= 1.8) return 0;
      if (age < 0.35) return smooth(age / 0.35);
      return age < 1.4 ? 1 : 1 - smooth((age - 1.4) / 0.4);
    }
  }

  function writeAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  // Transforms and opacity only: nothing here changes layout.
  function applyMascotPose(brain, pose) {
    const nodes = brain.nodes;
    const rise = Math.max(0, pose.lift);
    writeAttribute(nodes.body, 'transform', `translate(${pose.dx.toFixed(2)} ${(-pose.lift).toFixed(2)}) rotate(${pose.tilt.toFixed(2)} 507 818) translate(507 818) scale(${(1 - 0.75 * pose.stretch).toFixed(4)} ${(1 + pose.stretch).toFixed(4)}) translate(-507 -818)`);
    writeAttribute(nodes.shadow, 'transform', `translate(507 846) scale(${Math.max(0.55, 1 - rise / 320).toFixed(3)}) translate(-507 -846)`);
    writeAttribute(nodes.shadow, 'opacity', (0.16 * Math.max(0.45, 1 - rise / 260)).toFixed(3));
    writeAttribute(nodes.eyes, 'transform', `translate(${(pose.gazeX * 50).toFixed(2)} ${(pose.gazeY * 34).toFixed(2)})`);
    const shape = pose.squint ? 'squint' : pose.open < 0.14 ? 'closed' : 'open';
    writeAttribute(nodes.open, 'opacity', shape === 'open' ? '1' : '0');
    writeAttribute(nodes.closed, 'opacity', shape === 'closed' ? '1' : '0');
    writeAttribute(nodes.squint, 'opacity', shape === 'squint' ? '1' : '0');
    if (shape !== 'open') return;
    // The upper lid comes down flat, so half-open reads as drowsy rather than small.
    const scale = pose.eyeScale;
    const lid = 537 - 34 * scale + (1 - pose.open) * 68 * scale;
    writeAttribute(nodes.lid, 'transform', `translate(0 ${(lid - 380).toFixed(2)})`);
    writeAttribute(nodes.left, 'transform', `translate(427 537) scale(${scale.toFixed(3)}) translate(-427 -537)`);
    writeAttribute(nodes.right, 'transform', `translate(582 537) scale(${scale.toFixed(3)}) translate(-582 -537)`);
    const glint = pose.open > 0.55 ? '.7' : '0';
    writeAttribute(nodes.glintLeft, 'opacity', glint);
    writeAttribute(nodes.glintRight, 'opacity', glint);
  }

  // The single loop: read every mascot's box first, then write transforms, so
  // frames never force a layout. It stops when the tab is hidden or no mascot
  // is on the page; with reduced motion it runs only when the pointer or a mood changes.
  const mascotElements = document.getElementsByClassName('mascot');
  const mascotBrains = new WeakMap();
  const mascotRects = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let mascotFrame = 0;

  function requestMascotFrame() {
    if (!mascotFrame && !document.hidden) mascotFrame = requestAnimationFrame(drawMascots);
  }

  function drawMascots(milliseconds) {
    mascotFrame = 0;
    const t = milliseconds / 1000;
    const count = mascotElements.length;
    const reduced = reducedMotion.matches;
    for (let i = 0; i < count; i += 1) mascotRects[i] = mascotElements[i].getBoundingClientRect();
    for (let i = 0; i < count; i += 1) {
      const svg = mascotElements[i];
      const rect = mascotRects[i];
      if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) continue;
      let brain = mascotBrains.get(svg);
      if (!brain) { brain = new MascotBrain(svg); mascotBrains.set(svg, brain); }
      brain.sense(rect, t);
      const mood = svg.dataset.mood;
      applyMascotPose(brain, reduced ? brain.still(mood) : brain.step(t, mood));
    }
    mascotRects.length = 0;
    if (count && !reduced) requestMascotFrame();
  }

  addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    mascotPointer.x = event.clientX;
    mascotPointer.y = event.clientY;
    mascotPointer.active = true;
    mascotPointer.movedAt = performance.now() / 1000;
    if (reducedMotion.matches) requestMascotFrame();
  }, { passive: true });
  document.addEventListener('mouseout', (event) => {
    if (event.relatedTarget) return;
    mascotPointer.active = false;
    requestMascotFrame();
  });
  // A click or tap on a mascot is a poke; anywhere else it is a reason to glance over.
  addEventListener('pointerdown', (event) => {
    const now = performance.now() / 1000;
    const svg = event.target instanceof Element ? event.target.closest('svg.mascot') : null;
    const brain = svg && mascotBrains.get(svg);
    if (brain) {
      brain.pokeStart = now;
    } else {
      mascotPointer.touchX = event.clientX;
      mascotPointer.touchY = event.clientY;
      mascotPointer.touchUntil = now + 1.6;
    }
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', requestMascotFrame);
  reducedMotion.addEventListener?.('change', requestMascotFrame);

  function setMascotMood(svg, mood) {
    if (!svg || svg.dataset.mood === mood) return;
    svg.dataset.mood = mood;
    requestMascotFrame();
  }

  // The header companion reflects the app: a brief celebration after a book is
  // added or finished, thinking during an import, sleepy while a sleep timer is
  // set, listening while audio plays.
  let celebrateUntil = 0;
  function appMascotMood() {
    if (performance.now() < celebrateUntil) return 'celebrating';
    if (state.pending?.busy) return 'thinking';
    if (state.sleepDeadline) return 'sleepy';
    return audio.paused ? 'idle' : 'listening';
  }
  function updateMascotMoods() {
    setMascotMood($('#title-mascot .mascot'), appMascotMood());
  }
  function celebrate() {
    celebrateUntil = performance.now() + 2800;
    updateMascotMoods();
    setTimeout(updateMascotMoods, 2850);
  }

  // ---------- rendering ----------

  function renderLibrary() {
    const library = $('#library');
    if (!state.books.length) {
      library.innerHTML = `
        <div class="empty">
          ${mascotHTML('idle', 172)}
          <h2 class="serif">A little room to listen</h2>
          <p class="empty-lead">Add your first audiobook</p>
          <p class="empty-body">Bring an audio file or a folder from your computer or phone. Hinterland keeps your place, even when you close the page.</p>
          <button class="prominent" data-action="add">${icon('plus', 18)} Add audiobook</button>
          <p class="hint">MP3, M4A and M4B. Your files stay in this browser and are never uploaded.</p>
        </div>`;
      return;
    }
    library.innerHTML = `
      <section class="book-list" aria-label="Your books">
        <h2 class="section-header">YOUR BOOKS</h2>
        <ul>${state.books.map((book) => `
          <li>
            <button class="book-row" data-open="${book.id}">
              ${artworkHTML(book, 66)}
              <span class="book-text">
                <span class="book-title">${escapeHTML(book.title)}</span>
                ${book.author ? `<span class="book-author">${escapeHTML(book.author)}</span>` : ''}
                <span class="book-meta">${rowProgressText(book)} · On this device</span>
              </span>
              ${icon('chevron', 14)}
            </button>
            <button class="row-more" data-more="${book.id}" aria-label="More actions for ${escapeHTML(book.title)}">${icon('more', 20)}</button>
          </li>`).join('')}
        </ul>
        <p class="section-footer">Your listening position is saved in this browser.</p>
      </section>`;
  }

  function renderMini() {
    const mini = $('#mini');
    const book = state.book;
    mini.hidden = !book;
    document.body.classList.toggle('has-mini', Boolean(book));
    if (!book) return;
    const subtitle = currentChapterTitle() || (state.track ? stem(state.track.name) : 'Ready to listen');
    mini.innerHTML = `
      <div class="mini-card">
        <button class="mini-open" data-action="open-player" aria-label="Open player for ${escapeHTML(book.title)}">
          ${artworkHTML(book, 43)}
          <span class="mini-text"><span class="mini-title">${escapeHTML(book.title)}</span><span class="mini-sub">${escapeHTML(subtitle)}</span></span>
        </button>
        <button class="mini-play" data-action="toggle" aria-label="${audio.paused ? 'Play' : 'Pause'}" ${state.loading || state.completed || !state.track ? 'disabled' : ''}>${audio.paused ? PLAY : PAUSE}</button>
        <span class="mini-progress" aria-hidden="true"><span style="width:${((liveProgress() ?? 0) * 100).toFixed(2)}%"></span></span>
      </div>`;
  }

  function renderPlayer() {
    const body = $('#player-body');
    const book = state.book;
    if (!book) { body.innerHTML = '<p class="unavailable">No book selected</p>'; return; }
    const index = trackIndex();
    const many = book.tracks.length > 1;
    const disabled = !state.track || state.loading || state.completed ? 'disabled' : '';
    const duration = Number.isFinite(audio.duration) ? audio.duration : (state.track?.duration || 0);
    const position = state.scrubbing ?? (audio.currentTime || 0);
    const progress = liveProgress();
    const sleep = sleepMinutesRemaining();
    const chapter = currentChapterTitle();
    body.innerHTML = `
      <div class="player-head">
        ${artworkHTML(book, 205)}
        <h2 class="serif player-title">${escapeHTML(book.title)}</h2>
        ${book.author ? `<p class="player-author">${escapeHTML(book.author)}</p>` : ''}
      </div>
      ${state.completed ? `
        <div class="notice">
          <p class="notice-title">${icon('check', 20)} Finished listening</p>
          <button class="link" data-action="restart">Listen again</button>
        </div>` : ''}
      <div class="track-detail">
        <p class="track-title" id="player-chapter">${escapeHTML(chapter || (state.track ? stem(state.track.name) : 'Preparing audio…'))}</p>
        ${many && index >= 0 ? `<p class="track-sub">Track ${index + 1} of ${book.tracks.length} · ${escapeHTML(stem(state.track.name))}</p>` : ''}
      </div>
      <div class="scrubber">
        <input type="range" id="scrub" min="0" max="${Math.max(duration, 1)}" step="any" value="${position}" aria-label="Track position"
          aria-valuetext="${clock(position)} of ${clock(duration)}" ${duration <= 0 || !state.track || state.loading ? 'disabled' : ''}>
        <div class="times"><span id="elapsed">${clock(position)}</span><span id="remaining">−${clock(Math.max(0, duration - position))}</span></div>
      </div>
      <div class="transport">
        <button class="skip" data-action="back" aria-label="Rewind 15 seconds" ${disabled}>${skipIcon('back', '15')}</button>
        <button class="play" data-action="toggle" aria-label="${audio.paused ? 'Play' : 'Pause'}" ${disabled}>${state.loading ? '<span class="spinner"></span>' : (audio.paused ? PLAY : PAUSE)}</button>
        <button class="skip" data-action="forward" aria-label="Forward 30 seconds" ${disabled}>${skipIcon('forward', '30')}</button>
      </div>
      ${many && progress !== null ? `
        <div class="overall">
          <div class="overall-labels"><span>Across this book</span><span id="overall-percent">${Math.floor(progress * 100)}%</span></div>
          <progress id="overall-bar" max="1" value="${progress}" aria-label="Overall book progress"></progress>
        </div>` : ''}
      <div class="options">
        <button class="option-row" data-action="contents">${icon('list', 20)} Chapters &amp; tracks</button>
        <div class="option-pair">
          <label class="menu">${icon('speed', 20)} <span>${speedText(state.speed)} Speed</span>
            <select id="speed" aria-label="Playback speed, ${state.speed} times">${SPEEDS.map((v) => `<option value="${v}" ${v === state.speed ? 'selected' : ''}>${speedText(v)}</option>`).join('')}</select>
          </label>
          <label class="menu">${icon('moon', 20)} <span>${sleep ? `${sleep} min Sleep` : 'Sleep timer'}</span>
            <select id="sleep" aria-label="Sleep timer"><option value="">Off</option>${SLEEP_MINUTES.map((m) => `<option value="${m}">${m} minutes</option>`).join('')}</select>
          </label>
        </div>
      </div>`;
    if (!state.sleepDeadline) $('#sleep', body).value = '';
    else $('#sleep', body).selectedIndex = -1;
  }

  // Cheap update on every audio tick: the time read-outs only.
  function renderProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const position = state.scrubbing ?? (audio.currentTime || 0);
    const progress = liveProgress();
    const scrub = $('#scrub');
    if (scrub) {
      if (state.scrubbing === null) scrub.value = position;
      scrub.setAttribute('aria-valuetext', `${clock(position)} of ${clock(duration)}`);
      $('#elapsed').textContent = clock(position);
      $('#remaining').textContent = `−${clock(Math.max(0, duration - position))}`;
      const chapter = $('#player-chapter');
      const text = currentChapterTitle() || (state.track ? stem(state.track.name) : '');
      if (chapter && text && chapter.textContent !== text) { chapter.textContent = text; updateMediaSession(); renderMini(); renderContents(); renderMiniWindow(); }
    }
    const bar = $('#overall-bar');
    if (bar && progress !== null) { bar.value = progress; $('#overall-percent').textContent = `${Math.floor(progress * 100)}%`; }
    const mini = $('#mini .mini-progress span');
    if (mini && progress !== null) mini.style.width = `${(progress * 100).toFixed(2)}%`;
    if (miniWindow) {
      const pip = miniWindow.document;
      const pipBar = pip.getElementById('pip-bar');
      if (pipBar) {
        pipBar.style.width = `${duration ? (position / duration) * 100 : 0}%`;
        pip.getElementById('pip-elapsed').textContent = clock(position);
        pip.getElementById('pip-remaining').textContent = `−${clock(Math.max(0, duration - position))}`;
      }
    }
    if ('mediaSession' in navigator && duration > 0 && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, duration) }); } catch { /* not ready */ }
    }
  }

  function renderPlayback() {
    // Re-rendering while a native menu is open would close it.
    const focused = document.activeElement;
    if (!(focused && focused.tagName === 'SELECT' && $('#player').contains(focused))) renderPlayer();
    renderMini();
    renderMiniWindow();
    updateMascotMoods();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  }

  function renderContents() {
    const book = state.book;
    if (!book) return;
    const time = audio.currentTime || 0;
    $('#contents-body').innerHTML = book.tracks.map((track, index) => {
      const current = state.track?.id === track.id;
      const currentChapter = current ? track.chapters.reduce((found, chapter, i) => (chapter.start <= time + 0.25 ? i : found), -1) : -1;
      return `
        <h3 class="section-header">TRACK ${index + 1} OF ${book.tracks.length}</h3>
        <ul class="plain-list">
          <li><button class="content-row ${current ? 'current' : ''}" data-track="${track.id}" data-start="0" ${current ? 'aria-current="true"' : ''}
              aria-label="Track ${index + 1}, ${escapeHTML(stem(track.name))}, ${durationText(track.duration)}">
            <span class="accent">${icon(current ? 'wave' : 'playCircle', 22)}</span>
            <span class="content-text"><span class="content-title">${escapeHTML(stem(track.name))}</span><span class="content-sub">${durationText(track.duration)}</span></span>
          </button></li>
          ${track.chapters.map((chapter, chapterIndex) => `
          <li><button class="content-row chapter ${chapterIndex === currentChapter ? 'current' : ''}" data-track="${track.id}" data-start="${chapter.start}" ${chapterIndex === currentChapter ? 'aria-current="true"' : ''}
              aria-label="Chapter ${escapeHTML(chapter.title)}, starts at ${clock(chapter.start)}">
            <span class="dot" aria-hidden="true"></span>
            <span class="content-title">${escapeHTML(chapter.title)}</span>
            <span class="content-time">${clock(chapter.start)}</span>
          </button></li>`).join('')}
        </ul>`;
    }).join('');
  }

  function renderReview() {
    const pending = state.pending;
    if (!pending) return;
    $('#review-count').textContent = `${pending.candidates.length} ${pending.candidates.length === 1 ? 'file' : 'files'}`;
    $('#review-list').innerHTML = pending.candidates.map((candidate, index) => `
      <li>
        <span class="order">${index + 1}</span>
        <span class="review-name">${escapeHTML(candidate.name)}</span>
        <span class="movers">
          <button data-move="${index}:-1" aria-label="Move ${escapeHTML(candidate.name)} up" ${index === 0 || pending.busy ? 'disabled' : ''}>${icon('up', 18)}</button>
          <button data-move="${index}:1" aria-label="Move ${escapeHTML(candidate.name)} down" ${index === pending.candidates.length - 1 || pending.busy ? 'disabled' : ''}>${icon('down', 18)}</button>
        </span>
      </li>`).join('');
    const status = $('#review-status');
    status.hidden = !pending.busy;
    // Keep the thinking companion between progress updates so its rhythm carries on.
    if (!pending.busy) status.innerHTML = '';
    else {
      if (!status.querySelector('.mascot')) status.innerHTML = `${mascotHTML('thinking', 56)}<div class="review-progress"><p></p><progress max="1"></progress></div>`;
      $('.review-progress p', status).textContent = pending.status || 'Preparing your book…';
      $('progress', status).value = pending.progress;
    }
    updateMascotMoods();
    const error = $('#review-error');
    error.hidden = !pending.error;
    error.innerHTML = pending.error ? `${icon('warn', 20)} <span>${escapeHTML(pending.error)}</span>` : '';
    $('#review-commit').disabled = pending.busy || !pending.candidates.length || !pending.title.trim();
  }

  async function renderSettings() {
    const bytes = state.books.reduce((sum, book) => sum + book.tracks.reduce((s, t) => s + (t.size || 0), 0), 0);
    $('#settings-storage').textContent = bytesText(bytes);
    let persisted = false;
    try { persisted = Boolean(await navigator.storage?.persisted?.()); } catch { /* unsupported */ }
    $('#settings-persist').textContent = persisted
      ? 'This browser has agreed to keep your books until you remove them.'
      : 'Your browser may clear stored books if the device runs low on space or you clear site data. Keep your original files.';
  }

  function renderAll() {
    renderLibrary();
    renderPlayer();
    renderMini();
    if (!$('#player').hidden) renderContents();
    renderMiniWindow();
  }

  // ---------- events ----------

  let actionBook = null;

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    const action = target.dataset.action;

    if (target.dataset.close) { closeSheet(target.dataset.close); return; }
    if (target.dataset.open) {
      const book = state.books.find((b) => b.id === target.dataset.open);
      if (book) { showPlayer(); await openBook(book); }
      return;
    }
    if (target.dataset.more) {
      actionBook = state.books.find((b) => b.id === target.dataset.more);
      $('#actions-title').textContent = actionBook.title;
      openSheet('actions');
      return;
    }
    if (target.dataset.move) {
      const [index, delta] = target.dataset.move.split(':').map(Number);
      moveCandidate(index, delta);
      return;
    }
    if (target.dataset.track) {
      const track = state.book.tracks.find((t) => t.id === target.dataset.track);
      if (track) await goTo(track, Number(target.dataset.start));
      return;
    }

    switch (action) {
      case 'add': openSheet('add'); break;
      case 'choose-files': closeSheet('add'); $('#pick-files').click(); break;
      case 'choose-folder': closeSheet('add'); $('#pick-folder').click(); break;
      case 'settings': await renderSettings(); openSheet('settings'); break;
      case 'open-player': showPlayer(); break;
      case 'close-player': closePlayer(); break;
      case 'mini-window': await toggleMiniWindow(); break;
      case 'toggle': await togglePlayback(); break;
      case 'back': await skip(-15); break;
      case 'forward': await skip(30); break;
      case 'restart': await restart(); break;
      case 'contents': $('#contents').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'review-cancel': state.pending = null; closeSheet('review'); break;
      case 'review-commit': await commitImport(); break;
      case 'rename':
        closeSheet('actions');
        $('#rename-title').value = actionBook.title;
        openSheet('rename');
        break;
      case 'rename-save': {
        const title = $('#rename-title').value.trim();
        if (!title) break;
        actionBook.title = title;
        await saveBook(actionBook);
        closeSheet('rename');
        renderAll();
        updateMediaSession();
        break;
      }
      case 'delete':
        closeSheet('actions');
        $('#delete-title').textContent = `Delete ${actionBook.title}?`;
        openSheet('delete');
        break;
      case 'delete-confirm':
        closeSheet('delete');
        if (!$('#player').hidden) closePlayer();
        await deleteBook(actionBook);
        break;
      default:
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'speed') { setSpeed(Number(event.target.value)); event.target.blur(); renderPlayback(); }
    if (event.target.id === 'sleep') { setSleepTimer(Number(event.target.value) || null); event.target.blur(); renderPlayback(); }
    if (event.target.id === 'scrub') {
      const value = Number(event.target.value);
      state.scrubbing = null;
      if (!state.completed && state.track) audio.currentTime = value;
      renderProgress();
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'scrub') { state.scrubbing = Number(event.target.value); renderProgress(); }
    if (event.target.id === 'review-title' && state.pending) { state.pending.title = event.target.value; $('#review-commit').disabled = state.pending.busy || !state.pending.candidates.length || !state.pending.title.trim(); }
  });

  for (const id of ['pick-files', 'pick-folder']) {
    $(`#${id}`).addEventListener('change', (event) => {
      const files = [...event.target.files];
      event.target.value = '';
      if (!files.length) return;
      const folder = id === 'pick-folder' ? (files[0].webkitRelativePath.split('/')[0] || null) : null;
      prepareImport(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })), folder);
    });
  }

  // A cancelled dialog (Escape) must not leave an import half-open.
  $('#review').addEventListener('close', () => { state.pending = null; updateMascotMoods(); });
  $('#rename-form').addEventListener('submit', (event) => { event.preventDefault(); $('[data-action="rename-save"]').click(); });
  for (const sheet of document.querySelectorAll('dialog')) {
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet && sheet.dataset.dismiss !== 'no') sheet.close();
    });
  }

  let dragDepth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (event) => { if (hasFiles(event)) { dragDepth += 1; document.body.classList.add('dragging'); } });
  addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (state.pending) return;
    const { files, folder } = await filesFromDrop(event.dataTransfer);
    if (files.length) prepareImport(files, folder);
  });

  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#player').hidden && !document.querySelector('dialog[open]')) { closePlayer(); return; }
    if (event.code !== 'Space' || !state.track) return;
    if (event.target.closest('input, textarea, select, button, a, summary')) return;
    event.preventDefault();
    togglePlayback();
  });

  // ---------- start ----------

  (async () => {
    const titleMascot = $('#title-mascot');
    if (titleMascot) titleMascot.innerHTML = mascotHTML(appMascotMood(), 44);
    try {
      database = await openDatabase();
      state.books = (await loadBooks()).sort((a, b) => b.created - a.created);
    } catch {
      $('#library').innerHTML = '<p class="unavailable">This browser is blocking storage for this page, so books cannot be saved here. Private browsing windows often do this. Open the page in a normal window.</p>';
      return;
    }
    renderAll();
    $('#mini-window-button').hidden = !miniWindowSupported;
    document.documentElement.classList.add('ready');
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
