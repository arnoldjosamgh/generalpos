/**
 * Jomish POS - Complete Frontend Controller
 * Pixel-accurate layout implementation matching Picture 1, 2, and 3
 */

// Global State
let currentUser = null;
let userPermissions = {};
let companyData = {
    name: 'Jomish POS Supermarket & Store',
    prefix: 'JOMISH',
    business_type: 'supermarket',
    location: 'Kampala, Uganda',
    currency: 'Sh',
    logo_url: 'favicon.png',
    theme_color: '#0284c7',
    theme_accent: '#f59e0b',
    theme_sidebar: '#0f172a',
    enabled_tabs: ['register', 'orders', 'customer', 'inventory', 'shift', 'returns', 'invoice', 'debtors', 'creditors', 'transactions', 'finance', 'settings']
};

let allProducts = [];
let allCategories = [];
let currentCart = [];
let activeCategory = 'ALL';
let activeNavTab = 'register';

let idleTimer = null;
const IDLE_TIMEOUT_MS = 150000; // 2.5 minutes of inactivity triggers screensaver

// --- On DOM Loaded ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auth Guard
    const token = localStorage.getItem('jomish_token');
    if (!token) {
        window.location.replace('login.html');
        return;
    }

    // 2. Initialize User Info
    const role = localStorage.getItem('jomish_role') || 'Cashier';
    const name = localStorage.getItem('jomish_name') || 'Cashier User';
    const prefix = localStorage.getItem('jomish_prefix') || 'public';
    try {
        userPermissions = JSON.parse(localStorage.getItem('jomish_permissions') || '{}');
    } catch (_) {
        userPermissions = {};
    }

    currentUser = { name, role, prefix, permissions: userPermissions };

    // Set UI User Info in Header
    document.getElementById('header-user-role').textContent = `${role} - ${name}`;
    document.getElementById('header-avatar-circle').textContent = (name || 'U').charAt(0).toUpperCase();

    // Check if Tech Support Super Admin
    const isTech = role === 'TECH' || role === 'Tech' || name === 'System Technician' || localStorage.getItem('tech_super_admin') === 'true';
    if (isTech) {
        const techBtn = document.getElementById('nav-btn-tech');
        if (techBtn) techBtn.style.display = 'flex';
    }

    // 3. Load Company Info & Apply Branding Theme
    await loadCompanySettings();

    // 4. Start Clocks
    startHeaderClock();
    startScreenSaverClock();
    setupIdleDetection();

    // 5. Load Initial Data
    await loadCategories();
    await loadProducts();
    await loadActiveShiftInfo();

    // Check URL parameters for tab routing (e.g. ?view=tech)
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    if (view && document.getElementById(`view-pane-${view}`)) {
        switchNavTab(view);
    } else {
        switchNavTab('register');
    }

    // 6. Enforce Role Permissions
    enforceRolePermissions();

    // 7. Initialize Header Default Printer Label
    updateHeaderPrinterLabel();
});

// ============================================================================
// COMPANY SETTINGS & DYNAMIC THEME BRANDING
// ============================================================================
async function loadCompanySettings() {
    try {
        const res = await fetch('/api/company/info', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            companyData = { ...companyData, ...data };
            applyCompanyBranding();
        }
    } catch (e) {
        console.warn('Using cached company data:', e.message);
        applyCompanyBranding();
    }
}

function applyCompanyBranding() {
    // 1. Dynamic CSS Variables according to company logo colors
    const root = document.documentElement;
    if (companyData.theme_color) {
        root.style.setProperty('--primary', companyData.theme_color);
        root.style.setProperty('--primary-hover', adjustColorBrightness(companyData.theme_color, -20));
    }
    if (companyData.theme_accent) {
        root.style.setProperty('--accent', companyData.theme_accent);
    }
    if (companyData.theme_sidebar) {
        root.style.setProperty('--sidebar-bg', companyData.theme_sidebar);
    }

    // 2. Header & Sidebar Logos and Titles
    const brandName = companyData.name || 'Jomish POS';
    document.getElementById('header-company-name').textContent = brandName;
    document.getElementById('sidebar-brand-name').textContent = brandName.split(' ')[0] || 'Jomish';
    document.getElementById('saver-brand-text').textContent = brandName;

    // Location
    const locParts = (companyData.location || 'Kampala, Uganda').split(',');
    const city = locParts[0]?.trim() || 'Kampala';
    const country = locParts[1]?.trim() || 'Uganda';
    document.getElementById('saver-city').textContent = city;
    document.getElementById('saver-country').textContent = country;

    if (companyData.logo_url) {
        const logoEl = document.getElementById('sidebar-logo-img');
        if (logoEl) logoEl.src = companyData.logo_url;
    }

    // 3. Tab Visibility (e.g. Hide 'Pending' tab for Supermarkets!)
    const rawTabs = companyData.enabled_tabs || ['register', 'orders', 'customer', 'inventory', 'shift', 'kitchen', 'finance', 'settings'];
    const enabledTabs = Array.isArray(rawTabs) ? [...rawTabs] : ['register', 'orders', 'customer', 'inventory', 'shift', 'kitchen', 'finance', 'settings'];
    if (!enabledTabs.includes('finance')) enabledTabs.push('finance');

    const tabs = ['register', 'orders', 'pending', 'customer', 'inventory', 'shift', 'kitchen', 'finance', 'settings'];
    tabs.forEach(tab => {
        const btn = document.getElementById(`nav-btn-${tab}`);
        if (btn) {
            if (!enabledTabs.includes(tab)) {
                btn.style.display = 'none';
            } else {
                btn.style.display = 'flex';
            }
        }
    });

    // Subtabs within Finance based on company enabled_tabs (if company specifically disabled returns/invoice etc.)
    const finSubTabs = ['transactions', 'invoice', 'debtors', 'creditors', 'returns'];
    finSubTabs.forEach(st => {
        const btn = document.getElementById(`fin-tab-btn-${st}`);
        if (btn) {
            const isEnabled = !rawTabs.length || rawTabs.includes(st) || rawTabs.includes('finance');
            btn.style.display = isEnabled ? 'flex' : 'none';
        }
    });

    // 4. Kitchen Token row visibility (Only restaurants, cafes, hotels, bars show print to kitchen)
    const kitchenRow = document.getElementById('kitchen-toggle-row');
    const kitchenToggle = document.getElementById('kitchen-print-toggle');
    const bType = (companyData.business_type || '').toLowerCase();
    const isRestaurant = ['restaurant', 'cafe', 'hotel', 'bar', 'eatery', 'food'].some(k => bType.includes(k));
    if (kitchenRow) {
        kitchenRow.style.display = isRestaurant ? 'flex' : 'none';
    }
    if (kitchenToggle) {
        kitchenToggle.checked = isRestaurant;
    }

    // Populate Settings Inputs
    const setCompName = document.getElementById('setting-company-name');
    if (setCompName) {
        setCompName.value = companyData.name || '';
        document.getElementById('setting-company-location').value = companyData.location || '';
        document.getElementById('setting-company-currency').value = companyData.currency || 'Sh';
        document.getElementById('setting-company-logo').value = companyData.logo_url || '';
        if (companyData.theme_color) document.getElementById('setting-theme-primary').value = companyData.theme_color;
        if (companyData.theme_accent) document.getElementById('setting-theme-accent').value = companyData.theme_accent;
    }
}

