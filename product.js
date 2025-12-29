// --- CONFIGURATION ---
const SUPABASE_URL_LOCAL = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SUPABASE_KEY_LOCAL = (typeof SUPABASE_KEY !== 'undefined') ? SUPABASE_KEY : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

// Initialize Supabase Client
let supabaseClient;
if (typeof supabase !== 'undefined') {
    supabaseClient = (typeof supabase.createClient === 'function') 
        ? supabase.createClient(SUPABASE_URL_LOCAL, SUPABASE_KEY_LOCAL)
        : supabase;
} else if (window && window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL_LOCAL, SUPABASE_KEY_LOCAL);
} else {
    console.error('Supabase library not found.');
}

// --- STATE ---
let productData = null;
let businessData = null;
let activeOffers = []; 
let selectedVariations = {}; 
let currentPrice = 0;
let currentOfferLabel = ""; 

// --- THEME LOGIC ---
function initTheme() {
    // Check local storage or system preference
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Default to light unless saved as dark
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        updateThemeIcon(true);
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        updateThemeIcon(false);
    }
}

function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    
    root.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(!isDark);
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if(icon) {
        icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();

    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    
    // Back Button for App
    if (urlParams.get('from_app') === '1') {
        try {
            const header = document.querySelector('header');
            const backBtn = document.createElement('button');
            backBtn.className = 'theme-card text-main hover:text-primary py-2 px-4 rounded-lg shadow-sm mr-4 text-sm font-medium';
            backBtn.innerHTML = '<i class="fa-solid fa-arrow-left mr-1"></i> Back';
            backBtn.onclick = () => window.history.back();
            header.insertBefore(backBtn, header.firstChild);
        } catch(e){}
    }

    if (!productId) return showError();

    try {
        await loadProduct(productId);
    } catch (err) {
        console.error(err);
        showError();
    }

    // Attach Collapsible Listeners
    const descToggle = document.getElementById('desc-toggle');
    if (descToggle) {
        descToggle.addEventListener('click', () => {
            const c = document.getElementById('desc-content');
            const chevron = document.getElementById('desc-chevron');
            if (c) c.classList.toggle('hidden');
            if (chevron) chevron.style.transform = c.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
        });
    }
});

// --- CORE FUNCTIONS ---

// Helper: Image URL
function getPublicImageUrl(path) {
    if (!path) return "";
    if (path.startsWith("http") || path.startsWith("//")) return path;
    const bucketName = "ecommerce-assets"; 
    const cleanPath = path.replace(new RegExp(`^${bucketName}\/`), "");
    const { data } = supabaseClient.storage.from(bucketName).getPublicUrl(cleanPath);
    return data.publicUrl;
}

async function loadProduct(productId) {
    const { data: product, error: prodError } = await supabaseClient
        .from('products').select('*').eq('id', productId).single();
    if (prodError || !product) throw new Error("Product not found");
    productData = product;

    const { data: biz } = await supabaseClient
        .from('business_settings').select('*').eq('business_id', product.business_id).single();
    businessData = biz || { brand_colors: {} };

    const { data: offers } = await supabaseClient
        .from('offers')
        .select('*')
        .eq('product_id', productId)
        .eq('is_active', true)
        .gte('end_date', new Date().toISOString())
        .order('priority', { ascending: true });
    
    activeOffers = offers || [];

    renderPage(product, businessData, activeOffers);
}

