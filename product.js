// Extracted from product.html - keeps original behavior but moved to external file
// --- CONFIGURATION ---
// Use existing globals if they were defined by the app, otherwise fall back to these values.
const SUPABASE_URL_LOCAL = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SUPABASE_KEY_LOCAL = (typeof SUPABASE_KEY !== 'undefined') ? SUPABASE_KEY : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

// Create or reuse a Supabase client without declaring the global name `supabase`.
let supabaseClient;
if (typeof supabase !== 'undefined') {
    // If the global `supabase` is the library (has createClient), create a client.
    if (typeof supabase.createClient === 'function') {
        supabaseClient = supabase.createClient(SUPABASE_URL_LOCAL, SUPABASE_KEY_LOCAL);
    } else {
        // Assume `supabase` is already a client instance provided by the app.
        supabaseClient = supabase;
    }
} else if (window && window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL_LOCAL, SUPABASE_KEY_LOCAL);
} else {
    console.error('Supabase library not found. Ensure @supabase/supabase-js is loaded.');
}

// Helper: Image URL Generator
function getPublicImageUrl(path) {
    if (!path) return "";
    if (path.startsWith("http") || path.startsWith("//")) return path;
    const bucketName = "ecommerce-assets"; 
    const cleanPath = path.replace(new RegExp(`^${bucketName}\/`), "");
    const { data } = supabaseClient.storage.from(bucketName).getPublicUrl(cleanPath);
    return data.publicUrl;
}

// --- STATE ---
// Avoid redeclaring globals if they were defined inline in `product.html`.
if (typeof productData === 'undefined') productData = null;
if (typeof businessData === 'undefined') var businessData = null;
if (typeof activeOffers === 'undefined') var activeOffers = []; // Holds all active offers
if (typeof selectedVariations === 'undefined') var selectedVariations = {};
if (typeof currentPrice === 'undefined') var currentPrice = 0;
if (typeof currentOfferLabel === 'undefined') var currentOfferLabel = ""; // For WhatsApp message

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    
    // App Back Button Logic (Preserved)
    try {
        if (urlParams.get('from_app') === '1') {
            const header = document.querySelector('header');
            const backBtn = document.createElement('button');
            backBtn.className = 'absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/80 bg-white/5 hover:bg-white/10 py-1 px-3 rounded-lg';
            backBtn.innerText = '← Back';
            backBtn.onclick = () => window.history.back();
            header.appendChild(backBtn);
        }
    } catch(e){}

    if (!productId) return showError();

    try {
        await loadProduct(productId);
    } catch (err) {
        console.error(err);
        showError();
    }

        // Desc Toggle (safe attach)
        const descToggle = document.getElementById('desc-toggle');
        if (descToggle) {
            descToggle.addEventListener('click', () => {
                const c = document.getElementById('desc-content');
                if (!c) return;
                c.classList.toggle('hidden');
                const chevron = document.getElementById('desc-chevron');
                if (chevron) chevron.style.transform = c.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
            });
        }
});

// --- CORE FUNCTIONS ---

async function loadProduct(productId) {
    // 1. Fetch Product
    const { data: product, error: prodError } = await supabaseClient
        .from('products').select('*').eq('id', productId).single();
    if (prodError || !product) throw new Error("Product not found");
    productData = product;

    // 2. Fetch Business Settings
    const { data: biz } = await supabaseClient
        .from('business_settings').select('*').eq('business_id', product.business_id).single();
    businessData = biz || { brand_colors: {} };

    // 3. Fetch ALL Active Offers (Sorted by priority)
    const { data: offers } = await supabaseClient
        .from('offers')
        .select('*')
        .eq('product_id', productId)
        .eq('is_active', true)
        .gte('end_date', new Date().toISOString())
        .order('priority', { ascending: true }); // Priority 1 comes first
    
    activeOffers = offers || [];

    renderPage(product, businessData, activeOffers);
}