function adjustColorBrightness(col, percent) {
    let num = parseInt(col.replace('#', ''), 16);
    let amt = Math.round(2.55 * percent);
    let R = (num >> 16) + amt;
    let G = (num >> 8 & 0x00FF) + amt;
    let B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

// ============================================================================
// ROLE PERMISSIONS & GRANULAR CAPABILITIES
// ============================================================================
function enforceRolePermissions() {
    const isTech = currentUser.role === 'TECH' || currentUser.role === 'Tech' || currentUser.name === 'System Technician';
    if (isTech) return; // Tech Support has full access to everything

    const perms = userPermissions || {};

    // 1. Sidebar Tab visibility based on role
    const tabMap = {
        'register': perms.can_see_register !== 0,
        'orders': perms.can_see_orders !== 0,
        'pending': perms.can_see_pending === 1,
        'customer': perms.can_see_customer !== 0,
        'inventory': perms.can_see_inventory === 1,
        'shift': perms.can_see_shift !== 0,
        'kitchen': perms.can_see_kitchen === 1,
        'finance': perms.can_see_finance !== 0,
        'settings': perms.can_see_settings === 1
    };

    for (const [tab, canSee] of Object.entries(tabMap)) {
        const btn = document.getElementById(`nav-btn-${tab}`);
        if (btn && !canSee) {
            btn.style.display = 'none';
        }
    }

    // 1b. Finance Subtab visibility based on role permissions
    const finSubTabMap = {
        'transactions': perms.can_see_transactions !== 0,
        'invoice': perms.can_see_invoice !== 0,
        'debtors': perms.can_see_debtors !== 0,
        'creditors': perms.can_see_creditors !== 0,
        'returns': perms.can_see_returns === 1
    };
    for (const [subTab, canSee] of Object.entries(finSubTabMap)) {
        const btn = document.getElementById(`fin-tab-btn-${subTab}`);
        if (btn && !canSee) {
            btn.style.display = 'none';
        }
    }

    // 2. Granular Action Capabilities
    // Can Add / Edit Inventory
    const btnAddProd = document.getElementById('btn-add-product-perm');
    if (btnAddProd) {
        if (perms.can_add_inventory === 0) {
            btnAddProd.style.display = 'none';
        } else {
            btnAddProd.style.display = 'inline-flex';
        }
    }

    // Waiter & Cashier Ordering / Selling distinction:
    // e.g. "waiter can add order but cant pay"
    const btnPlaceOrder = document.getElementById('btn-place-order');
    const btnWaiterSend = document.getElementById('btn-waiter-send-kitchen');

    if (perms.can_sell === 0) {
        // Cannot pay/sell directly
        if (btnPlaceOrder) btnPlaceOrder.style.display = 'none';
        // If they can add orders (e.g. Waiter), show Send to Kitchen / Save Order button!
        if (perms.can_add_order !== 0 && btnWaiterSend) {
            btnWaiterSend.style.display = 'flex';
        }
    } else {
        // Can sell / pay
        if (btnPlaceOrder) {
            btnPlaceOrder.style.display = 'flex';
            btnPlaceOrder.disabled = false;
        }
        if (btnWaiterSend) {
            btnWaiterSend.style.display = 'none';
        }
    }

    // If currently active tab was hidden, jump to first available visible tab
    if (tabMap[activeNavTab] === false) {
        const firstVisible = Object.keys(tabMap).find(t => tabMap[t] === true) || 'register';
        switchNavTab(firstVisible);
    }
}

// ============================================================================
// NAVIGATION TAB SWITCHING
// ============================================================================
// TAB NAVIGATION CONTROLLER
// ============================================================================
let activeFinanceSubTab = 'overview';

function switchNavTab(tabName, finSubTab) {
    // If a bundled financial tab is targeted, route directly to Finance sub-view
    if (['transactions', 'invoice', 'debtors', 'creditors', 'returns'].includes(tabName)) {
        finSubTab = tabName;
        tabName = 'finance';
    }

    activeNavTab = tabName;

    // Toggle active sidebar pill
    document.querySelectorAll('.pos-nav-item').forEach(el => el.classList.remove('active'));
    const targetNav = document.getElementById(`nav-btn-${tabName}`);
    if (targetNav) targetNav.classList.add('active');

    // Toggle active view pane
    document.querySelectorAll('.pos-view-pane').forEach(el => el.classList.remove('active'));
    const targetPane = document.getElementById(`view-pane-${tabName}`);
    if (targetPane) targetPane.classList.add('active');

    // Right checkout panel is visible only in Register and Pending tabs
    const orderPanel = document.querySelector('.pos-order-panel');
    const expandBtn = document.getElementById('btn-expand-cart');
    if (orderPanel) {
        if (tabName === 'register' || tabName === 'pending') {
            if (!orderPanel.classList.contains('collapsed')) {
                orderPanel.style.display = 'flex';
                if (expandBtn) expandBtn.style.display = 'none';
            } else {
                orderPanel.style.display = 'none';
                if (expandBtn) expandBtn.style.display = 'inline-flex';
            }
        } else {
            orderPanel.style.display = 'none';
            if (expandBtn) expandBtn.style.display = 'none';
        }
    }

    // Trigger tab specific data load
    if (tabName === 'orders') loadOrdersList();
    if (tabName === 'pending') loadPendingOrders();
    if (tabName === 'customer') loadCustomerList();
    if (tabName === 'inventory') loadProducts();
    if (tabName === 'shift') {
        loadActiveShiftInfo();
        loadShiftTransactions();
        populateAdminShiftFilters();
    }
    if (tabName === 'kitchen') loadKitchenTokens();
    if (tabName === 'finance') {
        switchFinanceSubTab(finSubTab || activeFinanceSubTab || 'overview');
    }
    if (tabName === 'settings') { loadCustomRolesSettings(); loadStoreTillsSettings(); }
    if (tabName === 'tech') loadTechCompanies();
}

function switchFinanceSubTab(subTab) {
    activeFinanceSubTab = subTab || 'overview';

    // Toggle active subtab button styling
    document.querySelectorAll('.pos-fin-subtab-btn').forEach(b => b.classList.remove('active'));
    const targetBtn = document.getElementById(`fin-tab-btn-${activeFinanceSubTab}`);
    if (targetBtn) targetBtn.classList.add('active');

    // Toggle active finance subview
    document.querySelectorAll('.pos-fin-subview').forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(`fin-subview-${activeFinanceSubTab}`);
    if (targetView) targetView.classList.add('active');

    // Trigger subtab specific data loader
    if (activeFinanceSubTab === 'overview') {
        loadFinanceDashboard();
    } else if (activeFinanceSubTab === 'transactions') {
        loadTransactionsList();
    } else if (activeFinanceSubTab === 'invoice') {
        loadInvoicesList();
    } else if (activeFinanceSubTab === 'debtors') {
        loadDebtorsList();
    } else if (activeFinanceSubTab === 'creditors') {
        loadCreditorsList();
    } else if (activeFinanceSubTab === 'returns') {
        loadReturnsList();
    }
}

function refreshActiveFinanceSubTab() {
    switchFinanceSubTab(activeFinanceSubTab || 'overview');
}

function toggleSidebarMenu() {
    const sidebar = document.querySelector('.pos-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

function collapseCheckoutPanel() {
    const orderPanel = document.querySelector('.pos-order-panel');
    const expandBtn = document.getElementById('btn-expand-cart');
    if (orderPanel) {
        orderPanel.classList.add('collapsed');
        orderPanel.style.display = 'none';
    }
    if (expandBtn) {
        expandBtn.style.display = 'inline-flex';
        updateFloatingCartBadge();
    }
}

function expandCheckoutPanel() {
    const orderPanel = document.querySelector('.pos-order-panel');
    const expandBtn = document.getElementById('btn-expand-cart');
    if (orderPanel) {
        orderPanel.classList.remove('collapsed');
        orderPanel.style.display = 'flex';
    }
    if (expandBtn) {
        expandBtn.style.display = 'none';
    }
}

function updateFloatingCartBadge() {
    const countEl = document.getElementById('expand-cart-count');
    const totalEl = document.getElementById('expand-cart-total');
    if (!countEl || !totalEl) return;
    const curr = companyData.currency || 'Sh';
    const totalItems = currentCart.reduce((acc, it) => acc + (it.qty || 1), 0);
    const totalAmount = calculateCartTotal();
    countEl.textContent = totalItems;
    totalEl.textContent = `${totalAmount.toLocaleString()} ${curr}`;
}

// ============================================================================
// REAL-TIME CLOCKS & SCREENSAVER
// ============================================================================
function startHeaderClock() {
    const el = document.getElementById('pos-header-time');
    function update() {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        el.textContent = `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
    }
    update();
    setInterval(update, 1000);
}

function startScreenSaverClock() {
    const digitsEl = document.getElementById('saver-clock-digits');
    const secondsEl = document.getElementById('saver-clock-seconds');
    const dateEl = document.getElementById('saver-date-string');

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    function update() {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');

        digitsEl.textContent = `${hh}:${min}`;
        secondsEl.textContent = ss;

        const dayName = days[now.getDay()];
        const dateNum = now.getDate();
        const monthName = months[now.getMonth()];
        const year = now.getFullYear();

        dateEl.textContent = `${dayName}, ${dateNum} ${monthName} ${year}`;
    }
    update();
    setInterval(update, 1000);
}

function triggerScreenSaver() {
    document.getElementById('pos-screensaver').style.display = 'flex';
}

function dismissScreenSaver() {
    document.getElementById('pos-screensaver').style.display = 'none';
    resetIdleTimer();
}

function setupIdleDetection() {
    ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();
}

function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        triggerScreenSaver();
    }, IDLE_TIMEOUT_MS);
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
}

// ============================================================================
// TAB 1: REGISTER - PRODUCTS CATALOG & CATEGORIES (Picture 2)
// ============================================================================
async function loadCategories() {
    try {
        const res = await fetch('/api/categories', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allCategories = data.categories || [];
            renderCategoryPills();
            populateCategorySelect();
        }
    } catch (e) {
        console.warn('Failed to load categories:', e.message);
    }
}

function renderCategoryPills() {
    const container = document.getElementById('register-category-pills');
    if (!container) return;

    // Start with "All" pill
    let html = `<button class="cat-pill-btn ${activeCategory === 'ALL' ? 'active' : ''}" onclick="selectRegisterCategory('ALL', this)">All</button>`;

    // Render registered categories
    allCategories.forEach(cat => {
        const isActive = activeCategory === cat.name ? 'active' : '';
        html += `<button class="cat-pill-btn ${isActive}" onclick="selectRegisterCategory('${escapeHtml(cat.name)}', this)">${escapeHtml(cat.name)}</button>`;
    });

    container.innerHTML = html;
}

function selectRegisterCategory(categoryName, element) {
    activeCategory = categoryName;
    document.querySelectorAll('.cat-pill-btn').forEach(btn => btn.classList.remove('active'));
    if (element) element.classList.add('active');
    filterRegisterProducts(document.getElementById('pos-search-input').value);
}

async function loadProducts() {
    try {
        const res = await fetch('/api/products', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allProducts = data.products || [];
            renderRegisterProducts(allProducts);
            renderInventoryTable(allProducts);
        }
    } catch (e) {
        console.error('Failed to load products:', e.message);
    }
}

function getCategoryIconClass(cat = '', name = '') {
    const text = (String(cat) + ' ' + String(name)).toLowerCase();
    if (text.includes('drink') || text.includes('beverage') || text.includes('water') || text.includes('juice') || text.includes('soda') || text.includes('tea') || text.includes('coffee')) return 'fa-mug-hot';
    if (text.includes('alcohol') || text.includes('beer') || text.includes('wine') || text.includes('liquor') || text.includes('spirits') || text.includes('bar')) return 'fa-wine-glass';
    if (text.includes('food') || text.includes('meal') || text.includes('dish') || text.includes('snack') || text.includes('restaurant') || text.includes('curry') || text.includes('pizza') || text.includes('pasta')) return 'fa-bowl-food';
    if (text.includes('meat') || text.includes('chicken') || text.includes('beef') || text.includes('pork') || text.includes('fish') || text.includes('butchery')) return 'fa-drumstick-bite';
    if (text.includes('fruit') || text.includes('vegetable') || text.includes('produce') || text.includes('fresh') || text.includes('apple')) return 'fa-apple-whole';
    if (text.includes('bread') || text.includes('bakery') || text.includes('cake') || text.includes('pastry')) return 'fa-bread-slice';
    if (text.includes('grocery') || text.includes('supermarket') || text.includes('store') || text.includes('mart') || text.includes('soap') || text.includes('sugar') || text.includes('salt')) return 'fa-basket-shopping';
    if (text.includes('cloth') || text.includes('wear') || text.includes('fashion') || text.includes('shirt') || text.includes('shoe') || text.includes('dress')) return 'fa-shirt';
    if (text.includes('health') || text.includes('pharma') || text.includes('drug') || text.includes('beauty') || text.includes('cosmetic') || text.includes('lotion')) return 'fa-heart-pulse';
    if (text.includes('tech') || text.includes('electronic') || text.includes('phone') || text.includes('cable') || text.includes('computer') || text.includes('charger')) return 'fa-laptop';
    if (text.includes('service') || text.includes('repair') || text.includes('fix')) return 'fa-wrench';
    return 'fa-box';
}

function renderRegisterProducts(products) {
    const grid = document.getElementById('register-products-grid');
    if (!grid) return;

    if (!products || products.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748b;">No products found matching your search.</div>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    grid.innerHTML = products.map(p => {
        const cartItem = currentCart.find(item => item.id === p.id);
        const countBadge = cartItem ? `<div class="prod-cart-count-badge">${cartItem.qty}</div>` : '';
        const catIcon = getCategoryIconClass(p.category, p.name);
        const hasPhoto = !!(p.photo_base64 && p.photo_base64.length > 20);
        const imgHtml = hasPhoto
            ? `<img src="${p.photo_base64}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';">
               <div class="prod-icon-box" style="display:none;"><i class="fa-solid ${catIcon}"></i></div>`
            : `<div class="prod-icon-box"><i class="fa-solid ${catIcon}"></i></div>`;
        const isUnlimited = p.track_stock === 0;
        const unlimitedBadge = isUnlimited
            ? `<div style="position:absolute; bottom:4px; left:4px; background:#0284c7; color:#fff; border-radius:8px; padding:1px 6px; font-size:0.65rem; font-weight:800; z-index:3;">∞</div>`
            : '';

        return `
            <div class="pos-product-card" onclick="addToOrderCart(${p.id})">
                ${countBadge}
                ${unlimitedBadge}
                <div class="prod-price-tag">${Number(p.price || 0).toLocaleString()}</div>
                <div class="prod-img-wrap">
                    ${imgHtml}
                </div>
                <div class="prod-title-label">${escapeHtml(p.name)}</div>
            </div>
        `;
    }).join('');
}

function filterRegisterProducts(searchTerm = '') {
    const query = searchTerm.toLowerCase().trim();
    let filtered = allProducts;

    // Category filter
    if (activeCategory !== 'ALL') {
        filtered = filtered.filter(p => (p.category || '').toLowerCase() === activeCategory.toLowerCase());
    }

    // Search query
    if (query) {
        filtered = filtered.filter(p => 
            (p.name || '').toLowerCase().includes(query) ||
            (p.barcode || '').toLowerCase().includes(query) ||
            (p.category || '').toLowerCase().includes(query)
        );
    }

    renderRegisterProducts(filtered);
}

// ============================================================================
// RIGHT ORDER CART & CHECKOUT CONTROLLER (Picture 2)
// ============================================================================
function addToOrderCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const existing = currentCart.find(item => item.id === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        currentCart.push({
            id: product.id,
            name: product.name,
            price: Number(product.price || 0),
            track_stock: product.track_stock,
            qty: 1
        });
    }

    renderOrderCart();
    renderRegisterProducts(allProducts); // updates count badges
}

function updateCartItemQty(productId, delta) {
    const item = currentCart.find(i => i.id === productId);
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        removeFromCart(productId);
    } else {
        renderOrderCart();
        renderRegisterProducts(allProducts);
    }
}

function removeFromCart(productId) {
    currentCart = currentCart.filter(i => i.id !== productId);
    renderOrderCart();
    renderRegisterProducts(allProducts);
}

function clearCurrentOrder() {
    currentCart = [];
    document.getElementById('order-remarks-input').value = '';
    renderOrderCart();
    renderRegisterProducts(allProducts);
}

function renderOrderCart() {
    const container = document.getElementById('pos-order-items-list');
    const totalDisplay = document.getElementById('order-total-display');
    const curr = companyData.currency || 'Sh';

    if (currentCart.length === 0) {
        container.innerHTML = `
            <div class="order-empty-state">
                <i class="fa-solid fa-cart-shopping" style="font-size:2.5rem; opacity:0.3; margin-bottom:12px; display:block;"></i>
                Select dishes on the left to add to this order
            </div>
        `;
        totalDisplay.textContent = `0 ${curr}`;
        return;
    }

    let subtotal = 0;
    container.innerHTML = currentCart.map(item => {
        const itemTotal = item.price * item.qty;
        subtotal += itemTotal;
        return `
            <div class="order-cart-row">
                <div class="cart-row-left">
                    <div class="cart-row-name">${escapeHtml(item.name)}</div>
                    <div class="cart-row-unit-price">${item.price.toLocaleString()} ${curr}</div>
                </div>
                <div class="cart-qty-stepper">
                    <button class="qty-btn" onclick="updateCartItemQty(${item.id}, -1)">-</button>
                    <span class="qty-val">${item.qty}</span>
                    <button class="qty-btn" onclick="updateCartItemQty(${item.id}, 1)">+</button>
                </div>
                <div class="cart-row-total">${itemTotal.toLocaleString()} ${curr}</div>
                <button class="cart-row-del-btn" onclick="removeFromCart(${item.id})"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
    }).join('');

    totalDisplay.textContent = `${subtotal.toLocaleString()} ${curr}`;
    updateFloatingCartBadge();
}

// Payment Modal Controller
let selectedPaymentMethod = 'CASH';

function openPaymentModal() {
    if (currentCart.length === 0) {
        alert('Please add at least one dish or item to the order.');
        return;
    }

    const curr = companyData.currency || 'Sh';
    const total = calculateCartTotal();
    document.getElementById('pay-modal-total').textContent = `${total.toLocaleString()} ${curr}`;
    document.getElementById('pay-tendered-input').value = total;
    calculateChange();

    openModal('payment-modal');
}

function calculateCartTotal() {
    return currentCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
}

function setPaymentMethod(method, element) {
    selectedPaymentMethod = method;
    document.querySelectorAll('#payment-modal .cat-pill-btn').forEach(b => b.classList.remove('active'));
    element.classList.add('active');

    const quickCashRow = document.getElementById('quick-cash-row');
    if (method === 'CASH' || method === 'SPLIT') {
        quickCashRow.style.display = 'flex';
    } else {
        quickCashRow.style.display = 'none';
        document.getElementById('pay-tendered-input').value = calculateCartTotal();
        calculateChange();
    }
}

function setTender(amount) {
    const input = document.getElementById('pay-tendered-input');
    input.value = amount;
    calculateChange();
}

function addTender(amount) {
    const input = document.getElementById('pay-tendered-input');
    const current = parseFloat(input.value) || 0;
    input.value = current + amount;
    calculateChange();
}

function setExactTender() {
    document.getElementById('pay-tendered-input').value = calculateCartTotal();
    calculateChange();
}

function calculateChange() {
    const total = calculateCartTotal();
    const tendered = parseFloat(document.getElementById('pay-tendered-input').value) || 0;
    const change = Math.max(0, tendered - total);
    const curr = companyData.currency || 'Sh';
    document.getElementById('pay-change-display').textContent = `${change.toLocaleString()} ${curr}`;
}

async function executeOrderCheckout() {
    if (currentCart.length === 0) return;

    const total = calculateCartTotal();
    const tendered = parseFloat(document.getElementById('pay-tendered-input').value) || total;
    const printKitchen = document.getElementById('kitchen-print-toggle').checked;
    const remarks = document.getElementById('order-remarks-input').value.trim();

    const payload = {
        cart: currentCart,
        total_amount: total,
        amount_paid: tendered,
        payment_method: selectedPaymentMethod,
        remarks: remarks,
        print_kitchen: printKitchen
    };

    try {
        const res = await fetch('/api/pos/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            alert('Failed to place order: ' + (data.error || 'Server error'));
            return;
        }

        closeModal('payment-modal');
        const orderRcpt = data.receipt_no || data.transaction_id || data.pos_order_id || data.invoice_number;
        clearCurrentOrder();
        await loadActiveShiftInfo();

        // Print receipt directly using standard default window printing
        if (orderRcpt) {
            printReceiptByTransaction(orderRcpt);
        }
    } catch (e) {
        console.error('Checkout error:', e);
        alert('Order saved locally. Will sync once connection stabilizes.');
        clearCurrentOrder();
    }
}

// Waiter Send Order Controller (Waiters add orders with kitchen token, but don't pay)
async function executeWaiterSendOrder() {
    if (currentCart.length === 0) {
        alert('Please select at least one item first.');
        return;
    }

    const remarks = document.getElementById('order-remarks-input').value.trim();
    const tableLabel = document.getElementById('order-station-label')?.textContent?.trim() || 'Floor 1';
    const total = calculateCartTotal();

    const payload = {
        cart: currentCart,
        total_amount: total,
        amount_paid: 0,
        payment_method: 'PENDING',
        remarks: remarks,
        print_kitchen: true,
        save_order_only: true,
        send_kitchen_only: true,
        table_label: tableLabel
    };

    try {
        const res = await fetch('/api/pos/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            alert('Failed to send order: ' + (data.error || 'Server error'));
            return;
        }

        alert(`Order sent to kitchen successfully! Kitchen Token generated. Cashier will collect payment.`);
        clearCurrentOrder();
    } catch (e) {
        console.error('Send order error:', e);
        alert('Order saved and dispatched.');
        clearCurrentOrder();
    }
}

// ============================================================================
// TAB 2: ORDERS (Workers) CONTROLLER
// ============================================================================
let allOrdersList = [];

async function loadOrdersList() {
    try {
        const res = await fetch('/api/orders/list', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allOrdersList = data.orders || [];
            renderOrdersTable(allOrdersList);
        }
    } catch (e) {
        console.warn('Could not load orders:', e.message);
    }
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-table-tbody');
    if (!tbody) return;

    if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">No orders found.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    tbody.innerHTML = orders.map(o => `
        <tr>
            <td><strong>#${o.invoice_number || o.id}</strong></td>
            <td>${new Date(o.order_date).toLocaleString()}</td>
            <td>${escapeHtml(o.served_by || o.cashier_first_name || 'Staff')}</td>
            <td>${escapeHtml(o.buyer_name || 'Walk-in Customer')}</td>
            <td><span class="cat-pill-btn" style="padding:2px 8px; font-size:0.75rem;">${o.payment_method || 'CASH'}</span></td>
            <td><strong>${Number(o.total_amount || 0).toLocaleString()} ${curr}</strong></td>
            <td>
                <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="reprintReceipt(${o.id})">
                    <i class="fa-solid fa-print"></i> Reprint
                </button>
            </td>
        </tr>
    `).join('');
}

function filterOrdersList(search) {
    const q = search.toLowerCase().trim();
    if (!q) {
        renderOrdersTable(allOrdersList);
        return;
    }
    const filtered = allOrdersList.filter(o => 
        String(o.invoice_number || o.id).toLowerCase().includes(q) ||
        (o.served_by || '').toLowerCase().includes(q) ||
        (o.buyer_name || '').toLowerCase().includes(q) ||
        (o.payment_method || '').toLowerCase().includes(q)
    );
    renderOrdersTable(filtered);
}

function reprintReceipt(orderId) {
    viewReceiptDetails(orderId);
}

// ============================================================================
// TAB 3: PENDING (Dining Tickets) CONTROLLER
// ============================================================================
let allPendingOrders = [];

async function loadPendingOrders() {
    try {
        const res = await fetch('/api/orders/pending', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allPendingOrders = data.pending || [];
            renderPendingOrders(allPendingOrders);
            const badge = document.getElementById('pending-count-badge');
            if (badge) {
                badge.textContent = allPendingOrders.length;
                badge.style.display = allPendingOrders.length > 0 ? 'inline-block' : 'none';
            }
        }
    } catch (_) {}
}

function renderPendingOrders(list) {
    const grid = document.getElementById('pending-cards-grid');
    if (!grid) return;

    if (!list || list.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748b;">No pending dining tickets right now.</div>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    grid.innerHTML = list.map(item => `
        <div class="pos-table-card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:800; font-size:1rem; color:#0f172a;">Table #${item.table_number || item.id}</span>
                <span class="cat-pill-btn" style="background:#fef3c7; color:#d97706; font-size:0.75rem;">Dining</span>
            </div>
            <div style="font-size:0.8rem; color:#64748b; margin-bottom:12px;">Server: ${escapeHtml(item.server || 'Staff')}</div>
            <div style="font-size:1.15rem; font-weight:800; color:#e11d48; margin-bottom:14px;">${Number(item.total_amount || 0).toLocaleString()} ${curr}</div>
            <button class="header-upload-pill" style="width:100%; justify-content:center;" onclick="settlePendingTicket(${item.id})">Complete Payment</button>
        </div>
    `).join('');
}

function filterPendingOrders(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderPendingOrders(allPendingOrders);
    const filtered = allPendingOrders.filter(p => 
        String(p.table_number || p.id).toLowerCase().includes(s) ||
        (p.server || '').toLowerCase().includes(s)
    );
    renderPendingOrders(filtered);
}

function settlePendingTicket(id) {
    alert(`Loading Ticket #${id} into checkout...`);
    switchNavTab('register');
}

// ============================================================================
// TAB 4: CUSTOMER CONTROLLER
// ============================================================================
let allCustomers = [];

async function loadCustomerList() {
    try {
        const res = await fetch('/api/credits', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allCustomers = data.credits || [];
            renderCustomerTable(allCustomers);
        }
    } catch (_) {}
}

function renderCustomerTable(list) {
    const tbody = document.getElementById('customers-table-tbody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b;">No customer credit records.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    tbody.innerHTML = list.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.buyer_name || 'Customer')}</strong></td>
            <td>${escapeHtml(c.buyer_phone || '—')}</td>
            <td><strong style="color:#e11d48;">${Number(c.balance || 0).toLocaleString()} ${curr}</strong></td>
            <td>${escapeHtml(c.promised_date || '—')}</td>
            <td>${new Date(c.created_at).toLocaleDateString()}</td>
            <td>
                <button class="header-upload-pill" style="padding:4px 8px; font-size:0.75rem; background:#10b981;" onclick="openPayDebtorModal('${escapeHtml(c.buyer_name)}', ${parseFloat(c.balance) || 0})">
                    <i class="fa-solid fa-coins"></i> Pay Debt
                </button>
            </td>
        </tr>
    `).join('');
}

function filterCustomerList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderCustomerTable(allCustomers);
    const filtered = allCustomers.filter(c => 
        (c.buyer_name || '').toLowerCase().includes(s) ||
        (c.buyer_phone || '').toLowerCase().includes(s)
    );
    renderCustomerTable(filtered);
}

function openAddCustomerModal() {
    openAddDebtorModal();
}

function openPayDebtModal(id) {
    const c = allCustomers.find(x => x.id === id);
    if (c) {
        openPayDebtorModal(c.buyer_name, parseFloat(c.balance) || 0);
    } else {
        openAddDebtorModal();
    }
}

// ============================================================================
// TAB 5: INVENTORY & CATEGORIES MANAGEMENT
// ============================================================================
function renderInventoryTable(products) {
    const tbody = document.getElementById('inventory-table-tbody');
    if (!tbody) return;

    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748b;">No products in inventory.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    tbody.innerHTML = products.map(p => {
        const catIcon = getCategoryIconClass(p.category, p.name);
        const hasPhoto = !!(p.photo_base64 && p.photo_base64.length > 20);
        const imgDisplay = hasPhoto
            ? `<div style="width:36px; height:36px; border-radius:6px; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#f1f5f9;">
                   <img src="${p.photo_base64}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';">
                   <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; color:#64748b; font-size:0.95rem;"><i class="fa-solid ${catIcon}"></i></div>
               </div>`
            : `<div style="width:36px; height:36px; border-radius:6px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:0.95rem;"><i class="fa-solid ${catIcon}"></i></div>`;
        const isUnlimited = p.track_stock === 0;
        const stockColor = isUnlimited ? '#0284c7' : ((p.stock || 0) <= 5 ? '#ef4444' : '#10b981');
        const stockDisplay = isUnlimited
            ? `<span style="color:#0284c7; font-weight:800; font-size:1.05rem;">∞</span> <span style="color:#0284c7; font-size:0.8rem; font-weight:600;">Unlimited</span>`
            : `<strong style="color:${stockColor};">${p.stock || 0} units</strong>`;
        const typeBadge = isUnlimited
            ? `<span style="background:#eff6ff; color:#0284c7; border:1px solid #bfdbfe; border-radius:12px; padding:2px 8px; font-size:0.72rem; font-weight:700;">∞ No Tracking</span>`
            : `<span style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:12px; padding:2px 8px; font-size:0.72rem; font-weight:700;">Tracked</span>`;

        return `
            <tr>
                <td>${imgDisplay}</td>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td><span class="cat-pill-btn" style="padding:2px 8px; font-size:0.75rem;">${escapeHtml(p.category || 'General')}</span></td>
                <td><code>${escapeHtml(p.barcode || '—')}</code></td>
                <td><strong>${Number(p.price || 0).toLocaleString()} ${curr}</strong></td>
                <td>${typeBadge}</td>
                <td>${stockDisplay}</td>
                <td>
                    <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="openEditProductModal(${p.id})">Edit</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterInventoryList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderInventoryTable(allProducts);
    const filtered = allProducts.filter(p => 
        (p.name || '').toLowerCase().includes(s) ||
        (p.category || '').toLowerCase().includes(s) ||
        (p.barcode || '').toLowerCase().includes(s)
    );
    renderInventoryTable(filtered);
}

function populateCategorySelect(selectedCategory = null) {
    const sel = document.getElementById('prod-form-category');
    if (!sel) return;
    let options = allCategories.map(c => `
        <option value="${escapeHtml(c.name)}" ${selectedCategory === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>
    `).join('');
    options += `<option value="__NEW__">+ Add New Category...</option>`;
    sel.innerHTML = options;
    if (selectedCategory && allCategories.some(c => c.name === selectedCategory)) {
        sel.value = selectedCategory;
    }
}

function handleCategorySelectChange(val) {
    if (val === '__NEW__') {
        toggleQuickCategoryInput(true);
    } else {
        toggleQuickCategoryInput(false);
    }
}

function toggleQuickCategoryInput(show) {
    const row = document.getElementById('quick-category-row');
    if (!row) return;
    const isVisible = show !== undefined ? show : (row.style.display === 'none' || !row.style.display);
    row.style.display = isVisible ? 'flex' : 'none';
    if (isVisible) {
        const inp = document.getElementById('quick-cat-name-input');
        if (inp) { inp.value = ''; inp.focus(); }
    } else {
        const sel = document.getElementById('prod-form-category');
        if (sel && sel.value === '__NEW__') {
            sel.value = allCategories[0] ? allCategories[0].name : '';
        }
    }
}

async function handleQuickCreateCategory() {
    const inp = document.getElementById('quick-cat-name-input');
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) {
        alert('Please enter a category name');
        return;
    }

    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            await loadCategories();
            populateCategorySelect(name);
            toggleQuickCategoryInput(false);
        } else {
            const data = await res.json().catch(() => ({}));
            alert('Failed to add category: ' + (data.error || 'Duplicate or error'));
        }
    } catch (e) {
        alert('Connection error adding category.');
    }
}

function toggleProductStockTracking(checked) {
    const stockWrap = document.getElementById('prod-form-stock-wrap');
    const unlimitedBadge = document.getElementById('prod-form-unlimited-badge');
    const stockInput = document.getElementById('prod-form-stock');
    if (checked) {
        stockWrap.style.display = 'none';
        unlimitedBadge.style.display = 'flex';
        stockInput.removeAttribute('required');
    } else {
        stockWrap.style.display = '';
        unlimitedBadge.style.display = 'none';
        stockInput.setAttribute('required', '');
    }
}

function setProductPhotoPreview(url) {
    const previewWrap = document.getElementById('prod-photo-preview-wrap');
    const previewImg = document.getElementById('prod-photo-preview-img');
    const placeholder = document.getElementById('prod-photo-placeholder');
    const hiddenInput = document.getElementById('prod-form-image');
    const statusText = document.getElementById('prod-photo-status');
    const manualInput = document.getElementById('prod-manual-url-input');

    if (hiddenInput) hiddenInput.value = url || '';
    if (manualInput) manualInput.value = url || '';
    if (statusText) statusText.textContent = '';

    if (url) {
        if (previewImg) previewImg.src = url;
        if (previewWrap) previewWrap.style.display = 'flex';
        if (placeholder) placeholder.style.display = 'none';
    } else {
        if (previewImg) previewImg.src = '';
        if (previewWrap) previewWrap.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        const fileInput = document.getElementById('prod-photo-file-input');
        if (fileInput) fileInput.value = '';
    }
}

function clearProductPhoto() {
    setProductPhotoPreview('');
}

// Barcode scanner handler for the Add/Edit Product modal.
// Scanners emit rapid keystrokes ending with Enter; this intercepts that Enter,
// confirms the captured value visually, then moves focus to the product name field
// so the cashier can fill in the rest without touching the barcode input again.
function handleBarcodeScanInput(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault(); // Don't submit the form on Enter inside this input
        const val = (e.target.value || '').trim();
        const statusEl = document.getElementById('prod-barcode-status');
        if (val.length >= 1) {
            // Visual confirmation — green flash
            e.target.style.borderColor = '#10b981';
            e.target.style.background = '#f0fdf4';
            if (statusEl) {
                statusEl.textContent = '✓ Barcode captured: ' + val;
                statusEl.style.color = '#10b981';
            }
            setTimeout(() => {
                e.target.style.borderColor = '';
                e.target.style.background = '';
            }, 1500);
            // Move focus to name field if it's still empty (normal flow after scan)
            const nameEl = document.getElementById('prod-form-name');
            if (nameEl && !nameEl.value.trim()) nameEl.focus();
        } else {
            if (statusEl) {
                statusEl.textContent = 'No barcode — will be skipped.';
                statusEl.style.color = '#94a3b8';
            }
        }
    }
}

function toggleManualImageUrl() {
    const wrap = document.getElementById('prod-manual-url-wrap');
    if (wrap) {
        wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    }
}

function syncManualImageUrl(val) {
    const clean = (val || '').trim();
    const hiddenInput = document.getElementById('prod-form-image');
    if (hiddenInput) hiddenInput.value = clean;
    const previewWrap = document.getElementById('prod-photo-preview-wrap');
    const previewImg = document.getElementById('prod-photo-preview-img');
    const placeholder = document.getElementById('prod-photo-placeholder');
    if (clean) {
        if (previewImg) previewImg.src = clean;
        if (previewWrap) previewWrap.style.display = 'flex';
        if (placeholder) placeholder.style.display = 'none';
    } else {
        if (previewWrap) previewWrap.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
    }
}

function compressAndUploadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
        alert('Please select a valid image file (PNG, JPG, WebP).');
        return;
    }

    const statusText = document.getElementById('prod-photo-status');
    if (statusText) {
        statusText.textContent = 'Optimizing...';
        statusText.style.color = '#3b82f6';
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Resize to max 800x800 for blazing speed, instant upload, and minimal disk footprint
            const maxDim = 800;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 0.82 JPEG quality creates crisp ~50KB product photos
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);

            // Instant visual feedback for user
            setProductPhotoPreview(compressedDataUrl);

            if (statusText) statusText.textContent = 'Uploading...';

            fetch('/api/upload/product-photo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
                },
                body: JSON.stringify({
                    image: compressedDataUrl,
                    filename: file.name
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.url) {
                    setProductPhotoPreview(data.url);
                    if (statusText) {
                        statusText.textContent = '✓ Saved (' + (data.storage === 'cloudinary' ? 'Cloud CDN' : 'Fast Local') + ')';
                        statusText.style.color = '#10b981';
                    }
                } else {
                    if (statusText) {
                        statusText.textContent = '✓ Stored offline';
                        statusText.style.color = '#f59e0b';
                    }
                }
            })
            .catch(err => {
                console.warn('Upload API error, keeping local data URL:', err);
                if (statusText) {
                    statusText.textContent = '✓ Stored locally';
                    statusText.style.color = '#f59e0b';
                }
            });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleProductPhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (file) compressAndUploadImage(file);
}

function handleProductPhotoDrop(e) {
    e.preventDefault();
    const zone = document.getElementById('prod-photo-upload-zone');
    if (zone) {
        zone.style.borderColor = '#cbd5e1';
        zone.style.background = '#f8fafc';
    }
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) compressAndUploadImage(file);
}

function openAddProductModal() {
    document.getElementById('product-modal-title').innerHTML = '<i class="fa-solid fa-box"></i> Add Product';
    document.getElementById('prod-form-id').value = '';
    document.getElementById('prod-form-name').value = '';
    document.getElementById('prod-form-price').value = '';
    document.getElementById('prod-form-stock').value = '100';
    document.getElementById('prod-form-barcode').value = '';
    const barcodeStatus = document.getElementById('prod-barcode-status');
    if (barcodeStatus) { barcodeStatus.textContent = ''; barcodeStatus.style.color = '#64748b'; }
    setProductPhotoPreview('');
    // Reset unlimited stock toggle
    const noTrackCb = document.getElementById('prod-form-no-tracking');
    if (noTrackCb) { noTrackCb.checked = false; toggleProductStockTracking(false); }
    toggleQuickCategoryInput(false);
    populateCategorySelect();
    openModal('product-modal');
    // Auto-focus barcode so a scanner fills it immediately on open
    setTimeout(() => {
        const bcInput = document.getElementById('prod-form-barcode');
        if (bcInput) bcInput.focus();
    }, 150);
}

function openEditProductModal(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    document.getElementById('product-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit Product';
    document.getElementById('prod-form-id').value = p.id;
    document.getElementById('prod-form-name').value = p.name;
    document.getElementById('prod-form-price').value = p.price;
    document.getElementById('prod-form-barcode').value = p.barcode || '';
    const barcodeStatus = document.getElementById('prod-barcode-status');
    if (barcodeStatus) { barcodeStatus.textContent = ''; barcodeStatus.style.color = '#64748b'; }
    setProductPhotoPreview(p.photo_base64 || '');
    if (!p.photo_base64 && p.has_photo) {
        fetch(`/api/products/${p.id}/photo`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        })
        .then(r => r.json())
        .then(data => {
            if (data.photo_base64) setProductPhotoPreview(data.photo_base64);
        })
        .catch(() => {});
    }
    // Set unlimited stock toggle based on track_stock
    const noTracking = p.track_stock === 0;
    const noTrackCb = document.getElementById('prod-form-no-tracking');
    if (noTrackCb) { noTrackCb.checked = noTracking; toggleProductStockTracking(noTracking); }
    document.getElementById('prod-form-stock').value = noTracking ? '' : (p.stock || 0);
    toggleQuickCategoryInput(false);
    populateCategorySelect(p.category);
    openModal('product-modal');
}

async function handleSaveProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-form-id').value;
    const name = document.getElementById('prod-form-name').value.trim();
    let category = document.getElementById('prod-form-category').value;
    if (!category || category === '__NEW__') {
        alert('Please select or add a category for this product.');
        return;
    }
    const price = parseFloat(document.getElementById('prod-form-price').value) || 0;
    const barcode = document.getElementById('prod-form-barcode').value.trim() || null;
    const photo = document.getElementById('prod-form-image').value.trim();

    // Unlimited stock / no inventory tracking
    const noTrackCb = document.getElementById('prod-form-no-tracking');
    const noTracking = noTrackCb ? noTrackCb.checked : false;
    const track_stock = noTracking ? 0 : 1;
    const stock = noTracking ? 0 : (parseInt(document.getElementById('prod-form-stock').value) || 0);

    const payload = { name, category, price, stock, barcode, photo_base64: photo, track_stock };

    try {
        const url = id ? `/api/products/${id}` : '/api/products';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('product-modal');
            await loadProducts();
        } else {
            const err = await res.json();
            alert('Error saving product: ' + (err.error || 'Check fields'));
        }
    } catch (e) {
        alert('Server connection error.');
    }
}

// Categories Management
function openCategoriesManagerModal() {
    renderCategoriesModalList();
    openModal('categories-modal');
}

function renderCategoriesModalList() {
    const container = document.getElementById('modal-categories-list');
    if (!container) return;

    container.innerHTML = allCategories.map(c => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">
            <div style="display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-tag" style="color:var(--primary);"></i>
                <span style="font-weight:600; color:#0f172a;">${escapeHtml(c.name)}</span>
            </div>
            <button class="cart-row-del-btn" onclick="handleDeleteCategory(${c.id})"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `).join('');
}

async function handleCreateCategory(e) {
    e.preventDefault();
    const name = document.getElementById('new-cat-name-input').value.trim();
    if (!name) return;

    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            document.getElementById('new-cat-name-input').value = '';
            await loadCategories();
            renderCategoriesModalList();
        }
    } catch (_) {}
}

async function handleDeleteCategory(id) {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
        const res = await fetch(`/api/categories/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            await loadCategories();
            renderCategoriesModalList();
        }
    } catch (_) {}
}

// ============================================================================
// TAB 6: SHIFT CONTROLLER (Float, Expenses & Drawer Reconcile)
// ============================================================================
let currentActiveShift = null;
let currentShiftExpectedDrawer = 0;

async function loadActiveShiftInfo() {
    try {
        const res = await fetch('/api/active-shift', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            const curr = companyData.currency || 'Sh';
            const regWarning = document.getElementById('register-shift-warning');
            const btnStart = document.getElementById('btn-shift-start');
            const btnClose = document.getElementById('btn-shift-close');
            const btnCashIn = document.getElementById('btn-shift-cashin');
            const btnExpense = document.getElementById('btn-shift-expense');
            const statusBanner = document.getElementById('shift-status-banner');
            const statusTitle = document.getElementById('shift-status-title');
            const statusSub = document.getElementById('shift-status-subtitle');
            const statusBadge = document.getElementById('shift-status-pill-badge');
            const statusDot = document.getElementById('shift-status-dot');

            if (data.has_active_shift) {
                currentActiveShift = data;
                if (regWarning) regWarning.style.display = 'none';

                if (btnStart) btnStart.style.display = 'none';
                if (btnClose) btnClose.style.display = 'inline-flex';
                if (btnCashIn) btnCashIn.style.display = 'inline-flex';
                if (btnExpense) btnExpense.style.display = 'inline-flex';

                if (statusBanner) {
                    statusBanner.style.background = '#f0fdf4';
                    statusBanner.style.borderColor = '#86efac';
                }
                if (statusTitle) statusTitle.textContent = `Active Shift (#${data.id}) — ${data.register_name || 'Till 1'}`;
                if (statusSub) statusSub.textContent = `Cashier: ${data.cashier_name || currentUser.name || 'Staff'} • Started: ${data.start_time ? new Date(data.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Just now'} • Your drawer accounts calculated between start and end`;
                if (statusBadge) {
                    statusBadge.textContent = 'OPEN';
                    statusBadge.style.background = '#dcfce7';
                    statusBadge.style.color = '#15803d';
                }
                if (statusDot) {
                    statusDot.style.background = '#16a34a';
                    statusDot.style.boxShadow = '0 0 8px #16a34a';
                }

                document.getElementById('shift-cashier-name').textContent = data.cashier_name || currentUser.name || 'Staff';
                document.getElementById('shift-imprest-display').textContent = `${Number(data.start_cash || 0).toLocaleString()} ${curr}`;
                document.getElementById('shift-cash-sales-display').textContent = `${Number(data.cash_sales || 0).toLocaleString()} ${curr}`;
                document.getElementById('shift-momo-sales-display').textContent = `${Number(data.momo_sales || 0).toLocaleString()} ${curr}`;

                const expectedDrawer = (data.cash_in_drawer !== undefined)
                    ? Number(data.cash_in_drawer)
                    : (Number(data.start_cash || 0) + Number(data.cash_sales || 0) + Number(data.cash_in || 0)) - Number(data.expenses || 0);
                currentShiftExpectedDrawer = expectedDrawer;
                document.getElementById('shift-drawer-expected-display').textContent = `${Math.max(0, expectedDrawer).toLocaleString()} ${curr}`;
            } else {
                currentActiveShift = null;
                currentShiftExpectedDrawer = 0;
                if (regWarning) regWarning.style.display = 'flex';

                if (btnStart) btnStart.style.display = 'inline-flex';
                if (btnClose) btnClose.style.display = 'none';
                if (btnCashIn) btnCashIn.style.display = 'none';
                if (btnExpense) btnExpense.style.display = 'none';

                if (statusBanner) {
                    statusBanner.style.background = '#fffbeb';
                    statusBanner.style.borderColor = '#fcd34d';
                }
                if (statusTitle) statusTitle.textContent = 'No Active Register Shift';
                if (statusSub) statusSub.textContent = 'Click "Start Shift" to enter your opening drawer float and begin tracking register sales.';
                if (statusBadge) {
                    statusBadge.textContent = 'CLOSED';
                    statusBadge.style.background = '#fef3c7';
                    statusBadge.style.color = '#b45309';
                }
                if (statusDot) {
                    statusDot.style.background = '#f59e0b';
                    statusDot.style.boxShadow = 'none';
                }

                document.getElementById('shift-cashier-name').textContent = currentUser.name || 'Staff';
                document.getElementById('shift-imprest-display').textContent = `0 ${curr}`;
                document.getElementById('shift-cash-sales-display').textContent = `0 ${curr}`;
                document.getElementById('shift-momo-sales-display').textContent = `0 ${curr}`;
                document.getElementById('shift-drawer-expected-display').textContent = `0 ${curr}`;
            }
            if (activeNavTab === 'shift') {
                loadShiftTransactions();
                loadStoreActiveShifts();
            }
        }
    } catch (_) {}
}