function renderPage(product, biz, offers) {
    // Colors
    const colors = biz.brand_colors || {};
    const root = document.documentElement;
    if(colors.primary) root.style.setProperty('--primary-color', colors.primary);
    if(colors.secondary) root.style.setProperty('--secondary-color', colors.secondary);
    // Note: We don't overwrite background in light mode to keep it clean white, 
    // unless you specifically want to force a brand background.

    // Basic Info
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

    // Images
    const images = product.images || [];
    if (images.length > 0) {
        document.getElementById('main-image').src = getPublicImageUrl(images[0]);
        const tCon = document.getElementById('image-thumbnails');
        tCon.innerHTML = '';
        images.forEach((img, i) => {
            const thumb = document.createElement('img');
            thumb.src = getPublicImageUrl(img);
            thumb.className = `gallery-thumb w-14 h-14 rounded-md object-cover border border-transparent cursor-pointer hover:border-primary opacity-80 transition-all ${i===0 ? 'active' : ''}`;
            thumb.onclick = () => {
                document.getElementById('main-image').src = getPublicImageUrl(img);
                Array.from(tCon.children).forEach(c => c.classList.remove('active'));
                thumb.classList.add('active');
            };
            tCon.appendChild(thumb);
        });
        initMetaPixel(product.business_id, product);
    }

    // --- OFFER ENGINE ---
    let price = product.price;
    currentPrice = price; 
    let primaryOffer = null;
    let secondaryOffer = null;

    if(offers.length > 0) {
        secondaryOffer = offers.find(o => o.offer_type === 'SHIPPING');
        primaryOffer = offers.find(o => o.offer_type !== 'SHIPPING');
    }

    if (primaryOffer) {
        const type = primaryOffer.offer_type;
        const config = primaryOffer.configuration || {};
        const badge = document.getElementById('offer-badge');
        badge.classList.remove('hidden');

        if (type === 'FLASH_SALE' || type === 'DISCOUNT') {
            let finalPrice = price;
            let label = "";

            if (config.percent) {
                finalPrice = price * (1 - (config.percent / 100));
                label = `-${config.percent}%`;
            } else if (config.amount) {
                finalPrice = price - config.amount;
                label = `-KES ${config.amount}`;
            } else if (primaryOffer.discount_value) {
                 if(primaryOffer.discount_type === 'percent') finalPrice = price * (1 - (primaryOffer.discount_value/100));
                 else finalPrice = price - primaryOffer.discount_value;
            }

            document.getElementById('price-old').innerText = `KES ${price.toLocaleString()}`;
            document.getElementById('price-old').classList.remove('hidden');
            document.getElementById('price-current').innerText = `KES ${finalPrice.toLocaleString()}`;
            badge.innerText = type === 'FLASH_SALE' ? `FLASH SALE ${label}` : `${label} OFF`;
            currentPrice = finalPrice;
            currentOfferLabel = `Discount Applied (${label})`;

            if (type === 'FLASH_SALE' && primaryOffer.end_date) startTimer(primaryOffer.end_date);
        } 
        else if (type === 'BOGO') {
            const buy = config.buy_qty || 1;
            const get = config.get_qty || 1;
            badge.innerText = `BUY ${buy} GET ${get} FREE`;
            document.getElementById('price-current').innerText = `KES ${price.toLocaleString()}`;
            currentOfferLabel = `Offer: Buy ${buy} Get ${get} Free`;
            
            const ctaText = `Buy ${buy} Get ${get} Free - Order Now`;
            document.getElementById('desktop-cta-text').innerText = ctaText;
            document.getElementById('mobile-cta-text').innerText = ctaText;
        }
        else if (type === 'BUNDLE') {
            if (config.bundle_price) {
                document.getElementById('price-old').innerText = `KES ${price.toLocaleString()}`;
                document.getElementById('price-old').classList.remove('hidden');
                currentPrice = config.bundle_price;
            }
            document.getElementById('price-current').innerText = `KES ${currentPrice.toLocaleString()}`;
            badge.innerText = "FREE GIFT";
            currentOfferLabel = "Bundle Offer Included";

            if (config.gift_product_id) loadBundleItem(config.gift_product_id);
        }
    } else {
        document.getElementById('price-current').innerText = `KES ${price.toLocaleString()}`;
        if(product.old_price > price) {
            document.getElementById('price-old').innerText = `KES ${product.old_price.toLocaleString()}`;
            document.getElementById('price-old').classList.remove('hidden');
        }
    }

    if (secondaryOffer && secondaryOffer.offer_type === 'SHIPPING') {
        const bar = document.getElementById('announcement-bar');
        const text = document.getElementById('announcement-text');
        const config = secondaryOffer.configuration || {};
        bar.style.display = 'block';
        text.innerText = config.threshold 
            ? `FREE SHIPPING ON ORDERS OVER KES ${config.threshold}`
            : (secondaryOffer.name || "FREE SHIPPING");
        
        try { document.querySelector('header').style.marginTop = `${bar.offsetHeight}px`; } catch(e){}
    }

    // Variations
    const varContainer = document.getElementById('variations-container');
    (product.variations || []).forEach(v => {
        const group = document.createElement('div');
        group.innerHTML = `<h3 class="text-xs font-bold text-muted mb-2 uppercase tracking-wide">${v.name}</h3>`;
        const optsDiv = document.createElement('div');
        optsDiv.className = 'flex flex-wrap gap-2';
        v.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = `var-btn px-4 py-2 rounded-lg text-sm transition-all ${i===0 ? 'selected' : ''}`;
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

    // Reveal
    placeOfferElements(); // Ensure DOM order
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    // Reviews & Stock
    renderReviews(product.reviews || []);
    
    const stockEl = document.getElementById('stock-status');
    const waBtn = document.getElementById('btn-whatsapp');
    if(product.stock_quantity <= 0) {
        stockEl.innerText = "Out of Stock"; stockEl.className = "text-red-500 font-bold";
        waBtn.disabled = true; waBtn.classList.add('opacity-50', 'cursor-not-allowed');
        document.querySelector('.mobile-sticky-btn button').disabled = true;
    } else if (product.stock_quantity < 5) {
        stockEl.innerText = `Only ${product.stock_quantity} Left!`; stockEl.className = "text-orange-500 font-bold";
    } else {
        stockEl.innerText = "In Stock";
    }
}


// --- MODAL & CRM LOGIC ---

function openOrderModal() {
    const modal = document.getElementById('modal-order');
    
    // Populate Modal Summary
    document.getElementById('modal-img').src = document.getElementById('main-image').src;
    document.getElementById('modal-title').innerText = productData.title;
    document.getElementById('modal-price').innerText = `KES ${currentPrice.toLocaleString()}`;
    
    // Format variants string
    const variantsStr = Object.entries(selectedVariations).map(([k,v]) => `${k}: ${v}`).join(', ') || 'Standard';
    document.getElementById('modal-variant').innerText = variantsStr;

    modal.classList.remove('hidden');
    // small delay for transition
    setTimeout(() => modal.classList.add('open'), 10);
}

function openDiscountModal() {
    const modal = document.getElementById('modal-discount');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('open'), 10);
}

function closeModals() {
    const modals = document.querySelectorAll('.modal-backdrop');
    modals.forEach(m => {
        m.classList.remove('open');
        setTimeout(() => m.classList.add('hidden'), 300);
    });
}

// CRM ACTION: Handle Order Submit
async function handleOrderSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-confirm-order');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

    const address = document.getElementById('inp-address').value;
    const phone = document.getElementById('inp-phone').value;
    
    // Generate Order ID
    const orderId = 'ORD-' + Math.random().toString(36).substr(2, 5).toUpperCase();

    // 1. SAVE TO CONTACTS (Upsert) & DEALS
    try {
        // Upsert Contact
        const { data: contact, error: cErr } = await supabaseClient
            .from('contacts')
            .upsert({ 
                phone: phone, 
                last_active: new Date(), 
                tags: ['whatsapp_order_attempt'] 
            }, { onConflict: 'phone' })
            .select()
            .single();

        // Insert Deal (if table exists)
        const dealData = {
            contact_id: contact?.id, 
            phone: phone, // fallback
            product_id: productData.id,
            product_name: productData.title,
            amount: currentPrice,
            status: 'new',
            stage: 'whatsapp_clicked',
            order_id: orderId,
            details: {
                address: address,
                variations: selectedVariations,
                offer: currentOfferLabel
            }
        };

        // Try inserting into deals, ignore error if table structure is different
        await supabaseClient.from('deals').insert(dealData).catch(err => console.log('Deal insert skipped/failed', err));

    } catch (err) {
        console.error("CRM Save Error (non-blocking):", err);
    }

    // 2. REDIRECT TO WHATSAPP
    const phoneClean = (businessData.whatsapp_number || '').replace(/[^0-9]/g, '');
    let msg = `*New Order: ${orderId}*\n`;
    msg += `------------------\n`;
    msg += `📦 *${productData.title}*\n`;
    msg += `💰 Price: KES ${currentPrice.toLocaleString()}\n`;
    if(currentOfferLabel) msg += `🔥 ${currentOfferLabel}\n`;
    const variantsStr = Object.entries(selectedVariations).map(([k,v]) => `${k}: ${v}`).join(', ');
    if(variantsStr) msg += `🎨 Options: ${variantsStr}\n`;
    msg += `\n📍 *Shipping To:*\n${address}\n`;
    msg += `\n📞 *Customer Contact:*\n${phone}\n`;
    msg += `------------------\n`;
    msg += `Please confirm my order.`;

    window.open(`https://wa.me/${phoneClean}?text=${encodeURIComponent(msg)}`, '_blank');

    // Reset UI
    btn.innerHTML = originalText;
    btn.disabled = false;
    closeModals();
}

