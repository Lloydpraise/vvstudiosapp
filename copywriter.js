/**
 * AI Copywriter Engine - VV Studios
 * Connects to Supabase Edge Functions & Tables
 */

// --- 1. INITIALIZATION ---
// Replace these with your actual Supabase credentials if not already handled in index.html
const SB_URL = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

// Create client only if it doesn't exist to avoid "already declared" errors
if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(SB_URL, SB_KEY);
}

// --- 2. STATE MANAGEMENT ---
let currentCategory = 'social';
let lastResponseData = null;
let lastGenerationId = null; // Tracks the ID in the copywriter_history table

// --- 3. UI CATEGORY SWITCHING ---
window.setCategory = function(id) {
    currentCategory = id;
    
    // Update Selection UI
    document.querySelectorAll('.category-card').forEach(c => {
        c.classList.remove('active');
        const icon = c.querySelector('i');
        if (icon) icon.classList.add('text-white/50');
    });
    
    const activeCard = document.getElementById('cat-' + id);
    if (activeCard) {
        activeCard.classList.add('active');
        const activeIcon = activeCard.querySelector('i');
        if (activeIcon) activeIcon.classList.remove('text-white/50');
    }

    // Switch Forms
    document.querySelectorAll('form').forEach(f => f.classList.add('hidden'));
    const activeForm = document.getElementById('form-' + id);
    if(activeForm) {
        activeForm.classList.remove('hidden');
        activeForm.classList.add('fade-in');
    }

    // Reset Output View
    document.getElementById('result-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    lastResponseData = null;
    lastGenerationId = null;
};

// --- 4. CORE GENERATION LOGIC ---
window.handleGenerate = async function(e) {
    if (e) e.preventDefault();
    
    // Identify the active form and the button that triggered the event
    const activeForm = document.getElementById(`form-${currentCategory}`);
    const btn = e.submitter || document.querySelector('button[onclick*="dispatchEvent"]');
    const originalBtnHTML = btn ? btn.innerHTML : "Generate Copy";

    // 1. Gather User Identity and Form Data
    const formData = new FormData(activeForm);
    const formValues = Object.fromEntries(formData.entries());
    
    // Extract business_id from vvUser in localStorage
    let businessId = 'general_user';
    try {
        const rawUser = localStorage.getItem('vvUser');
        if (rawUser) {
            const user = JSON.parse(rawUser);
            // Matches the keys used in your index.html login flow
            businessId = user.business_id || user['business id'] || user.id;
        }
    } catch (err) {
        console.error("Error reading vvUser identity:", err);
    }

    // 2. Update UI to Loading State
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Writing...`;
    }
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('result-state').classList.add('hidden');
    document.getElementById('loading-state').classList.remove('hidden');

    try {
        // 3. Call Supabase Edge Function
        // Note: Use 'generate-marketing-copy' to match your function name
        const { data, error } = await window.supabaseClient.functions.invoke('generate-copy', {
            body: { 
                business_id: businessId,
                category: currentCategory,
                form_data: formValues
            }
        });

        if (error) throw error;

        // 4. Handle Success
        lastResponseData = data.content; 
        lastGenerationId = data.history_id; 

        renderOutput(lastResponseData);
        
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('result-state').classList.remove('hidden');

    } catch (err) {
        console.error("Generation Error:", err);
        alert(`Error: ${err.message || "Failed to connect to AI service"}`);
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('empty-state').classList.remove('hidden');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHTML;
        }
    }
};
// --- 5. SAVING LOGIC ---
window.saveDraft = async function() {
    if (!lastGenerationId) {
        alert("Please generate content first.");
        return;
    }

    try {
        const { error } = await window.supabaseClient
            .from('copywriter_history')
            .update({ is_saved: true })
            .eq('id', lastGenerationId);

        if (error) throw error;

        const saveBtn = document.querySelector('button[onclick="saveDraft()"]');
        saveBtn.innerHTML = `<i class="fa-solid fa-check text-green-400"></i> Saved`;
        setTimeout(() => {
            saveBtn.innerHTML = `<i class="fa-regular fa-bookmark"></i> Save`;
        }, 2000);

    } catch (err) {
        console.error("Save Error:", err);
        alert("Could not save to database.");
    }
};

// --- 6. OUTPUT RENDERING (RETAINED FROM ORIGINAL) ---

function renderOutput(response) {
    const container = document.getElementById('dynamic-output');
    container.innerHTML = ''; 

    if (!response || !response.type) {
        container.innerHTML = `<div class="p-6 text-white/50 text-center">Unexpected AI response format.</div>`;
        return;
    }

    // Routes the data to the correct visual component
    switch (response.type) {
        case 'social_media': renderSocialMediaOutput(response, container); break;
        case 'ads': renderAdsOutput(response, container); break;
        case 'website': renderWebsiteOutput(response, container); break;
        case 'whatsapp': renderWhatsAppOutput(response, container); break;
        case 'offer': renderOfferOutput(response, container); break;
        case 'branding': renderBrandingOutput(response, container); break;
        case 'script': renderScriptOutput(response, container); break;
        default:
            container.innerHTML = `<div class="p-6 text-white/50 text-center">Category renderer not found.</div>`;
    }
}

// Sub-renderers (Pure logic from your original file)

function renderSocialMediaOutput(data, container) {
    const variations = data.variations || [];
    const tabsHeader = document.createElement('div');
    tabsHeader.className = "flex border-b border-white/5 px-4 pt-2 gap-4 shrink-0 bg-[#1a1d23]";
    
    variations.forEach((_, i) => {
        const activeClass = i === 0 ? 'active' : '';
        tabsHeader.innerHTML += `<button onclick="switchVariationTab(${i})" class="tab-btn ${activeClass} text-sm pb-2 font-medium" data-tab="${i}">Variation ${i+1}</button>`;
    });
    container.appendChild(tabsHeader);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = "flex-1 p-5 relative";
    
    variations.forEach((text, i) => {
        const hiddenClass = i === 0 ? '' : 'hidden';
        const div = document.createElement('div');
        div.id = `var-content-${i}`;
        div.className = `variation-content ${hiddenClass} text-white/90 leading-relaxed whitespace-pre-wrap font-light text-sm`;
        div.innerHTML = `
            <div class="bg-white/5 p-4 rounded-lg border border-white/5 relative group">
                ${text}
                <button onclick="copyText('${escapeHtml(text)}', this)" class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition bg-black/50 hover:bg-black text-xs text-white px-2 py-1 rounded"><i class="fa-regular fa-copy"></i></button>
            </div>
        `;
        contentWrapper.appendChild(div);
    });

    if(data.hashtags) {
        contentWrapper.innerHTML += `<div class="mt-4 pt-4 border-t border-white/10 text-blue-300 text-sm italic">
            <span class="text-white/40 text-xs font-bold uppercase block mb-1">Hashtags</span> ${data.hashtags.join(' ')}
        </div>`;
    }
    container.appendChild(contentWrapper);
}

function renderAdsOutput(data, container) {
    let html = `<div class="p-5 space-y-6">`;
    if(data.headlines) {
        html += `<div><h4 class="text-xs text-white/40 uppercase font-bold mb-2">Headlines</h4><div class="space-y-2">
        ${data.headlines.map(h => `<div class="bg-white/5 p-3 rounded border border-white/5 flex justify-between items-center group"><span class="text-sm text-white/90 font-medium">${h}</span><button onclick="copyText('${escapeHtml(h)}', this)" class="text-white/30 hover:text-white"><i class="fa-regular fa-copy"></i></button></div>`).join('')}
        </div></div>`;
    }
    if(data.primary_text) {
        html += `<div><h4 class="text-xs text-white/40 uppercase font-bold mb-2">Primary Text</h4>
        <div class="bg-white/5 p-4 rounded-lg border border-white/5 relative group">
            <p class="text-sm text-white/80 whitespace-pre-wrap">${data.primary_text.short || data.primary_text}</p>
            <button onclick="copyText('${escapeHtml(data.primary_text.short || data.primary_text)}', this)" class="absolute top-2 right-2 text-white/30 hover:text-white"><i class="fa-regular fa-copy"></i></button>
        </div></div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
}

function renderWebsiteOutput(data, container) {
    container.innerHTML = `<div class="p-5 space-y-6">
        <div class="bg-gradient-to-br from-white/5 to-transparent p-6 rounded-xl border border-white/10 text-center relative">
            <h2 class="text-xl md:text-2xl font-bold text-white mb-3">${data.headline}</h2>
            <p class="text-white/70 text-sm leading-relaxed">${data.paragraph}</p>
            ${data.cta ? `<div class="mt-4 inline-block px-5 py-2 bg-orange-600 rounded text-sm font-bold text-white">${data.cta}</div>` : ''}
        </div>
    </div>`;
}

function renderWhatsAppOutput(data, container) {
    let html = `<div class="p-5 space-y-4">`;
    const msg = data.main_message || data.text;
    html += `<div class="bg-[#0b141a] border border-[#202c33] p-4 rounded-lg relative max-w-[90%] mx-auto shadow-lg">
        <div class="text-sm text-white/90 whitespace-pre-wrap">${msg}</div>
        <button onclick="copyText('${escapeHtml(msg)}', this)" class="absolute -right-8 top-0 text-white/30 hover:text-white p-2"><i class="fa-regular fa-copy"></i></button>
    </div></div>`;
    container.innerHTML = html;
}

function renderOfferOutput(data, container) {
    container.innerHTML = `<div class="p-5">
        <div class="bg-gradient-to-r from-orange-500/10 to-purple-500/10 border border-orange-500/20 rounded-xl p-6 text-center relative">
            <div class="text-orange-400 font-bold tracking-widest text-xs uppercase mb-2">OFFER</div>
            <h2 class="text-2xl font-bold text-white mb-2">${data.headline}</h2>
            <p class="text-white/70 text-sm mb-6">${data.description}</p>
            <button onclick="copyText('${escapeHtml(data.headline + ' ' + data.description)}', this)" class="bg-white/10 px-4 py-2 rounded-lg border border-dashed border-white/20 text-sm font-mono text-orange-200">COPY OFFER</button>
        </div>
    </div>`;
}

function renderBrandingOutput(data, container) {
    container.innerHTML = `<div class="p-5 space-y-6">
        <div><h4 class="text-xs text-white/40 uppercase font-bold mb-2">Brand Voice Option</h4>
        <div class="bg-white/5 p-4 rounded-xl border border-white/10 text-lg font-medium text-white/90 text-center relative">
            "${data.primary}"
            <button onclick="copyText('${escapeHtml(data.primary)}', this)" class="absolute top-2 right-2 text-white/30 hover:text-white"><i class="fa-regular fa-copy"></i></button>
        </div></div>
    </div>`;
}

function renderScriptOutput(data, container) {
    container.innerHTML = `<div class="p-5 space-y-6">
        <div><h4 class="text-xs text-white/40 uppercase font-bold mb-2">Video Script Hook</h4>
        <div class="bg-white/5 p-4 rounded-lg border border-white/5 text-sm text-white/80 whitespace-pre-wrap relative italic">
            ${data.hook}
        </div></div>
        <div><h4 class="text-xs text-white/40 uppercase font-bold mb-2">Body Script</h4>
        <div class="bg-white/5 p-4 rounded-lg border border-white/5 text-sm text-white/80 whitespace-pre-wrap relative">
            ${data.script}
        </div></div>
    </div>`;
}

// --- 7. UTILITY HELPERS ---

window.switchVariationTab = function(index) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${index}"]`).classList.add('active');
    document.querySelectorAll('.variation-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`var-content-${index}`).classList.remove('hidden');
};

window.copyText = function(text, btnElement) {
    if (!text) return;
    navigator.clipboard.writeText(text.replace(/\\n/g, '\n')).then(() => {
        const originalIcon = btnElement.innerHTML;
        btnElement.innerHTML = `<i class="fa-solid fa-check text-green-400"></i>`;
        setTimeout(() => { btnElement.innerHTML = originalIcon; }, 1500);
    });
};

function escapeHtml(text) {
     if(!text) return '';
     return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\n/g, "\\n"); 
}

// Ensure first category is loaded
document.addEventListener('DOMContentLoaded', () => {
    setCategory('social');
});