// Text chunks array - will be populated when EPUB is uploaded
const textChunks = [];
// Chapter metadata - tracks chapter information
let chapterMetadata = {
    chapters: [], // Array of {title, startIndex, endIndex}
    totalChapters: 0
};

// EPUB Parser
class EPUBParser {
    constructor() {
        this.book = null;
    }

    async loadEPUB(file) {
        return new Promise((resolve, reject) => {
            // Check if epub.js is loaded
            if (typeof ePub === 'undefined') {
                reject(new Error('EPUB.js library not loaded. Please check your internet connection.'));
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    this.book = ePub(arrayBuffer);
                    
                    // Wait for book to be ready
                    await this.book.ready;
                    resolve(this.book);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    async extractText() {
        if (!this.book) return [];

        try {
            await this.book.ready;
            
            // Get spine - try different ways to access it
            let spine;
            if (this.book.spine) {
                spine = this.book.spine;
            } else if (this.book.loaded && this.book.loaded.spine) {
                spine = this.book.loaded.spine;
            } else {
                throw new Error('Could not access EPUB spine');
            }
            
            const chapters = [];
            const spineLength = spine.length || spine.spineItems?.length || 0;

            // Extract text from each chapter
            for (let i = 0; i < spineLength; i++) {
                try {
                    let item, section;
                    
                    // Try different ways to get spine item
                    if (spine.get) {
                        item = spine.get(i);
                    } else if (spine.spineItems) {
                        item = spine.spineItems[i];
                    } else if (Array.isArray(spine)) {
                        item = spine[i];
                    } else {
                        item = spine[i];
                    }
                    
                    if (!item) continue;
                    
                    // Get the href
                    const href = item.href || item.idref || item.url || item;
                    
                    // Load the section - try different methods
                    let htmlContent = '';
                    
                    try {
                        // Method 1: Direct load
                        section = await this.book.load(href);
                        
                        // Handle different return types from book.load()
                        if (typeof section === 'string') {
                            htmlContent = section;
                        } else if (section && section.document) {
                            // If it returns a document object
                            htmlContent = section.document.body?.innerHTML || section.document.documentElement?.innerHTML || '';
                        } else if (section && section.innerHTML) {
                            htmlContent = section.innerHTML;
                        } else if (section && section.body) {
                            htmlContent = section.body.innerHTML;
                        } else if (section && section.documentElement) {
                            htmlContent = section.documentElement.innerHTML;
                        } else if (section && typeof section.section === 'string') {
                            htmlContent = section.section;
                        } else {
                            // Try to get as string
                            htmlContent = String(section);
                        }
                    } catch (loadError) {
                        // Try alternative method using getSection
                        try {
                            if (this.book.getSection) {
                                const sectionData = await this.book.getSection(href);
                                if (sectionData) {
                                    htmlContent = sectionData.document?.body?.innerHTML || 
                                                 sectionData.document?.documentElement?.innerHTML ||
                                                 String(sectionData);
                                }
                            }
                        } catch (altError) {
                            console.warn(`Could not load section ${href}:`, loadError, altError);
                            continue;
                        }
                    }
                    
                    if (!htmlContent || htmlContent.trim().length === 0) {
                        continue;
                    }
                    
                    // Create a temporary DOM to parse HTML
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlContent, 'text/html');
                    
                    // Remove script and style tags
                    const scripts = doc.querySelectorAll('script, style');
                    scripts.forEach(el => el.remove());
                    
                    // Extract text content, preserving structure
                    const textContent = this.extractFormattedText(doc.body);
                    if (textContent.trim()) {
                        const title = item.label || item.title || `Chapter ${i + 1}`;
                        chapters.push({
                            title: title,
                            content: textContent
                        });
                    }
                } catch (error) {
                    console.warn(`Error loading chapter ${i + 1}:`, error);
                    // Continue with next chapter
                }
            }

            if (chapters.length === 0) {
                console.error('No chapters extracted. Spine length:', spineLength);
                console.error('Book object:', this.book);
                console.error('Spine object:', spine);
                throw new Error('No readable content found. EPUB might be image-based or have a different structure. Check browser console for details.');
            }

            console.log(`Successfully extracted ${chapters.length} chapters`);
            return chapters;
        } catch (error) {
            console.error('Error extracting text:', error);
            throw error;
        }
    }

    extractFormattedText(element) {
        if (!element) return '';
        
        let html = '';
        const children = element.childNodes;
        
        for (let child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text) {
                    html += text + ' ';
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                
                // Skip unwanted elements
                if (['script', 'style', 'nav', 'header', 'footer'].includes(tagName)) {
                    continue;
                }
                
                // Preserve paragraph breaks
                if (tagName === 'p') {
                    const paraContent = this.extractFormattedText(child).trim();
                    if (paraContent) {
                        html += '<p>' + paraContent + '</p>';
                    }
                }
                // Preserve line breaks
                else if (tagName === 'br') {
                    html += '<br>';
                }
                // Preserve divs (often used for paragraphs in EPUBs)
                else if (tagName === 'div') {
                    const divContent = this.extractFormattedText(child).trim();
                    if (divContent) {
                        html += '<div>' + divContent + '</div>';
                    }
                }
                // Preserve emphasis
                else if (tagName === 'em' || tagName === 'i') {
                    html += '<em>' + this.extractFormattedText(child) + '</em>';
                }
                else if (tagName === 'strong' || tagName === 'b') {
                    html += '<strong>' + this.extractFormattedText(child) + '</strong>';
                }
                // Handle headings
                else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
                    const headingContent = this.extractFormattedText(child).trim();
                    if (headingContent) {
                        html += '<p style="font-weight: bold; margin-bottom: 1em;">' + headingContent + '</p>';
                    }
                }
                // Handle spans and other inline elements
                else if (['span', 'a', 'small', 'sub', 'sup'].includes(tagName)) {
                    html += this.extractFormattedText(child);
                }
                // Handle block elements
                else if (['section', 'article', 'main'].includes(tagName)) {
                    html += this.extractFormattedText(child);
                }
                // For everything else, just extract text
                else {
                    const childContent = this.extractFormattedText(child);
                    if (childContent.trim()) {
                        html += childContent;
                    }
                }
            }
        }
        
        return html;
    }

    chunkText(chapters, maxChunkSize = 500) {
        const chunks = [];
        let chunkId = 1;
        const chapterInfo = [];

        chapters.forEach((chapter, chapterIndex) => {
            if (!chapter.content || !chapter.content.trim()) {
                return; // Skip empty chapters
            }

            const chapterStartIndex = chunks.length; // Track where this chapter starts

            // Use regex to match complete paragraph tags
            const paraRegex = /<p[^>]*>.*?<\/p>/gi;
            const paragraphs = chapter.content.match(paraRegex) || [];
            
            // Also handle divs as paragraphs
            const divRegex = /<div[^>]*>.*?<\/div>/gi;
            const divs = chapter.content.match(divRegex) || [];
            
            // Combine and process all paragraph-like elements
            let allParagraphs = [...paragraphs, ...divs].filter(p => {
                const textOnly = p.replace(/<[^>]*>/g, '').trim();
                return textOnly.length > 0;
            });
            
            // If no paragraphs found, treat entire content as one paragraph
            if (allParagraphs.length === 0) {
                const textOnly = chapter.content.replace(/<[^>]*>/g, '').trim();
                if (textOnly.length > 0) {
                    // Wrap in paragraph tags
                    allParagraphs = ['<p>' + chapter.content + '</p>'];
                }
            }
            
            let currentChunk = '';
            let currentTitle = chapter.title;

            allParagraphs.forEach((para, paraIndex) => {
                const paraText = para.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags for length check
                
                if (currentChunk.length + paraText.length > maxChunkSize && currentChunk.length > 0) {
                    // Save current chunk
                    chunks.push({
                        id: chunkId++,
                        title: currentTitle,
                        chapterIndex: chapterIndex,
                        chapterTitle: chapter.title,
                        text: currentChunk.trim()
                    });
                    currentChunk = '';
                    currentTitle = null; // Only show title on first chunk of chapter
                }
                
                // Add paragraph with formatting preserved
                currentChunk += para;
            });

            // Add remaining chunk
            if (currentChunk.trim()) {
                chunks.push({
                    id: chunkId++,
                    title: currentTitle,
                    chapterIndex: chapterIndex,
                    chapterTitle: chapter.title,
                    text: currentChunk.trim()
                });
            }

            // Track chapter metadata
            const chapterEndIndex = chunks.length - 1;
            if (chapterStartIndex <= chapterEndIndex) {
                chapterInfo.push({
                    title: chapter.title,
                    startIndex: chapterStartIndex,
                    endIndex: chapterEndIndex
                });
            }
        });

        // Store chapter metadata globally
        chapterMetadata = {
            chapters: chapterInfo,
            totalChapters: chapterInfo.length
        };

        return chunks;
    }
}

class TextReels {
    constructor() {
        this.currentIndex = 0;
        this.isTransitioning = false;
        this.isDragging = false;
        this.touchStartY = 0;
        this.touchEndY = 0;
        this.currentDragY = 0;
        this.minSwipeDistance = 50;
        this.threshold = 100; // Distance needed to trigger page change
        
        this.init();
    }

