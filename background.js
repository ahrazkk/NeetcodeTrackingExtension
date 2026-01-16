// Helper function to get date in YYYY-MM-DD format
function getDate() {
    const date = new Date();
    return date.toISOString().split('T')[0];
}

// Get language file extension
function getLanguage(language) {
    const languageMap = {
        "Python": "py",
        "Java": "java",
        "C++": "cpp",
        "C#": "cs",
        "JavaScript": "js",
        "TypeScript": "ts",
        "Go": "go",
        "Ruby": "rb",
        "Swift": "swift",
        "Kotlin": "kt",
        "Rust": "rs"
    };
    return languageMap[language] || "py";
}

// Get stored GitHub config from chrome.storage
async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['github_token', 'github_username', 'github_repo', 'committer_name', 'committer_email'], (result) => {
            resolve({
                token: result.github_token || '',
                username: result.github_username || '',
                repo: result.github_repo || '',
                committerName: result.committer_name || 'Neetcode Tracker',
                committerEmail: result.committer_email || 'neetcode-tracker@example.com'
            });
        });
    });
}

// Check if a file exists in the GitHub repo
async function findExistingFile(config, pathName) {
    try {
        const response = await fetch(
            `https://api.github.com/repos/${config.username}/${config.repo}/contents/${pathName}`,
            {
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );
        const data = await response.json();
        return {
            response: data,
            status: response.status
        };
    } catch (error) {
        return {
            response: null,
            status: 500,
            error: error.message
        };
    }
}

// Upload file to GitHub
async function uploadToGitHub(config, pathName, dataToAdd) {
    try {
        const response = await fetch(
            `https://api.github.com/repos/${config.username}/${config.repo}/contents/${pathName}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${config.token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(dataToAdd)
            }
        );
        const data = await response.json();
        return {
            response: data,
            status: response.status
        };
    } catch (error) {
        return {
            response: null,
            status: 500,
            error: error.message
        };
    }
}

// Add a single file to GitHub
async function addToGithub(config, content, title, contentType, fileType) {
    try {
        const date = getDate();
        const pathName = `${date}/${title}/${contentType}.${fileType}`;
        const dataToAdd = {
            owner: config.username,
            repo: config.repo,
            path: pathName,
            message: `Added ${title} on ${date}`,
            committer: {
                name: config.committerName,
                email: config.committerEmail
            },
            content: btoa(String.fromCharCode(...new TextEncoder().encode(content)))
        };

        const existingFile = await findExistingFile(config, pathName);
        if (existingFile.status === 200) {
            dataToAdd.sha = existingFile.response.sha;
            const data = await uploadToGitHub(config, pathName, dataToAdd);
            return {
                response: data,
                status: data.status,
                updated: true
            };
        } else {
            const data = await uploadToGitHub(config, pathName, dataToAdd);
            return {
                response: data,
                status: data.status,
                updated: false
            };
        }
    } catch (error) {
        return {
            response: null,
            status: 500,
            error: error.message
        };
    }
}

// Add both solution and problem files to GitHub
async function addContentToGitHub(config, code, questionTitle, questionContent, language) {
    const title = questionTitle.replace(/\s+/g, '-').toLowerCase().trim();
    const solutionResult = await addToGithub(config, code, title, "solution", getLanguage(language));
    
    if (solutionResult.status !== 201 && solutionResult.status !== 200) {
        return solutionResult;
    }

    const problemResult = await addToGithub(config, questionContent, title, "problem", "md");
    
    if (problemResult.status !== 201 && problemResult.status !== 200) {
        return problemResult;
    }

    return {
        status: problemResult.status,
        updated: solutionResult.updated || problemResult.updated
    };
}

// Listen for code submission requests
chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        if (!details.url.includes("https://us-central1-neetcode-dd170.cloudfunctions.net/executeCodeFunction")) {
            return;
        }

        try {
            const requestBody = details.requestBody;
            if (!requestBody || !requestBody.raw || !requestBody.raw[0] || !requestBody.raw[0].bytes) {
                console.error('Invalid request body structure');
                return;
            }

            const buffer = requestBody.raw[0].bytes;
            const uint8Array = new Uint8Array(buffer);
            const decoder = new TextDecoder('utf-8');
            const decodedString = decoder.decode(uint8Array);
            
            // Validate JSON before parsing
            let data;
            try {
                data = JSON.parse(decodedString);
            } catch (parseError) {
                console.error('Failed to parse request body as JSON:', parseError);
                return;
            }

            // Validate required fields
            if (!data.data || !data.data.problemId || !data.data.rawCode) {
                console.error('Missing required fields in request data');
                return;
            }

            const title = data.data.problemId;
            const code = data.data.rawCode;

            // Send message to content script to get DOM data
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'GET_DOM_DATA',
                        title: title,
                        code: code
                    });
                }
            });
        } catch (error) {
            console.error('Error processing request:', error);
        }
    },
    { urls: ["https://us-central1-neetcode-dd170.cloudfunctions.net/*"] },
    ["requestBody"]
);

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPLOAD_TO_GITHUB') {
        (async () => {
            try {
                const config = await getConfig();
                
                // Validate config
                if (!config.token || !config.username || !config.repo) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'GITHUB_RESULT',
                        success: false,
                        error: 'GitHub configuration missing. Please set up your credentials.'
                    });
                    return;
                }

                const result = await addContentToGitHub(
                    config,
                    message.code,
                    message.questionTitle,
                    message.markdownContent,
                    message.language
                );

                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'GITHUB_RESULT',
                    success: result.status === 200 || result.status === 201,
                    updated: result.updated,
                    error: result.error
                });
            } catch (error) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'GITHUB_RESULT',
                    success: false,
                    error: error.message
                });
            }
        })();
        return true; // Keep message channel open for async response
    }
});

// Initialize storage with default values if not set
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['github_token'], (result) => {
        if (!result.github_token) {
            console.log('Neetcode Tracker: Please configure your GitHub settings.');
            console.log('Use chrome.storage.local.set() to configure:');
            console.log('- github_token: Your GitHub personal access token');
            console.log('- github_username: Your GitHub username');
            console.log('- github_repo: Your repository name');
            console.log('- committer_name: (optional) Name for commits');
            console.log('- committer_email: (optional) Email for commits');
        }
    });
});