async function renderPage(product, biz, offers) {
    // --- Theme Setup ---
    const colors = biz.brand_colors || {};
    const root = document.documentElement;
    if(colors.primary) root.style.setProperty('--primary-color', colors.primary);
    if(colors.secondary) root.style.setProperty('--secondary-color', colors.secondary);
    if(colors.background) root.style.setProperty('--bg-page', colors.background);

    // --- Basic Product Data ---
    if (biz.logo_url) {
        const logo = document.getElementById('biz-logo');
        logo.src = getPublicImageUrl(biz.logo_url);
        logo.classList.remove('hidden');
        document.getElementById('logo-placeholder').classList.add('hidden');
    }
    if (biz.business_name) document.getElementById('biz-name').textContent = biz.business_name;
    document.getElementById('product-title').innerText = product.title;
    document.getElementById('product-desc-short').innerText = product.description_short || '';
    document.getElementById('product-desc-long').innerHTML = (product.description_long || '').replace(/\n/g, '<br>');

    // --- Images ---
    const images = product.images || [];
    if (images.length > 0) {
        document.getElementById('main-image').src = getPublicImageUrl(images[0]);
        // Thumbnails logic (support multiple images and active state)
        const tCon = document.getElementById('image-thumbnails');
        tCon.innerHTML = '';
        images.forEach((img, i) => {
            const thumb = document.createElement('img');
            thumb.src = getPublicImageUrl(img);
            thumb.alt = `${product.title} - ${i+1}`;
            thumb.dataset.src = img;
            thumb.className = `gallery-thumb w-14 h-14 rounded-md object-cover border border-transparent cursor-pointer hover:border-white/50 opacity-90`;
            if (i === 0) thumb.classList.add('active');
            thumb.onclick = () => {
                // update main image
                document.getElementById('main-image').src = getPublicImageUrl(img);
                // update active marker
                Array.from(tCon.children).forEach(c => c.classList.remove('active'));
                thumb.classList.add('active');
            };
            tCon.appendChild(thumb);
        });
    }

    // --- OFFER LOGIC ENGINE ---
    let price = product.price;
    currentPrice = price; 
    let primaryOffer = null;
    let secondaryOffer = null; // Usually Shipping

    // Separate offers
    if(offers.length > 0) {
        // Find stackable offer (usually shipping)
        secondaryOffer = offers.find(o => o.offer_type === 'SHIPPING');
        // Find primary offer (Discount, Flash Sale, BOGO, Bundle)
        primaryOffer = offers.find(o => o.offer_type !== 'SHIPPING');
    }

    // 1. Handle Primary Offer (Affects Price/Badges)
    if (primaryOffer) {
        const type = primaryOffer.offer_type;
        const config = primaryOffer.configuration || {};
        const badge = document.getElementById('offer-badge');
        
        badge.classList.remove('hidden');

        if (type === 'FLASH_SALE' || type === 'DISCOUNT') {
            // Calculate Discount
            let finalPrice = price;
            let label = "";

            if (config.percent) {
                finalPrice = price * (1 - (config.percent / 100));
                label = `-${config.percent}%`;
            } else if (config.amount) {
                finalPrice = price - config.amount;
                label = `-KES ${config.amount}`;
            } else if (primaryOffer.discount_value) {
                 // Fallback for legacy table structure if used
                 if(primaryOffer.discount_type === 'percent') finalPrice = price * (1 - (primaryOffer.discount_value/100));
                         else finalPrice = price - primaryOffer.discount_value;
            }

            // Render Price
            document.getElementById('price-old').innerText = `KES ${price.toLocaleString()}`;
            document.getElementById('price-old').classList.remove('hidden');
            document.getElementById('price-current').innerText = `KES ${finalPrice.toLocaleString()}`;
            badge.innerText = type === 'FLASH_SALE' ? `FLASH SALE ${label}` : `${label} OFF`;
            currentPrice = finalPrice;
            currentOfferLabel = `Discount Applied (${label})`;

            // Timer for Flash Sale
            if (type === 'FLASH_SALE' && primaryOffer.end_date) {
                startTimer(primaryOffer.end_date);
            }
        } 
        else if (type === 'BOGO') {
            // Logic: Price stays same (usually), but CTA changes
            const buy = config.buy_qty || 1;
            const get = config.get_qty || 1;
            badge.innerText = `BUY ${buy} GET ${get} FREE`;
            document.getElementById('price-current').innerText = `KES ${price.toLocaleString()}`;
            currentOfferLabel = `Offer: Buy ${buy} Get ${get} Free`;
            
            // Update CTA Text
            const ctaText = `Buy ${buy} Get ${get} Free - Order Now`;
            document.getElementById('desktop-cta-text').innerText = ctaText;
            document.getElementById('mobile-cta-text').innerText = ctaText;
        }
        else if (type === 'BUNDLE') {
            // Logic: Price might be fixed bundle price OR same price + free gift
            if (config.bundle_price) {
                document.getElementById('price-old').innerText = `KES ${price.toLocaleString()}`;
                document.getElementById('price-old').classList.remove('hidden');
                currentPrice = config.bundle_price;
            }
            document.getElementById('price-current').innerText = `KES ${currentPrice.toLocaleString()}`;
            badge.innerText = "FREE GIFT";
            currentOfferLabel = "Bundle Offer Included";

            // Load Tied Product Data
            if (config.gift_product_id) {
                loadBundleItem(config.gift_product_id);
            }
        }
    } else {
        // No Price Offer
        document.getElementById('price-current').innerText = `KES ${price.toLocaleString()}`;
        if(product.old_price > price) {
            document.getElementById('price-old').innerText = `KES ${product.old_price.toLocaleString()}`;
            document.getElementById('price-old').classList.remove('hidden');
        }
    }

    // 2. Handle Secondary Offer (Shipping)
    if (secondaryOffer && secondaryOffer.offer_type === 'SHIPPING') {
        const bar = document.getElementById('announcement-bar');
        const text = document.getElementById('announcement-text');
        const config = secondaryOffer.configuration || {};
        
        bar.style.display = 'block';
        if (config.threshold) {
            text.innerText = `FREE SHIPPING ON ORDERS OVER KES ${config.threshold}`;
        } else {
            text.innerText = secondaryOffer.name || "FREE SHIPPING ON THIS ITEM";
        }
        // Push header down slightly so bar doesn't overlap logo
        try {
            const headerEl = document.querySelector('header');
            if (headerEl) headerEl.style.marginTop = `${bar.offsetHeight}px`;
        } catch(e){}
    }

    // --- Variations ---
    const varContainer = document.getElementById('variations-container');
    (product.variations || []).forEach(v => {
        const group = document.createElement('div');
        group.innerHTML = `<h3 class="text-sm font-medium text-white/70 mb-2 uppercase tracking-wide">${v.name}</h3>`;
        const optsDiv = document.createElement('div');
        optsDiv.className = 'flex flex-wrap gap-2';
        v.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = `var-btn px-4 py-2 rounded-lg border border-white/20 hover:border-white/50 transition-colors text-sm ${i===0 ? 'selected' : ''}`;
            btn.innerText = opt;
            if(i===0) selectedVariations[v.name] = opt;
            btn.onclick = () => {
                Array.from(optsDiv.children).forEach(c => c.classList.remove('selected'));
                btn.classList.add('selected');
                selectedVariations[v.name] = opt;
            };
            optsDiv.appendChild(btn);
        });
        group.appendChild(optsDiv);
        varContainer.appendChild(group);
    });

    // Reveal Page
    // Ensure offer elements are placed correctly relative to layout changes
    placeOfferElements(primaryOffer, secondaryOffer);

    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    // Render reviews if present
    try {
        renderReviews(product.reviews || []);
    } catch (err) {
        console.warn('renderReviews error:', err);
    }

    // Stock Logic
    const stockEl = document.getElementById('stock-status');
    if(product.stock_quantity <= 0) {
        stockEl.innerText = "Out of Stock"; stockEl.className = "text-red-500 font-bold";
        document.getElementById('btn-whatsapp').disabled = true;
        document.getElementById('btn-whatsapp').classList.add('opacity-50');
    } else if (product.stock_quantity < 5) {
        stockEl.innerText = `Only ${product.stock_quantity} Left!`; stockEl.className = "text-orange-500 font-bold";
    } else {
        stockEl.innerText = "In Stock";
    }
}

