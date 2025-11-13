
# Signergy — Sign Language Overlay for YouTube & Google Meet

Signergy is a browser extension built with HTML, CSS, and JavaScript that displays sign language videos based on live subtitles from YouTube and Google Meet. It enhances accessibility for Deaf and Hard-of-Hearing users by providing real-time signing for spoken content.

Features

* Detects and reads live captions from YouTube and Google Meet
* Supports full-sentence signing through a sentence-to-video mapping system
* Falls back to word-level signing when no sentence match is found
* Uses letter-by-letter signing if a word video is missing, ensuring complete coverage
* Includes a draggable floating overlay that plays sign-language videos without interrupting the page
* Ensures sequential playback with proper timing so signs never overlap
* Offers an optional debug mode to display which video is currently being used

How It Works

1. The extension injects a floating video overlay into any YouTube or Google Meet page.
2. A caption observer monitors subtitles in real time.
3. The system checks if the full subtitle text matches a sentence from `data.json`.
4. If a match exists, the corresponding sentence video is played.
5. If not, the subtitle is split into words and matched individually.
6. Missing words are automatically fingerspelled using letter videos.
7. All items are added to a queue and played one at a time, preventing overlap or interruptions.

 Project Structure

```
manifest.json
content.js
popup.html
data.json          // maps sentence IDs to sentences
signs/
   sentences/      // 1.mp4, 2.mp4, etc.
   words/          // hello.mp4, help.mp4, etc.
   letters/        // a-abc.mp4, b-abc.mp4, etc.
```

 Technologies Used

* HTML for the popup and overlay structure
* CSS (inline via JavaScript) for overlay styling
* JavaScript for caption parsing, queue management, and video playback
* Browser Extension APIs (Chrome/Firefox)
* JSON for sentence mapping

Purpose

Signergy was created to demonstrate how browser-based tools can improve online accessibility. It allows anyone to instantly add sign language support to videos and meetings without needing specialized hardware or expensive human interpreters.