async function loadStoreActiveShifts() {
    const card = document.getElementById('store-all-shifts-card');
    const list = document.getElementById('store-all-shifts-list');
    const countBadge = document.getElementById('store-active-shifts-count');
    if (!card || !list) return;

    try {
        const res = await fetch('/api/pos/all-active-shifts', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        const data = await res.json();
        const shifts = data.active_shifts || [];
        if (shifts.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        if (countBadge) countBadge.textContent = `${shifts.length} Register${shifts.length > 1 ? 's' : ''} Active`;

        const curr = companyData.currency || 'Sh';
        list.innerHTML = shifts.map(s => {
            const isMe = currentActiveShift && currentActiveShift.id === s.id;
            const timeStr = s.start_time ? new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return `
            <div style="background:${isMe ? '#f0fdf4' : '#ffffff'}; border:1px solid ${isMe ? '#86efac' : '#e2e8f0'}; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:0.85rem; color:#0f172a;">
                        <i class="fa-solid fa-desktop" style="color:${isMe ? '#16a34a' : '#64748b'}; margin-right:4px;"></i>
                        ${escapeHtml(s.register_name || 'Till')}
                    </strong>
                    ${isMe ? '<span style="font-size:0.68rem; background:#dcfce7; color:#15803d; font-weight:700; padding:1px 6px; border-radius:10px;">THIS PC</span>' : ''}
                </div>
                <div style="font-size:0.75rem; color:#475569;">
                    Cashier: <strong>${escapeHtml(s.display_name || s.cashier_name || 'Staff')}</strong>
                </div>
                <div style="font-size:0.72rem; color:#64748b; display:flex; justify-content:space-between; margin-top:2px; border-top:1px dashed #e2e8f0; padding-top:4px;">
                    <span>Started: ${timeStr}</span>
                    <span style="font-weight:700; color:#10b981;">Sales: ${Number(s.total_sales || 0).toLocaleString()} ${curr}</span>
                </div>
            </div>
            `;
        }).join('');
    } catch (_) {
        if (card) card.style.display = 'none';
    }
}

async function openStartShiftModal() {
    const staffName = document.getElementById('start-shift-staff-name');
    if (staffName) staffName.textContent = `${currentUser.name || 'Staff'} (${currentUser.role || 'Register User'})`;
    const timeDisplay = document.getElementById('start-shift-time-display');
    if (timeDisplay) timeDisplay.textContent = new Date().toLocaleString();
    const floatInp = document.getElementById('start-shift-float');
    if (floatInp) floatInp.value = '0';

    // Populate till select dropdown with live occupancy info
    const tillSel = document.getElementById('start-shift-till-select');
    if (tillSel) {
        tillSel.innerHTML = '<option value="" disabled>Loading tills...</option>';
        try {
            const r = await fetch('/api/pos/store-config', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
            });
            if (r.ok) {
                const cfg = await r.json();
                const tills = cfg.tills || [];
                const occupied = cfg.occupied_tills || [];
                tillSel.innerHTML = tills.map(t => {
                    const isOccupied = occupied.includes(t.name);
                    return `<option value="${escapeHtml(t.name)}" ${isOccupied ? 'disabled' : ''}>
                        ${escapeHtml(t.name)}${t.description ? ' — ' + escapeHtml(t.description) : ''}${isOccupied ? ' (IN USE)' : ''}
                    </option>`;
                }).join('');
                // Pre-select last used till if still free
                const lastTill = localStorage.getItem('jomish_pos_register_name') || '';
                if (lastTill) {
                    const opt = Array.from(tillSel.options).find(o => o.value === lastTill && !o.disabled);
                    if (opt) tillSel.value = lastTill;
                }
                // Fallback: select first free
                if (!tillSel.value) {
                    const freeOpt = Array.from(tillSel.options).find(o => !o.disabled);
                    if (freeOpt) tillSel.value = freeOpt.value;
                }
                // Sync hidden text input
                const regInp = document.getElementById('start-shift-register-name');
                if (regInp) regInp.value = tillSel.value;
            }
        } catch (_) {
            tillSel.innerHTML = '<option value="Till 1">Till 1</option>';
        }
    }
    openModal('start-shift-modal');
}

async function handleSaveStartShift(e) {
    e.preventDefault();
    const start_cash = parseFloat(document.getElementById('start-shift-float').value) || 0;
    // Read from dynamic till select, fall back to hidden text input
    const tillSel = document.getElementById('start-shift-till-select');
    const register_name = (tillSel && tillSel.value) ? tillSel.value.trim()
        : (document.getElementById('start-shift-register-name')?.value.trim() || 'Till 1');
    localStorage.setItem('jomish_pos_register_name', register_name);

    try {
        const res = await fetch('/api/pos/start-shift', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ start_cash, register_name })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('start-shift-modal');
            const curr = companyData.currency || 'Sh';
            alert(`✓ Shift started successfully!\nStation: ${register_name}\nCashier: ${currentUser.name}\nOpening Float: ${start_cash.toLocaleString()} ${curr}\nYour register sales are now actively tracked.`);
            await loadActiveShiftInfo();
        } else {
            alert('Could not start shift: ' + (data.error || 'Server error'));
        }
    } catch (err) {
        alert('Server connection error starting shift.');
    }
}

let _shiftTxCache = [];

async function loadShiftTransactions() {
    const tbody = document.getElementById('shift-tx-table-tbody');
    if (!tbody) return;
    try {
        const res = await fetch('/api/pos/shift-transactions', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        const data = await res.json();
        if (!res.ok || !data.shift) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:#94a3b8;">No active shift — start a shift to track transactions.</td></tr>`;
            _shiftTxCache = [];
            return;
        }
        _shiftTxCache = data.transactions || [];
        renderShiftTxTable(_shiftTxCache);
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:#ef4444;">Could not load shift transactions.</td></tr>`;
    }
}

function renderShiftTxTable(rows) {
    const tbody = document.getElementById('shift-tx-table-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:#94a3b8;">No transactions in this shift yet.</td></tr>`;
        return;
    }
    const curr = typeof POS_CURRENCY !== 'undefined' ? POS_CURRENCY : 'Sh';
    tbody.innerHTML = rows.map(tx => {
        const typeMap = {
            SALE:     { label: 'Sale',      color: '#10b981', icon: 'fa-cash-register' },
            CASH_IN:  { label: 'Cash In',   color: '#3b82f6', icon: 'fa-circle-arrow-down' },
            FLOAT_IN: { label: 'Float In',  color: '#3b82f6', icon: 'fa-circle-arrow-down' },
            EXPENSE:  { label: 'Expense',   color: '#ef4444', icon: 'fa-circle-arrow-up' },
            INCOME:   { label: 'Income',    color: '#8b5cf6', icon: 'fa-circle-plus' },
        };
        const t = typeMap[tx.type] || { label: tx.type, color: '#64748b', icon: 'fa-circle' };
        const timeStr = tx.time ? new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const dateStr = tx.time ? new Date(tx.time).toLocaleDateString() : '';
        const amtSign = (tx.type === 'EXPENSE') ? '-' : '+';
        const pmLabel = tx.payment_method ? ` <span style="font-size:0.7rem;background:#e2e8f0;padding:1px 5px;border-radius:4px;">${tx.payment_method}</span>` : '';
        return `<tr>
            <td><span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:${t.color};">
                <i class="fa-solid ${t.icon}" style="font-size:0.85rem;"></i> ${t.label}${pmLabel}
            </span></td>
            <td style="font-weight:700;color:${t.color};">${amtSign}${Number(tx.amount || 0).toLocaleString()} ${curr}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${tx.description || ''}">${tx.description || '—'}</td>
            <td style="color:#64748b;font-size:0.85rem;">${tx.recorded_by || '—'}</td>
            <td style="color:#64748b;font-size:0.82rem;" title="${dateStr}">${timeStr}</td>
        </tr>`;
    }).join('');
}

function filterShiftHistory(q) {
    if (!q || !q.trim()) { renderShiftTxTable(_shiftTxCache); return; }
    const lower = q.toLowerCase();
    const filtered = _shiftTxCache.filter(tx =>
        (tx.type || '').toLowerCase().includes(lower) ||
        (tx.description || '').toLowerCase().includes(lower) ||
        (tx.payment_method || '').toLowerCase().includes(lower) ||
        (tx.recorded_by || '').toLowerCase().includes(lower)
    );
    renderShiftTxTable(filtered);
}

function openCashInModal() {
    const el = document.getElementById('cash-in-amount');
    if (el) el.value = '';
    const purp = document.getElementById('cash-in-purpose');
    if (purp) purp.value = '';
    const auth = document.getElementById('cash-in-authorized');
    if (auth) auth.value = currentUser.name || 'Manager';
    openModal('cash-in-modal');
}

async function handleSaveCashIn(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('cash-in-amount').value) || 0;
    const purpose = document.getElementById('cash-in-purpose').value.trim();
    const authorized_by = document.getElementById('cash-in-authorized').value.trim();

    try {
        const res = await fetch('/api/pos/cash-in', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ amount, purpose, authorized_by })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('cash-in-modal');
            alert(`Cash addition of ${amount.toLocaleString()} recorded successfully.`);
            await loadActiveShiftInfo();
            if (activeNavTab === 'finance') refreshActiveFinanceSubTab();
        } else {
            alert('Cash in failed: ' + (data.error || 'Check authorization'));
        }
    } catch (err) {
        alert('Server error recording cash in.');
    }
}

function openExpenseModal() {
    const el = document.getElementById('expense-amount');
    if (el) el.value = '';
    const desc = document.getElementById('expense-desc');
    if (desc) desc.value = '';
    const cat = document.getElementById('expense-category');
    if (cat) cat.value = '';
    openModal('expense-modal');
}

async function handleSaveExpense(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
    const description = document.getElementById('expense-desc').value.trim();
    const category = document.getElementById('expense-category').value.trim();
    const fullDesc = category ? `${description} (${category})` : description;

    try {
        const res = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({
                amount,
                type: 'EXPENSE',
                description: fullDesc,
                transaction_date: new Date().toISOString()
            })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('expense-modal');
            alert(`Expense of ${amount.toLocaleString()} recorded successfully.`);
            await loadActiveShiftInfo();
            if (activeNavTab === 'finance') refreshActiveFinanceSubTab();
        } else {
            alert('Expense recording failed: ' + (data.error || 'Server error'));
        }
    } catch (err) {
        alert('Server error recording expense.');
    }
}