// CRM ACTION: Handle Discount Waitlist
async function handleDiscountSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-join-waitlist');
    btn.disabled = true;
    btn.innerText = "Saving...";

    const phone = document.getElementById('inp-lead-phone').value;

    try {
        await supabaseClient
            .from('contacts')
            .upsert({ 
                phone: phone, 
                last_active: new Date(),
                tags: ['lead_magnet_30off', 'price_sensitive']
            }, { onConflict: 'phone' });
        
        btn.innerText = "Done! We'll text you.";
        btn.classList.add('bg-green-500', 'text-white');
        
        setTimeout(() => {
            closeModals();
            btn.disabled = false;
            btn.innerText = "Notify Me for 30% Off";
            btn.classList.remove('bg-green-500');
        }, 2000);

    } catch (err) {
        console.error(err);
        btn.innerText = "Error. Try again.";
        btn.disabled = false;
    }
}

// --- UTILITIES ---

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

function placeOfferElements() {
    try {
        const badge = document.getElementById('offer-badge');
        const imgCon = document.getElementById('main-image')?.parentElement;
        if (badge && imgCon && badge.parentElement !== imgCon) imgCon.appendChild(badge);

        const timer = document.getElementById('offer-timer');
        const priceCon = document.getElementById('price-current')?.parentElement;
        if (timer && priceCon && timer.parentElement !== priceCon) priceCon.appendChild(timer);
    } catch (e) {}
}

