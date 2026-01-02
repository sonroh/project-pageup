// Text chunks array - will be populated when EPUB is uploaded
const textChunks = [];
// Chapter metadata - tracks chapter information
let chapterMetadata = {
    chapters: [], // Array of {title, startIndex, endIndex}
    totalChapters: 0
};

// LocalStorage helper functions for saving/loading reading position
const StorageManager = {
    savePosition(epubIdentifier, pageIndex) {
        const data = {
            epubIdentifier: epubIdentifier,
            pageIndex: pageIndex,
            timestamp: Date.now()
        };
        localStorage.setItem('pageup-reading-position', JSON.stringify(data));
    },

    loadPosition() {
        const saved = localStorage.getItem('pageup-reading-position');
        return saved ? JSON.parse(saved) : null;
    },

    clearPosition() {
        localStorage.removeItem('pageup-reading-position');
    },

    // Create identifier from file (filename + size + lastModified)
    createEpubIdentifier(file) {
        return `${file.name}-${file.size}-${file.lastModified}`;
    },
    
    // Analytics tracking
    saveAnalytics(epubIdentifier, sessionData) {
        const key = `pageup-analytics-${epubIdentifier}`;
        let analytics = JSON.parse(localStorage.getItem(key) || '{"sessions": []}');
        analytics.sessions.push(sessionData);
        localStorage.setItem(key, JSON.stringify(analytics));
    },
    
    getAnalytics(epubIdentifier) {
        const key = `pageup-analytics-${epubIdentifier}`;
        return JSON.parse(localStorage.getItem(key) || '{"sessions": []}');
    }
};

// Analytics Tracker
class AnalyticsTracker {
    constructor() {
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.sessionStartTime = null;
        this.pageTimes = []; // Array of {pageIndex, startTime, endTime, duration, density}
        this.currentPageStartTime = null;
        this.pagesRead = new Set(); // Track unique pages viewed
        this.readThreshold = 2000; // 2 seconds to count as "read"
        
        // Track time spent in each density setting
        this.densityTimeTracking = {
            less: { startTime: null, totalTime: 0 },
            medium: { startTime: null, totalTime: 0 },
            more: { startTime: null, totalTime: 0 }
        };
        this.currentDensity = 'medium';
    }
    
    startSession() {
        this.sessionStartTime = Date.now();
        // Start tracking current density
        this.densityTimeTracking[this.currentDensity].startTime = this.sessionStartTime;
    }
    
    startPage(pageIndex, density) {
        // End previous page if exists
        if (this.currentPageStartTime !== null && this.pageTimes.length > 0) {
            const lastEntry = this.pageTimes[this.pageTimes.length - 1];
            if (lastEntry.endTime === null) {
                lastEntry.endTime = Date.now();
                lastEntry.duration = lastEntry.endTime - lastEntry.startTime;
                
                // Mark as read if duration > threshold
                if (lastEntry.duration >= this.readThreshold) {
                    this.pagesRead.add(lastEntry.pageIndex);
                }
            }
        }
        
        // Handle density change
        if (density !== this.currentDensity) {
            // End tracking for previous density
            if (this.densityTimeTracking[this.currentDensity].startTime !== null) {
                const endTime = Date.now();
                const duration = endTime - this.densityTimeTracking[this.currentDensity].startTime;
                this.densityTimeTracking[this.currentDensity].totalTime += duration;
                this.densityTimeTracking[this.currentDensity].startTime = null;
            }
            
            // Start tracking new density
            this.currentDensity = density;
            this.densityTimeTracking[this.currentDensity].startTime = Date.now();
        }
        
        // Start tracking new page
        this.currentPageStartTime = Date.now();
        this.pageTimes.push({
            pageIndex: pageIndex,
            startTime: this.currentPageStartTime,
            endTime: null,
            duration: 0,
            density: density
        });
    }
    
    endSession() {
        // Finalize current page
        if (this.currentPageStartTime !== null && this.pageTimes.length > 0) {
            const lastEntry = this.pageTimes[this.pageTimes.length - 1];
            if (lastEntry.endTime === null) {
                lastEntry.endTime = Date.now();
                lastEntry.duration = lastEntry.endTime - lastEntry.startTime;
                
                if (lastEntry.duration >= this.readThreshold) {
                    this.pagesRead.add(lastEntry.pageIndex);
                }
            }
        }
        
        // Finalize current density tracking
        if (this.densityTimeTracking[this.currentDensity].startTime !== null) {
            const endTime = Date.now();
            const duration = endTime - this.densityTimeTracking[this.currentDensity].startTime;
            this.densityTimeTracking[this.currentDensity].totalTime += duration;
            this.densityTimeTracking[this.currentDensity].startTime = null;
        }
        
        // Calculate average time per page
        const validPages = this.pageTimes.filter(pt => pt.duration > 0);
        const avgTime = validPages.length > 0
            ? Math.round(validPages.reduce((sum, pt) => sum + pt.duration, 0) / validPages.length / 1000) // in seconds
            : 0;
        
        // Get last page index
        const lastPageIndex = this.pageTimes.length > 0 
            ? this.pageTimes[this.pageTimes.length - 1].pageIndex 
            : 0;
        
        // Calculate total time spent reading (sum of all page durations)
        const totalReadingTime = Math.round(validPages.reduce((sum, pt) => sum + pt.duration, 0) / 1000); // in seconds
        
        // Get time spent in each density (convert from ms to seconds)
        const timeInLess = Math.round(this.densityTimeTracking.less.totalTime / 1000);
        const timeInMedium = Math.round(this.densityTimeTracking.medium.totalTime / 1000);
        const timeInMore = Math.round(this.densityTimeTracking.more.totalTime / 1000);
        
        return {
            sessionId: this.sessionId,
            sessionStartTimestamp: this.sessionStartTime ? new Date(this.sessionStartTime).toISOString() : new Date().toISOString(),
            sessionEndTimestamp: new Date().toISOString(),
            totalPagesRead: this.pagesRead.size,
            lastPageIndex: lastPageIndex,
            totalPages: textChunks.length,
            progressPercentage: textChunks.length > 1 
                ? parseFloat(((lastPageIndex / (textChunks.length - 1)) * 100).toFixed(2))
                : (textChunks.length === 1 ? 100.00 : 0.00),
            averageTimePerPage: avgTime,
            totalTimeSpentReading: totalReadingTime,
            lastPageSizeSetting: this.currentDensity,
            timeSpentInLess: timeInLess,
            timeSpentInMedium: timeInMedium,
            timeSpentInMore: timeInMore
        };
    }
    