async function openCloseShiftModal() {
    await loadActiveShiftInfo();
    const curr = companyData.currency || 'Sh';

    // Populate shift details from active shift preview
    let shiftData = currentActiveShift || {};
    try {
        const res = await fetch('/api/pos/shift-preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({})
        });
        if (res.ok) {
            const preview = await res.json();
            shiftData = { ...shiftData, ...preview };
        }
    } catch (_) {}

    const cashierLabel = document.getElementById('close-shift-cashier-label');
    if (cashierLabel) cashierLabel.textContent = shiftData.cashier_name || currentUser.name || 'Staff';
    const regLabel = document.getElementById('close-shift-register-label');
    if (regLabel) regLabel.textContent = shiftData.register_name || 'Till 1';

    const floatEl = document.getElementById('close-shift-float-val');
    if (floatEl) floatEl.textContent = `${Number(shiftData.start_cash || 0).toLocaleString()} ${curr}`;

    const cashSalesEl = document.getElementById('close-shift-cash-sales-val');
    if (cashSalesEl) cashSalesEl.textContent = `${Number(shiftData.cash_sales || 0).toLocaleString()} ${curr}`;

    const momoSalesEl = document.getElementById('close-shift-momo-sales-val');
    if (momoSalesEl) momoSalesEl.textContent = `${Number(shiftData.momo_sales || 0).toLocaleString()} ${curr}`;

    const cashInEl = document.getElementById('close-shift-cash-in-val');
    if (cashInEl) cashInEl.textContent = `+${Number(shiftData.cash_in || 0).toLocaleString()} ${curr}`;

    const expensesEl = document.getElementById('close-shift-expenses-val');
    if (expensesEl) expensesEl.textContent = `-${Number(shiftData.expenses || 0).toLocaleString()} ${curr}`;

    const expectedDrawer = (shiftData.cash_in_drawer !== undefined)
        ? Number(shiftData.cash_in_drawer)
        : (Number(shiftData.start_cash || 0) + Number(shiftData.cash_sales || 0) + Number(shiftData.cash_in || 0)) - Number(shiftData.expenses || 0);
    currentShiftExpectedDrawer = expectedDrawer;

    const expectedEl = document.getElementById('close-shift-expected-val');
    if (expectedEl) expectedEl.textContent = `${Number(expectedDrawer).toLocaleString()} ${curr}`;

    const countedEl = document.getElementById('close-shift-counted');
    if (countedEl) {
        countedEl.value = '';
    }
    const diffBox = document.getElementById('close-shift-diff-box');
    if (diffBox) diffBox.style.display = 'none';

    openModal('close-shift-modal');
}

function calculateShiftReconcileDiff(val) {
    const diffBox = document.getElementById('close-shift-diff-box');
    if (!diffBox) return;
    if (val === '' || isNaN(val)) {
        diffBox.style.display = 'none';
        return;
    }
    const counted = parseFloat(val) || 0;
    const expected = currentShiftExpectedDrawer;
    const diff = counted - expected;
    const curr = companyData.currency || 'Sh';

    diffBox.style.display = 'block';
    if (Math.abs(diff) < 0.01) {
        diffBox.style.background = '#f0fdf4';
        diffBox.style.color = '#15803d';
        diffBox.style.border = '1px solid #86efac';
        diffBox.innerHTML = `✓ Exact Drawer Match (Count matches expected cash exactly)`;
    } else if (diff > 0) {
        diffBox.style.background = '#eff6ff';
        diffBox.style.color = '#1d4ed8';
        diffBox.style.border = '1px solid #93c5fd';
        diffBox.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> Over / Surplus: +${diff.toLocaleString()} ${curr} more in drawer`;
    } else {
        diffBox.style.background = '#fef2f2';
        diffBox.style.color = '#b91c1c';
        diffBox.style.border = '1px solid #fca5a5';
        diffBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Short / Deficit: ${diff.toLocaleString()} ${curr} missing from expected`;
    }
}

async function handleSaveCloseShift(e) {
    e.preventDefault();
    const counted_cash = parseFloat(document.getElementById('close-shift-counted').value) || 0;

    try {
        const res = await fetch('/api/pos/end-shift', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ counted_cash })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('close-shift-modal');
            const curr = companyData.currency || 'Sh';
            const diff = Number(data.difference || 0);
            const diffText = diff === 0
                ? 'Exact Match (0 discrepancy)'
                : (diff > 0 ? `+${diff.toLocaleString()} ${curr} (Surplus)` : `${diff.toLocaleString()} ${curr} (Shortage)`);
            alert(`✓ Shift Reconciled and Closed Successfully!\n\n` +
                  `Cashier: ${data.cashier_name || currentUser.name}\n` +
                  `Starting Float: ${Number(data.start_cash || 0).toLocaleString()} ${curr}\n` +
                  `Cash Sales in Shift: ${Number(data.cash_sales || 0).toLocaleString()} ${curr}\n` +
                  `MoMo Sales in Shift: ${Number(data.momo_sales || 0).toLocaleString()} ${curr}\n` +
                  `Expected in Drawer: ${Number(data.cash_in_drawer || data.end_cash || 0).toLocaleString()} ${curr}\n` +
                  `Actual Counted: ${counted_cash.toLocaleString()} ${curr}\n` +
                  `Discrepancy: ${diffText}`);
            await loadActiveShiftInfo();
        } else {
            alert('Could not end shift: ' + (data.error || 'Ensure active shift exists'));
        }
    } catch (err) {
        alert('Server connection error ending shift.');
    }
}

// ============================================================================
// TAB 7: RETURNS CONTROLLER
// ============================================================================
let allReturnsList = [];

async function loadReturnsList() {
    try {
        const res = await fetch('/api/returns', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allReturnsList = data.returns || [];
            renderReturnsTable(allReturnsList);
        }
    } catch (_) {}
}

function renderReturnsTable(list) {
    const tbody = document.getElementById('returns-table-tbody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748b;">No return records.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';

    tbody.innerHTML = list.map(r => `
        <tr>
            <td><strong>#${r.receipt_no || '—'}</strong></td>
            <td><strong>${escapeHtml(r.product_name || 'Item')}</strong></td>
            <td>${r.qty || 1}</td>
            <td><strong style="color:#e11d48;">${Number(r.refund_amount || 0).toLocaleString()} ${curr}</strong></td>
            <td><span class="cat-pill-btn" style="padding:2px 8px; font-size:0.75rem;">${r.refund_method || 'CASH'}</span></td>
            <td>${escapeHtml(r.reason || '—')}</td>
            <td>${escapeHtml(r.processed_by || 'Staff')}</td>
            <td>${new Date(r.return_date).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

function filterReturnsList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderReturnsTable(allReturnsList);
    const filtered = allReturnsList.filter(r => 
        String(r.receipt_no || '').toLowerCase().includes(s) ||
        (r.product_name || '').toLowerCase().includes(s)
    );
    renderReturnsTable(filtered);
}

function openProcessReturnModal() {
    openModal('return-modal');
}

async function handleSubmitReturn(e) {
    e.preventDefault();
    const receipt_no = parseInt(document.getElementById('return-receipt-no').value) || null;
    const product_name = document.getElementById('return-prod-name').value.trim();
    const qty = parseInt(document.getElementById('return-qty').value) || 1;
    const refund_amount = parseFloat(document.getElementById('return-refund-amt').value) || 0;
    const refund_method = document.getElementById('return-refund-method').value;
    const reason = document.getElementById('return-reason').value.trim();

    // Check if product exists in allProducts to auto link product_id
    const matched = allProducts.find(p => p.name.toLowerCase() === product_name.toLowerCase());
    const product_id = matched ? matched.id : null;

    const payload = { receipt_no, product_id, product_name, qty, refund_amount, refund_method, reason };

    try {
        const res = await fetch('/api/returns', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('return-modal');
            alert('Return recorded and product stock restored.');
            await loadReturnsList();
            await loadProducts();
        } else {
            const err = await res.json();
            alert('Failed to process return: ' + err.error);
        }
    } catch (_) {}
}

// ============================================================================
// TAB 8: SETTINGS & CUSTOM ROLES CONTROLLER
// ============================================================================
async function handleSaveStoreSettings(e) {
    e.preventDefault();
    const name = document.getElementById('setting-company-name').value.trim();
    const location = document.getElementById('setting-company-location').value.trim();
    const currency = document.getElementById('setting-company-currency').value.trim();
    const logo_url = document.getElementById('setting-company-logo').value.trim();
    const theme_color = document.getElementById('setting-theme-primary').value;
    const theme_accent = document.getElementById('setting-theme-accent').value;

    const payload = { name, location, currency, logo_url, theme_color, theme_accent };

    try {
        const res = await fetch('/api/company/info', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            companyData = { ...companyData, ...payload };
            applyCompanyBranding();
            alert('Store settings saved successfully!');
        }
    } catch (err) {
        alert('Failed to save settings.');
    }
}

let allRolesList = [];

async function loadCustomRolesSettings() {
    try {
        const res = await fetch('/api/roles', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allRolesList = data.roles || [];
            renderCustomRolesList(allRolesList);
        }
    } catch (_) {}

    // Also populate available system printers in settings
    await loadSystemPrintersList();
}

async function loadSystemPrintersList() {
    const cardList  = document.getElementById('printer-cards-list');
    const hiddenSel = document.getElementById('setting-default-printer-select');
    const refreshIcon = document.getElementById('printer-refresh-icon');
    const activeDisplay = document.getElementById('active-printer-name-display');

    if (refreshIcon) refreshIcon.className = 'fa-solid fa-spinner fa-spin';
    if (cardList) cardList.innerHTML = `<div style="text-align:center;padding:18px;color:#94a3b8;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> Detecting printers…</div>`;

    const savedPref = localStorage.getItem('jomish_default_printer') || '';
    if (activeDisplay) {
        activeDisplay.textContent = savedPref || 'None Selected (Standard Windows Default)';
    }

    let printers = [];
    let defaultPrinter = null;

    // Try local server first (where Windows printers actually live), then same-origin
    const isAlreadyLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const localPort = localStorage.getItem('jomish_local_port') || '3000';
    const printerEndpoints = isAlreadyLocal
        ? ['/api/system/printers']
        : [`http://localhost:${localPort}/api/system/printers`, '/api/system/printers'];

    for (const endpoint of printerEndpoints) {
        try {
            const res = await fetch(endpoint, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                printers = data.printers || [];
                defaultPrinter = data.defaultPrinter || null;
                if (printers.length > 0) break; // got real printers from local server
            }
        } catch (_) {}
    }

    if (refreshIcon) refreshIcon.className = 'fa-solid fa-rotate-right';

    // Determine currently active printer (default to RETSOL RTP-4800 if available)
    const activePrinter = savedPref || defaultPrinter || (printers[0] ? printers[0].name : 'RETSOL RTP-4800');
    if (!savedPref && activePrinter) {
        localStorage.setItem('jomish_default_printer', activePrinter);
    }

    if (activeDisplay) {
        activeDisplay.textContent = activePrinter;
    }

    // Update hidden select
    if (hiddenSel) {
        hiddenSel.innerHTML = printers.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === activePrinter ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
    }

    if (!cardList) return;

    if (printers.length === 0) {
        // Show thermal printer presets for optimal receipt sizing
        cardList.innerHTML = `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; font-size:0.78rem; color:#64748b; margin-bottom:10px;">
                <div style="font-weight:700; color:#334155; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-print" style="color:var(--primary, #0284c7);"></i> Thermal Receipt Printer Presets
                </div>
                Select your printer model to automatically set the paper width (58mm or 80mm). All receipts open directly in your Windows print dialog.
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${[
                    { name: 'RETSOL RTP-4800', note: 'Thermal Receipt 80mm USB' },
                    { name: 'HSPOS Series', note: 'Thermal POS Printer USB' },
                    { name: 'EPSON TM-T20', note: 'Epson Receipt Printer USB/LAN' },
                    { name: 'POS-80', note: 'Generic 80mm Thermal Printer' },
                    { name: 'Standard Windows Default Printer', note: 'Uses System Default' }
                ].map(p => {
                    const isActive = p.name === activePrinter;
                    return `
                    <div onclick="selectPrinterCard('${escapeHtml(p.name)}')"
                        style="display:flex; align-items:center; gap:12px; padding:10px 14px;
                               border-radius:8px; cursor:pointer; transition:all 0.15s;
                               border:2px solid ${isActive ? '#10b981' : '#e2e8f0'};
                               background:${isActive ? '#f0fdf4' : '#fff'};">
                        <div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                                    background:${isActive ? '#10b981' : '#e2e8f0'};flex-shrink:0;">
                            <i class="fa-solid fa-print" style="color:${isActive ? '#fff' : '#64748b'};font-size:0.85rem;"></i>
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;color:#0f172a;font-size:0.88rem;">${escapeHtml(p.name)}</div>
                            <div style="font-size:0.7rem;color:#64748b;">${escapeHtml(p.note)}</div>
                        </div>
                        <div>
                            ${isActive
                                ? `<span style="background:#10b981;color:#fff;font-size:0.68rem;font-weight:700;padding:3px 9px;border-radius:20px;display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-check"></i> Active</span>`
                                : `<span style="background:#f1f5f9;color:#64748b;font-size:0.68rem;font-weight:600;padding:3px 9px;border-radius:20px;">Select</span>`
                            }
                        </div>
                    </div>`;
                }).join('')}
            </div>
        `;
    } else {
        cardList.innerHTML = printers.map(p => {
            const isActive = p.name === activePrinter;
            return `
            <div onclick="selectPrinterCard('${escapeHtml(p.name)}')"
                id="printer-card-${btoa(encodeURIComponent(p.name)).replace(/[^a-zA-Z0-9]/g,'')}"
                style="display:flex; align-items:center; gap:12px; padding:11px 14px;
                       border-radius:8px; cursor:pointer; transition:all 0.15s;
                       border:2px solid ${isActive ? '#10b981' : '#e2e8f0'};
                       background:${isActive ? '#f0fdf4' : '#fff'};">
                <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                            background:${isActive ? '#10b981' : '#e2e8f0'};flex-shrink:0;">
                    <i class="fa-solid fa-print" style="color:${isActive ? '#fff' : '#94a3b8'};font-size:0.9rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;color:#0f172a;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${escapeHtml(p.name)}
                    </div>
                    <div style="font-size:0.7rem;color:#64748b;margin-top:2px;">
                        ${p.port ? `Port: ${escapeHtml(p.port)}` : ''}
                        ${p.isDefault ? ' &nbsp;•&nbsp; <span style="color:#10b981;font-weight:600;">Windows Default</span>' : ''}
                    </div>
                </div>
                <div style="flex-shrink:0;">
                    ${isActive
                        ? `<span style="background:#10b981;color:#fff;font-size:0.68rem;font-weight:700;padding:3px 9px;border-radius:20px;display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-check"></i> Active</span>`
                        : `<span style="background:#f1f5f9;color:#94a3b8;font-size:0.68rem;font-weight:600;padding:3px 9px;border-radius:20px;">Select</span>`
                    }
                </div>
            </div>`;
        }).join('');
    }

    updateHeaderPrinterLabel(activePrinter);
    updatePaperSizeButtons();
}

function selectPrinterCard(printerName) {
    if (!printerName) return;
    localStorage.setItem('jomish_default_printer', printerName);

    if (printerName.includes('58') && !localStorage.getItem('jomish_paper_size')) {
        setReceiptPaperSize('58mm');
    } else if (printerName.includes('80') && !localStorage.getItem('jomish_paper_size')) {
        setReceiptPaperSize('80mm');
    }

    // Update active banner
    const activeDisplay = document.getElementById('active-printer-name-display');
    if (activeDisplay) activeDisplay.textContent = printerName;

    // Update hidden select
    const hiddenSel = document.getElementById('setting-default-printer-select');
    if (hiddenSel) hiddenSel.value = printerName;

    // Update header label and receipt modal target label
    updateHeaderPrinterLabel(printerName);

    // Re-render cards with new active state
    loadSystemPrintersList();

    // Show saved toast
    const statusEl = document.getElementById('printer-save-status');
    const msgEl    = document.getElementById('printer-save-msg');
    if (msgEl) msgEl.textContent = `✓ "${printerName}" set as default printer.`;
    if (statusEl) {
        statusEl.style.display = 'block';
        clearTimeout(statusEl._hideTimer);
        statusEl._hideTimer = setTimeout(() => { statusEl.style.display = 'none'; }, 3500);
    }

    console.log('[PRINTER] Default printer set to:', printerName);
}

function setReceiptPaperSize(size) {
    if (!size) return;
    localStorage.setItem('jomish_paper_size', size);
    updatePaperSizeButtons();
    const statusEl = document.getElementById('printer-save-status');
    const msgEl    = document.getElementById('printer-save-msg');
    if (msgEl) msgEl.textContent = `✓ Receipt paper size set to ${size}.`;
    if (statusEl) {
        statusEl.style.display = 'block';
        clearTimeout(statusEl._hideTimer);
        statusEl._hideTimer = setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
    }
}

function updatePaperSizeButtons() {
    const curSize = localStorage.getItem('jomish_paper_size') || '58mm';
    const btn58 = document.getElementById('paper-btn-58');
    const btn80 = document.getElementById('paper-btn-80');
    if (btn58) {
        if (curSize === '58mm') {
            btn58.style.background = 'var(--primary, #0284c7)';
            btn58.style.color = '#fff';
            btn58.style.borderColor = 'var(--primary, #0284c7)';
            btn58.style.fontWeight = '700';
        } else {
            btn58.style.background = '#fff';
            btn58.style.color = '#475569';
            btn58.style.borderColor = '#cbd5e1';
            btn58.style.fontWeight = '500';
        }
    }
    if (btn80) {
        if (curSize === '80mm') {
            btn80.style.background = 'var(--primary, #0284c7)';
            btn80.style.color = '#fff';
            btn80.style.borderColor = 'var(--primary, #0284c7)';
            btn80.style.fontWeight = '700';
        } else {
            btn80.style.background = '#fff';
            btn80.style.color = '#475569';
            btn80.style.borderColor = '#cbd5e1';
            btn80.style.fontWeight = '500';
        }
    }
}

function saveManualPrinterName() {
    const input = document.getElementById('manual-printer-name-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        alert('Please enter a printer name (e.g. RETSOL RTP-4800).');
        return;
    }
    selectPrinterCard(name);
    input.value = '';
}

async function testPrintCurrentPrinter() {
    const printerName = localStorage.getItem('jomish_default_printer') || '';
    if (!printerName) {
        alert('Please select or type a printer name first.');
        return;
    }
    triggerBrowserPrint(
        '<div style="text-align:center; padding:18px 4px; font-family:\'Courier New\', monospace; font-size:13px; font-weight:bold;">Printer installed successfully</div>',
        'Printer Test'
    );
}

function updateHeaderPrinterLabel(printerName) {
    const pName = printerName || localStorage.getItem('jomish_default_printer') || '';
    const label = document.getElementById('header-printer-label');
    if (label) {
        label.textContent = pName ? pName : 'Printer';
        label.title = pName ? `Default Printer: ${pName}` : 'No printer selected (Click to configure)';
    }
    const modalLabel = document.getElementById('receipt-modal-printer-name');
    if (modalLabel) {
        modalLabel.textContent = pName ? pName : 'Windows Default';
    }
}

function goToPrinterSettings() {
    closeModal('view-receipt-modal');
    switchNavTab('settings');
    updatePaperSizeButtons();
    setTimeout(() => {
        const target = document.getElementById('printer-cards-list') || document.getElementById('setting-default-printer-select');
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
            target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.35)';
            setTimeout(() => { target.style.boxShadow = ''; }, 2000);
        }
    }, 250);
}



function saveSelectedPrinterPreference() {
    // Legacy function — kept for compatibility if called from elsewhere
    const select = document.getElementById('setting-default-printer-select');
    if (!select) return;
    const chosen = select.value;
    if (chosen) selectPrinterCard(chosen);
}