function renderReviews(reviews) {
    const grid = document.getElementById('reviews-grid');
    if (!grid) return;
    if (!reviews || !reviews.length) {
        grid.innerHTML = '<div class="col-span-full text-center text-muted italic">No reviews yet.</div>';
        return;
    }
    const avg = (reviews.reduce((a, b) => a + (b.rating || 0), 0) / reviews.length).toFixed(1);
    document.getElementById('avg-rating') && (document.getElementById('avg-rating').textContent = avg);

    grid.innerHTML = reviews.map(r => `
        <div class="theme-card rounded-xl p-5 border border-border shadow-sm">
            <div class="flex justify-between items-start mb-2">
                <div class="font-bold text-main text-sm">${r.name || 'Anonymous'}</div>
                <div class="text-xs text-muted">${r.date || ''}</div>
            </div>
            <div class="text-orange-500 text-[12px] mb-2">
                ${'<i class="fa-solid fa-star"></i>'.repeat(r.rating || 0)}
            </div>
            <p class="text-muted text-sm leading-relaxed">${r.comment || ''}</p>
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
            el.innerHTML = '<span class="text-red-500 font-bold">Offer Expired</span>';
            return;
        }
        
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        el.innerHTML = `
            <div class="text-secondary animate-pulse"><i class="fa-solid fa-bolt"></i></div>
            <div class="text-main text-sm font-mono">
                Ends in <span class="font-bold text-main">${d}d ${h}h ${m}m ${s}s</span>
            </div>
        `;
    };
    tick();
    setInterval(tick, 1000);
}

function showError() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('error-screen').classList.remove('hidden');
}
// --- META PIXEL INTEGRATION ---
async function initMetaPixel(businessId, p) {
    if (!businessId || !p) return;

    // 1. Get the Pixel ID from business settings
    const { data } = await supabaseClient
        .from('business_settings')
        .select('meta_pixel_id')
        .eq('business_id', businessId)
        .single();

    if (!data || !data.meta_pixel_id) return;

    // 2. Standard Meta Pixel Base Code (Prevents duplicates)
    if (!window.fbq) {
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        
        fbq('init', data.meta_pixel_id);
    }

    // 3. Track Events
    fbq('track', 'PageView');
    fbq('track', 'ViewContent', {
        content_name: p.title,
        content_ids: [p.id],
        content_type: 'product',
        value: p.price,
        currency: 'KES'
    });
}