    reset() {
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.sessionStartTime = null;
        this.pageTimes = [];
        this.currentPageStartTime = null;
        this.pagesRead = new Set();
        this.densityTimeTracking = {
            less: { startTime: null, totalTime: 0 },
            medium: { startTime: null, totalTime: 0 },
            more: { startTime: null, totalTime: 0 }
        };
        this.currentDensity = 'medium';
    }
}

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
                    
                    // Extract chapter number from idref if available (e.g., "chapter-3" -> 3)
                    let chapterNumberFromIdref = null;
                    if (item.idref) {
                        const idrefMatch = item.idref.match(/chapter[_-]?(\d+)/i);
                        if (idrefMatch) {
                            chapterNumberFromIdref = parseInt(idrefMatch[1], 10);
                            console.log(`Extracted chapter number ${chapterNumberFromIdref} from idref: ${item.idref}`);
                        }
                    }
                    
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
                        // Check if this is a table of contents or front matter
                        const textLower = textContent.toLowerCase();
                        const isTableOfContents = textLower.includes('contents') || 
                                                 textLower.includes('table of contents') ||
                                                 textLower.includes('toc') ||
                                                 (doc.body.querySelectorAll('a').length > 10); // Many links = likely TOC
                        
                        const isFrontMatter = textLower.includes('project gutenberg') ||
                                             textLower.includes('ebook') ||
                                             textLower.includes('copyright') ||
                                             textLower.includes('license') ||
                                             href.toLowerCase().includes('title') ||
                                             href.toLowerCase().includes('cover') ||
                                             href.toLowerCase().includes('copyright') ||
                                             (item.idref && (item.idref.toLowerCase().includes('cover') ||
                                             item.idref.toLowerCase().includes('header')));
                        
                        // Skip TOC and front matter pages
                        if (isTableOfContents || isFrontMatter) {
                            // Still include the content, but don't treat it as a chapter with a title
                            chapters.push({
                                title: null, // No title for TOC/front matter
                                content: textContent,
                                isMetadata: true,
                                chapterNumberFromIdref: null // No chapter number for metadata
                            });
                        } else {
                            // Only assign chapter title if EPUB provides a meaningful label
                            // Don't auto-generate "Chapter X" - it's often wrong
                            const title = (item.label && item.label.trim() && 
                                         !item.label.match(/^(chapter|ch)\s*\d+$/i)) 
                                         ? item.label 
                                         : null;
                            chapters.push({
                                title: title,
                                content: textContent,
                                isMetadata: false,
                                chapterNumberFromIdref: chapterNumberFromIdref // Store extracted chapter number
                            });
                        }
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

    async diagnoseEPUB() {
        if (!this.book) return null;
        
        try {
            await this.book.ready;
            
            const diagnosis = {
                metadata: {},
                spine: [],
                navigation: null,
                toc: null
            };
            
            // Get metadata
            try {
                const metadata = this.book.packaging?.metadata || this.book.metadata || this.book.loaded?.metadata || {};
                diagnosis.metadata = {
                    title: metadata.title,
                    creator: metadata.creator,
                    language: metadata.language,
                    publisher: metadata.publisher,
                    all: metadata
                };
            } catch (e) {
                console.warn('Could not get metadata:', e);
            }
            
            // Get spine information
            let spine;
            if (this.book.spine) {
                spine = this.book.spine;
            } else if (this.book.loaded && this.book.loaded.spine) {
                spine = this.book.loaded.spine;
            }
            
            if (spine) {
                const spineLength = spine.length || spine.spineItems?.length || 0;
                for (let i = 0; i < spineLength; i++) {
                    let item;
                    if (spine.get) {
                        item = spine.get(i);
                    } else if (spine.spineItems) {
                        item = spine.spineItems[i];
                    } else if (Array.isArray(spine)) {
                        item = spine[i];
                    } else {
                        item = spine[i];
                    }
                    
                    if (item) {
                        diagnosis.spine.push({
                            index: i,
                            href: item.href || item.idref || item.url,
                            label: item.label,
                            title: item.title,
                            idref: item.idref,
                            fullItem: item
                        });
                    }
                }
            }
            
            // Try to get navigation/TOC
            try {
                if (this.book.navigation) {
                    diagnosis.navigation = this.book.navigation;
                }
                if (this.book.loaded && this.book.loaded.navigation) {
                    diagnosis.navigation = this.book.loaded.navigation;
                }
            } catch (e) {
                console.warn('Could not get navigation:', e);
            }
            
            return diagnosis;
        } catch (error) {
            console.error('Diagnosis error:', error);
            return null;
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
                
                // Preserve paragraph breaks with styles
                if (tagName === 'p') {
                    const paraContent = this.extractFormattedText(child).trim();
                    if (paraContent) {
                        const style = child.getAttribute('style') || '';
                        const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                        html += `<p ${classAttr} ${style ? `style="${style}"` : ''}>${paraContent}</p>`;
                    }
                }
                // Preserve line breaks
                else if (tagName === 'br') {
                    html += '<br>';
                }
                // Preserve divs (often used for paragraphs in EPUBs) with styles
                else if (tagName === 'div') {
                    // Check if div already contains block-level elements (p, div, h1-h6, etc.)
                    const hasBlockElements = child.querySelector('p, div, h1, h2, h3, h4, h5, h6, section, article');
                    
                    if (hasBlockElements) {
                        // Div already has block structure, process normally
                        const divContent = this.extractFormattedText(child).trim();
                        if (divContent) {
                            const style = child.getAttribute('style') || '';
                            const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                            html += `<div ${classAttr} ${style ? `style="${style}"` : ''}>${divContent}</div>`;
                        }
                    } else {
                        // Div has only text/inline elements - wrap them in <p> tags
                        let paragraphContent = '';
                        let currentTextGroup = '';
                        
                        const processDivChildren = (node) => {
                            for (let childNode of node.childNodes) {
                                if (childNode.nodeType === Node.TEXT_NODE) {
                                    const text = childNode.textContent.trim();
                                    if (text) {
                                        currentTextGroup += (currentTextGroup ? ' ' : '') + text;
                                    }
                                } else if (childNode.nodeType === Node.ELEMENT_NODE) {
                                    const childTag = childNode.tagName.toLowerCase();
                                    // If we hit a block element or br, finalize current paragraph
                                    if (['br', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(childTag)) {
                                        if (currentTextGroup.trim()) {
                                            paragraphContent += `<p>${currentTextGroup.trim()}</p>`;
                                            currentTextGroup = '';
                                        }
                                        if (childTag === 'br') {
                                            paragraphContent += '<br>';
                                        } else {
                                            paragraphContent += this.extractFormattedText(childNode);
                                        }
                                    } else {
                                        // Inline element - add to current text group
                                        currentTextGroup += this.extractFormattedText(childNode);
                                    }
                                }
                            }
                        };
                        
                        processDivChildren(child);
                        
                        // Finalize any remaining text as a paragraph
                        if (currentTextGroup.trim()) {
                            paragraphContent += `<p>${currentTextGroup.trim()}</p>`;
                        }
                        
                        if (paragraphContent.trim()) {
                            const style = child.getAttribute('style') || '';
                            const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                            html += `<div ${classAttr} ${style ? `style="${style}"` : ''}>${paragraphContent}</div>`;
                        }
                    }
                }
                // Preserve emphasis
                else if (tagName === 'em' || tagName === 'i') {
                    html += '<em>' + this.extractFormattedText(child) + '</em>';
                }
                else if (tagName === 'strong' || tagName === 'b') {
                    html += '<strong>' + this.extractFormattedText(child) + '</strong>';
                }
                // Preserve spans with styles (for font sizes, colors, etc.)
                else if (tagName === 'span') {
                    const style = child.getAttribute('style') || '';
                    const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                    const spanContent = this.extractFormattedText(child);
                    if (style || classAttr) {
                        html += `<span ${classAttr} ${style ? `style="${style}"` : ''}>${spanContent}</span>`;
                    } else {
                        html += spanContent;
                    }
                }
                // Preserve headings with their original tags (for proper sizing)
                else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
                    const headingContent = this.extractFormattedText(child).trim();
                    if (headingContent) {
                        // Preserve the heading tag and any inline styles
                        const style = child.getAttribute('style') || '';
                        const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                        html += `<${tagName} ${classAttr} ${style ? `style="${style}"` : ''}>${headingContent}</${tagName}>`;
                    }
                }
                // Handle links with href
                else if (tagName === 'a') {
                    const href = child.getAttribute('href') || '';
                    const linkContent = this.extractFormattedText(child);
                    if (href) {
                        html += `<a href="${href}">${linkContent}</a>`;
                    } else {
                        html += linkContent;
                    }
                }
                // Handle other inline elements
                else if (['small', 'sub', 'sup', 'u', 'mark'].includes(tagName)) {
                    html += `<${tagName}>${this.extractFormattedText(child)}</${tagName}>`;
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
        let actualChapterNumber = 0; // Track actual chapters (excluding metadata)

        chapters.forEach((chapter, chapterIndex) => {
            if (!chapter.content || !chapter.content.trim()) {
                return; // Skip empty chapters
            }

            const chapterStartIndex = chunks.length; // Track where this chapter starts
            
            // Skip metadata pages (TOC, front matter) when tracking chapters
            const isMetadataPage = chapter.isMetadata === true;
            
            // Determine the chapter number to use
            let chapterNumberToUse = null;
            
            if (!isMetadataPage) {
                // If we have a chapter number from idref, use it
                if (chapter.chapterNumberFromIdref !== null && chapter.chapterNumberFromIdref !== undefined) {
                    chapterNumberToUse = chapter.chapterNumberFromIdref;
                    // Update actualChapterNumber to match if it's higher (for tracking max)
                    if (chapterNumberToUse > actualChapterNumber) {
                        actualChapterNumber = chapterNumberToUse;
                    }
                } else {
                    // Fallback: increment our counter
                    actualChapterNumber++;
                    chapterNumberToUse = actualChapterNumber;
                }
            }

            // Parse HTML to extract paragraphs in order
            const parser = new DOMParser();
            const doc = parser.parseFromString(chapter.content, 'text/html');
            
            // Get all paragraph and div elements in document order (top-level only)
            const allElements = [];
            
            // Process direct children of body first, then nested elements
            const processNode = (node) => {
                const tagName = node.tagName ? node.tagName.toLowerCase() : '';
                
                if (tagName === 'p' || tagName === 'div') {
                    const innerHTML = node.innerHTML.trim();
                    const textOnly = node.textContent.trim();
                    
                    if (textOnly.length > 0) {
                        allElements.push({
                            tag: tagName,
                            html: `<${tagName}>${innerHTML}</${tagName}>`,
                            textLength: textOnly.length
                        });
                        return; // Don't process children if we've added this node
                    }
                }
                
                // Process children
                if (node.children) {
                    Array.from(node.children).forEach(child => processNode(child));
                }
            };
            
            // Start processing from body
            if (doc.body) {
                Array.from(doc.body.children).forEach(child => processNode(child));
            }

            // If no structured elements found, use the content as-is
            if (allElements.length === 0) {
                const textOnly = chapter.content.replace(/<[^>]*>/g, '').trim();
                if (textOnly.length > 0) {
                    allElements.push({
                        tag: 'p',
                        html: '<p>' + chapter.content + '</p>',
                        textLength: textOnly.length
                    });
                }
            }
            
            let currentChunk = '';
            // Only use title if chapter has one and it's not a metadata page
            let currentTitle = (!isMetadataPage && chapter.title) ? chapter.title : null;
            let isFirstChunkOfChapter = true; // Track if this is the first chunk

            // Helper function to split text by sentences
            const splitBySentences = (text) => {
                // Split by sentence endings, but keep the punctuation
                // Handle common sentence endings: . ! ? and also handle quotes/parentheses
                const sentences = text.match(/[^.!?]+[.!?]+[\])'"`'"]*\s*|.+$/g) || [text];
                return sentences.filter(s => s.trim().length > 0);
            };

            // Helper function to split a long paragraph
            const splitLongParagraph = (element) => {
                const textOnly = element.html.replace(/<[^>]*>/g, '');
                const tag = element.tag;
                const parts = [];
                
                if (textOnly.length <= maxChunkSize) {
                    // Paragraph fits in one chunk
                    return [element.html];
                }
                
                // Split by sentences first
                const sentences = splitBySentences(textOnly);
                let currentPart = '';
                
                sentences.forEach(sentence => {
                    const sentenceTrimmed = sentence.trim();
                    
                    // Check if adding this sentence would exceed limit
                    if (currentPart.length > 0 && 
                        (currentPart.length + sentenceTrimmed.length + 1 > maxChunkSize)) {
                        // Save current part and start new one
                        if (currentPart.trim()) {
                            parts.push(`<${tag}>${currentPart.trim()}</${tag}>`);
                        }
                        currentPart = sentenceTrimmed;
                    } else {
                        // Add sentence to current part
                        currentPart += (currentPart ? ' ' : '') + sentenceTrimmed;
                    }
                });
                
                // Add remaining part
                if (currentPart.trim()) {
                    parts.push(`<${tag}>${currentPart.trim()}</${tag}>`);
                }
                
                // Fallback: if splitting by sentences didn't work, split by words
                if (parts.length === 0 || (parts.length === 1 && parts[0].replace(/<[^>]*>/g, '').length > maxChunkSize)) {
                    // Split by words as last resort
                    const words = textOnly.split(/\s+/);
                    currentPart = '';
                    parts.length = 0; // Reset
                    
                    words.forEach(word => {
                        if (currentPart.length + word.length + 1 > maxChunkSize && currentPart.length > 0) {
                            parts.push(`<${tag}>${currentPart.trim()}</${tag}>`);
                            currentPart = word;
                        } else {
                            currentPart += (currentPart ? ' ' : '') + word;
                        }
                    });
                    
                    if (currentPart.trim()) {
                        parts.push(`<${tag}>${currentPart.trim()}</${tag}>`);
                    }
                }
                
                return parts.length > 0 ? parts : [element.html];
            };

            // Process elements in order
            allElements.forEach((element, elementIndex) => {
                const paraText = element.html.replace(/<[^>]*>/g, '').trim();
                const paraTextLength = paraText.length;
                
                // If paragraph is too long, split it
                if (paraTextLength > maxChunkSize) {
                    const paragraphParts = splitLongParagraph(element);
                    
                    paragraphParts.forEach((part, partIndex) => {
                        const partText = part.replace(/<[^>]*>/g, '').trim();
                        
                        // Check if current chunk + this part would exceed limit
                        if (currentChunk.length > 0 && 
                            (currentChunk.length + partText.length > maxChunkSize)) {
                            // Save current chunk
                            chunks.push({
                                id: chunkId++,
                                title: isFirstChunkOfChapter ? currentTitle : null,
                                chapterIndex: chapterIndex,
                                actualChapterNumber: chapterNumberToUse, // Use the extracted/calculated chapter number
                                chapterTitle: chapter.title,
                                text: currentChunk.trim()
                            });
                            currentChunk = '';
                            isFirstChunkOfChapter = false; // Subsequent chunks don't get title
                        }
                        
                        // Add this part to current chunk with spacing
                        if (currentChunk.length > 0 && !currentChunk.endsWith(' ')) {
                            currentChunk += ' '; // Add space between parts
                        }
                        currentChunk += part;
                    });
                } else {
                    // Normal paragraph - check if adding it would exceed limit
                    if (currentChunk.length > 0 && 
                        (currentChunk.length + paraTextLength > maxChunkSize)) {
                        // Save current chunk before it gets too long
                        chunks.push({
                            id: chunkId++,
                            title: isFirstChunkOfChapter ? currentTitle : null,
                            chapterIndex: chapterIndex,
                            actualChapterNumber: chapterNumberToUse, // Use the extracted/calculated chapter number
                            chapterTitle: chapter.title,
                            text: currentChunk.trim()
                        });
                        currentChunk = '';
                        isFirstChunkOfChapter = false; // Subsequent chunks don't get title
                    }
                    
                    // Add paragraph with formatting preserved
                    // Ensure proper spacing - paragraphs should naturally have margin from CSS
                    currentChunk += element.html;
                }
            });

            // Add remaining chunk (important - don't lose the last part!)
            if (currentChunk.trim()) {
                // Ensure proper HTML structure - normalize whitespace but preserve paragraph tags
                let finalChunk = currentChunk.trim();
                // Remove any extra whitespace between tags but keep paragraph structure
                finalChunk = finalChunk.replace(/>\s+</g, '><'); // Remove whitespace between tags
                // But ensure paragraphs are properly separated
                finalChunk = finalChunk.replace(/<\/p><p/g, '</p>\n<p'); // Add newline for readability (doesn't affect rendering)
                
                chunks.push({
                    id: chunkId++,
                    title: isFirstChunkOfChapter ? currentTitle : null,
                    chapterIndex: chapterIndex,
                    actualChapterNumber: chapterNumberToUse, // Use the extracted/calculated chapter number
                    chapterTitle: chapter.title,
                    text: finalChunk
                });
            }

            // Track chapter metadata (skip metadata pages like TOC)
            if (!isMetadataPage) {
                const chapterEndIndex = chunks.length - 1;
                if (chapterStartIndex <= chapterEndIndex) {
                    // Only add chapter info if we actually created chunks
                    if (chunks.length > chapterStartIndex) {
                    chapterInfo.push({
                        title: chapter.title,
                        startIndex: chapterStartIndex,
                        endIndex: chapterEndIndex,
                        chapterNumber: chapterNumberToUse // Use the extracted/calculated chapter number
                    });
                    }
                }
            }
        });

        // Store chapter metadata globally
        // Calculate totalChapters as the maximum chapter number (not just count)
        // This handles cases where chapters are numbered 3, 5, 7, 8 instead of 1, 2, 3, 4
        let maxChapterNumber = 0;
        chapterInfo.forEach(ch => {
            if (ch.chapterNumber && ch.chapterNumber > maxChapterNumber) {
                maxChapterNumber = ch.chapterNumber;
            }
        });
        
        // If no chapters found or all are null, use count as fallback
        const totalChapters = maxChapterNumber > 0 ? maxChapterNumber : chapterInfo.length;
        
        chapterMetadata = {
            chapters: chapterInfo,
            totalChapters: totalChapters
        };
        
        console.log('Chapter metadata:', {
            chapterCount: chapterInfo.length,
            maxChapterNumber: maxChapterNumber,
            totalChapters: totalChapters,
            chapters: chapterInfo.map(ch => ({ number: ch.chapterNumber, title: ch.title }))
        });

        return chunks;
    }
}

// HTML Parser
class HTMLParser {
    constructor() {
        this.document = null;
    }

    async loadHTML(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const htmlContent = e.target.result;
                    const parser = new DOMParser();
                    this.document = parser.parseFromString(htmlContent, 'text/html');
                    resolve(this.document);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    async extractText() {
        if (!this.document) return [];

        const chapters = [];
        
        // Strategy 1: Look for semantic HTML5 elements (article, section with data attributes)
        const articles = this.document.querySelectorAll('article[data-chapter], section[data-chapter]');
        if (articles.length > 0) {
            articles.forEach((article, index) => {
                const chapterNumber = article.getAttribute('data-chapter') || 
                                     article.getAttribute('data-chapter-number') ||
                                     (index + 1);
                const chapterTitle = article.getAttribute('data-chapter-title') ||
                                    article.querySelector('h1, h2, h3')?.textContent?.trim() ||
                                    null;
                
                const content = this.extractFormattedText(article);
                if (content.trim()) {
                    chapters.push({
                        title: chapterTitle,
                        content: content,
                        isMetadata: false,
                        chapterNumberFromIdref: parseInt(chapterNumber, 10) || null
                    });
                }
            });
        }
        
        // Strategy 2: Look for h1/h2 headings as chapter markers
        if (chapters.length === 0) {
            const headings = this.document.querySelectorAll('h1, h2');
            if (headings.length > 0) {
                let currentChapter = { title: null, content: '', elements: [] };
                let chapterNumber = 1;
                
                const allElements = Array.from(this.document.body.children);
                
                allElements.forEach(element => {
                    const tagName = element.tagName.toLowerCase();
                    
                    // Check if this is a chapter heading
                    if ((tagName === 'h1' || tagName === 'h2') && 
                        (element.textContent.trim().match(/chapter\s+\d+/i) || 
                         element.textContent.trim().match(/^\d+\./))) {
                        
                        // Save previous chapter if it has content
                        if (currentChapter.content.trim()) {
                            chapters.push({
                                title: currentChapter.title,
                                content: currentChapter.content,
                                isMetadata: false,
                                chapterNumberFromIdref: chapterNumber++
                            });
                        }
                        
                        // Start new chapter
                        currentChapter = {
                            title: element.textContent.trim(),
                            content: '',
                            elements: []
                        };
                    } else {
                        // Add to current chapter
                        currentChapter.elements.push(element);
                    }
                });
                
                // Add last chapter
                if (currentChapter.elements.length > 0) {
                    const tempDiv = document.createElement('div');
                    currentChapter.elements.forEach(el => {
                        tempDiv.appendChild(el.cloneNode(true));
                    });
                    currentChapter.content = this.extractFormattedText(tempDiv);
                    
                    if (currentChapter.content.trim()) {
                        chapters.push({
                            title: currentChapter.title,
                            content: currentChapter.content,
                            isMetadata: false,
                            chapterNumberFromIdref: chapterNumber
                        });
                    }
                }
            }
        }
        
        // Strategy 3: Fallback - treat entire body as one chapter
        if (chapters.length === 0) {
            const content = this.extractFormattedText(this.document.body);
            if (content.trim()) {
                // Try to extract title from h1 or title tag
                const title = this.document.querySelector('h1')?.textContent?.trim() ||
                             this.document.querySelector('title')?.textContent?.trim() ||
                             null;
                
                chapters.push({
                    title: title,
                    content: content,
                    isMetadata: false,
                    chapterNumberFromIdref: 1
                });
            }
        }
        
        return chapters;
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
                
                // Preserve paragraph breaks with styles
                if (tagName === 'p') {
                    const paraContent = this.extractFormattedText(child).trim();
                    if (paraContent) {
                        const style = child.getAttribute('style') || '';
                        const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                        html += `<p ${classAttr} ${style ? `style="${style}"` : ''}>${paraContent}</p>`;
                    }
                }
                // Preserve line breaks
                else if (tagName === 'br') {
                    html += '<br>';
                }
                // Preserve divs with styles
                else if (tagName === 'div') {
                    const divContent = this.extractFormattedText(child).trim();
                    if (divContent) {
                        const style = child.getAttribute('style') || '';
                        const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                        html += `<div ${classAttr} ${style ? `style="${style}"` : ''}>${divContent}</div>`;
                    }
                }
                // Preserve emphasis
                else if (tagName === 'em' || tagName === 'i') {
                    html += '<em>' + this.extractFormattedText(child) + '</em>';
                }
                else if (tagName === 'strong' || tagName === 'b') {
                    html += '<strong>' + this.extractFormattedText(child) + '</strong>';
                }
                // Preserve spans with styles
                else if (tagName === 'span') {
                    const style = child.getAttribute('style') || '';
                    const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                    const spanContent = this.extractFormattedText(child);
                    if (style || classAttr) {
                        html += `<span ${classAttr} ${style ? `style="${style}"` : ''}>${spanContent}</span>`;
                    } else {
                        html += spanContent;
                    }
                }
                // Preserve headings with their original tags
                else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
                    const headingContent = this.extractFormattedText(child).trim();
                    if (headingContent) {
                        const style = child.getAttribute('style') || '';
                        const classAttr = child.getAttribute('class') ? `class="${child.getAttribute('class')}"` : '';
                        html += `<${tagName} ${classAttr} ${style ? `style="${style}"` : ''}>${headingContent}</${tagName}>`;
                    }
                }
                // Handle links
                else if (tagName === 'a') {
                    const href = child.getAttribute('href') || '';
                    const linkContent = this.extractFormattedText(child);
                    if (href) {
                        html += `<a href="${href}">${linkContent}</a>`;
                    } else {
                        html += linkContent;
                    }
                }
                // Handle other inline elements
                else if (['small', 'sub', 'sup', 'u', 'mark'].includes(tagName)) {
                    html += `<${tagName}>${this.extractFormattedText(child)}</${tagName}>`;
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
        // Reuse the same chunking logic as EPUBParser
        const tempParser = new EPUBParser();
        return tempParser.chunkText(chapters, maxChunkSize);
    }

    async diagnoseHTML() {
        if (!this.document) return null;
        
        const metadata = {
            title: this.document.querySelector('title')?.textContent || 
                   this.document.querySelector('h1')?.textContent || 
                   'No title found',
            author: this.document.querySelector('meta[name="author"]')?.getAttribute('content') ||
                   this.document.querySelector('meta[property="author"]')?.getAttribute('content') ||
                   'Unknown',
            description: this.document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
        };
        
        const chapters = await this.extractText();
        
        return {
            metadata: metadata,
            chapters: chapters,
            totalChapters: chapters.length
        };
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
        this.threshold = 40; // Distance needed to trigger page change
        this.currentEpubIdentifier = null; // Track which EPUB is currently loaded
        this.originalChapters = null; // Store original chapters for re-chunking
        this.currentDensity = 'medium'; // Current text density: 'less', 'medium', 'more'
        this.parser = null; // Store parser instance for re-chunking
        this.analyticsTracker = new AnalyticsTracker();
        
        // Google Forms configuration
        this.googleFormId = '1FAIpQLScfogpt4UwmRULcF6mw5m_jrLfJ1RTduyGFX-1we8n-Qrdo5g';
        this.googleFormEntryIds = {
            sessionId: 'entry.453262883',
            sessionStartTimestamp: 'entry.779014196',
            sessionEndTimestamp: 'entry.1267759225',
            totalPagesRead: 'entry.890030520',
            lastPageIndex: 'entry.2011441323',
            totalPages: 'entry.492070347',
            progressPercentage: 'entry.1207501572',
            averageTimePerPage: 'entry.1771254717',
            totalTimeSpentReading: 'entry.1591503276',
            lastPageSizeSetting: 'entry.351585333',
            timeSpentInLess: 'entry.276628545',
            timeSpentInMedium: 'entry.948659475',
            timeSpentInMore: 'entry.1683789704',
            deviceType: 'entry.110755807'
        };
        
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
            if (index === this.currentIndex) reelItem.classList.add('active');
            
            // Debug: Log first chunk to verify HTML structure
            if (index === 0) {
                console.log('First chunk text (first 500 chars):', chunk.text.substring(0, 500));
                console.log('Contains <p> tags:', chunk.text.includes('<p>'));
            }
            
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
        
        // Track page view
        this.analyticsTracker.startPage(this.currentIndex, this.currentDensity);
        
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
        
        // Track page view
        this.analyticsTracker.startPage(this.currentIndex, this.currentDensity);
        
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
        
        // Save position if EPUB is loaded
        if (this.currentEpubIdentifier && textChunks.length > 0) {
            StorageManager.savePosition(this.currentEpubIdentifier, this.currentIndex);
        }
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

        // Get chapter info from chunk - use actualChapterNumber if available
        let chapterNum = null;
        
        if (currentChunk.actualChapterNumber !== null && currentChunk.actualChapterNumber !== undefined) {
            // Use the actual chapter number (excluding metadata)
            chapterNum = currentChunk.actualChapterNumber;
        } else {
            // Fallback: find chapter by checking which chapter range contains currentIndex
            const chapterInfo = chapterMetadata.chapters.find(ch => 
                this.currentIndex >= ch.startIndex && this.currentIndex <= ch.endIndex
            );
            if (chapterInfo) {
                chapterNum = chapterInfo.chapterNumber;
            }
        }

        if (chapterNum !== null && chapterNum > 0) {
            currentChapterNumber.textContent = chapterNum;
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
        
        // Track page view
        this.analyticsTracker.startPage(this.currentIndex, this.currentDensity);
        
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
        
        // Detect file type
        const fileName = file.name.toLowerCase();
        const isHTML = fileName.endsWith('.html') || fileName.endsWith('.htm');
        const isEPUB = fileName.endsWith('.epub');
        
        if (!isHTML && !isEPUB) {
            statusEl.textContent = '✗ Please select an EPUB or HTML file';
            uploadBtn.disabled = false;
            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
            return;
        }
        
        statusEl.textContent = isHTML ? 'Loading HTML file...' : 'Loading EPUB file...';
        
        try {
            let parser;
            let chapters;
            
            if (isHTML) {
                // HTML file processing
                parser = new HTMLParser();
                this.parser = parser; // Store parser for re-chunking
                statusEl.textContent = 'Parsing HTML structure...';
                
                await parser.loadHTML(file);
                statusEl.textContent = 'Analyzing HTML structure...';
                
                // Run diagnosis
                const diagnosis = await parser.diagnoseHTML();
                if (diagnosis) {
                    console.log('=== HTML DIAGNOSIS ===');
                    console.log('Metadata:', diagnosis.metadata);
                    console.log('Total chapters:', diagnosis.totalChapters);
                    console.log('Chapters:', diagnosis.chapters);
                    console.log('========================');
                }
                
                statusEl.textContent = 'Extracting text from chapters...';
                chapters = await parser.extractText();
            } else {
                // EPUB file processing
                // Check if epub.js is available
                if (typeof ePub === 'undefined') {
                    throw new Error('EPUB.js library not loaded. Please refresh the page.');
                }

                parser = new EPUBParser();
                this.parser = parser; // Store parser for re-chunking
                statusEl.textContent = 'Parsing EPUB structure...';
                
                await parser.loadEPUB(file);
                statusEl.textContent = 'Analyzing EPUB structure...';
                
                // Run diagnosis to see what information is available
                const diagnosis = await parser.diagnoseEPUB();
                if (diagnosis) {
                    console.log('=== EPUB DIAGNOSIS ===');
                    console.log('Metadata:', diagnosis.metadata);
                    console.log('Total spine items:', diagnosis.spine.length);
                    console.log('Spine items (first 10):', diagnosis.spine.slice(0, 10));
                    console.log('All spine items:', diagnosis.spine);
                    console.log('Navigation/TOC:', diagnosis.navigation);
                    console.log('========================');
                }
                
                statusEl.textContent = 'Extracting text from chapters...';
                chapters = await parser.extractText();
            }
            
            if (chapters.length === 0) {
                throw new Error(`No text content found in ${isHTML ? 'HTML' : 'EPUB'}. The file might be corrupted or empty.`);
            }
            
            // Store original chapters for re-chunking
            this.originalChapters = chapters;
            
            // Load density preference from localStorage
            const savedDensity = localStorage.getItem('pageup-text-density');
            if (savedDensity && ['less', 'medium', 'more'].includes(savedDensity)) {
                this.currentDensity = savedDensity;
            }
            
            // Get chunk size based on density
            const chunkSize = this.getChunkSizeForDensity(this.currentDensity);
            
            statusEl.textContent = `Processing ${chapters.length} chapters...`;
            
            const chunks = parser.chunkText(chapters, chunkSize);
            
            if (chunks.length === 0) {
                throw new Error('No readable content found in EPUB.');
            }
            
            // Create identifier for this EPUB
            const epubIdentifier = StorageManager.createEpubIdentifier(file);
            this.currentEpubIdentifier = epubIdentifier;
            
            // Check if we have a saved position for this EPUB
            const savedPosition = StorageManager.loadPosition();
            let startIndex = 0;
            let restoredPosition = false;
            
            if (savedPosition && savedPosition.epubIdentifier === epubIdentifier) {
                // Same EPUB - restore position
                startIndex = savedPosition.pageIndex;
                if (startIndex >= chunks.length) {
                    startIndex = 0; // Safety check - position might be invalid
                } else if (startIndex > 0) {
                    restoredPosition = true;
                }
            }
            
            // Update textChunks
            textChunks.length = 0;
            textChunks.push(...chunks);
            
            // Reset and start analytics tracking
            this.analyticsTracker.reset();
            this.analyticsTracker.currentDensity = this.currentDensity;
            this.analyticsTracker.startSession();
            
            // Re-render starting at saved position
            this.currentIndex = startIndex;
            this.renderReels();
            this.updateProgress();
            
            // Start tracking initial page view
            this.analyticsTracker.startPage(this.currentIndex, this.currentDensity);
            
            // Show chapter indicator by default when EPUB is loaded
            const chapterIndicator = document.getElementById('chapter-indicator');
            if (chapterIndicator && chapterMetadata.totalChapters > 0) {
                chapterIndicator.classList.remove('hidden');
            }
            
            // Show density control and update buttons
            const densityControl = document.getElementById('density-control');
            if (densityControl) {
                densityControl.classList.remove('hidden');
                this.updateDensityButtons();
            }
            
            // Show Done Reading button
            const doneReadingBtn = document.getElementById('done-reading-btn');
            if (doneReadingBtn) {
                doneReadingBtn.style.display = 'inline-block';
            }
            
            // Hide upload button
            document.getElementById('upload-container').classList.add('hidden');
            
            // Show appropriate message
            if (restoredPosition) {
                statusEl.textContent = `✓ Resumed from page ${startIndex + 1} of ${chunks.length}`;
            } else {
                statusEl.textContent = `✓ Loaded ${chunks.length} chunks`;
            }
            
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

    async loadFromLibrary(bookKey) {
        const statusEl = document.getElementById('upload-status');
        const uploadBtn = document.getElementById('upload-btn');
        
        if (!BookLibrary || !BookLibrary[bookKey]) {
            statusEl.textContent = '✗ Book not found in library';
            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
            return;
        }
        
        try {
            uploadBtn.disabled = true;
            statusEl.textContent = `Loading ${BookLibrary[bookKey].title}...`;
            
            const bookData = BookLibrary[bookKey];
            const htmlContent = bookData.html;
            
            // Create a File-like object from the HTML content
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const file = new File([blob], `${bookData.title}.html`, { type: 'text/html' });
            
            // Use the existing HTML parser
            await this.loadEPUB(file);
            
            statusEl.textContent = '';
        } catch (error) {
            statusEl.textContent = `✗ Error: ${error.message}`;
            console.error('Error loading from library:', error);
            setTimeout(() => {
                statusEl.textContent = '';
            }, 5000);
        } finally {
            uploadBtn.disabled = false;
        }
    }

    getChunkSizeForDensity(density) {
        // Chunk sizes optimized for phone screens
        switch(density) {
            case 'less':
                return 300; // Fewer words per page, more pages
            case 'more':
                return 800; // More words per page, fewer pages
            case 'medium':
            default:
                return 500; // Balanced
        }
    }

    changeTextDensity(newDensity) {
        if (!this.originalChapters || !this.parser) {
            console.warn('No EPUB loaded. Cannot change density.');
            return;
        }

        if (!['less', 'medium', 'more'].includes(newDensity)) {
            console.warn('Invalid density:', newDensity);
            return;
        }

        // Save current reading position - try to maintain same content
        const currentChunk = textChunks[this.currentIndex];
        if (!currentChunk) {
            console.warn('No current chunk found');
            return;
        }
        
        // Calculate relative position (percentage through the book)
        const currentPosition = textChunks.length > 1 
            ? this.currentIndex / (textChunks.length - 1) 
            : 0;
        const currentChapterIndex = currentChunk.chapterIndex;
        
        // Get a unique text snippet from current chunk for matching (first 200 chars, or a sentence)
        const currentChunkText = currentChunk.text;
        const textSnippet = this.extractTextSnippet(currentChunkText, 200);
        
        // Get new chunk size
        const newChunkSize = this.getChunkSizeForDensity(newDensity);
        
        // Re-chunk the text
        const newChunks = this.parser.chunkText(this.originalChapters, newChunkSize);
        
        if (newChunks.length === 0) {
            console.error('Failed to re-chunk text');
            return;
        }

        // Strategy 1: Try to find exact text match (best method)
        let newIndex = -1;
        if (textSnippet && textSnippet.length > 50) {
            // Try to find chunk containing this text snippet
            for (let i = 0; i < newChunks.length; i++) {
                if (newChunks[i].text.includes(textSnippet)) {
                    newIndex = i;
                    break;
                }
            }
        }
        
        // Strategy 2: If no exact match, use relative position within same chapter
        if (newIndex === -1 && currentChapterIndex !== undefined) {
            const currentChapterChunks = textChunks.filter(ch => ch.chapterIndex === currentChapterIndex);
            if (currentChapterChunks.length > 0) {
                const positionInChapter = currentChapterChunks.findIndex(ch => ch.id === currentChunk.id);
                const relativePositionInChapter = positionInChapter >= 0 
                    ? positionInChapter / Math.max(currentChapterChunks.length - 1, 1)
                    : 0;
                
                const newChapterChunks = newChunks.filter(ch => ch.chapterIndex === currentChapterIndex);
                if (newChapterChunks.length > 0) {
                    const targetIndexInChapter = Math.round(relativePositionInChapter * (newChapterChunks.length - 1));
                    const targetChunk = newChapterChunks[targetIndexInChapter];
                    newIndex = newChunks.indexOf(targetChunk);
                }
            }
        }
        
        // Strategy 3: Fallback to relative position in entire book (maintains percentage)
        if (newIndex === -1) {
            newIndex = Math.round(currentPosition * (newChunks.length - 1));
        }
        
        // Ensure index is valid
        newIndex = Math.max(0, Math.min(newIndex, newChunks.length - 1));

        // Update chunks
        textChunks.length = 0;
        textChunks.push(...newChunks);
        
        // Update density
        this.currentDensity = newDensity;
        localStorage.setItem('pageup-text-density', newDensity);
        
        // Update UI
        this.updateDensityButtons();
        
        // Re-render with new chunks
        this.currentIndex = Math.min(newIndex, newChunks.length - 1);
        this.renderReels();
        this.updateProgress();
        this.updateChapterIndicator();
        
        // Track page view with new density
        this.analyticsTracker.startPage(this.currentIndex, this.currentDensity);
    }

    extractTextSnippet(text, maxLength = 200) {
        if (!text || text.length === 0) return '';
        
        // Try to get a complete sentence if possible
        const sentences = text.match(/[^.!?]+[.!?]+[\])'"`'"]*\s*|.+$/g);
        if (sentences && sentences.length > 0) {
            let snippet = '';
            for (const sentence of sentences) {
                if (snippet.length + sentence.length <= maxLength) {
                    snippet += sentence;
                } else {
                    break;
                }
            }
            if (snippet.trim().length > 50) {
                return snippet.trim();
            }
        }
        
        // Fallback: get first maxLength characters, but try to end at word boundary
        if (text.length <= maxLength) {
            return text;
        }
        
        const truncated = text.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.7) {
            return truncated.substring(0, lastSpace).trim();
        }
        
        return truncated.trim();
    }

    updateDensityButtons() {
        const buttons = document.querySelectorAll('.density-btn');
        buttons.forEach(btn => {
            if (btn.dataset.density === this.currentDensity) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    toggleDensityControl() {
        const control = document.getElementById('density-control');
        if (!control) return;
        
        if (control.classList.contains('hidden')) {
            control.classList.remove('hidden');
        } else {
            control.classList.add('hidden');
        }
    }
    
    getDeviceType() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            ? 'mobile'
            : 'desktop';
    }
    
    async submitSessionData(sessionData) {
        if (!this.googleFormId) {
            console.warn('Google Form ID not configured');
            return false;
        }
        
        const formUrl = `https://docs.google.com/forms/d/e/${this.googleFormId}/formResponse`;
        
        // Build form data
        const formData = new FormData();
        formData.append(this.googleFormEntryIds.sessionId, sessionData.sessionId);
        formData.append(this.googleFormEntryIds.sessionStartTimestamp, sessionData.sessionStartTimestamp);
        formData.append(this.googleFormEntryIds.sessionEndTimestamp, sessionData.sessionEndTimestamp);
        formData.append(this.googleFormEntryIds.totalPagesRead, sessionData.totalPagesRead.toString());
        formData.append(this.googleFormEntryIds.lastPageIndex, sessionData.lastPageIndex.toString());
        formData.append(this.googleFormEntryIds.totalPages, sessionData.totalPages.toString());
        formData.append(this.googleFormEntryIds.progressPercentage, sessionData.progressPercentage.toString());
        formData.append(this.googleFormEntryIds.averageTimePerPage, sessionData.averageTimePerPage.toString());
        formData.append(this.googleFormEntryIds.totalTimeSpentReading, sessionData.totalTimeSpentReading.toString());
        formData.append(this.googleFormEntryIds.lastPageSizeSetting, sessionData.lastPageSizeSetting);
        formData.append(this.googleFormEntryIds.timeSpentInLess, sessionData.timeSpentInLess.toString());
        formData.append(this.googleFormEntryIds.timeSpentInMedium, sessionData.timeSpentInMedium.toString());
        formData.append(this.googleFormEntryIds.timeSpentInMore, sessionData.timeSpentInMore.toString());
        formData.append(this.googleFormEntryIds.deviceType, this.getDeviceType());
        
        try {
            // Submit via fetch (works without login, in incognito)
            const response = await fetch(formUrl, {
                method: 'POST',
                mode: 'no-cors', // Important: prevents CORS issues
                body: formData
            });
            
            // With no-cors, we can't read response, but submission should work
            return true;
        } catch (error) {
            console.error('Failed to submit analytics:', error);
            return false;
        }
    }
    
    async handleDoneReading() {
        if (!this.currentEpubIdentifier || textChunks.length === 0) {
            this.showConfirmation('No reading session to save.');
            return;
        }
        
        // End current page tracking
        this.analyticsTracker.startPage(this.currentIndex, this.currentDensity); // This will finalize previous
        
        // Get session data
        const sessionData = this.analyticsTracker.endSession();
        
        // Submit to Google Forms
        const submitted = await this.submitSessionData(sessionData);
        
        // Save locally as backup
        StorageManager.saveAnalytics(this.currentEpubIdentifier, sessionData);
        
        // Show confirmation (always show, even if submission failed silently)
        this.showConfirmation('Thanks! Your anonymous reading session has been saved.');
        
        // Reset tracker for potential new session
        this.analyticsTracker.reset();
    }
    
    showConfirmation(message) {
        // Remove existing confirmation if any
        const existing = document.getElementById('session-confirmation');
        if (existing) {
            existing.remove();
        }
        
        // Create confirmation element
        const confirmation = document.createElement('div');
        confirmation.id = 'session-confirmation';
        confirmation.textContent = message;
        confirmation.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: #fff;
            padding: 20px 30px;
            border-radius: 15px;
            font-size: 16px;
            z-index: 10000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            text-align: center;
            max-width: 80%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        
        document.body.appendChild(confirmation);
        
        // Fade in
        setTimeout(() => {
            confirmation.style.opacity = '1';
        }, 10);
        
        // Fade out and remove after 3 seconds
        setTimeout(() => {
            confirmation.style.opacity = '0';
            setTimeout(() => {
                confirmation.remove();
            }, 300);
        }, 3000);
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
        if (file) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.epub') || fileName.endsWith('.html') || fileName.endsWith('.htm')) {
                await reels.loadEPUB(file);
            } else {
                const statusEl = document.getElementById('upload-status');
                statusEl.textContent = 'Please select an EPUB or HTML file';
                setTimeout(() => {
                    statusEl.textContent = '';
                }, 3000);
            }
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
    
    // Density control handlers
    const densityControlArea = document.getElementById('density-control-area');
    const densityControl = document.getElementById('density-control');
    const densityButtons = document.querySelectorAll('.density-btn');
    
    // Toggle density control visibility when clicking the area background (but not buttons or control)
    if (densityControlArea) {
        densityControlArea.addEventListener('click', (e) => {
            // Only toggle if clicking the area background itself, not buttons or control
            if (e.target === densityControlArea) {
                e.stopPropagation();
                reels.toggleDensityControl();
            }
        });
        
        densityControlArea.addEventListener('touchend', (e) => {
            if (e.target === densityControlArea) {
                e.stopPropagation();
                e.preventDefault();
                reels.toggleDensityControl();
            }
        });
    }
    
    // Handle density button clicks - change density without toggling visibility
    densityButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const density = btn.dataset.density;
            if (density) {
                reels.changeTextDensity(density);
            }
        });
        
        btn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const density = btn.dataset.density;
            if (density) {
                reels.changeTextDensity(density);
            }
        });
    });
    
    // Allow clicking the control itself to toggle (but not buttons)
    if (densityControl) {
        densityControl.addEventListener('click', (e) => {
            // Only toggle if clicking the control background, not buttons
            if (e.target === densityControl) {
                e.stopPropagation();
                reels.toggleDensityControl();
            }
        });
    }
    
    // Done Reading button handler
    const doneReadingBtn = document.getElementById('done-reading-btn');
    if (doneReadingBtn) {
        doneReadingBtn.addEventListener('click', async () => {
            doneReadingBtn.disabled = true;
            await reels.handleDoneReading();
            doneReadingBtn.disabled = false;
        });
        
        doneReadingBtn.addEventListener('touchend', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            doneReadingBtn.disabled = true;
            await reels.handleDoneReading();
            doneReadingBtn.disabled = false;
        });
    }
    
    // Generate book library buttons
    const bookLibraryContainer = document.getElementById('book-library');
    if (bookLibraryContainer && typeof BookLibrary !== 'undefined') {
        Object.keys(BookLibrary).forEach(bookKey => {
            const book = BookLibrary[bookKey];
            const button = document.createElement('button');
            button.textContent = `Load "${book.title}"`;
            button.style.cssText = 'padding: 8px 15px; border-radius: 8px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: #fff; cursor: pointer; font-size: 13px; transition: all 0.2s ease; text-align: left;';
            button.addEventListener('mouseenter', () => {
                button.style.background = 'rgba(255,255,255,0.3)';
            });
            button.addEventListener('mouseleave', () => {
                button.style.background = 'rgba(255,255,255,0.2)';
            });
            button.addEventListener('click', async () => {
                await reels.loadFromLibrary(bookKey);
            });
            button.addEventListener('touchend', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await reels.loadFromLibrary(bookKey);
            });
            bookLibraryContainer.appendChild(button);
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