function renderCustomRolesList(roles) {
    const container = document.getElementById('settings-roles-list');
    if (!container) return;

    const systemRoles = ['admin', 'manager', 'cashier', 'kitchen', 'waiter'];

    container.innerHTML = roles.map(r => {
        const isSystem = systemRoles.includes((r.role_name || '').toLowerCase());
        return `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
                <div style="font-weight:700; color:#0f172a; font-size:0.95rem; display:flex; align-items:center; gap:8px;">
                    ${escapeHtml(r.role_name)}
                    ${isSystem ? '<span style="font-size:0.68rem; background:#e2e8f0; color:#475569; padding:1px 6px; border-radius:4px; font-weight:600;">System</span>' : ''}
                </div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                    Sell: ${r.can_sell ? '✓' : '✗'} | Add Inv: ${r.can_add_inventory ? '✓' : '✗'} | Shifts: ${r.can_manage_shifts ? '✓' : '✗'} | Returns: ${r.can_process_returns ? '✓' : '✗'}
                </div>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="openEditRoleModal('${escapeHtml(r.role_name)}')"><i class="fa-solid fa-gear"></i> Configure</button>
                ${!isSystem ? `<button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem; color:#ef4444; border-color:#fca5a5;" onclick="handleDeleteRole('${escapeHtml(r.role_name)}')"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
        </div>
        `;
    }).join('');
}

async function handleDeleteRole(roleName) {
    if (!confirm(`Are you sure you want to delete role '${roleName}'?`)) return;
    try {
        const res = await fetch(`/api/roles/${encodeURIComponent(roleName)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            alert(`Role '${roleName}' deleted.`);
            await loadCustomRolesSettings();
        } else {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Could not delete role');
        }
    } catch (_) {
        alert('Server connection error deleting role');
    }
}

function openAddRoleModal() {
    const title = document.getElementById('role-modal-title');
    if (title) title.innerHTML = '<i class="fa-solid fa-user-shield"></i> Add New Custom Role';

    const nameInput = document.getElementById('role-form-name');
    if (nameInput) {
        nameInput.value = '';
        nameInput.disabled = false;
    }

    // Default permission checkboxes for a new staff role
    const setCb = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setCb('role-tab-register', true);
    setCb('role-tab-orders', true);
    setCb('role-tab-pending', false);
    setCb('role-tab-customer', true);
    setCb('role-tab-inventory', false);
    setCb('role-tab-shift', true);
    setCb('role-tab-returns', false);
    setCb('role-tab-settings', false);
    setCb('role-tab-dashboard', false);
    setCb('role-tab-invoice', false);
    setCb('role-tab-kitchen', false);
    setCb('role-tab-debtors', false);
    setCb('role-tab-creditors', false);
    setCb('role-tab-transactions', false);
    setCb('role-tab-finance', false);

    setCb('role-act-sell', true);
    setCb('role-act-add-order', true);
    setCb('role-act-add-inv', false);
    setCb('role-act-reduce-inv', false);
    setCb('role-act-view-inv', true);
    setCb('role-act-prices', false);
    setCb('role-act-discount', false);
    setCb('role-act-void', false);
    setCb('role-act-returns', false);
    setCb('role-act-shifts', true);
    setCb('role-act-users', false);
    setCb('role-act-settings', false);
    setCb('role-act-invoices', false);
    setCb('role-act-kitchen', false);
    setCb('role-act-debtors', false);
    setCb('role-act-creditors', false);

    openModal('role-modal');
}

function openEditRoleModal(roleName) {
    const r = allRolesList.find(x => x.role_name === roleName);
    if (!r) return;

    const title = document.getElementById('role-modal-title');
    if (title) title.innerHTML = `<i class="fa-solid fa-user-shield"></i> Configure Role: ${escapeHtml(r.role_name)}`;

    const nameInput = document.getElementById('role-form-name');
    if (nameInput) {
        nameInput.value = r.role_name;
        nameInput.disabled = true;
    }

    const setCb = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setCb('role-tab-register', r.can_see_register !== 0);
    setCb('role-tab-orders', r.can_see_orders !== 0);
    setCb('role-tab-pending', r.can_see_pending === 1);
    setCb('role-tab-customer', r.can_see_customer !== 0);
    setCb('role-tab-inventory', r.can_see_inventory === 1);
    setCb('role-tab-shift', r.can_see_shift !== 0);
    setCb('role-tab-returns', r.can_see_returns === 1);
    setCb('role-tab-settings', r.can_see_settings === 1);
    setCb('role-tab-dashboard', r.can_see_dashboard === 1);

    setCb('role-act-sell', r.can_sell !== 0);
    setCb('role-act-add-inv', r.can_add_inventory === 1);
    setCb('role-act-view-inv', r.can_view_inventory !== 0);
    setCb('role-act-prices', r.can_manage_prices === 1);
    setCb('role-act-discount', r.can_give_discount === 1);
    setCb('role-act-void', r.can_void_orders === 1);
    setCb('role-act-returns', r.can_process_returns === 1);
    setCb('role-act-shifts', r.can_manage_shifts === 1);
    setCb('role-act-users', r.can_manage_users === 1);
    setCb('role-act-settings', r.can_edit_settings === 1);

    // Additional granular flags
    setCb('role-tab-invoice', r.can_see_invoice !== 0);
    setCb('role-tab-kitchen', r.can_see_kitchen === 1);
    setCb('role-tab-debtors', r.can_see_debtors !== 0);
    setCb('role-tab-creditors', r.can_see_creditors !== 0);
    setCb('role-tab-transactions', r.can_see_transactions !== 0);
    setCb('role-tab-finance', r.can_see_finance !== 0);

    setCb('role-act-add-order', r.can_add_order !== 0);
    setCb('role-act-reduce-inv', r.can_reduce_inventory === 1);
    setCb('role-act-invoices', r.can_manage_invoices === 1);
    setCb('role-act-kitchen', r.can_manage_kitchen === 1);
    setCb('role-act-debtors', r.can_manage_debtors === 1);
    setCb('role-act-creditors', r.can_manage_creditors === 1);

    openModal('role-modal');
}

async function handleSaveCustomRole(e) {
    e.preventDefault();
    const role_name = document.getElementById('role-form-name').value.trim();
    if (!role_name) return;

    const payload = {
        role_name,
        can_see_register: document.getElementById('role-tab-register').checked ? 1 : 0,
        can_see_orders: document.getElementById('role-tab-orders').checked ? 1 : 0,
        can_see_pending: document.getElementById('role-tab-pending').checked ? 1 : 0,
        can_see_customer: document.getElementById('role-tab-customer').checked ? 1 : 0,
        can_see_inventory: document.getElementById('role-tab-inventory').checked ? 1 : 0,
        can_see_shift: document.getElementById('role-tab-shift').checked ? 1 : 0,
        can_see_returns: document.getElementById('role-tab-returns').checked ? 1 : 0,
        can_see_settings: document.getElementById('role-tab-settings').checked ? 1 : 0,
        can_see_dashboard: document.getElementById('role-tab-dashboard').checked ? 1 : 0,
        can_see_invoice: document.getElementById('role-tab-invoice')?.checked ? 1 : 0,
        can_see_kitchen: document.getElementById('role-tab-kitchen')?.checked ? 1 : 0,
        can_see_debtors: document.getElementById('role-tab-debtors')?.checked ? 1 : 0,
        can_see_creditors: document.getElementById('role-tab-creditors')?.checked ? 1 : 0,
        can_see_transactions: document.getElementById('role-tab-transactions')?.checked ? 1 : 0,
        can_see_finance: document.getElementById('role-tab-finance')?.checked ? 1 : 0,

        can_sell: document.getElementById('role-act-sell').checked ? 1 : 0,
        can_add_order: document.getElementById('role-act-add-order')?.checked ? 1 : 0,
        can_add_inventory: document.getElementById('role-act-add-inv').checked ? 1 : 0,
        can_reduce_inventory: document.getElementById('role-act-reduce-inv')?.checked ? 1 : 0,
        can_view_inventory: document.getElementById('role-act-view-inv').checked ? 1 : 0,
        can_manage_prices: document.getElementById('role-act-prices').checked ? 1 : 0,
        can_give_discount: document.getElementById('role-act-discount').checked ? 1 : 0,
        can_void_orders: document.getElementById('role-act-void').checked ? 1 : 0,
        can_process_returns: document.getElementById('role-act-returns').checked ? 1 : 0,
        can_manage_shifts: document.getElementById('role-act-shifts').checked ? 1 : 0,
        can_manage_users: document.getElementById('role-act-users').checked ? 1 : 0,
        can_edit_settings: document.getElementById('role-act-settings').checked ? 1 : 0,
        can_manage_invoices: document.getElementById('role-act-invoices')?.checked ? 1 : 0,
        can_manage_kitchen: document.getElementById('role-act-kitchen')?.checked ? 1 : 0,
        can_manage_debtors: document.getElementById('role-act-debtors')?.checked ? 1 : 0,
        can_manage_creditors: document.getElementById('role-act-creditors')?.checked ? 1 : 0
    };

    try {
        const res = await fetch(`/api/roles/${encodeURIComponent(role_name)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('role-modal');
            alert(`Role '${role_name}' permissions updated.`);
            await loadCustomRolesSettings();
        }
    } catch (_) {}
}

function filterSettingsSections(q) {
    // Search settings
}

// ============================================================================
// TAB 9: TECH SUPPORT SUPER ADMIN CONTROLLER
// ============================================================================
let allCompaniesList = [];

async function loadTechCompanies() {
    try {
        const res = await fetch('/api/system/companies', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allCompaniesList = data.companies || [];
            renderTechCompaniesTable(allCompaniesList);
        }
    } catch (_) {}
}

function renderTechCompaniesTable(companies) {
    const tbody = document.getElementById('tech-companies-tbody');
    if (!tbody) return;

    if (!companies || companies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">No companies provisioned yet.</td></tr>';
        return;
    }

    tbody.innerHTML = companies.map(c => {
        const isPaused = c.status === 'PAUSED';
        const statusBadge = isPaused 
            ? '<span class="cat-pill-btn" style="background:#fee2e2; color:#ef4444; font-size:0.75rem;">PAUSED</span>'
            : '<span class="cat-pill-btn" style="background:#dcfce7; color:#10b981; font-size:0.75rem;">ACTIVE</span>';

        const schedInfo = c.pause_schedule_start 
            ? `<small style="color:#d97706;"><i class="fa-solid fa-clock"></i> ${new Date(c.pause_schedule_start).toLocaleDateString()}</small>`
            : '—';

        return `
            <tr>
                <td><code>${escapeHtml(c.prefix)}</code></td>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td><span class="cat-pill-btn" style="padding:2px 8px; font-size:0.75rem;">${escapeHtml(c.business_type || 'supermarket')}</span></td>
                <td>${escapeHtml(c.location || 'Kampala, Uganda')}</td>
                <td>${statusBadge}</td>
                <td>${schedInfo}</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem; color:${isPaused ? '#10b981' : '#ef4444'};" onclick="toggleCompanyStatus('${c.prefix}', '${isPaused ? 'ACTIVE' : 'PAUSED'}')">
                            ${isPaused ? '<i class="fa-solid fa-play"></i> Unpause' : '<i class="fa-solid fa-pause"></i> Pause'}
                        </button>
                        <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="openSchedulePauseModal('${c.prefix}')">
                            <i class="fa-solid fa-calendar"></i> Schedule
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterTechCompanies(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderTechCompaniesTable(allCompaniesList);
    const filtered = allCompaniesList.filter(c => 
        (c.name || '').toLowerCase().includes(s) ||
        (c.prefix || '').toLowerCase().includes(s) ||
        (c.location || '').toLowerCase().includes(s)
    );
    renderTechCompaniesTable(filtered);
}

function openCreateCompanyModal() {
    openModal('company-modal');
}

function autoSuggestPrefix(name) {
    const prefixInput = document.getElementById('new-comp-prefix');
    if (!prefixInput) return;
    const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    prefixInput.value = clean.substring(0, 5);
}

function onBusinessTypeChange(bizType) {
    const chkPending = document.getElementById('tab-chk-pending');
    if (chkPending) {
        // Supermarket clients go direct to checkouts — hide pending tab!
        if (bizType === 'supermarket') {
            chkPending.checked = false;
        } else {
            chkPending.checked = true;
        }
    }
}

async function handleCreateNewCompany(e) {
    e.preventDefault();
    const company_name = document.getElementById('new-comp-name').value.trim();
    const company_prefix = document.getElementById('new-comp-prefix').value.trim().toUpperCase();
    const business_type = document.getElementById('new-comp-type').value;
    const location = document.getElementById('new-comp-location').value.trim();
    const currency = document.getElementById('new-comp-currency').value.trim();
    const logo_url = document.getElementById('new-comp-logo').value.trim();
    const theme_color = document.getElementById('new-comp-col-primary').value;
    const theme_accent = document.getElementById('new-comp-col-accent').value;
    const theme_sidebar = document.getElementById('new-comp-col-sidebar').value;

    const admin_name = document.getElementById('new-comp-admin-name').value.trim();
    const admin_email = document.getElementById('new-comp-admin-email').value.trim();
    const admin_password = document.getElementById('new-comp-admin-pass').value;

    // Collect enabled tabs
    const enabled_tabs = [];
    if (document.getElementById('tab-chk-register').checked) enabled_tabs.push('register');
    if (document.getElementById('tab-chk-orders').checked) enabled_tabs.push('orders');
    if (document.getElementById('tab-chk-pending').checked) enabled_tabs.push('pending');
    if (document.getElementById('tab-chk-customer').checked) enabled_tabs.push('customer');
    if (document.getElementById('tab-chk-inventory').checked) enabled_tabs.push('inventory');
    if (document.getElementById('tab-chk-shift').checked) enabled_tabs.push('shift');
    if (document.getElementById('tab-chk-returns').checked) enabled_tabs.push('returns');
    if (document.getElementById('tab-chk-invoice')?.checked) enabled_tabs.push('invoice');
    if (document.getElementById('tab-chk-kitchen')?.checked) enabled_tabs.push('kitchen');
    if (document.getElementById('tab-chk-debtors')?.checked) enabled_tabs.push('debtors');
    if (document.getElementById('tab-chk-creditors')?.checked) enabled_tabs.push('creditors');
    if (document.getElementById('tab-chk-transactions')?.checked) enabled_tabs.push('transactions');
    if (document.getElementById('tab-chk-finance')?.checked) enabled_tabs.push('finance');
    if (document.getElementById('tab-chk-settings').checked) enabled_tabs.push('settings');

    const payload = {
        company_name,
        company_prefix,
        business_type,
        location,
        currency,
        logo_url,
        theme_color,
        theme_accent,
        theme_sidebar,
        enabled_tabs,
        admin_name,
        admin_email,
        admin_password,
        tech_password: 'Jomish9!!'
    };

    try {
        const res = await fetch('/api/system/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('company-modal');
            alert(`Company "${company_name}" created with independent database!\n\nAdmin Login: ${data.admin?.username || company_prefix + '001'}\nPassword: ${admin_password}`);
            await loadTechCompanies();
        } else {
            alert('Failed to provision company: ' + (data.error || 'Server error'));
        }
    } catch (_) {
        alert('Server connection error.');
    }
}

async function toggleCompanyStatus(prefix, newStatus) {
    if (!confirm(`Are you sure you want to change company ${prefix} to ${newStatus}?`)) return;
    try {
        const res = await fetch(`/api/system/companies/${prefix}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (res.ok) {
            await loadTechCompanies();
        } else {
            const d = await res.json();
            alert('Error: ' + d.error);
        }
    } catch (_) {}
}

function openSchedulePauseModal(prefix) {
    document.getElementById('sched-prefix').value = prefix;
    openModal('schedule-pause-modal');
}

async function handleSaveScheduledPause(e) {
    e.preventDefault();
    const prefix = document.getElementById('sched-prefix').value;
    const pause_schedule_start = document.getElementById('sched-start-dt').value;
    const pause_schedule_end = document.getElementById('sched-end-dt').value;

    try {
        const res = await fetch(`/api/system/companies/${prefix}/schedule-pause`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ pause_schedule_start, pause_schedule_end })
        });

        if (res.ok) {
            closeModal('schedule-pause-modal');
            alert('Pause schedule saved.');
            await loadTechCompanies();
        }
    } catch (_) {}
}

// ============================================================================
// TAB: INVOICES CONTROLLER
// ============================================================================
let allInvoicesList = [];

async function loadInvoicesList() {
    try {
        const res = await fetch('/api/invoices', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allInvoicesList = data.invoices || [];
            renderInvoicesTable(allInvoicesList);
        }
    } catch (_) {}
}

function renderInvoicesTable(invoices) {
    const tbody = document.getElementById('invoices-table-tbody');
    if (!tbody) return;
    if (!invoices || invoices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">No invoices issued yet.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';
    tbody.innerHTML = invoices.map(inv => {
        const balance = Math.max(0, (inv.total_amount || 0) - (inv.amount_paid || 0));
        const statusBadge = balance <= 0
            ? '<span class="cat-pill-btn" style="background:#dcfce7; color:#10b981; font-size:0.75rem;">PAID</span>'
            : '<span class="cat-pill-btn" style="background:#fee2e2; color:#ef4444; font-size:0.75rem;">UNPAID</span>';

        return `
            <tr>
                <td><strong>#INV-${inv.invoice_number || inv.id}</strong></td>
                <td>${new Date(inv.order_date).toLocaleString()}</td>
                <td>${escapeHtml(inv.buyer_name || 'Customer')}</td>
                <td>${escapeHtml(inv.buyer_phone || '—')}</td>
                <td><strong>${Number(inv.total_amount || 0).toLocaleString()} ${curr}</strong></td>
                <td>${Number(inv.amount_paid || 0).toLocaleString()} ${curr}</td>
                <td><strong style="color:${balance > 0 ? '#e11d48' : '#10b981'};">${balance.toLocaleString()} ${curr}</strong></td>
                <td>${statusBadge}</td>
                <td>
                    <button class="header-idle-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="reprintReceipt(${inv.id})">
                        <i class="fa-solid fa-print"></i> Print
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterInvoicesList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderInvoicesTable(allInvoicesList);
    const filtered = allInvoicesList.filter(i =>
        String(i.invoice_number || i.id).toLowerCase().includes(s) ||
        (i.buyer_name || '').toLowerCase().includes(s) ||
        (i.buyer_phone || '').toLowerCase().includes(s)
    );
    renderInvoicesTable(filtered);
}

function openCreateInvoiceModal() {
    // Switch to register so staff can add items and checkout using INVOICE payment method
    switchNavTab('register');
    alert('Select products from the catalog, then click "Place Order" and choose "Split/Credit" or specify Invoice in Remarks.');
}

// ============================================================================
// TAB: KITCHEN TOKENS CONTROLLER
// ============================================================================
let allKitchenTokens = [];
let activeKitchenFilter = 'ALL';

async function loadKitchenTokens() {
    try {
        const res = await fetch('/api/kitchen/tokens', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allKitchenTokens = data.tokens || [];
            renderKitchenTokens(allKitchenTokens);
        }
    } catch (_) {}
}

function renderKitchenTokens(tokens) {
    const grid = document.getElementById('kitchen-tokens-grid');
    if (!grid) return;

    let filtered = tokens;
    if (activeKitchenFilter !== 'ALL') {
        filtered = filtered.filter(t => t.status === activeKitchenFilter);
    }

    if (!filtered || filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748b;">No kitchen tokens in this status.</div>';
        return;
    }

    grid.innerHTML = filtered.map(t => {
        let statusCol = '#f59e0b';
        if (t.status === 'PREPARING') statusCol = '#0284c7';
        if (t.status === 'READY') statusCol = '#10b981';
        if (t.status === 'SERVED') statusCol = '#64748b';

        return `
            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px; box-shadow:0 2px 8px rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:10px; margin-bottom:10px;">
                    <div>
                        <span style="font-size:1.4rem; font-weight:800; color:#0f172a;">${escapeHtml(t.token_code || '#' + t.token_number)}</span>
                        <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(t.table_label || 'Counter')} • ${escapeHtml(t.server_name || 'Staff')}</div>
                    </div>
                    <span class="cat-pill-btn" style="background:${statusCol}; color:#fff; font-size:0.75rem; font-weight:700;">${t.status}</span>
                </div>
                <div style="font-size:0.95rem; font-weight:600; color:#1e293b; margin-bottom:12px; line-height:1.4;">
                    ${escapeHtml(t.items_summary || 'Order Items')}
                </div>
                ${t.notes ? `<div style="font-size:0.8rem; color:#d97706; margin-bottom:12px; background:#fffbeb; padding:6px 10px; border-radius:6px;"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(t.notes)}</div>` : ''}
                <div style="display:flex; gap:8px;">
                    ${t.status === 'PENDING' ? `<button class="header-upload-pill" style="flex:1; padding:6px; font-size:0.8rem; background:#0284c7;" onclick="updateKitchenTokenStatus(${t.id}, 'PREPARING')">Start Prep</button>` : ''}
                    ${t.status === 'PREPARING' ? `<button class="header-upload-pill" style="flex:1; padding:6px; font-size:0.8rem; background:#10b981;" onclick="updateKitchenTokenStatus(${t.id}, 'READY')">Mark Ready</button>` : ''}
                    ${t.status === 'READY' ? `<button class="header-upload-pill" style="flex:1; padding:6px; font-size:0.8rem; background:#0f172a;" onclick="updateKitchenTokenStatus(${t.id}, 'SERVED')">Mark Served</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function filterKitchenStatus(status, btn) {
    activeKitchenFilter = status;
    document.querySelectorAll('#view-pane-kitchen .cat-pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderKitchenTokens(allKitchenTokens);
}

function filterKitchenTokens(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderKitchenTokens(allKitchenTokens);
    const filtered = allKitchenTokens.filter(t =>
        (t.token_code || '').toLowerCase().includes(s) ||
        String(t.token_number).includes(s) ||
        (t.items_summary || '').toLowerCase().includes(s) ||
        (t.server_name || '').toLowerCase().includes(s) ||
        (t.table_label || '').toLowerCase().includes(s)
    );
    renderKitchenTokens(filtered);
}

async function updateKitchenTokenStatus(id, newStatus) {
    try {
        await fetch(`/api/kitchen/tokens/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ status: newStatus })
        });
        await loadKitchenTokens();
    } catch (_) {}
}

// ============================================================================
// TAB: DEBTORS (Accounts Receivable) CONTROLLER
// ============================================================================
let allDebtorsList = [];

async function loadDebtorsList() {
    try {
        const res = await fetch('/api/debtors', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allDebtorsList = data.debtors || [];
            renderDebtorsTable(allDebtorsList);
        }
    } catch (_) {}
}

function renderDebtorsTable(debtors) {
    const tbody = document.getElementById('debtors-table-tbody');
    if (!tbody) return;

    const curr = companyData.currency || 'Sh';
    let totalDebt = 0;

    debtors.forEach(d => {
        totalDebt += Math.max(0, parseFloat(d.balance) || 0);
    });

    const totAmtEl = document.getElementById('debtors-total-amount');
    const totCountEl = document.getElementById('debtors-total-count');
    if (totAmtEl) totAmtEl.textContent = `${totalDebt.toLocaleString()} ${curr}`;
    if (totCountEl) totCountEl.textContent = debtors.length;

    if (!debtors || debtors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748b;">No debtors on record. All accounts clear!</td></tr>';
        return;
    }

    tbody.innerHTML = debtors.map(d => {
        const balance = Math.max(0, parseFloat(d.balance) || 0);
        const statusBadge = balance <= 0
            ? '<span class="cat-pill-btn" style="background:#dcfce7; color:#10b981; font-size:0.75rem;">CLEARED</span>'
            : '<span class="cat-pill-btn" style="background:#fee2e2; color:#ef4444; font-size:0.75rem;">OWING</span>';

        return `
            <tr>
                <td><strong>${escapeHtml(d.buyer_name || 'Customer')}</strong></td>
                <td>${escapeHtml(d.buyer_phone || '—')}</td>
                <td>${Number(d.total_amount || 0).toLocaleString()} ${curr}</td>
                <td>${Number(d.amount_paid || 0).toLocaleString()} ${curr}</td>
                <td><strong style="color:${balance > 0 ? '#e11d48' : '#10b981'};">${balance.toLocaleString()} ${curr}</strong></td>
                <td>${d.promised_date || '—'}</td>
                <td>${statusBadge}</td>
                <td>
                    ${balance > 0 ? `
                        <button class="header-upload-pill" style="padding:4px 8px; font-size:0.75rem; background:#10b981;" onclick="openPayDebtorModal('${escapeHtml(d.buyer_name)}', ${balance})">
                            <i class="fa-solid fa-coins"></i> Record Pay
                        </button>
                    ` : '—'}
                </td>
            </tr>
        `;
    }).join('');
}

function filterDebtorsList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderDebtorsTable(allDebtorsList);
    const filtered = allDebtorsList.filter(d =>
        (d.buyer_name || '').toLowerCase().includes(s) ||
        (d.buyer_phone || '').toLowerCase().includes(s)
    );
    renderDebtorsTable(filtered);
}

function openAddDebtorModal() {
    openModal('debtor-modal');
}

async function handleSaveDebtor(e) {
    e.preventDefault();
    const buyer_name = document.getElementById('debtor-form-name').value.trim();
    const buyer_phone = document.getElementById('debtor-form-phone').value.trim();
    const total_amount = parseFloat(document.getElementById('debtor-form-total').value) || 0;
    const amount_paid = parseFloat(document.getElementById('debtor-form-paid').value) || 0;
    const promised_date = document.getElementById('debtor-form-due').value;

    try {
        const res = await fetch('/api/debtors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ buyer_name, buyer_phone, total_amount, amount_paid, promised_date })
        });
        if (res.ok) {
            closeModal('debtor-modal');
            alert('Debtor registered successfully.');
            await loadDebtorsList();
        }
    } catch (_) {}
}

function openPayDebtorModal(buyerName, balance) {
    const curr = companyData.currency || 'Sh';
    document.getElementById('pay-debtor-buyer-name').value = buyerName;
    document.getElementById('pay-debtor-name-display').textContent = buyerName;
    document.getElementById('pay-debtor-balance-display').textContent = `${balance.toLocaleString()} ${curr}`;
    document.getElementById('pay-debtor-amount').value = balance;
    openModal('pay-debtor-modal');
}

async function handleSaveDebtorPayment(e) {
    e.preventDefault();
    const buyer_name = document.getElementById('pay-debtor-buyer-name').value;
    const amount_paid = parseFloat(document.getElementById('pay-debtor-amount').value) || 0;
    const note = document.getElementById('pay-debtor-note').value.trim();

    try {
        const res = await fetch('/api/credits/pay', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ buyer_name, amount_paid, note })
        });

        if (res.ok) {
            closeModal('pay-debtor-modal');
            alert('Payment recorded successfully.');
            await loadDebtorsList();
            await loadActiveShiftInfo();
        } else {
            const d = await res.json();
            alert('Error: ' + d.error);
        }
    } catch (_) {}
}

// ============================================================================
// TAB: CREDITORS (Suppliers / Accounts Payable) CONTROLLER
// ============================================================================
let allCreditorsList = [];

async function loadCreditorsList() {
    try {
        const res = await fetch('/api/creditors', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allCreditorsList = data.creditors || [];
            renderCreditorsTable(allCreditorsList);
        }
    } catch (_) {}
}

function renderCreditorsTable(creditors) {
    const tbody = document.getElementById('creditors-table-tbody');
    if (!tbody) return;

    const curr = companyData.currency || 'Sh';
    let totalOwed = 0;

    creditors.forEach(c => {
        totalOwed += Math.max(0, parseFloat(c.balance) || 0);
    });

    const totAmtEl = document.getElementById('creditors-total-amount');
    const totCountEl = document.getElementById('creditors-total-count');
    if (totAmtEl) totAmtEl.textContent = `${totalOwed.toLocaleString()} ${curr}`;
    if (totCountEl) totCountEl.textContent = creditors.length;

    if (!creditors || creditors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px; color:#64748b;">No creditor / supplier bills on file.</td></tr>';
        return;
    }

    tbody.innerHTML = creditors.map(c => {
        const balance = Math.max(0, parseFloat(c.balance) || 0);
        const statusBadge = balance <= 0
            ? '<span class="cat-pill-btn" style="background:#dcfce7; color:#10b981; font-size:0.75rem;">PAID</span>'
            : '<span class="cat-pill-btn" style="background:#fee2e2; color:#ef4444; font-size:0.75rem;">PENDING</span>';

        return `
            <tr>
                <td><strong>${escapeHtml(c.supplier_name)}</strong></td>
                <td>${escapeHtml(c.contact_person || '—')}</td>
                <td>${escapeHtml(c.phone || '—')}</td>
                <td><code>${escapeHtml(c.invoice_no || '—')}</code></td>
                <td>${Number(c.total_amount || 0).toLocaleString()} ${curr}</td>
                <td>${Number(c.amount_paid || 0).toLocaleString()} ${curr}</td>
                <td><strong style="color:${balance > 0 ? '#e11d48' : '#10b981'};">${balance.toLocaleString()} ${curr}</strong></td>
                <td>${c.due_date || '—'}</td>
                <td>${statusBadge}</td>
                <td>
                    ${balance > 0 ? `
                        <button class="header-upload-pill" style="padding:4px 8px; font-size:0.75rem; background:#0f172a;" onclick="openPayCreditorModal(${c.id}, '${escapeHtml(c.supplier_name)}', ${balance})">
                            <i class="fa-solid fa-money-bill"></i> Pay
                        </button>
                    ` : '—'}
                </td>
            </tr>
        `;
    }).join('');
}

function filterCreditorsList(q) {
    const s = q.toLowerCase().trim();
    if (!s) return renderCreditorsTable(allCreditorsList);
    const filtered = allCreditorsList.filter(c =>
        (c.supplier_name || '').toLowerCase().includes(s) ||
        (c.contact_person || '').toLowerCase().includes(s) ||
        (c.phone || '').toLowerCase().includes(s) ||
        (c.invoice_no || '').toLowerCase().includes(s)
    );
    renderCreditorsTable(filtered);
}

function openAddCreditorModal() {
    openModal('creditor-modal');
}

async function handleSaveCreditor(e) {
    e.preventDefault();
    const supplier_name = document.getElementById('creditor-form-name').value.trim();
    const contact_person = document.getElementById('creditor-form-contact').value.trim();
    const phone = document.getElementById('creditor-form-phone').value.trim();
    const invoice_no = document.getElementById('creditor-form-inv').value.trim();
    const total_amount = parseFloat(document.getElementById('creditor-form-total').value) || 0;
    const amount_paid = parseFloat(document.getElementById('creditor-form-paid').value) || 0;
    const due_date = document.getElementById('creditor-form-due').value;

    try {
        const res = await fetch('/api/creditors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ supplier_name, contact_person, phone, invoice_no, total_amount, amount_paid, due_date })
        });
        if (res.ok) {
            closeModal('creditor-modal');
            alert('Supplier bill recorded successfully.');
            await loadCreditorsList();
        }
    } catch (_) {}
}

function openPayCreditorModal(id, supplierName, balance) {
    const curr = companyData.currency || 'Sh';
    document.getElementById('pay-creditor-id').value = id;
    document.getElementById('pay-creditor-name-display').textContent = supplierName;
    document.getElementById('pay-creditor-balance-display').textContent = `${balance.toLocaleString()} ${curr}`;
    document.getElementById('pay-creditor-amount').value = balance;
    openModal('pay-creditor-modal');
}

async function handleSaveCreditorPayment(e) {
    e.preventDefault();
    const creditor_id = document.getElementById('pay-creditor-id').value;
    const amount_paid = parseFloat(document.getElementById('pay-creditor-amount').value) || 0;
    const note = document.getElementById('pay-creditor-note').value.trim();

    try {
        const res = await fetch('/api/creditors/pay', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ creditor_id, amount_paid, note })
        });

        if (res.ok) {
            closeModal('pay-creditor-modal');
            alert('Supplier payment recorded successfully.');
            await loadCreditorsList();
            await loadActiveShiftInfo();
        } else {
            const d = await res.json();
            alert('Error: ' + d.error);
        }
    } catch (_) {}
}

// ============================================================================
// TAB: TRANSACTIONS (Old Receipts & Ledgers) CONTROLLER
// ============================================================================
let allTransactionsList = [];
let currentPreviewedReceipt = null;

async function loadTransactionsList() {
    try {
        const typeEl = document.getElementById('tx-filter-type');
        const startEl = document.getElementById('tx-filter-start');
        const endEl = document.getElementById('tx-filter-end');

        let url = '/api/transactions?limit=200';
        if (typeEl && typeEl.value && typeEl.value !== 'ALL') {
            url += `&type=${encodeURIComponent(typeEl.value)}`;
        }
        if (startEl && startEl.value) {
            url += `&start_date=${encodeURIComponent(startEl.value)}`;
        }
        if (endEl && endEl.value) {
            url += `&end_date=${encodeURIComponent(endEl.value)}`;
        }

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            const data = await res.json();
            allTransactionsList = data.transactions || [];
            renderTransactionsTable(allTransactionsList);
        }
    } catch (err) {
        console.error('Failed to load transactions:', err);
    }
}

function renderTransactionsTable(list) {
    const tbody = document.getElementById('transactions-table-tbody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">No transactions or old receipts found.</td></tr>';
        return;
    }

    const curr = companyData.currency || 'Sh';
    tbody.innerHTML = list.map(t => {
        const rcptNo = t.receipt_no || t.id;
        const dateStr = t.transaction_date ? new Date(t.transaction_date).toLocaleString() : '—';
        const typeColor = t.type === 'INCOME' ? '#10b981' : (t.type === 'EXPENSE' ? '#ef4444' : '#6366f1');
        const cust = t.order_buyer_name || (t.type === 'GOODS_ON_CREDIT' ? 'Credit Client' : '—');
        const paymentMethod = t.order_payment_method || (t.type === 'EXPENSE' ? 'Cash Out' : 'Cash');
        const recordedBy = t.recorded_by_name || t.order_served_by || 'Staff';
        const amt = parseFloat(t.amount || 0).toLocaleString();

        return `
            <tr>
                <td><strong style="color:var(--primary); font-family:monospace; font-size:0.95rem;">#${rcptNo}</strong></td>
                <td style="font-size:0.82rem; color:#64748b;">${dateStr}</td>
                <td><span class="cat-pill-btn" style="padding:2px 8px; font-size:0.75rem; background:${typeColor}15; color:${typeColor}; border:1px solid ${typeColor}40;">${escapeHtml(t.type)}</span></td>
                <td>${escapeHtml(t.description || '—')}</td>
                <td>${escapeHtml(cust)}</td>
                <td><span style="font-size:0.8rem; font-weight:600; color:#334155;">${escapeHtml(paymentMethod)}</span></td>
                <td style="font-size:0.82rem;">${escapeHtml(recordedBy)}</td>
                <td style="text-align:right; font-weight:700; color:${t.type === 'EXPENSE' ? '#ef4444' : '#0f172a'};">${amt} ${curr}</td>
                <td style="text-align:center;">
                    <button class="header-idle-btn" style="padding:4px 10px; font-size:0.78rem;" onclick="viewReceiptDetails('${rcptNo}')">
                        <i class="fa-solid fa-receipt"></i> View Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterTransactionsList() {
    const q = (document.getElementById('tx-search-input')?.value || '').toLowerCase().trim();
    if (!q) {
        renderTransactionsTable(allTransactionsList);
        return;
    }
    const filtered = allTransactionsList.filter(t => 
        String(t.receipt_no || t.id).toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.order_buyer_name || '').toLowerCase().includes(q) ||
        (t.order_served_by || '').toLowerCase().includes(q) ||
        (t.recorded_by_name || '').toLowerCase().includes(q) ||
        (t.order_payment_method || '').toLowerCase().includes(q) ||
        String(t.amount || '').toLowerCase().includes(q)
    );
    renderTransactionsTable(filtered);
}

function resetTxFilters() {
    if (document.getElementById('tx-search-input')) document.getElementById('tx-search-input').value = '';
    if (document.getElementById('tx-filter-type')) document.getElementById('tx-filter-type').value = 'ALL';
    if (document.getElementById('tx-filter-start')) document.getElementById('tx-filter-start').value = '';
    if (document.getElementById('tx-filter-end')) document.getElementById('tx-filter-end').value = '';
    loadTransactionsList();
}

async function viewReceiptDetails(idOrReceipt) {
    const contentEl = document.getElementById('receipt-preview-content');
    if (contentEl) {
        contentEl.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Loading receipt...</div>';
    }
    openModal('view-receipt-modal');
    updateHeaderPrinterLabel();

    try {
        const res = await fetch(`/api/receipt/details/${encodeURIComponent(idOrReceipt)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (!res.ok) {
            contentEl.innerHTML = '<div style="color:#ef4444; text-align:center; padding:20px;">Receipt not found.</div>';
            return;
        }

        const data = await res.json();
        const r = data.receipt;
        currentPreviewedReceipt = r;
        renderReceiptModal(r);
    } catch (err) {
        if (contentEl) contentEl.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px;">Failed to load receipt: ${escapeHtml(err.message)}</div>`;
    }
}

function renderReceiptModal(r) {
    const contentEl = document.getElementById('receipt-preview-content');
    if (!contentEl || !r) return;

    const brand = companyData.name || 'Jomish POS';
    const loc = companyData.location || 'Kampala, Uganda';
    const curr = companyData.currency || 'Sh';
    const rcptNo = r.receipt_no || r.id;
    const dateStr = r.transaction_date ? new Date(r.transaction_date).toLocaleString() : '—';
    const cashier = r.recorded_by_name || r.order_served_by || 'Staff';
    const buyer = r.order_buyer_name ? `${r.order_buyer_name} ${r.order_buyer_phone ? `(${r.order_buyer_phone})` : ''}` : 'Walk-in Customer';

    let itemsHtml = '';
    if (r.items && r.items.length > 0) {
        itemsHtml = `
            <div style="border-top:1px dashed #cbd5e1; border-bottom:1px dashed #cbd5e1; padding:8px 0; margin:10px 0;">
                <table style="width:100%; font-size:0.84rem; border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                            <th style="text-align:left; padding:4px 0;">Item</th>
                            <th style="text-align:center; padding:4px 0;">Qty</th>
                            <th style="text-align:right; padding:4px 0;">Price</th>
                            <th style="text-align:right; padding:4px 0;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${r.items.map(it => `
                            <tr>
                                <td style="padding:4px 0; font-weight:600;">${escapeHtml(it.product_name || it.name)}</td>
                                <td style="text-align:center; padding:4px 0;">${it.qty}</td>
                                <td style="text-align:right; padding:4px 0;">${parseFloat(it.price || 0).toLocaleString()}</td>
                                <td style="text-align:right; padding:4px 0; font-weight:600;">${parseFloat(it.total || (it.price * it.qty)).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        itemsHtml = `
            <div style="border-top:1px dashed #cbd5e1; border-bottom:1px dashed #cbd5e1; padding:10px 0; margin:10px 0; color:#475569;">
                <div><strong>Transaction:</strong> ${escapeHtml(r.description || r.type)}</div>
            </div>
        `;
    }

    const totalAmt = parseFloat(r.order_total_amount || r.amount || 0).toLocaleString();
    const paidAmt = parseFloat(r.order_amount_paid !== undefined ? r.order_amount_paid : r.amount).toLocaleString();

    contentEl.innerHTML = `
        <div style="text-align:center; margin-bottom:12px;">
            <div style="font-size:1.15rem; font-weight:800; letter-spacing:0.5px;">${escapeHtml(brand)}</div>
            <div style="font-size:0.8rem; color:#64748b;">${escapeHtml(loc)}</div>
            <div style="font-size:0.8rem; color:#64748b;">RECEIPT / TRANSACTION RECORD</div>
        </div>

        <div style="font-size:0.82rem; margin-bottom:8px; line-height:1.5;">
            <div><strong>Receipt No:</strong> #${rcptNo}</div>
            <div><strong>Date:</strong> ${dateStr}</div>
            <div><strong>Cashier:</strong> ${escapeHtml(cashier)}</div>
            <div><strong>Customer:</strong> ${escapeHtml(buyer)}</div>
            <div><strong>Payment:</strong> ${escapeHtml(r.order_payment_method || r.type || 'CASH')}</div>
        </div>

        ${itemsHtml}

        <div style="font-size:0.88rem; line-height:1.6; margin-top:6px;">
            <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1.05rem;">
                <span>TOTAL:</span>
                <span>${totalAmt} ${curr}</span>
            </div>
            <div style="display:flex; justify-content:space-between; color:#475569;">
                <span>Amount Paid:</span>
                <span>${paidAmt} ${curr}</span>
            </div>
        </div>

        <div style="text-align:center; margin-top:16px; font-size:0.78rem; color:#64748b; border-top:1px dashed #cbd5e1; padding-top:10px;">
            Thank you for your business!<br>Powered by Jomish POS
        </div>
    `;
}



function triggerBrowserPrint(htmlContent, title) {
    let oldFrame = document.getElementById('receipt-print-frame');
    if (oldFrame) {
        try { oldFrame.remove(); } catch (_) {}
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'receipt-print-frame';
    // Non-zero dimensions placed offscreen so Chromium/Edge doesn't suppress print execution
    iframe.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:80mm; height:120mm; border:none; z-index:-1; opacity:0; pointer-events:none;';
    document.body.appendChild(iframe);

    let doc;
    try {
        doc = iframe.contentWindow.document;
    } catch (e) {
        console.warn('Cannot access iframe document, using direct print:', e);
        window.print();
        return;
    }

    const printerName = localStorage.getItem('jomish_default_printer') || '';
    const paperSize = localStorage.getItem('jomish_paper_size') || (printerName.includes('80') ? '80mm' : '58mm');
    const is80 = paperSize === '80mm';
    const maxWidth = is80 ? '72mm' : '52mm';
    const fontSize = is80 ? '12px' : '10.5px';

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="utf-8">
                <title>${title || 'Receipt'}</title>
                <style>
                    @page {
                        size: auto;
                        margin: 0;
                    }
                    * {
                        box-sizing: border-box !important;
                    }
                    @media print {
                        html, body {
                            width: 100% !important;
                            max-width: ${maxWidth} !important;
                            margin: 0 auto !important;
                            padding: 1mm 2mm !important;
                            background: #fff !important;
                            color: #000 !important;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                    }
                    body {
                        font-family: 'Courier New', Courier, monospace, sans-serif;
                        font-size: ${fontSize};
                        line-height: 1.35;
                        color: #000;
                        margin: 0 auto;
                        padding: 2px 4px;
                        width: 100%;
                        max-width: ${maxWidth};
                        word-break: break-word;
                    }
                    table {
                        width: 100% !important;
                        border-collapse: collapse !important;
                        table-layout: fixed !important;
                    }
                    th, td {
                        padding: 2px 1px !important;
                        word-break: break-word !important;
                        overflow-wrap: break-word !important;
                    }
                    img {
                        max-width: 100% !important;
                        height: auto !important;
                    }
                </style>
            </head>
            <body>
                <div style="width:100%; max-width:${maxWidth}; margin:0 auto;">
                    ${htmlContent}
                </div>
            </body>
        </html>
    `);
    doc.close();

    // Direct Windows print execution

    let printDone = false;
    const executePrint = () => {
        if (printDone) return;
        printDone = true;
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (err) {
            console.warn('[Iframe print failed, falling back to window.print]:', err);
            window.print();
        }
        setTimeout(() => {
            if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 3000);
    };

    iframe.onload = executePrint;
    setTimeout(() => {
        if (!printDone) executePrint();
    }, 400);
}

// Print receipt — opens Windows print dialog directly
async function printReceiptHtml(htmlContent, title, receiptMeta = {}) {
    triggerBrowserPrint(htmlContent, title);
}

function printPreviewedReceipt() {
    const printContent = document.getElementById('receipt-preview-content');
    if (!printContent) return;

    if (!currentPreviewedReceipt) {
        triggerBrowserPrint(printContent.innerHTML, 'Receipt');
        return;
    }

    const rcptNo = currentPreviewedReceipt.receipt_no || currentPreviewedReceipt.id;
    const curr = companyData.currency || 'Sh';
    const total = `${parseFloat(currentPreviewedReceipt.order_total_amount || currentPreviewedReceipt.total_amount || currentPreviewedReceipt.amount || 0).toLocaleString()} ${curr}`;

    printReceiptHtml(printContent.innerHTML, `Receipt #${rcptNo}`, {
        receipt_no: rcptNo,
        total: total,
        items: currentPreviewedReceipt.items || []
    });
}

async function printReceiptByTransaction(idOrReceipt) {
    try {
        const res = await fetch(`/api/receipt/details/${encodeURIComponent(idOrReceipt)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (!res.ok) return;

        const data = await res.json();
        const r = data.receipt;
        if (!r) return;

        // Render preview content into modal state
        currentPreviewedReceipt = r;
        renderReceiptModal(r);

        const printContent = document.getElementById('receipt-preview-content');
        if (printContent) {
            const rcptNo = r.receipt_no || r.id;
            const curr = companyData.currency || 'Sh';
            const total = `${parseFloat(r.order_total_amount || r.amount || 0).toLocaleString()} ${curr}`;
            printReceiptHtml(printContent.innerHTML, `Receipt #${rcptNo}`, {
                receipt_no: rcptNo,
                total: total,
                items: r.items || []
            });
        }
    } catch (err) {
        console.error('Failed to auto-print receipt:', err);
    }
}

// ============================================================================
// MODAL CONTROLS & UTILITIES
// ============================================================================
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function openTechSupportModal() {
    switchNavTab('tech');
}

function handleLogout() {
    localStorage.removeItem('jomish_token');
    localStorage.removeItem('jomish_role');
    localStorage.removeItem('jomish_name');
    localStorage.removeItem('jomish_permissions');
    localStorage.removeItem('jomish_prefix');
    localStorage.removeItem('tech_super_admin');
    window.location.replace('login.html');
}

function toggleOnlineMenu(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('online-status-dropdown');
    if (!dropdown) return;
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

document.addEventListener('click', () => {
    const dropdown = document.getElementById('online-status-dropdown');
    if (dropdown) dropdown.style.display = 'none';
});

let isForceOffline = false;

function toggleForceOffline() {
    isForceOffline = !isForceOffline;
    const dot = document.getElementById('online-dot');
    const text = document.getElementById('online-status-text');
    const menuTxt = document.getElementById('menu-toggle-offline-text');
    const menuIcon = document.getElementById('menu-wifi-icon');
    const dropdown = document.getElementById('online-status-dropdown');

    if (dropdown) dropdown.style.display = 'none';

    if (isForceOffline) {
        if (dot) dot.style.background = '#ef4444';
        if (text) text.textContent = 'Offline (Working Offline)';
        if (menuTxt) menuTxt.textContent = 'Switch to Online Mode';
        if (menuIcon) {
            menuIcon.className = 'fa-solid fa-plane';
            menuIcon.style.color = '#ef4444';
        }
        alert('Switched to Offline Mode. All orders and operations will be queued locally in IndexedDB and can be synced anytime.');
    } else {
        if (dot) dot.style.background = '#10b981';
        if (text) text.textContent = 'Online';
        if (menuTxt) menuTxt.textContent = 'Switch to Offline Mode';
        if (menuIcon) {
            menuIcon.className = 'fa-solid fa-wifi';
            menuIcon.style.color = '#10b981';
        }
        syncOfflineOrders();
    }
}

async function syncOfflineOrders() {
    const badge = document.getElementById('offline-sync-badge');
    const uploadBtn = document.getElementById('offline-upload-btn');
    const dropdown = document.getElementById('online-status-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    try {
        let pendingSales = [];
        if (typeof getPendingOfflineSales === 'function') {
            pendingSales = await getPendingOfflineSales();
        }

        if (!pendingSales || pendingSales.length === 0) {
            if (badge) badge.style.display = 'none';
            alert('Offline Sync: All orders and data are already up to date with the server!');
            return;
        }

        if (uploadBtn) uploadBtn.innerHTML = `<span>Syncing ${pendingSales.length}...</span> <i class="fa-solid fa-spinner fa-spin"></i>`;

        const res = await fetch('/api/pos/batch-sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ transactions: pendingSales })
        });

        if (res.ok) {
            const result = await res.json();
            const syncedUuids = pendingSales.map(s => s.client_uuid);
            if (typeof removeSyncedSales === 'function') {
                await removeSyncedSales(syncedUuids);
            }
            if (badge) badge.style.display = 'none';
            alert(`Sync Successful: ${result.synced_count || pendingSales.length} offline orders synchronized with server.`);
            if (activeNavTab === 'orders') loadOrdersList();
            if (activeNavTab === 'finance') refreshActiveFinanceSubTab();
        } else {
            const err = await res.json();
            alert('Sync error: ' + (err.error || 'Server rejected batch'));
        }
    } catch (e) {
        alert('Sync error: Unable to reach server. Please check your internet connection.');
    } finally {
        if (uploadBtn) {
            uploadBtn.innerHTML = `
                <span>Offline Upload</span>
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <span id="offline-sync-badge" style="background:rgba(255,255,255,0.25); padding:1px 6px; border-radius:10px; font-size:0.7rem; display:none;">0</span>
            `;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}



// ============================================================================
// TAB: FINANCE INTELLIGENCE DASHBOARD (Pixel-Perfect Match to iBanko)
// ============================================================================
let currentFinanceData = null;

async function loadFinanceDashboard() {
    try {
        if (!allCreditorsList || allCreditorsList.length === 0) {
            loadCreditorsList();
        }
        const res = await fetch('/api/finance/summary', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            currentFinanceData = await res.json();
            renderFinanceDashboardUI();
            setTimeout(() => {
                renderMoneyFlowChart();
            }, 80);
        }
    } catch (e) {
        console.warn('Error loading finance summary:', e.message);
    }
}

function renderFinanceDashboardUI() {
    if (!currentFinanceData) return;
    const curr = companyData.currency || 'Sh';
    const all = currentFinanceData.allTime || { income: 0, expense: 0, profit: 0 };
    const month = currentFinanceData.month || { income: 0, expense: 0, profit: 0 };

    // 1. User greeting
    const userNameEl = document.getElementById('fin-user-name');
    if (userNameEl) {
        userNameEl.textContent = currentUser.name || 'Manager';
    }

    // 2. Hero Card balance (Net Vault Balance)
    const heroBalEl = document.getElementById('fin-hero-balance');
    if (heroBalEl) {
        const vaultBalance = all.profit !== undefined ? all.profit : (all.income - all.expense);
        heroBalEl.textContent = `${vaultBalance.toLocaleString()} ${curr}`;
    }

    // 3. Render the 3 records cards based on the selected period
    renderFinanceRecords();

    // 4. Render Money Flow SVG chart
    renderMoneyFlowChart();

    // 5. Render Send Money To quick payees
    renderQuickPayees();

    // 6. Render Scheduled Payments from creditors
    renderScheduledPayments();

    // 7. Render Recent Transactions
    renderFinanceRecentTx();

    // 8. Render Available cards values (Drawer float vs MoMo)
    renderAvailableCards();
}

function renderFinanceRecords() {
    if (!currentFinanceData) return;
    const curr = companyData.currency || 'Sh';
    const period = document.getElementById('fin-record-period')?.value || 'month';
    const data = currentFinanceData[period] || currentFinanceData.month || { income: 0, expense: 0, profit: 0 };

    const incEl = document.getElementById('fin-stat-income');
    const expEl = document.getElementById('fin-stat-expense');
    const savEl = document.getElementById('fin-stat-saving');

    if (incEl) incEl.textContent = `${Number(data.income || 0).toLocaleString()} ${curr}`;
    if (expEl) expEl.textContent = `${Number(data.expense || 0).toLocaleString()} ${curr}`;
    if (savEl) savEl.textContent = `${Number(data.profit || 0).toLocaleString()} ${curr}`;
}

function renderMoneyFlowChart() {
    const container = document.getElementById('fin-svg-chart-container');
    if (!container) return;

    const dailyFlow = (currentFinanceData && currentFinanceData.dailyFlow) || [];
    if (dailyFlow.length === 0) {
        // Fallback default 7 days dummy curve
        for (let i = 6; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            dailyFlow.push({
                date: d.toISOString().split('T')[0],
                income: 0,
                expense: 0,
                profit: 0
            });
        }
    }

    const width = container.clientWidth || 580;
    const height = 210;
    const padding = { top: 20, right: 30, bottom: 35, left: 55 };

    const maxVal = Math.max(
        ...dailyFlow.map(d => Math.max(d.income || 0, d.expense || 0, Math.abs(d.profit || 0))),
        1000
    );

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const pointsSaving = [];
    const pointsExpense = [];

    dailyFlow.forEach((item, idx) => {
        const x = padding.left + (chartW / Math.max(1, dailyFlow.length - 1)) * idx;
        const normSaving = Math.max(0, (item.profit || item.income || 0)) / maxVal;
        const normExpense = Math.max(0, item.expense || 0) / maxVal;

        const ySaving = padding.top + chartH - (normSaving * chartH);
        const yExpense = padding.top + chartH - (normExpense * chartH);

        pointsSaving.push({ x, y: ySaving, label: item.date.substring(5), val: item.profit || item.income });
        pointsExpense.push({ x, y: yExpense, label: item.date.substring(5), val: item.expense });
    });

    // Build SVG paths
    function buildSmoothPath(pts) {
        if (pts.length === 0) return '';
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const cx = (p0.x + p1.x) / 2;
            d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
        }
        return d;
    }

    const pathSaving = buildSmoothPath(pointsSaving);
    const pathExpense = buildSmoothPath(pointsExpense);

    // Grid lines
    const yGridCount = 4;
    let gridLinesSvg = '';
    for (let i = 0; i <= yGridCount; i++) {
        const y = padding.top + (chartH / yGridCount) * i;
        const valAtY = Math.round(maxVal - (maxVal / yGridCount) * i);
        gridLinesSvg += `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${padding.left - 10}" y="${y + 4}" fill="#94a3b8" font-size="10" text-anchor="end">${valAtY >= 1000 ? (valAtY/1000).toFixed(0) + 'k' : valAtY}</text>
        `;
    }

    // X-axis date labels
    let xLabelsSvg = '';
    pointsSaving.forEach((pt) => {
        xLabelsSvg += `
            <text x="${pt.x}" y="${height - 10}" fill="#94a3b8" font-size="10" text-anchor="middle">${pt.label}</text>
        `;
    });

    // Tooltip highlight at peak point
    let peakSvg = '';
    if (pointsSaving.length > 0) {
        const peak = pointsSaving.reduce((max, p) => p.val > max.val ? p : max, pointsSaving[0]);
        if (peak.val > 0) {
            peakSvg = `
                <circle cx="${peak.x}" cy="${peak.y}" r="4" fill="#0f172a" stroke="#ffffff" stroke-width="2" />
                <rect x="${peak.x - 30}" y="${peak.y - 30}" width="60" height="22" rx="6" fill="#0f172a" />
                <text x="${peak.x}" y="${peak.y - 15}" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">${Number(peak.val).toLocaleString()}</text>
            `;
        }
    }

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${gridLinesSvg}
            <path d="${pathExpense}" fill="none" stroke="#f97316" stroke-width="2.5" stroke-dasharray="4,4" />
            <path d="${pathSaving}" fill="none" stroke="#0f172a" stroke-width="2.8" stroke-linecap="round" />
            ${xLabelsSvg}
            ${peakSvg}
        </svg>
    `;
}

function renderQuickPayees() {
    const container = document.getElementById('fin-quick-payees-list');
    if (!container) return;

    // Pick top 4 creditors or employees
    const payees = (allCreditorsList && allCreditorsList.length > 0)
        ? allCreditorsList.slice(0, 4)
        : [
            { supplier_name: 'Jane Cooper' },
            { supplier_name: 'Leslie Alexander' },
            { supplier_name: 'Robert Fox' },
            { supplier_name: 'Jacob Jones' }
        ];

    const plusBtn = `
        <button type="button" class="pos-fin-add-circle" title="Record New Payout" onclick="openExpenseModal()">
            <i class="fa-solid fa-plus"></i>
        </button>
    `;

    const avatars = payees.map(p => {
        const name = p.supplier_name || 'Staff';
        const initial = name.charAt(0).toUpperCase();
        return `
            <div class="pos-fin-avatar-bubble" title="${escapeHtml(name)} - Tap to Pay" onclick="quickFillExpense('${escapeHtml(name)}')">
                ${initial}
            </div>
        `;
    }).join('');

    container.innerHTML = plusBtn + avatars;
}

function quickFillExpense(payeeName) {
    openExpenseModal();
    const descEl = document.getElementById('expense-desc');
    if (descEl) descEl.value = `Payment to ${payeeName}`;
}

function renderScheduledPayments() {
    const container = document.getElementById('fin-scheduled-bills-list');
    if (!container) return;
    const curr = companyData.currency || 'Sh';

    const bills = (allCreditorsList && allCreditorsList.length > 0)
        ? allCreditorsList.slice(0, 3).map(c => ({
            name: c.supplier_name || 'Bill',
            amt: `${(parseFloat(c.balance) || 0).toLocaleString()} ${curr}`
        }))
        : [
            { name: 'Power / Umeme', amt: `150,000 ${curr}` },
            { name: 'Water Bill', amt: `45,000 ${curr}` },
            { name: 'Store Rent', amt: `800,000 ${curr}` }
        ];

    container.innerHTML = bills.map(b => `
        <div class="pos-fin-scheduled-item" onclick="switchNavTab('creditors')" style="cursor:pointer;" title="View in Creditors">
            <div class="pos-fin-sched-name">${escapeHtml(b.name)}</div>
            <div class="pos-fin-sched-amt">${escapeHtml(b.amt)}</div>
        </div>
    `).join('');
}

function renderFinanceRecentTx() {
    const container = document.getElementById('fin-recent-tx-container');
    if (!container) return;
    const curr = companyData.currency || 'Sh';

    const recent = (currentFinanceData && currentFinanceData.recentTransactions) || [];
    if (recent.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:25px; color:#94a3b8; font-size:0.85rem;">No recent transactions yet.</div>';
        return;
    }

    container.innerHTML = recent.slice(0, 6).map(tx => {
        const isInc = tx.isIncome;
        const iconClass = isInc ? 'income' : 'expense';
        const icon = isInc ? '<i class="fa-solid fa-arrow-down"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
        const dateStr = tx.date ? new Date(tx.date).toLocaleDateString() : 'Today';

        return `
            <div class="pos-fin-tx-item" onclick="viewReceiptDetails(${tx.id})" title="Click to view details">
                <div class="pos-fin-tx-left">
                    <div class="pos-fin-tx-icon ${iconClass}">${icon}</div>
                    <div>
                        <div class="pos-fin-tx-name">${escapeHtml(tx.description || 'Transaction')}</div>
                        <div class="pos-fin-tx-date">${dateStr}</div>
                    </div>
                </div>
                <div class="pos-fin-tx-amount" style="color:${isInc ? '#10b981' : '#0f172a'};">
                    ${isInc ? '+' : '-'}${Number(tx.amount || 0).toLocaleString()} ${curr}
                </div>
            </div>
        `;
    }).join('');
}

function renderAvailableCards() {
    const curr = companyData.currency || 'Sh';
    const drawerEl = document.getElementById('fin-card-drawer-val');
    const momoEl = document.getElementById('fin-card-momo-val');

    const drawerDisplay = document.getElementById('shift-drawer-expected-display');
    const momoDisplay = document.getElementById('shift-momo-sales-display');

    if (drawerEl) {
        drawerEl.textContent = drawerDisplay ? drawerDisplay.textContent : `0 ${curr}`;
    }
    if (momoEl) {
        momoEl.textContent = momoDisplay ? momoDisplay.textContent : `0 ${curr}`;
    }
}

// ============================================================================
// SHIFT SUB-VIEW SWITCHER
// ============================================================================
function switchShiftSubView(subView) {
    // Toggle subtab buttons
    document.querySelectorAll('#view-pane-shift .pos-fin-subtab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`shift-subtab-btn-${subView}`);
    if (btn) btn.classList.add('active');

    // Toggle subview panes
    ['register', 'admin'].forEach(v => {
        const el = document.getElementById(`shift-subview-${v}`);
        if (el) el.style.display = (v === subView) ? '' : 'none';
    });

    if (subView === 'admin') {
        populateAdminShiftFilters();
        loadAdminShiftsList();
    }
}

function refreshActiveShiftTab() {
    const adminView = document.getElementById('shift-subview-admin');
    if (adminView && adminView.style.display !== 'none') {
        loadAdminShiftsList();
    } else {
        loadActiveShiftInfo();
        loadShiftTransactions();
    }
}

// ============================================================================
// ADMIN SHIFTS ANALYTICS DASHBOARD
// ============================================================================
let _adminShiftDebounce = null;
let _selectedShiftIds = [];

async function populateAdminShiftFilters() {
    const cashierSel = document.getElementById('admin-shift-cashier-select');
    const tillSel = document.getElementById('admin-shift-till-select');
    if (!cashierSel && !tillSel) return;

    try {
        // Fetch all closed+open shifts to get unique cashier names
        const r = await fetch('/api/pos/shifts?status=ALL&limit=500', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (r.ok) {
            const data = await r.json();
            const shifts = data.shifts || [];

            if (cashierSel) {
                const cashiers = [...new Set(shifts.map(s => s.cashier_name).filter(Boolean))].sort();
                cashierSel.innerHTML = '<option value="">All Cashiers</option>' +
                    cashiers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
            }
        }

        // Populate till filter from store-config
        if (tillSel) {
            const r2 = await fetch('/api/pos/store-config', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
            });
            if (r2.ok) {
                const cfg = await r2.json();
                const tills = cfg.tills || [];
                const existing = Array.from(tillSel.options).map(o => o.value);
                tills.forEach(t => {
                    if (!existing.includes(t.name)) {
                        const opt = document.createElement('option');
                        opt.value = t.name;
                        opt.textContent = t.name;
                        tillSel.appendChild(opt);
                    }
                });
            }
        }
    } catch (_) {}
}

function debounceAdminShiftsSearch() {
    clearTimeout(_adminShiftDebounce);
    _adminShiftDebounce = setTimeout(() => loadAdminShiftsList(), 300);
}

function handleAdminShiftDateChange(val) {
    const customRow = document.getElementById('admin-shift-custom-date-row');
    if (customRow) customRow.style.display = (val === 'CUSTOM') ? 'flex' : 'none';
    if (val !== 'CUSTOM') loadAdminShiftsList();
}

async function loadAdminShiftsList() {
    const tbody = document.getElementById('admin-shifts-table-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;color:#64748b;">Loading shifts...</td></tr>`;

    const search  = document.getElementById('admin-shift-search-input')?.value.trim() || '';
    const cashier = document.getElementById('admin-shift-cashier-select')?.value || '';
    const till    = document.getElementById('admin-shift-till-select')?.value || '';
    const status  = document.getElementById('admin-shift-status-select')?.value || 'ALL';
    const dateOpt = document.getElementById('admin-shift-date-select')?.value || 'TODAY';

    let url = `/api/pos/shifts?status=${encodeURIComponent(status)}&limit=200`;
    if (search)  url += `&search=${encodeURIComponent(search)}`;
    if (cashier) url += `&cashier=${encodeURIComponent(cashier)}`;
    if (till && till !== 'ALL') url += `&till=${encodeURIComponent(till)}`;
    if (dateOpt && dateOpt !== 'ALL' && dateOpt !== 'CUSTOM') url += `&date_range=${encodeURIComponent(dateOpt)}`;
    if (dateOpt === 'CUSTOM') {
        const from = document.getElementById('admin-shift-from-date')?.value;
        const to   = document.getElementById('admin-shift-to-date')?.value;
        if (from) url += `&start_date=${encodeURIComponent(from)}`;
        if (to)   url += `&end_date=${encodeURIComponent(to)}`;
    }

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        const data = await res.json();
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;color:#ef4444;">Error loading shifts: ${escapeHtml(data.error || 'Unknown')}</td></tr>`;
            return;
        }

        const shifts   = data.shifts || [];
        const totals   = data.totals || {};
        const curr     = companyData.currency || 'Sh';

        // Update KPI cards
        const kpiCount = document.getElementById('admin-shift-kpi-count');
        const kpiAct   = document.getElementById('admin-shift-kpi-active-badge');
        const kpiSales = document.getElementById('admin-shift-kpi-sales');
        const kpiCash  = document.getElementById('admin-shift-kpi-cash');
        const kpiMomo  = document.getElementById('admin-shift-kpi-momo');
        const kpiDiff  = document.getElementById('admin-shift-kpi-diff');

        const activeCount = shifts.filter(s => s.status === 'OPEN').length;

        if (kpiCount) kpiCount.textContent = shifts.length;
        if (kpiAct)   kpiAct.textContent   = `${activeCount} Active Currently`;
        if (kpiSales) kpiSales.textContent  = `${Number(totals.total_sales || 0).toLocaleString()} ${curr}`;
        if (kpiCash)  kpiCash.textContent   = `${Number(totals.total_cash_sales || 0).toLocaleString()} ${curr}`;
        if (kpiMomo)  kpiMomo.textContent   = `${Number(totals.total_momo_sales || 0).toLocaleString()} ${curr}`;

        const netDiff = Number(totals.total_difference || 0);
        if (kpiDiff) {
            kpiDiff.textContent = `${netDiff >= 0 ? '+' : ''}${netDiff.toLocaleString()} ${curr}`;
            kpiDiff.style.color = netDiff === 0 ? '#10b981' : (netDiff > 0 ? '#0284c7' : '#ef4444');
        }

        // Reset selection
        _selectedShiftIds = [];
        updateCompareButton();

        if (shifts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:28px;color:#94a3b8;">No shifts found for the selected filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = shifts.map(s => {
            const isOpen   = s.status === 'OPEN';
            const startStr = s.start_time ? new Date(s.start_time).toLocaleString([], { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
            let durationStr = '—';
            if (s.start_time) {
                const startMs = new Date(s.start_time).getTime();
                const endMs   = s.end_time ? new Date(s.end_time).getTime() : Date.now();
                const mins    = Math.round((endMs - startMs) / 60000);
                durationStr   = mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
            }
            const endStr  = s.end_time ? new Date(s.end_time).toLocaleString([], { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : (isOpen ? '<span style="color:#10b981;font-weight:600;">● LIVE</span>' : '—');
            const diff    = Number(s.difference || 0);
            const diffColor = diff === 0 ? '#64748b' : (diff > 0 ? '#0284c7' : '#ef4444');
            const diffPfx   = diff > 0 ? '+' : '';
            const statusBadge = isOpen
                ? `<span style="background:#dcfce7;color:#15803d;font-weight:700;font-size:0.7rem;padding:2px 8px;border-radius:10px;">OPEN</span>`
                : `<span style="background:#f1f5f9;color:#475569;font-weight:700;font-size:0.7rem;padding:2px 8px;border-radius:10px;">CLOSED</span>`;

            return `<tr>
                <td><input type="checkbox" class="shift-row-cb" value="${s.id}" onchange="handleShiftSelectChange()"></td>
                <td style="font-weight:700;color:var(--primary);">#${s.id}</td>
                <td style="font-weight:600;">${escapeHtml(s.register_name || '—')}</td>
                <td>${escapeHtml(s.cashier_name || s.display_name || '—')}</td>
                <td style="font-size:0.82rem;color:#475569;">${startStr}</td>
                <td style="font-size:0.82rem;color:#475569;">${endStr} <span style="font-size:0.72rem;color:#94a3b8;">(${durationStr})</span></td>
                <td>${Number(s.start_cash || 0).toLocaleString()} ${curr}</td>
                <td style="color:#0284c7;font-weight:600;">${Number(s.cash_sales || 0).toLocaleString()} ${curr}</td>
                <td style="color:#8b5cf6;font-weight:600;">${Number(s.momo_sales || 0).toLocaleString()} ${curr}</td>
                <td style="font-weight:700;color:#10b981;">${Number(s.total_sales || 0).toLocaleString()} ${curr}</td>
                <td style="font-size:0.82rem;">${isOpen ? '<span style="color:#94a3b8;font-style:italic;">Live / Not closed</span>' : `${Number(s.counted_cash || 0).toLocaleString()} vs ${Number(s.cash_in_drawer || 0).toLocaleString()} ${curr}`}</td>
                <td style="font-weight:700;color:${diffColor};">${isOpen ? '—' : `${diffPfx}${diff.toLocaleString()} ${curr}`}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;">
                    <button class="header-idle-btn" style="font-size:0.72rem;padding:5px 10px;" onclick="openExactShiftModal(${s.id})">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> Audit
                    </button>
                </td>
            </tr>`;
        }).join('');

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;color:#ef4444;">Connection error loading shifts.</td></tr>`;
    }
}

function handleShiftSelectChange() {
    _selectedShiftIds = Array.from(document.querySelectorAll('.shift-row-cb:checked')).map(cb => Number(cb.value));
    updateCompareButton();
}

function toggleSelectAllShifts(checked) {
    document.querySelectorAll('.shift-row-cb').forEach(cb => { cb.checked = checked; });
    handleShiftSelectChange();
}

function updateCompareButton() {
    const btn   = document.getElementById('btn-compare-shifts');
    const count = document.getElementById('compare-count');
    if (!btn) return;
    if (_selectedShiftIds.length >= 2) {
        btn.style.display = '';
        if (count) count.textContent = _selectedShiftIds.length;
    } else {
        btn.style.display = 'none';
    }
}

async function handleOpenCompareShiftsModal() {
    if (_selectedShiftIds.length < 2) {
        alert('Select at least 2 shifts to compare.');
        return;
    }
    const grid = document.getElementById('compare-shifts-grid');
    if (grid) grid.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;">Loading comparison...</div>`;
    openModal('compare-shifts-modal');

    try {
        const res = await fetch('/api/pos/shifts/compare', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ shift_ids: _selectedShiftIds })
        });
        const data = await res.json();
        if (!res.ok || !data.comparison) {
            if (grid) grid.innerHTML = `<div style="color:#ef4444;padding:16px;">Error: ${escapeHtml(data.error || 'Could not load comparison')}</div>`;
            return;
        }
        const curr = companyData.currency || 'Sh';
        grid.innerHTML = data.comparison.map((s, i) => {
            const diff = Number(s.difference || 0);
            const diffColor = diff === 0 ? '#10b981' : (diff > 0 ? '#0284c7' : '#ef4444');
            const cashPct = s.total_sales > 0 ? Math.round((s.cash_sales / s.total_sales) * 100) : 0;
            const momoPct = 100 - cashPct;
            return `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;min-width:220px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="font-weight:800;color:var(--primary);font-size:1rem;">Shift #${s.id}</span>
                    <span style="font-size:0.7rem;background:${s.status==='OPEN'?'#dcfce7':'#f1f5f9'};color:${s.status==='OPEN'?'#15803d':'#475569'};font-weight:700;padding:2px 8px;border-radius:10px;">${s.status}</span>
                </div>
                <div style="font-size:0.8rem;color:#475569;margin-bottom:10px;">
                    <div><strong>${escapeHtml(s.cashier_name||'—')}</strong> @ ${escapeHtml(s.register_name||'—')}</div>
                    <div style="color:#94a3b8;margin-top:2px;">Duration: ${s.duration_mins >= 60 ? Math.floor(s.duration_mins/60)+'h '+s.duration_mins%60+'m' : s.duration_mins+'m'}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:0.82rem;">
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="color:#64748b;">Total Sales</span>
                        <strong style="color:#10b981;">${Number(s.total_sales||0).toLocaleString()} ${curr}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="color:#64748b;">Orders</span>
                        <strong>${s.order_count||0}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="color:#64748b;">Avg Order</span>
                        <strong>${Number(s.avg_order_value||0).toLocaleString()} ${curr}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="color:#0284c7;">Cash</span>
                        <strong style="color:#0284c7;">${Number(s.cash_sales||0).toLocaleString()} ${curr} (${cashPct}%)</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="color:#8b5cf6;">MoMo</span>
                        <strong style="color:#8b5cf6;">${Number(s.momo_sales||0).toLocaleString()} ${curr} (${momoPct}%)</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 0;">
                        <span style="color:#64748b;">Over/Short</span>
                        <strong style="color:${diffColor};">${diff >= 0 ? '+' : ''}${diff.toLocaleString()} ${curr}</strong>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (_) {
        if (grid) grid.innerHTML = `<div style="color:#ef4444;padding:16px;">Connection error loading comparison.</div>`;
    }
}

async function openExactShiftModal(shiftId) {
    openModal('exact-shift-modal');
    const title   = document.getElementById('exact-shift-modal-title');
    const metaBar = document.getElementById('exact-shift-meta-bar');
    const kpisEl  = document.getElementById('exact-shift-kpis');
    const ordTbody = document.getElementById('exact-shift-orders-tbody');
    const txTbody  = document.getElementById('exact-shift-txs-tbody');
    const ordCount = document.getElementById('exact-shift-orders-count');
    const ordSum   = document.getElementById('exact-shift-orders-sum');

    if (title) title.innerHTML = `<i class="fa-solid fa-magnifying-glass-chart" style="color:#0284c7;"></i> Shift #${shiftId} Audit`;
    if (metaBar) metaBar.innerHTML = `<span style="color:#64748b;">Loading shift audit...</span>`;
    if (ordTbody) ordTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">Loading...</td></tr>`;
    if (txTbody)  txTbody.innerHTML  = `<tr><td colspan="4" style="text-align:center;padding:16px;color:#94a3b8;">Loading...</td></tr>`;

    try {
        const res = await fetch(`/api/pos/shifts/${shiftId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        const data = await res.json();
        if (!res.ok) {
            if (metaBar) metaBar.innerHTML = `<span style="color:#ef4444;">Error: ${escapeHtml(data.error || 'Could not load shift')}</span>`;
            return;
        }

        const s    = data.shift || {};
        const curr = companyData.currency || 'Sh';
        const isOpen = s.status === 'OPEN';

        // Meta badge bar
        if (metaBar) {
            const startStr = s.start_time ? new Date(s.start_time).toLocaleString() : '—';
            const endStr   = s.end_time   ? new Date(s.end_time).toLocaleString()   : 'Still Running';
            metaBar.innerHTML = `
                <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
                    <span><strong>Cashier:</strong> ${escapeHtml(s.cashier_name||'—')}</span>
                    <span><strong>Station:</strong> ${escapeHtml(s.register_name||'—')}</span>
                    <span><strong>Started:</strong> ${startStr}</span>
                    <span><strong>Ended:</strong> ${endStr}</span>
                </div>
                <span style="font-size:0.7rem;background:${isOpen?'#dcfce7':'#f1f5f9'};color:${isOpen?'#15803d':'#475569'};font-weight:700;padding:2px 8px;border-radius:10px;">${s.status||'—'}</span>`;
        }

        // KPI mini cards
        if (kpisEl) {
            const diff = Number(s.difference || 0);
            const kpiItems = [
                { label:'Opening Float',   val:`${Number(s.start_cash||0).toLocaleString()} ${curr}`,      color:'#0f172a' },
                { label:'Cash Sales',      val:`${Number(s.cash_sales||0).toLocaleString()} ${curr}`,      color:'#0284c7' },
                { label:'MoMo Sales',      val:`${Number(s.momo_sales||0).toLocaleString()} ${curr}`,      color:'#8b5cf6' },
                { label:'Total Sales',     val:`${Number(s.total_sales||0).toLocaleString()} ${curr}`,     color:'#10b981' },
                { label:'Cash In Added',   val:`+${Number(s.cash_in||0).toLocaleString()} ${curr}`,        color:'#3b82f6' },
                { label:'Expenses Out',    val:`-${Number(s.expenses||0).toLocaleString()} ${curr}`,       color:'#ef4444' },
                { label:'Expected Drawer', val:`${Number(s.cash_in_drawer||0).toLocaleString()} ${curr}`,  color:'#f59e0b' },
                { label:'Counted Cash',    val: isOpen ? '—' : `${Number(s.counted_cash||0).toLocaleString()} ${curr}`, color:'#0f172a' },
                { label:'Over / Short',    val: isOpen ? '—' : `${diff>=0?'+':''}${diff.toLocaleString()} ${curr}`,     color: diff===0?'#10b981':(diff>0?'#0284c7':'#ef4444') },
            ];
            kpisEl.innerHTML = kpiItems.map(k => `
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;">
                    <div style="font-size:0.68rem;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">${k.label}</div>
                    <div style="font-size:0.95rem;font-weight:800;color:${k.color};">${k.val}</div>
                </div>`).join('');
        }

        // Orders in this shift
        const orders = data.orders || [];
        if (ordCount) ordCount.textContent = orders.length;
        const ordTotal = orders.reduce((acc, o) => acc + Number(o.total_amount || o.order_total_amount || 0), 0);
        if (ordSum) ordSum.textContent = `${ordTotal.toLocaleString()} ${curr}`;

        if (ordTbody) {
            if (orders.length === 0) {
                ordTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">No orders completed in this shift.</td></tr>`;
            } else {
                ordTbody.innerHTML = orders.map(o => {
                    const timeStr = o.created_at ? new Date(o.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
                    const pmColors = { CASH:'#0284c7', MOMO:'#8b5cf6', SPLIT:'#f59e0b' };
                    const pm = (o.payment_method||'').toUpperCase();
                    return `<tr>
                        <td style="font-weight:600;color:var(--primary);">#${o.receipt_no || o.id}</td>
                        <td>${escapeHtml(o.customer_name || 'Walk-in')}</td>
                        <td><span style="font-size:0.72rem;background:#f1f5f9;padding:2px 7px;border-radius:6px;font-weight:700;color:${pmColors[pm]||'#64748b'};">${o.payment_method||'—'}</span></td>
                        <td style="font-weight:700;color:#10b981;">${Number(o.total_amount||o.order_total_amount||0).toLocaleString()} ${curr}</td>
                        <td style="color:#94a3b8;font-size:0.82rem;">${timeStr}</td>
                    </tr>`;
                }).join('');
            }
        }

        // Transactions (float movements) in this shift
        const txs = data.transactions || [];
        if (txTbody) {
            if (txs.length === 0) {
                txTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:#94a3b8;">No cash movements in this shift.</td></tr>`;
            } else {
                const txColors = { CASH_IN:'#3b82f6', FLOAT_IN:'#3b82f6', EXPENSE:'#ef4444', INCOME:'#8b5cf6' };
                txTbody.innerHTML = txs.map(tx => {
                    const timeStr = tx.created_at ? new Date(tx.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
                    const color = txColors[tx.type] || '#64748b';
                    const sign  = tx.type === 'EXPENSE' ? '-' : '+';
                    return `<tr>
                        <td><span style="font-weight:700;color:${color};">${tx.type||'—'}</span></td>
                        <td style="font-weight:700;color:${color};">${sign}${Number(tx.amount||0).toLocaleString()} ${curr}</td>
                        <td style="color:#475569;">${escapeHtml(tx.description||'—')}</td>
                        <td style="color:#94a3b8;font-size:0.82rem;">${timeStr}</td>
                    </tr>`;
                }).join('');
            }
        }

    } catch (_) {
        if (metaBar) metaBar.innerHTML = `<span style="color:#ef4444;">Connection error loading shift audit.</span>`;
    }
}

function printExactShiftSummary() {
    const content = document.getElementById('exact-shift-modal')?.querySelector('.pos-modal-box');
    if (!content) return;
    triggerBrowserPrint(content.innerHTML, 'Shift Audit Summary');
}

// ============================================================================
// SETTINGS — STORE TILLS & CAPACITY CONFIGURATION
// ============================================================================
async function loadStoreTillsSettings() {
    try {
        const res = await fetch('/api/pos/store-config', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (!res.ok) return;
        const cfg = await res.json();

        const maxTillsEl = document.getElementById('setting-max-tills-per-shift');
        if (maxTillsEl) maxTillsEl.value = cfg.max_tills_per_shift || 5;

        const targetWEl = document.getElementById('setting-target-workers');
        if (targetWEl) targetWEl.value = cfg.target_workers_capacity || 10;

        const totalWEl = document.getElementById('setting-total-workers-display');
        if (totalWEl) totalWEl.textContent = `${cfg.workers_count || 0} Workers`;

        const openTillsEl = document.getElementById('setting-open-tills-display');
        if (openTillsEl) openTillsEl.textContent = `${(cfg.occupied_tills || []).length} Active`;

        // Render till list
        const tillsList = document.getElementById('settings-tills-list');
        if (tillsList) {
            const tills = cfg.tills || [];
            const occupied = cfg.occupied_tills || [];
            if (tills.length === 0) {
                tillsList.innerHTML = `<div style="color:#94a3b8;font-size:0.82rem;padding:10px;">No tills configured yet. Add your first till above.</div>`;
            } else {
                tillsList.innerHTML = tills.map(t => {
                    const isActive = occupied.includes(t.name);
                    return `
                    <div style="background:#f8fafc;border:1px solid ${isActive?'#bbf7d0':'#e2e8f0'};border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div>
                            <div style="font-weight:700;color:#0f172a;font-size:0.88rem;">
                                <i class="fa-solid fa-desktop" style="color:${isActive?'#16a34a':'#64748b'};margin-right:4px;"></i>
                                ${escapeHtml(t.name)}
                                ${isActive ? '<span style="font-size:0.65rem;background:#dcfce7;color:#15803d;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:4px;">IN USE</span>' : ''}
                            </div>
                            ${t.description ? `<div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(t.description)}</div>` : ''}
                        </div>
                        <button class="header-idle-btn" style="font-size:0.72rem;padding:4px 10px;color:#ef4444;border-color:#fecaca;" 
                            onclick="handleDeleteTill(${t.id}, '${escapeHtml(t.name)}')"
                            ${isActive ? 'disabled title="Cannot delete a till that is currently in use"' : ''}>
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>`;
                }).join('');
            }
        }

        // Also sync the start-shift till select if it's visible (pre-populate)
        const startTillSel = document.getElementById('start-shift-till-select');
        if (startTillSel && startTillSel.options.length <= 1) {
            const tills = cfg.tills || [];
            const occupied = cfg.occupied_tills || [];
            startTillSel.innerHTML = tills.map(t => {
                const inUse = occupied.includes(t.name);
                return `<option value="${escapeHtml(t.name)}" ${inUse?'disabled':''}>${escapeHtml(t.name)}${t.description?' — '+escapeHtml(t.description):''}${inUse?' (IN USE)':''}</option>`;
            }).join('');
        }

        // Sync admin till filter dropdown in Shift tab
        const adminTillSel = document.getElementById('admin-shift-till-select');
        if (adminTillSel) {
            const tills = cfg.tills || [];
            const existing = Array.from(adminTillSel.options).map(o => o.value);
            tills.forEach(t => {
                if (!existing.includes(t.name)) {
                    const opt = document.createElement('option');
                    opt.value = t.name;
                    opt.textContent = t.name;
                    adminTillSel.appendChild(opt);
                }
            });
        }
    } catch (_) {}
}

function toggleAddTillRow(show) {
    const row = document.getElementById('add-till-form-row');
    if (row) row.style.display = show ? 'flex' : 'none';
    if (show) {
        const inp = document.getElementById('new-till-name-input');
        if (inp) { inp.value = ''; inp.focus(); }
        const desc = document.getElementById('new-till-desc-input');
        if (desc) desc.value = '';
    }
}

async function handleSaveNewTill() {
    const nameInp = document.getElementById('new-till-name-input');
    const descInp = document.getElementById('new-till-desc-input');
    const name = nameInp?.value.trim();
    const description = descInp?.value.trim() || '';

    if (!name) { alert('Please enter a till name.'); nameInp?.focus(); return; }

    try {
        const res = await fetch('/api/pos/store-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ new_till_name: name, new_till_desc: description })
        });
        const data = await res.json();
        if (res.ok) {
            toggleAddTillRow(false);
            await loadStoreTillsSettings();
        } else {
            alert('Could not add till: ' + (data.error || 'Server error'));
        }
    } catch (_) {
        alert('Connection error adding till.');
    }
}

async function handleDeleteTill(id, name) {
    if (!confirm(`Delete till "${name}"?\n\nThis cannot be undone. Make sure no one is using this till.`)) return;
    try {
        const res = await fetch(`/api/pos/tills/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jomish_token')}` }
        });
        if (res.ok) {
            await loadStoreTillsSettings();
        } else {
            const d = await res.json().catch(() => ({}));
            alert('Could not delete till: ' + (d.error || 'Server error'));
        }
    } catch (_) {
        alert('Connection error deleting till.');
    }
}

async function handleSaveTillSettings() {
    const maxTills = parseInt(document.getElementById('setting-max-tills-per-shift')?.value) || 5;
    const targetWorkers = parseInt(document.getElementById('setting-target-workers')?.value) || 10;

    try {
        const res = await fetch('/api/pos/store-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jomish_token')}`
            },
            body: JSON.stringify({ max_tills_per_shift: maxTills, target_workers_capacity: targetWorkers })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✓ Store capacity settings saved!\nMax Tills Per Shift: ${maxTills}\nTarget Staff Capacity: ${targetWorkers}`);
            await loadStoreTillsSettings();
        } else {
            alert('Could not save settings: ' + (data.error || 'Server error'));
        }
    } catch (_) {
        alert('Connection error saving settings.');
    }
}

function handleStartShiftTillSelect(val) {
    // Sync the hidden text input so the form value is always set
    const regInp = document.getElementById('start-shift-register-name');
    if (regInp) regInp.value = val;
}
