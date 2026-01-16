async function waitForElement(getElement, identifier) {
    const targetElement = document[getElement](identifier);
    if (targetElement) {
        return targetElement;
    }

    return new Promise((resolve) => {
        const observer = new MutationObserver((_, observer) => {
            const element = document[getElement](identifier);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function showToast(message, color, duration = 3000) {
    if (!document.getElementById('toast-style')) {
      const style = document.createElement('style');
      style.id = 'toast-style';
      style.textContent = `
      .toast {
        position: fixed;
        top: 24px;
        right: 24px;
        background-color: ${color};
        color: white;
        padding: 12px 20px;
        border-radius: 5px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-family: sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(-20px);
        z-index: 9999;
      }
    
      .toast.show {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
    `;
      document.head.appendChild(style);
    }
  
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.backgroundColor = color;
    document.body.appendChild(toast);
  
    void toast.offsetHeight;
    toast.classList.add('show');
  
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
}

function formatArticleComponent(title, articleComponent) {
    if (!articleComponent) return '';
    
    let markdown = `# **${title}**\n\n`;
    
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim();
        }
        
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            const textContent = node.textContent.trim();
            
            switch (tagName) {
                case 'p':
                    if (textContent) {
                        return textContent + '\n\n';
                    }
                    break;
                    
                case 'div':
                    if (node.classList.contains('code-toolbar')) {
                        const codeElement = node.querySelector('code');
                        if (codeElement) {
                            return '```\n' + codeElement.textContent + '\n```\n\n';
                        }
                    }
                    let divContent = '';
                    for (const child of node.childNodes) {
                        divContent += processNode(child);
                    }
                    return divContent;
                    
                case 'ul':
                    let ulContent = '';
                    const listItems = node.querySelectorAll('li');
                    for (const li of listItems) {
                        ulContent += '- ' + li.textContent.trim() + '\n';
                    }
                    return ulContent + '\n';
                    
                case 'ol':
                    let olContent = '';
                    const orderedItems = node.querySelectorAll('li');
                    for (let i = 0; i < orderedItems.length; i++) {
                        olContent += (i + 1) + '. ' + orderedItems[i].textContent.trim() + '\n';
                    }
                    return olContent + '\n';
                    
                case 'details':
                    if (node.classList.contains('hint-accordion')) {
                        const summary = node.querySelector('summary');
                        const content = node.querySelector('div') || node.querySelector('p');
                        if (summary && content) {
                            return '### ' + summary.textContent.trim() + '\n\n' + 
                                   content.textContent.trim() + '\n\n';
                        }
                    }
                    break;
                    
                case 'br':
                    return '\n';
                    
                case 'strong':
                case 'b':
                    return '**' + textContent + '**';
                    
                case 'em':
                case 'i':
                    return '*' + textContent + '*';
                    
                case 'code':
                    if (node.parentElement && node.parentElement.classList.contains('code-toolbar')) {
                        return '```\n' + textContent + '\n```\n\n';
                    }
                    return '`' + textContent + '`';
                    
                case 'pre':
                    return '```\n' + textContent + '\n```\n\n';
                    
                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                    const level = parseInt(tagName.charAt(1));
                    const prefix = '#'.repeat(level);
                    return prefix + ' ' + textContent + '\n\n';
                    
                default:
                    let content = '';
                    for (const child of node.childNodes) {
                        content += processNode(child);
                    }
                    return content;
            }
        }
        
        return '';
    }
    
    for (const child of articleComponent.childNodes) {
        markdown += processNode(child);
    }
    
    return markdown.trim();
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // Handle request from background to get DOM data
    if (message.type === 'GET_DOM_DATA' && message.code && message.title) {
        try {
            const questionTitle = await waitForElement('querySelector', 'h1');
            const articleComponent = await waitForElement('querySelector', 'div.my-article-component-container');
            const markdownContent = formatArticleComponent(questionTitle.textContent, articleComponent);
            const languageElement = await waitForElement('querySelector', '.selected-language');

            // Send data to background script for GitHub upload
            chrome.runtime.sendMessage({
                type: 'UPLOAD_TO_GITHUB',
                code: message.code,
                questionTitle: questionTitle.textContent,
                markdownContent: markdownContent,
                language: languageElement.textContent
            });
        } catch (error) {
            showToast('Failed to extract page data', '#e74c3c');
        }
    }
    
    // Handle result from background script
    if (message.type === 'GITHUB_RESULT') {
        if (message.success) {
            const toastMessage = message.updated ? 'Successfully updated in GitHub' : 'Successfully added to GitHub';
            showToast(toastMessage, '#007bff');
        } else {
            const errorMessage = message.error || 'Failed to add to GitHub';
            showToast(errorMessage, '#e74c3c');
        }
    }
});