// --- HELPER LOGIC ---

async function loadBundleItem(giftId) {
    const { data } = await supabaseClient.from('products').select('title, images').eq('id', giftId).single();
    if (data) {
        document.getElementById('bundle-container').classList.remove('hidden');
        document.getElementById('bundle-title').innerText = data.title;
        if(data.images && data.images.length > 0) {
            document.getElementById('bundle-img').src = getPublicImageUrl(data.images[0]);
        }
    }
}

// Ensure offer UI elements are placed into the correct containers after layout changes
function placeOfferElements(primaryOffer, secondaryOffer) {
    try {
        // 1. Offer badge should live inside the image container for visibility
        const badge = document.getElementById('offer-badge');
        const imageContainer = document.querySelector('.aspect-square') || document.getElementById('main-image')?.parentElement;
        if (badge && imageContainer && badge.parentElement !== imageContainer) {
            imageContainer.appendChild(badge);
        }

        // 2. Offer timer should appear near the price/current price area
        const timer = document.getElementById('offer-timer');
        const priceEl = document.getElementById('price-current');
        if (timer && priceEl) {
            const priceContainer = priceEl.parentElement;
            if (priceContainer && timer.parentElement !== priceContainer) {
                priceContainer.appendChild(timer);
            }
        }

        // 3. Bundle container: place before variations so it's visible above selectors
        const bundle = document.getElementById('bundle-container');
        const variations = document.getElementById('variations-container');
        if (bundle && variations && bundle.nextElementSibling !== variations) {
            variations.parentElement.insertBefore(bundle, variations);
        }

        // 4. Announcement bar handled where it's shown — ensure header has margin adjusted
        const bar = document.getElementById('announcement-bar');
        const headerEl = document.querySelector('header');
        if (bar && headerEl) {
            if (bar.style.display && bar.style.display !== 'none') headerEl.style.marginTop = `${bar.offsetHeight}px`;
            else headerEl.style.marginTop = '';
        }
    } catch (e) {
        console.warn('placeOfferElements error', e);
    }
}

