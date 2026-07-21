const browserApi = typeof browser !== 'undefined' ? browser : chrome;
console.log('[Signergy] content script v5.1 loaded');

let signQueue = [];
let isDisplaying = false;
let overlay = null;
let signVideo = null;
let debugText = null;
let mutationObserver = null;
let showDebugInfo = false;
let dictionary = {};
let isOverlayEnabled = true;
const BASE_PATH_IN_REPO = "Signergy/Signs";

let captionDebounceTimer = null;
let transcriptHistory = "";

// Sync sign playback with the host video's play/pause state.
let mainVideo = null;
let isPaused = false;
let advanceTimer = null;
let advanceDeadline = 0;
let advanceRemaining = 0;

function initializeOverlay() {
    if (document.getElementById('sign-language-overlay')) return;
    if (!document.body) return;

    // Mobile-aware adjustments
    const isMobile = window.innerWidth < 768;
    const overlaySize = isMobile ? '150px' : '200px';
    const initialTop = `calc(100vh - ${isMobile ? 230 : 280}px)`;
    const initialLeft = `calc(100vw - ${isMobile ? 170 : 220}px)`;

    overlay = document.createElement('div');
    overlay.id = 'sign-language-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = initialTop;
    overlay.style.left = initialLeft;
    overlay.style.width = overlaySize;
    overlay.style.height = overlaySize;
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.border = '2px solid #a78bfa';
    overlay.style.borderRadius = '10px';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.color = 'white';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.cursor = 'move';
    overlay.innerHTML = '<p>Loading Dictionary...</p>';
    document.body.appendChild(overlay);

    debugText = document.createElement('p');
    debugText.style.position = 'absolute';
    debugText.style.bottom = '5px';
    debugText.style.left = '5px';
    debugText.style.fontSize = '10px';
    debugText.style.color = '#cccccc';
    debugText.style.margin = '0';
    debugText.style.fontFamily = 'monospace';
    debugText.style.display = 'none';
    overlay.appendChild(debugText);
    
    signVideo = document.createElement('video');
    signVideo.style.display = 'none';
    signVideo.style.maxWidth = '100%';
    signVideo.style.maxHeight = '100%';
    signVideo.autoplay = true;
    signVideo.muted = true;
    signVideo.loop = false;
    signVideo.playbackRate = 2.5;
    signVideo.playsInline = true; // Essential for mobile browsers
    overlay.appendChild(signVideo);

    let isDragging = false;
    let offsetX, offsetY;
    
    // Combined touch and mouse event handlers
    const dragStart = (e) => {
        isDragging = true;
        const event = e.touches ? e.touches[0] : e;
        offsetX = event.clientX - overlay.getBoundingClientRect().left;
        offsetY = event.clientY - overlay.getBoundingClientRect().top;
        e.preventDefault();
    };
    const dragMove = (e) => {
        if (!isDragging) return;
        const event = e.touches ? e.touches[0] : e;
        overlay.style.left = `${event.clientX - offsetX}px`;
        overlay.style.top = `${event.clientY - offsetY}px`;
    };
    const dragEnd = () => { isDragging = false; };

    overlay.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    overlay.addEventListener('touchstart', dragStart, { passive: false });
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
}