    init() {
        this.renderReels();
        this.setupEventListeners();
        this.updateProgress();
        this.showSwipeHint();
    }

    renderReels() {
        const container = document.getElementById('reels-container');
        container.innerHTML = '';
        
        if (textChunks.length === 0) {
            // Show empty state message
            const emptyItem = document.createElement('div');
            emptyItem.className = 'reel-item active';
            emptyItem.innerHTML = `
                <div class="text-container">
                    <div class="reel-title">Welcome to PageUp</div>
                    <div class="reel-text" style="text-align: center; padding: 20px;">
                        <p>Upload an EPUB file to start reading in reels format.</p>
                        <p style="margin-top: 20px; font-size: 16px; opacity: 0.7;">Click "Upload EPUB" button in the top-left corner.</p>
                    </div>
                </div>
            `;
            container.appendChild(emptyItem);
            const totalPagesEl = document.getElementById('total-pages');
            if (totalPagesEl) {
                totalPagesEl.textContent = '0';
            }
            const currentPageInput = document.getElementById('current-page');
            if (currentPageInput) {
                currentPageInput.max = 0;
            }
            return;
        }
        
        textChunks.forEach((chunk, index) => {
            const reelItem = document.createElement('div');
            reelItem.className = 'reel-item';
            if (index === 0) reelItem.classList.add('active');
            
            reelItem.innerHTML = `
                <div class="text-container">
                    ${chunk.title ? `<div class="reel-title">${chunk.title}</div>` : ''}
                    <div class="reel-text">${chunk.text}</div>
                </div>
            `;
            
            container.appendChild(reelItem);
        });
        
            const totalPagesEl = document.getElementById('total-pages');
            if (totalPagesEl) {
                totalPagesEl.textContent = textChunks.length;
            }
            // Update max attribute for page input
            const currentPageInput = document.getElementById('current-page');
            if (currentPageInput) {
                currentPageInput.max = textChunks.length;
            }
    }