// --- Reviews Renderer (from old product page) ---
function renderReviews(reviews) {
    const grid = document.getElementById('reviews-grid');
    if (!grid) return;
    if (!reviews || !reviews.length) {
        grid.innerHTML = '<div class="col-span-full text-center text-white/30 italic">No reviews yet.</div>';
        document.getElementById('avg-rating') && (document.getElementById('avg-rating').textContent = '0.0');
        return;
    }
    // Update average
    const avg = (reviews.reduce((a, b) => a + (b.rating || 0), 0) / reviews.length).toFixed(1);
    document.getElementById('avg-rating') && (document.getElementById('avg-rating').textContent = avg);

    grid.innerHTML = reviews.map(r => `
        <div class="bg-[#14161a] border border-[#2b2f3a] rounded-xl p-5 card-animate">
            <div class="flex justify-between items-start mb-2">
                <div class="font-bold text-white text-sm">${r.name || 'Anonymous'}</div>
                <div class="text-xs text-white/30">${r.date || ''}</div>
            </div>
            <div class="text-orange-500 text-[12px] mb-2">
                ${'<i class="fa-solid fa-star"></i>'.repeat(r.rating || 0)}
            </div>
            <p class="text-white/60 text-sm leading-relaxed">${r.comment || ''}</p>
        </div>
    `).join('');
}

function startTimer(endDate) {
    const el = document.getElementById('offer-timer');
    el.classList.remove('hidden');
    
    const tick = () => {
        const now = new Date().getTime();
        const end = new Date(endDate).getTime();
        const diff = end - now;
        
        if (diff < 0) {
            el.innerHTML = '<span class="text-red-400 font-bold">Offer Expired</span>';
            return;
        }
        
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        el.innerHTML = `
            <div class="text-[var(--secondary-color)] animate-pulse"><i class="fa-solid fa-bolt"></i></div>
            <div class="text-white text-sm font-mono">
                Ends in <span class="font-bold text-white">${d}d ${h}h ${m}m ${s}s</span>
            </div>
        `;
    };
    tick();
    setInterval(tick, 1000);
}

async function handleWhatsAppPurchase() {
    if (!productData || !businessData) return;
    const phone = (businessData.whatsapp_number || '').replace(/[^0-9]/g, '');
    
    let msg = `Hi, I want to order *${productData.title}*.
`;
    msg += `Price: KES ${currentPrice.toLocaleString()}
`;
    if(currentOfferLabel) msg += `🔥 ${currentOfferLabel}
`;
    if (Object.keys(selectedVariations).length) {
        msg += `Options: ${Object.entries(selectedVariations).map(([k,v]) => `${k}: ${v}`).join(', ')}
`;
    }
    msg += `Link: ${window.location.href}`;
    
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function handleHelpClick() {
    alert("This will open a support form or chat in the future.");
}

// Keep mobile sticky WhatsApp in sync with the in-panel button and ensure help button visible
(function syncMobileUI(){
    const sticky = document.querySelector('.mobile-sticky-btn');
    const inblock = document.getElementById('btn-whatsapp');
    const helpBtn = document.getElementById('help-btn');

    function updateStickyVisibility(){
        if (!sticky) return;
        if (inblock && inblock.disabled) {
            sticky.style.display = 'none';
        } else {
            sticky.style.display = '';
        }
    }

    function ensureHelpVisible(){
        if (!helpBtn) return;
        if (window.innerWidth <= 767) {
            helpBtn.style.scrollMarginBottom = '160px';
            const rect = helpBtn.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 80) {
                window.scrollBy({ top: rect.bottom - (window.innerHeight - 80) + 16, behavior: 'smooth' });
            }
        }
    }

    document.addEventListener('DOMContentLoaded', updateStickyVisibility);
    window.addEventListener('resize', updateStickyVisibility);
    setTimeout(() => { updateStickyVisibility(); ensureHelpVisible(); }, 600);
})();