function processNewText(text) {
    const cleanedText = text.toLowerCase().replace(/[^\w\s']/g, '').trim();
    if (!cleanedText) return;

    let matchedSentenceKey = null;

    if (dictionary.sentences) {
        for (const sentenceKey in dictionary.sentences) {
            if (cleanedText.includes(sentenceKey)) {
                if (!matchedSentenceKey || sentenceKey.length > matchedSentenceKey.length) {
                    matchedSentenceKey = sentenceKey;
                }
            }
        }
    }

    if (matchedSentenceKey) {
        addSignToQueue(matchedSentenceKey, 'sentences');
    } else {
        const words = cleanedText.split(/\s+/);
        words.forEach(word => {
            let wordFound = false;
            if (dictionary.words && dictionary.words[word]) {
                addSignToQueue(word, 'words');
                wordFound = true;
            }
            if (!wordFound && dictionary.letters) {
                for (const letter of word) {
                    if (dictionary.letters[letter]) {
                        addSignToQueue(letter, 'letters');
                    }
                }
            }
        });
    }

    if (!isDisplaying && !isPaused) {
        displayNextSign();
    }
}

function addSignToQueue(key, category) {
    const fileName = dictionary[category]?.[key];
    if (fileName) {
        const url = `https://raw.githubusercontent.com/${dictionary._repo_user}/${dictionary._repo_name}/main/${BASE_PATH_IN_REPO}/${category}/${fileName}`;
        signQueue.push({ key, fileName, url, category });
        console.log(`[Signergy] queued ${category}: "${key}" -> ${fileName} (queue=${signQueue.length})`);
    }
}

// Attach play/pause listeners to the host video so signs freeze when it pauses.
function hookMainVideo() {
    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!v || v === mainVideo) return;
    mainVideo = v;
    isPaused = v.paused;
    v.addEventListener('pause', onMainPause);
    v.addEventListener('play', onMainPlay);
    console.log('[Signergy] hooked host video (paused=' + isPaused + ')');
}

function onMainPause() {
    if (isPaused) return;
    isPaused = true;
    if (signVideo && !signVideo.paused) signVideo.pause();
    if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
        advanceRemaining = Math.max(0, advanceDeadline - performance.now());
    }
    console.log('[Signergy] host paused — signs frozen');
}

function onMainPlay() {
    if (!isPaused) return;
    isPaused = false;
    if (signVideo && signVideo.style.display === 'block' && signVideo.src && signVideo.paused) {
        signVideo.play().catch(() => {});
    }
    if (isDisplaying && advanceRemaining > 0) {
        scheduleAdvance(advanceRemaining);
    } else {
        displayNextSign();
    }
    console.log('[Signergy] host resumed — signs playing');
}

function scheduleAdvance(delay) {
    clearTimeout(advanceTimer);
    advanceRemaining = delay;
    advanceDeadline = performance.now() + delay;
    advanceTimer = setTimeout(() => { advanceTimer = null; displayNextSign(); }, delay);
}

function displayNextSign() {
    if (!overlay || !isOverlayEnabled) {
        isDisplaying = false;
        return;
    }

    // Hold on the current frame while the host video is paused.
    if (isPaused) return;

    if (signQueue.length === 0) {
        isDisplaying = false;
        setTimeout(() => {
            if (signQueue.length === 0 && overlay) {
                signVideo.style.display = 'none';
                debugText.style.display = 'none';
                overlay.querySelector('p').style.display = 'block';
                overlay.querySelector('p').textContent = 'Waiting for captions...';
            }
        }, 2000);
        return;
    }

    isDisplaying = true;
    const sign = signQueue.shift();
    
    overlay.querySelector('p').style.display = 'none';
    if (!signVideo.paused) signVideo.pause();

    signVideo.style.display = 'block';
    if (showDebugInfo) {
        debugText.textContent = sign.fileName;
        debugText.style.display = 'block';
    }

    console.log(`[Signergy] playing ${sign.category}: ${sign.fileName}`);
    const onVideoReady = () => {
        const durationInSeconds = signVideo.duration / signVideo.playbackRate;
        const delay = sign.category === 'letters'
            ? (durationInSeconds * 1000) * 0.5
            : (durationInSeconds * 1000) + 200;

        // If the host paused while this sign was loading, freeze here; onMainPlay resumes.
        if (isPaused) {
            signVideo.pause();
            advanceRemaining = delay;
            return;
        }

        signVideo.play().catch(e => console.error("[Signergy] Video play failed:", e));
        scheduleAdvance(delay);
    };
    const onVideoError = () => {
        console.error(`[Signergy] Failed to load video: ${sign.fileName} (${sign.url})`);
        displayNextSign();
    };

    signVideo.addEventListener('loadeddata', onVideoReady, { once: true });
    signVideo.addEventListener('error', onVideoError, { once: true });
    signVideo.src = sign.url;
}

let observedNode = null;
let currentSite = '';
let captionWatchStarted = false;