    setupEventListeners() {
        // Touch events
        const container = document.getElementById('reels-container');
        
        container.addEventListener('touchstart', (e) => {
            if (this.isTransitioning) return;
            this.isDragging = true;
            this.touchStartY = e.touches[0].clientY;
            this.currentDragY = 0;
        }, { passive: true });
        
        container.addEventListener('touchmove', (e) => {
            if (!this.isDragging || this.isTransitioning) return;
            
            const currentY = e.touches[0].clientY;
            const deltaY = currentY - this.touchStartY;
            this.currentDragY = deltaY;
            
            // Prevent default scrolling
            e.preventDefault();
            
            // Apply real-time transform
            this.updateDragPosition(deltaY);
        }, { passive: false });
        
        container.addEventListener('touchend', (e) => {
            if (!this.isDragging) return;
            
            this.isDragging = false;
            this.touchEndY = e.changedTouches[0].clientY;
            const finalDelta = this.touchEndY - this.touchStartY;
            
            // Determine if we should change pages or snap back
            if (Math.abs(finalDelta) > this.threshold) {
                if (finalDelta < 0) {
                    // Swiped up enough - go to next
                    this.goToNext();
                } else {
                    // Swiped down enough - go to previous
                    this.goToPrevious();
                }
            } else {
                // Snap back to current page
                this.snapBack();
            }
        }, { passive: true });

        // Mouse events for desktop testing
        let mouseStartY = 0;
        let mouseEndY = 0;
        let isMouseDragging = false;
        
        container.addEventListener('mousedown', (e) => {
            if (this.isTransitioning) return;
            isMouseDragging = true;
            mouseStartY = e.clientY;
            this.currentDragY = 0;
        });
        
        container.addEventListener('mousemove', (e) => {
            if (!isMouseDragging || this.isTransitioning) return;
            const deltaY = e.clientY - mouseStartY;
            this.currentDragY = deltaY;
            this.updateDragPosition(deltaY);
        });
        
        container.addEventListener('mouseup', (e) => {
            if (!isMouseDragging) return;
            isMouseDragging = false;
            mouseEndY = e.clientY;
            const finalDelta = mouseEndY - mouseStartY;
            
            if (Math.abs(finalDelta) > this.threshold) {
                if (finalDelta < 0) {
                    this.goToNext();
                } else {
                    this.goToPrevious();
                }
            } else {
                this.snapBack();
            }
        });

        // Keyboard navigation for testing
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                this.goToNext();
            } else if (e.key === 'ArrowUp') {
                this.goToPrevious();
            }
        });
    }

    updateDragPosition(deltaY) {
        const items = document.querySelectorAll('.reel-item');
        const currentItem = items[this.currentIndex];
        const screenHeight = window.innerHeight;
        
        // Limit drag distance
        const maxDrag = screenHeight * 0.5;
        const clampedDelta = Math.max(-maxDrag, Math.min(maxDrag, deltaY));
        
        // Move current item
        currentItem.style.transform = `translateY(${clampedDelta}px)`;
        currentItem.style.transition = 'none';
        
        // Move next/previous item into view
        if (deltaY < 0 && this.currentIndex < textChunks.length - 1) {
            // Dragging up - show next item below
            const nextItem = items[this.currentIndex + 1];
            nextItem.style.transform = `translateY(${screenHeight + clampedDelta}px)`;
            nextItem.style.transition = 'none';
            nextItem.style.opacity = '1';
        } else if (deltaY > 0 && this.currentIndex > 0) {
            // Dragging down - show previous item above
            const prevItem = items[this.currentIndex - 1];
            prevItem.style.transform = `translateY(${-screenHeight + clampedDelta}px)`;
            prevItem.style.transition = 'none';
            prevItem.style.opacity = '1';
        }
    }

    snapBack() {
        const items = document.querySelectorAll('.reel-item');
        const currentItem = items[this.currentIndex];
        
        // Reset all items with smooth transition
        items.forEach((item, index) => {
            item.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
            
            if (index === this.currentIndex) {
                item.style.transform = 'translateY(0)';
                item.style.opacity = '1';
            } else {
                item.style.transform = '';
                item.style.opacity = '';
            }
        });
        
        // Clean up after animation
        setTimeout(() => {
            items.forEach((item) => {
                item.style.transition = '';
            });
        }, 300);
    }

    goToNext() {
        if (this.isTransitioning || this.currentIndex >= textChunks.length - 1) {
            this.snapBack();
            return;
        }
        
        this.isTransitioning = true;
        const items = document.querySelectorAll('.reel-item');
        
        // Reset all inline styles and use classes
        items.forEach((item) => {
            item.style.transform = '';
            item.style.transition = '';
            item.style.opacity = '';
        });
        
        items[this.currentIndex].classList.remove('active');
        items[this.currentIndex].classList.add('prev');
        
        this.currentIndex++;
        items[this.currentIndex].classList.remove('next');
        items[this.currentIndex].classList.add('active');
        
        this.updateProgress();
        
        setTimeout(() => {
            this.isTransitioning = false;
            items.forEach((item, index) => {
                item.classList.remove('prev', 'next');
            });
        }, 300);
    }

    goToPrevious() {
        if (this.isTransitioning || this.currentIndex <= 0) {
            this.snapBack();
            return;
        }
        
        this.isTransitioning = true;
        const items = document.querySelectorAll('.reel-item');
        
        // Reset all inline styles and use classes
        items.forEach((item) => {
            item.style.transform = '';
            item.style.transition = '';
            item.style.opacity = '';
        });
        
        // Position the previous item above before transitioning
        const prevIndex = this.currentIndex - 1;
        items[prevIndex].style.transform = 'translateY(-100%)';
        items[prevIndex].style.opacity = '0';
        void items[prevIndex].offsetHeight;
        
        items[this.currentIndex].classList.remove('active');
        items[this.currentIndex].classList.add('next');
        
        this.currentIndex--;
        items[this.currentIndex].classList.remove('prev');
        items[this.currentIndex].classList.add('active');
        
        items[this.currentIndex].style.transform = '';
        items[this.currentIndex].style.opacity = '';
        
        this.updateProgress();
        
        setTimeout(() => {
            this.isTransitioning = false;
            items.forEach((item, index) => {
                item.classList.remove('prev', 'next');
                item.style.transform = '';
                item.style.opacity = '';
            });
        }, 300);
    }

    updateProgress() {
        const currentPageInput = document.getElementById('current-page');
        if (currentPageInput) {
            currentPageInput.value = this.currentIndex + 1;
            currentPageInput.max = textChunks.length;
        }
        this.updateChapterIndicator();
    }

    updateChapterIndicator() {
        const indicator = document.getElementById('chapter-indicator');
        const currentChapterNumber = document.getElementById('current-chapter-number');
        const totalChapters = document.getElementById('total-chapters');

        if (!indicator || !currentChapterNumber || !totalChapters) {
            return;
        }

        // Find current chapter based on currentIndex
        if (chapterMetadata.chapters.length === 0 || textChunks.length === 0) {
            indicator.classList.add('hidden');
            return;
        }

        const currentChunk = textChunks[this.currentIndex];
        if (!currentChunk) {
            indicator.classList.add('hidden');
            return;
        }

        // Get chapter info from chunk or find it
        let chapterIndex = currentChunk.chapterIndex;
        if (chapterIndex === undefined) {
            // Fallback: find chapter by checking which chapter range contains currentIndex
            chapterIndex = chapterMetadata.chapters.findIndex(ch => 
                this.currentIndex >= ch.startIndex && this.currentIndex <= ch.endIndex
            );
        }

        if (chapterIndex >= 0 && chapterIndex < chapterMetadata.chapters.length) {
            currentChapterNumber.textContent = chapterIndex + 1;
            totalChapters.textContent = chapterMetadata.totalChapters;
            // Update content but don't change visibility (respect user's toggle)
        } else {
            indicator.classList.add('hidden');
        }
    }

    toggleChapterIndicator() {
        const indicator = document.getElementById('chapter-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden');
        }
    }

    goToPage(pageNumber) {
        const targetPage = parseInt(pageNumber);
        const maxPages = textChunks.length;
        
        if (isNaN(targetPage) || targetPage < 1 || targetPage > maxPages) {
            // Reset to current page if invalid
            this.updateProgress();
            return;
        }
        
        if (this.isTransitioning) return;
        
        const targetIndex = targetPage - 1; // Convert to 0-based index
        
        if (targetIndex === this.currentIndex) {
            // Already on this page
            this.updateProgress();
            return;
        }
        
        this.isTransitioning = true;
        const items = document.querySelectorAll('.reel-item');
        
        // Reset all inline styles
        items.forEach((item) => {
            item.style.transform = '';
            item.style.transition = '';
            item.style.opacity = '';
        });
        
        // Remove active class from current item
        items[this.currentIndex].classList.remove('active');
        
        // Determine direction
        if (targetIndex > this.currentIndex) {
            // Moving forward
            items[this.currentIndex].classList.add('prev');
            this.currentIndex = targetIndex;
            items[this.currentIndex].classList.remove('next');
        } else {
            // Moving backward
            items[this.currentIndex].classList.add('next');
            // Position target item above
            items[targetIndex].style.transform = 'translateY(-100%)';
            items[targetIndex].style.opacity = '0';
            void items[targetIndex].offsetHeight; // Force reflow
            this.currentIndex = targetIndex;
            items[this.currentIndex].classList.remove('prev');
        }
        
        items[this.currentIndex].classList.add('active');
        items[this.currentIndex].style.transform = '';
        items[this.currentIndex].style.opacity = '';
        
        this.updateProgress();
        
        setTimeout(() => {
            this.isTransitioning = false;
            items.forEach((item, index) => {
                item.classList.remove('prev', 'next');
                item.style.transform = '';
                item.style.opacity = '';
            });
        }, 300);
    }

    showSwipeHint() {
        if (textChunks.length <= 1) return;
        
        const hint = document.createElement('div');
        hint.className = 'swipe-hint';
        hint.textContent = '↑ Swipe up';
        document.getElementById('app').appendChild(hint);
        
        setTimeout(() => {
            hint.remove();
        }, 5000);
    }

    async loadEPUB(file) {
        const statusEl = document.getElementById('upload-status');
        const uploadBtn = document.getElementById('upload-btn');
        
        // Disable button during loading
        uploadBtn.disabled = true;
        statusEl.textContent = 'Loading EPUB file...';
        
        try {
            // Check if epub.js is available
            if (typeof ePub === 'undefined') {
                throw new Error('EPUB.js library not loaded. Please refresh the page.');
            }

            const parser = new EPUBParser();
            statusEl.textContent = 'Parsing EPUB structure...';
            
            await parser.loadEPUB(file);
            statusEl.textContent = 'Extracting text from chapters...';
            
            const chapters = await parser.extractText();
            
            if (chapters.length === 0) {
                throw new Error('No text content found in EPUB. The file might be corrupted or empty.');
            }
            
            statusEl.textContent = `Processing ${chapters.length} chapters...`;
            
            const chunks = parser.chunkText(chapters, 400); // 400 chars per chunk
            
            if (chunks.length === 0) {
                throw new Error('No readable content found in EPUB.');
            }
            
            // Update textChunks
            textChunks.length = 0;
            textChunks.push(...chunks);
            
            // Re-render
            this.currentIndex = 0;
            this.renderReels();
            this.updateProgress();
            
            // Show chapter indicator by default when EPUB is loaded
            const chapterIndicator = document.getElementById('chapter-indicator');
            if (chapterIndicator && chapterMetadata.totalChapters > 0) {
                chapterIndicator.classList.remove('hidden');
            }
            
            // Hide upload button
            document.getElementById('upload-container').classList.add('hidden');
            statusEl.textContent = `✓ Loaded ${chunks.length} chunks`;
            
            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
        } catch (error) {
            statusEl.textContent = '✗ Error: ' + error.message;
            uploadBtn.disabled = false;
            console.error('EPUB Error:', error);
            
            // Show error for longer
            setTimeout(() => {
                statusEl.textContent = 'Try uploading again';
            }, 5000);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Check if epub.js loaded
    if (typeof ePub === 'undefined') {
        const statusEl = document.getElementById('upload-status');
        statusEl.textContent = '⚠ EPUB library loading...';
        statusEl.style.color = 'rgba(255, 255, 0, 0.8)';
        
        // Wait a bit and check again
        setTimeout(() => {
            if (typeof ePub === 'undefined') {
                statusEl.textContent = '⚠ EPUB.js failed to load. Check internet connection.';
                statusEl.style.color = 'rgba(255, 100, 100, 0.8)';
            } else {
                statusEl.textContent = '';
                statusEl.style.color = '';
            }
        }, 2000);
    }
    
    const reels = new TextReels();
    
    // EPUB Upload Handler
    const uploadBtn = document.getElementById('upload-btn');
    const epubInput = document.getElementById('epub-input');
    
    uploadBtn.addEventListener('click', () => {
        epubInput.click();
    });
    
    epubInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.epub')) {
            await reels.loadEPUB(file);
        } else if (file) {
            const statusEl = document.getElementById('upload-status');
            statusEl.textContent = 'Please select an .epub file';
            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
        }
    });
    
    // Page navigation input handler
    const currentPageInput = document.getElementById('current-page');
    if (currentPageInput) {
        // Jump to page on Enter key or blur (when user clicks away)
        currentPageInput.addEventListener('blur', (e) => {
            reels.goToPage(e.target.value);
        });
        
        currentPageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur(); // This will trigger the blur event
            }
        });
        
        // Prevent invalid input while typing
        currentPageInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const max = parseInt(document.getElementById('total-pages').textContent);
            if (value > max) {
                e.target.value = max;
            } else if (value < 1 && e.target.value !== '') {
                e.target.value = 1;
            }
        });
    }
    
    // Chapter indicator toggle handler - use the area container so it's always tappable
    const chapterIndicatorArea = document.getElementById('chapter-indicator-area');
    if (chapterIndicatorArea) {
        chapterIndicatorArea.addEventListener('click', (e) => {
            e.stopPropagation();
            reels.toggleChapterIndicator();
        });
        
        // Also allow tap on the area (for mobile)
        chapterIndicatorArea.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            reels.toggleChapterIndicator();
        });
    }
    
    // Make reels instance globally accessible
    window.reels = reels;
});

// Prevent pull-to-refresh on mobile
let lastTouchY = 0;
document.addEventListener('touchstart', (e) => {
    lastTouchY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const touchY = e.touches[0].clientY;
    const touchYDelta = touchY - lastTouchY;
    lastTouchY = touchY;
    
    if (touchYDelta > 0 && window.scrollY === 0) {
        e.preventDefault();
    }
}, { passive: false });