function findCaptionContainer() {
    const hostname = window.location.hostname;

    if (hostname === 'www.youtube.com') {
        currentSite = 'youtube-desktop';
        return document.querySelector('.ytp-caption-window-container');
    } else if (hostname === 'm.youtube.com') {
        currentSite = 'youtube-mobile';
        const mobileSelectors = ['.ytm-timed-text-container', '.caption-window', '.player-timed-text-container'];
        for (const selector of mobileSelectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
    } else if (hostname === 'meet.google.com') {
        currentSite = 'meet';
        const meetSelectors = ['[jsname="dsdcsc"]', '.a4cQT', '.adErb', '.ADivge[data-is-captions]'];
        for (const selector of meetSelectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
    }
    return null;
}

function readTranscript(container, site) {
    if (site === 'meet') {
        let t = '';
        container.querySelectorAll('.ygicle.VbkSUe').forEach(el => { t += el.textContent + ' '; });
        return t.replace(/\s+/g, ' ').trim();
    }
    // Handles both youtube-desktop and youtube-mobile
    return container.textContent.replace(/\s+/g, ' ').trim();
}

function handleTranscript(container, site) {
    const fullTranscript = readTranscript(container, site);
    if (!fullTranscript || fullTranscript === transcriptHistory) return;

    let newText = '';
    if (fullTranscript.startsWith(transcriptHistory)) {
        newText = fullTranscript.substring(transcriptHistory.length);
    } else {
        newText = fullTranscript;
    }

    if (newText.trim()) {
        console.log('[Signergy] new caption text:', JSON.stringify(newText.trim()));
        processNewText(newText);
    }
    transcriptHistory = fullTranscript;
}

function attachObserver(container, site) {
    if (mutationObserver) mutationObserver.disconnect();
    observedNode = container;

    if (overlay) {
        const p = overlay.querySelector('p');
        if (p && (p.textContent === 'Waiting for captions...' || p.textContent === 'Loading Dictionary...')) {
            p.textContent = 'Observer active!';
        }
    }

    mutationObserver = new MutationObserver(() => {
        clearTimeout(captionDebounceTimer);
        captionDebounceTimer = setTimeout(() => handleTranscript(container, site), 750);
    });
    mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });
    console.log('[Signergy] observer attached to caption container:', container);

    // Process any captions already present at attach time.
    handleTranscript(container, site);
}

// The caption box is repeatedly torn down and rebuilt by YouTube (and by other
// player extensions), which would leave a one-shot observer watching a dead node.
// Poll for the current container and (re)attach whenever it appears or is replaced.
function startCaptionWatch() {
    if (captionWatchStarted) return;
    captionWatchStarted = true;

    setInterval(() => {
        hookMainVideo();
        // Reconcile pause state against the video's real state so it can't get stuck.
        if (mainVideo && mainVideo.paused !== isPaused) {
            if (mainVideo.paused) onMainPause();
            else onMainPlay();
        }
        const container = findCaptionContainer();
        if (container && container !== observedNode) {
            attachObserver(container, currentSite);
        }
    }, 1000);
}

async function main() {
    const data = await browserApi.storage.sync.get(['isOverlayEnabled', 'showDebug']);
    isOverlayEnabled = typeof data.isOverlayEnabled === 'undefined' ? true : data.isOverlayEnabled;
    showDebugInfo = !!data.showDebug;

    if (!isOverlayEnabled) {
        return;
    }

    initializeOverlay();

    try {
        const dictionaryUrl = browserApi.runtime.getURL('dictionary.json');
        const response = await fetch(dictionaryUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        dictionary = await response.json();
        
        if (overlay) overlay.querySelector('p').textContent = 'Waiting for captions...';
        
        startCaptionWatch();

    } catch (error) {
        console.error("Failed to load dictionary:", error);
        if (overlay) overlay.querySelector('p').textContent = 'Error: dictionary missing';
    }
}

browserApi.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggleDebug') {
        showDebugInfo = !!request.showDebug;
    } else if (request.action === 'enableOverlay') {
        isOverlayEnabled = true;
        if (!overlay) main(); 
        else overlay.style.display = 'flex';
    } else if (request.action === 'disableOverlay') {
        isOverlayEnabled = false;
        if (overlay) overlay.style.display = 'none';
    } else if (request.action === 'reloadOverlay') {
        if (overlay) overlay.remove();
        overlay = null;
        if (mutationObserver) mutationObserver.disconnect();
        mutationObserver = null;
        observedNode = null; // Force the watchdog to re-attach to a fresh node
        transcriptHistory = ""; // Reset history on reload
        main();
    }
});

main();

