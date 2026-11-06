// ================= EDIT THIS =================
// Paste your Apps Script Web app URL here (ends with /exec)
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzH6HSInvwVGMjIaRObZ776HJuiMzr1PHWiiZmbz0qRLqZKyEJjlw1u6k21opOX1Q/exec';
// =============================================

const $ = (id) => document.getElementById(id);
const form = $('form');
const lookupForm = $('lookup');
const STORE_KEY = 'bgyf2026_me';
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;  // 5 MB
const PHOTO_MAX_SIDE = 1600;              // px; plenty for a printed ID, much faster to upload
const REG_FEE = 400;                      // PHP per registrant; keep the same as REG_FEE in Code.gs
const MAX_GROUP = 30;                     // most registrants in one multiple payment

// ---------- small helpers ----------
function show(el, text) {
    if (text !== undefined) el.textContent = text;
    el.hidden = false;
}
function hide(el) { el.hidden = true; }

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function clearErrors(f, alertEl) {
    f.querySelectorAll('.err').forEach((e) => (e.textContent = ''));
    hide(alertEl);
}

function setErrors(f, errors) {
    let first = null;
    for (const [name, msg] of Object.entries(errors)) {
        const slot = f.querySelector(`.err[data-for="${name}"]`);
        if (slot) slot.textContent = msg;
        if (!first) first = f.querySelector(`[name="${name}"]`);
    }
    if (first) first.focus();
}

async function callApi(payload) {
    // text/plain avoids a CORS preflight, which Apps Script doesn't support
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
    });
    return res.json();
}

function churchValue(f) {
    const v = String(new FormData(f).get('local_church') || '').trim();
    return v === '__other' ? String(new FormData(f).get('local_church_other') || '').trim() : v;
}

function wireOther(select, other) {
    select.addEventListener('change', () => {
        const isOther = select.value === '__other';
        other.hidden = !isOther;
        if (isOther) other.focus();
    });
}

// ---------- ID photo ----------
// Sample photo shown until a real one is uploaded, by gender
const SAMPLE_PHOTOS = { Male: 'assets/avatar-male.jpg', Female: 'assets/avatar-female.jpg' };
function samplePhoto(sex) { return SAMPLE_PHOTOS[sex] || ''; }

// Small copies of uploaded photos, kept on this phone so the profile shows them instantly.
// Cleared on log out. On another phone, the photo is fetched once from the Sheet's Drive folder.
const THUMB_KEY = 'bgyf2026_thumbs';
function loadThumbs() { try { return JSON.parse(localStorage.getItem(THUMB_KEY) || '{}'); } catch (e) { return {}; } }
function saveThumb(code, url) {
    const all = loadThumbs();
    all[code] = url;
    try { localStorage.setItem(THUMB_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked: show it this time only */ }
    memThumbs[code] = url;
}
function forgetThumbs() { try { localStorage.removeItem(THUMB_KEY); } catch (e) {} for (const k in memThumbs) delete memThumbs[k]; }
const memThumbs = {};
function cachedThumb(code) { return memThumbs[code] || loadThumbs()[code] || ''; }

async function makeThumb(src, side = 360) {
    const im = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
    });
    const scale = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * scale);
    c.height = Math.round(im.naturalHeight * scale);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
}

const thumbJobs = {};
function fetchThumb(r) {
    if (!thumbJobs[r.reg_code]) {
        thumbJobs[r.reg_code] = callApi({ action: 'thumb', reg_code: r.reg_code, auth_name: r.full_name, auth_church: r.local_church })
            .then(async (out) => {
                if (!out.ok) return '';
                const raw = `data:${out.type};base64,${out.data}`;
                const small = await makeThumb(raw).catch(() => raw);
                saveThumb(r.reg_code, small);
                return small;
            })
            .catch(() => '')
            .finally(() => { delete thumbJobs[r.reg_code]; });
    }
    return thumbJobs[r.reg_code];
}

/** Puts the right picture in an <img>: the real photo if uploaded, otherwise the gender sample. */
function setPhotoImg(img, r, onState) {
    const own = r.has_photo ? cachedThumb(r.reg_code) : '';
    if (own) { img.src = own; onState('own'); return; }
    const sample = samplePhoto(r.sex);
    if (sample) { img.src = sample; onState(r.has_photo ? 'loading' : 'sample'); } else { img.removeAttribute('src'); onState('none'); }
    if (r.has_photo) {
        fetchThumb(r).then((url) => {
            if (url && img.isConnected) { img.src = url; onState('own'); }
            else if (!url) onState(sample ? 'sample-uploaded' : 'none');
        });
    }
}

// Checks the size, shows a preview, and prepares the upload in the background:
// large photos are scaled to 1600 px JPEG so they upload quickly on mobile data.
function photoPicker(inputId, previewId, phId, errName = 'photo', noun = 'photo') {
    const input = $(inputId);
    const img = $(previewId);
    const ph = $(phId);
    const slot = input.form.querySelector(`.err[data-for="${errName}"]`);
    let job = null;
    let url = null;

    function reset() {
        input.value = '';
        job = null;
        if (url) URL.revokeObjectURL(url);
        url = null;
        img.hidden = true;
        img.removeAttribute('src');
        ph.hidden = false;
        ph.querySelector('b').textContent = ph.dataset.label || ph.querySelector('b').textContent;
    }
    ph.dataset.label = ph.querySelector('b').textContent;

    img.addEventListener('error', () => {
        // Some formats (e.g. HEIC on Android) can't be previewed but can still be uploaded
        img.hidden = true;
        ph.hidden = false;
        ph.querySelector('b').textContent = 'Photo selected (no preview)';
    });

    input.addEventListener('change', () => {
        slot.textContent = '';
        const f = input.files && input.files[0];
        if (!f) return reset();
        const isImage = /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name);
        if (!isImage) {
            reset();
            slot.textContent = `Please choose ${noun === 'photo' ? 'a photo' : 'an image'} (JPG or PNG).`;
            return;
        }
        if (f.size > PHOTO_MAX_BYTES) {
            reset();
            slot.textContent = `This ${noun} is ${(f.size / 1048576).toFixed(1)} MB. Please choose one up to 5 MB.`;
            return;
        }
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(f);
        img.src = url;
        img.hidden = false;
        ph.hidden = true;
        job = preparePhoto(f);
    });

    return { get: () => job, reset };
}

function fileToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        const u = URL.createObjectURL(file);
        im.onload = () => { URL.revokeObjectURL(u); resolve(im); };
        im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('decode')); };
        im.src = u;
    });
}

async function preparePhoto(file) {
    try {
        const im = await loadImage(file);
        const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * scale);
        c.height = Math.round(im.naturalHeight * scale);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        if (out && out.size < file.size) return { type: 'image/jpeg', data: await fileToBase64(out) };
    } catch (e) { /* fall back to the original file */ }
    let type = (file.type || '').toLowerCase();
    if (!type && /\.heic$/i.test(file.name)) type = 'image/heic';
    if (!type && /\.heif$/i.test(file.name)) type = 'image/heif';
    return { type: type || 'image/jpeg', data: await fileToBase64(file) };
}

// Saved login on this device (wrapped: storage can be blocked)
function saveMe(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {} }
function loadMe() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
function forgetMe() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

// ---------- tabs ----------
const tabs = {
    register: [$('t-register'), $('tab-register')],
    check: [$('t-check'), $('tab-check')],
    photo: [$('t-photo'), $('tab-photo')],
    pay: [$('t-pay'), $('tab-pay')],
};
function openTab(name) {
    for (const [key, [btn, panel]] of Object.entries(tabs)) {
        const on = key === name;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        panel.hidden = !on;
    }
}
$('t-register').addEventListener('click', () => openTab('register'));
$('t-check').addEventListener('click', () => openTab('check'));
$('t-photo').addEventListener('click', () => openTab('photo'));
$('t-pay').addEventListener('click', () => openTab('pay'));
let afterLogin = null; // tab to return to after logging in

// ================= REGISTER =================
const submitBtn = $('submit');
const church = $('church');
const churchOther = $('church-other');
wireOther(church, churchOther);

function readForm() {
    const f = new FormData(form);
    const t = (k) => String(f.get(k) || '').trim();
    return {
        full_name: t('full_name'),
        age: t('age'),
        sex: t('sex'),
        email: t('email').toLowerCase(),
        local_church: churchValue(form),
        role: t('role'),
        consent: f.get('consent') === '1',
        website: t('website'),
    };
}

function localCheck(d) {
    const e = {};
    if (!d.full_name) e.full_name = 'Please enter your full name.';
    if (!/^\d{1,3}$/.test(d.age) || +d.age < 5 || +d.age > 100) e.age = 'Please enter a valid age (5–100).';
    if (!d.sex) e.sex = 'Please select your sex.';
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Please enter a valid email address, or leave it blank.';
    if (!d.local_church) e.local_church = 'Please select or type your local church.';
    if (!d.role) e.role = 'Please select your role.';
    if (!d.consent) e.consent = 'Please agree to the data privacy notice.';
    return e;
}

form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(form, $('alert'));
    const data = readForm();
    const errs = localCheck(data);
    if (Object.keys(errs).length) return setErrors(form, errs);

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
        const out = await callApi(data);
        if (out.ok) {
            $('s-name').textContent = out.full_name;
            $('s-code').textContent = out.reg_code;
            saveMe([{ reg_code: out.reg_code, full_name: out.full_name, sex: data.sex, local_church: data.local_church, role: data.role, registered_at: 'Just now', has_photo: !!out.has_photo }]);
            renderMe();
            hide(form);
            show($('success'));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (out.errors) {
            setErrors(form, out.errors);
        } else {
            show($('alert'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('alert'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Register';
    }
});

$('again').addEventListener('click', () => {
    form.reset();
    churchOther.hidden = true;
    clearErrors(form, $('alert'));
    hide($('success'));
    show(form);
});

$('see-program').addEventListener('click', () => {
    openTab('check');
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('go-photo').addEventListener('click', () => {
    openTab('photo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ================= LOGIN / CHECK =================
const lChurch = $('l-church');
const lChurchOther = $('l-church-other');
lChurch.innerHTML = church.innerHTML; // same church list as the registration form
lChurch.selectedIndex = 0;
wireOther(lChurch, lChurchOther);

lookupForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(lookupForm, $('l-alert'));
    const payload = {
        action: 'lookup',
        full_name: String(new FormData(lookupForm).get('full_name') || '').trim(),
        local_church: churchValue(lookupForm),
    };
    const errs = {};
    if (!payload.full_name) errs.full_name = 'Please enter your full name.';
    if (!payload.local_church) errs.local_church = 'Please select or type your local church.';
    if (Object.keys(errs).length) return setErrors(lookupForm, errs);

    const btn = $('l-submit');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
        const out = await callApi(payload);
        if (out.ok) {
            saveMe(out.results);
            renderMe();
            lookupForm.reset();
            lChurchOther.hidden = true;
            if (afterLogin) {
                openTab(afterLogin);
                afterLogin = null;
            }
        } else if (out.errors) {
            setErrors(lookupForm, out.errors);
        } else if (out.notFound) {
            show($('l-alert'), "We couldn't find a registration with that name and church. Check the spelling, or register first.");
        } else {
            show($('l-alert'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('l-alert'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Log in';
    }
});

$('logout').addEventListener('click', () => {
    forgetMe();
    forgetThumbs();
    closeEdit();
    hide($('saved'));
    renderMe();
});

// ================= EDIT PROFILE =================
// Editing opens straight from the logged-in pass card: the server checks
// that the reg code still belongs to the name + church on this device.
const editForm = $('editform');
const eChurch = $('e-church');
const eChurchOther = $('e-church-other');
let editing = null; // { reg_code, auth_name, auth_church }

// Reuse the registration form's choices so the lists never drift apart
$('e-gender').innerHTML = form.querySelector('.seg').innerHTML;
$('e-role').innerHTML = form.querySelector('.roles').innerHTML;
eChurch.innerHTML = church.innerHTML;
wireOther(eChurch, eChurchOther);

async function startEdit(rec, btn) {
    hide($('saved'));
    clearErrors(editForm, $('e-alert'));
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
        const auth = { reg_code: rec.reg_code, auth_name: rec.full_name, auth_church: rec.local_church };
        const out = await callApi(Object.assign({ action: 'profile' }, auth));
        if (out.ok) {
            editing = auth;
            $('edit-for').textContent = `${rec.full_name} · ${rec.reg_code}`;
            fillEdit(out.profile);
            show($('edit'));
            $('edit').scrollIntoView({ behavior: 'smooth', block: 'start' });
            editForm.full_name.focus({ preventScroll: true });
        } else {
            show($('saved'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('saved'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Edit profile';
    }
}

function closeEdit() {
    editing = null;
    hide($('edit'));
}

document.querySelectorAll('#edit [data-cancel]').forEach((b) => b.addEventListener('click', closeEdit));

function fillEdit(p) {
    editForm.reset();
    editForm.full_name.value = p.full_name;
    editForm.age.value = p.age;
    editForm.email.value = p.email || '';
    editForm.querySelectorAll('[name=sex]').forEach((i) => (i.checked = i.value === p.sex));
    editForm.querySelectorAll('[name=role]').forEach((i) => (i.checked = i.value === p.role));
    const listed = [...eChurch.options].some((o) => o.value === p.local_church);
    eChurch.value = listed ? p.local_church : '__other';
    eChurchOther.value = listed ? '' : p.local_church;
    eChurchOther.hidden = listed;
}

editForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(editForm, $('e-alert'));
    const f = new FormData(editForm);
    const t = (k) => String(f.get(k) || '').trim();
    const data = {
        full_name: t('full_name'),
        age: t('age'),
        sex: t('sex'),
        email: t('email').toLowerCase(),
        local_church: churchValue(editForm),
        role: t('role'),
        consent: true,
    };
    const errs = localCheck(data);
    if (Object.keys(errs).length) return setErrors(editForm, errs);

    const btn = $('e-submit');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        const out = await callApi(Object.assign({ action: 'update' }, editing, data));
        if (out.ok) {
            const me = (loadMe() || []).map((r) => (r.reg_code === out.result.reg_code ? out.result : r));
            saveMe(me);
            closeEdit();
            renderMe();
            show($('saved'), 'Your profile was updated.');
            $('me').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (out.errors) {
            setErrors(editForm, out.errors);
        } else {
            show($('e-alert'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('e-alert'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save changes';
    }
});

function payLabel(st) {
    if (st === 'Verified') return 'Paid';
    if (st === 'Pending') return 'Pending verification';
    if (st === 'Rejected') return 'Not accepted, please pay again';
    return 'Not paid';
}

function renderMe() {
    renderPhotoTab();
    prefillPayCodes();
    const me = loadMe();
    const cards = $('me-cards');
    cards.replaceChildren();
    if (!me || !me.length) {
        hide($('me'));
        show(lookupForm);
        return;
    }
    me.forEach((r) => {
        const c = el('div', 'pass');
        if (r.has_photo || samplePhoto(r.sex)) {
            const fig = el('div', 'pass-avatar');
            const im = el('img');
            const tag = el('span', '', '');
            fig.append(im, tag);
            setPhotoImg(im, r, (state) => {
                im.alt = state === 'own' ? `${r.full_name}'s ID photo` : 'Sample photo';
                fig.classList.toggle('own', state === 'own');
                fig.classList.toggle('loading', state === 'loading');
                tag.textContent = state === 'sample' ? 'Sample' : state === 'loading' ? 'Loading…' : '';
                tag.hidden = !tag.textContent;
            });
            c.append(fig);
        }
        c.append(el('p', 'kicker', 'Registered'));
        c.append(el('p', 'pass-name', r.full_name));
        c.append(el('p', 'code', r.reg_code));
        const dl = el('dl', 'pass-meta');
        [['Church', r.local_church], ['Role', r.role], ['Registered', r.registered_at], ['ID photo', r.has_photo ? 'Uploaded' : 'Missing'], ['Payment', payLabel(r.payment)]].forEach(([k, v]) => {
            const d = el('div');
            const warn = (k === 'ID photo' && !r.has_photo) || (k === 'Payment' && r.payment !== 'Verified');
            d.append(el('dt', '', k), el('dd', (warn ? 'missing' : '') + (k === 'Payment' && r.payment === 'Verified' ? ' paid' : ''), v));
            dl.append(d);
        });
        c.append(dl);
        const editBtn = el('button', 'btn small-dark', 'Edit profile');
        editBtn.type = 'button';
        editBtn.addEventListener('click', () => startEdit(r, editBtn));
        const actions = el('div', 'pass-actions');
        if (!r.has_photo) {
            const photoBtn = el('button', 'btn small-dark accent', 'Upload ID photo');
            photoBtn.type = 'button';
            photoBtn.addEventListener('click', () => openTab('photo'));
            actions.append(photoBtn);
        }
        if (r.payment !== 'Verified' && r.payment !== 'Pending') {
            const payBtn = el('button', 'btn small-dark accent', `Pay ₱${REG_FEE}`);
            payBtn.type = 'button';
            payBtn.addEventListener('click', () => openTab('pay'));
            actions.append(payBtn);
        }
        actions.append(editBtn);
        c.append(actions);
        cards.append(c);
    });
    if (me.length > 1) cards.prepend(el('p', 'hint left', `${me.length} registrations match this name and church.`));
    hide(lookupForm);
    show($('me'));
}

// ================= ID PHOTO TAB =================
const photoForm = $('photoform');
const tabPhoto = photoPicker('photo', 'photo-preview', 'photo-ph');
const phWho = $('ph-who');

$('ph-login').addEventListener('click', () => {
    afterLogin = 'photo';
    openTab('check');
    lookupForm.querySelector('input').focus();
});
$('ph-register').addEventListener('click', () => openTab('register'));

function photoTarget() {
    const me = loadMe() || [];
    return me.find((r) => r.reg_code === phWho.value) || me[0] || null;
}

let shownCode = null;
function showPhotoTarget() {
    const r = photoTarget();
    if (!r) return;
    if (r.reg_code !== shownCode) {
        // a different person: clear the last person's messages and chosen file
        shownCode = r.reg_code;
        resetBadge();
        hide($('ph-saved'));
        clearErrors(photoForm, $('ph-alert'));
        tabPhoto.reset();
    }
    $('ph-name').textContent = r.full_name;
    $('ph-code').textContent = `${r.reg_code} · ${r.local_church}`;
    const st = $('ph-status');
    st.textContent = r.has_photo
        ? 'Your ID photo is uploaded. Upload a new one only if you want to replace it.'
        : 'No ID photo yet.';
    st.classList.toggle('missing', !r.has_photo);
    st.classList.toggle('done', !!r.has_photo);
    $('ph-submit').textContent = r.has_photo ? 'Replace photo' : 'Upload photo';
    $('badge-box').hidden = false;
    $('badge-need').hidden = !!r.has_photo;
    $('badge-make').disabled = !r.has_photo;
    const sample = $('photo-sample');
    const box = sample.closest('.photo-pick');
    const label = $('photo-ph').querySelector('b');
    setPhotoImg(sample, r, (state) => {
        sample.hidden = state === 'none';
        box.classList.toggle('with-sample', state !== 'none');
        box.classList.toggle('current', state === 'own');
        label.textContent = state === 'own' ? 'Tap to replace your photo' : 'Take a selfie or choose a photo';
        $('photo-ph').dataset.label = label.textContent;
    });
}

function renderPhotoTab() {
    const me = loadMe() || [];
    if (!me.length) {
        shownCode = null;
        show($('ph-out'));
        hide(photoForm);
        hide($('badge-box'));
        return;
    }
    hide($('ph-out'));
    show(photoForm);
    const keep = phWho.value;
    phWho.replaceChildren();
    me.forEach((r) => {
        const o = el('option', '', `${r.full_name} · ${r.reg_code}`);
        o.value = r.reg_code;
        phWho.append(o);
    });
    if (me.some((r) => r.reg_code === keep)) phWho.value = keep;
    $('ph-who-wrap').hidden = me.length < 2;
    showPhotoTarget();
}

phWho.addEventListener('change', () => {
    hide($('ph-saved'));
    showPhotoTarget();
});

photoForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(photoForm, $('ph-alert'));
    hide($('ph-saved'));
    const r = photoTarget();
    const job = tabPhoto.get();
    if (!job) return setErrors(photoForm, { photo: 'Please choose a photo first.' });

    const btn = $('ph-submit');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing photo…';
    try {
        const photo = await job;
        btn.textContent = 'Uploading…';
        const out = await callApi({ action: 'photo', reg_code: r.reg_code, auth_name: r.full_name, auth_church: r.local_church, photo });
        if (out.ok) {
            const small = await makeThumb(`data:${photo.type};base64,${photo.data}`).catch(() => '');
            if (small) saveThumb(out.result.reg_code, small);
            resetBadge();
            saveMe((loadMe() || []).map((x) => (x.reg_code === out.result.reg_code ? out.result : x)));
            tabPhoto.reset();
            renderMe();
            show($('ph-saved'), out.replaced ? 'Your new ID photo replaced the old one.' : 'Your ID photo was uploaded. Thank you!');
        } else if (out.errors) {
            setErrors(photoForm, out.errors);
        } else {
            show($('ph-alert'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('ph-alert'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        if (btn.textContent === 'Uploading…' || btn.textContent === 'Preparing photo…') btn.textContent = label;
        showPhotoTarget();
    }
});

// ================= PROGRAM =================
function renderDay(i) {
    $('daytabs').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', i === j ? 'true' : 'false'));
    const list = $('timeline');
    list.replaceChildren();
    PROGRAM[i].items.forEach((it) => {
        const li = el('li', it.highlight ? 'hl' : '');
        li.append(el('span', 'time', it.time));
        const body = el('div', 'tl-body');
        body.append(el('p', 'tl-title', it.title));
        if (it.by) body.append(el('p', 'tl-by', it.by));
        if (it.details) {
            const det = el('details');
            det.append(el('summary', '', 'Details'));
            const ul = el('ul');
            it.details.forEach((d) => {
                if (typeof d === 'string') return ul.append(el('li', '', d));
                const sub = el('li', '', d.label);
                const inner = el('ul');
                d.items.forEach((x) => inner.append(el('li', '', x)));
                sub.append(inner);
                ul.append(sub);
            });
            det.append(ul);
            body.append(det);
        }
        li.append(body);
        list.append(li);
    });
}

function initProgram() {
    $('prog-updated').textContent = PROGRAM_UPDATED;
    const bar = $('daytabs');
    PROGRAM.forEach((d, i) => {
        const b = el('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.append(el('b', '', d.day), el('span', '', d.date));
        b.addEventListener('click', () => renderDay(i));
        bar.append(b);
    });
    // Open today's day during the event, otherwise Day 1
    const today = new Date();
    const start = new Date(2026, 11, 27);
    const diff = Math.floor((today - start) / 86400000);
    renderDay(diff >= 0 && diff < PROGRAM.length ? diff : 0);
}


// Check whether registration is still open
fetch(SCRIPT_URL)
    .then((r) => r.json())
    .then((st) => {
        if (st && st.open === false) {
            hide(form);
            show($('notice'), st.message);
        }
    })
    .catch(() => {});

// ================= PAYMENT TAB =================
const payForm = $('payform');
const payCodes = $('pay-codes');
const payCount = $('pay-count');
const payReceipt = photoPicker('pay-receipt', 'pay-preview', 'pay-ph', 'receipt', 'receipt');
const peso = (n) => '₱' + n.toLocaleString('en-PH');

function payType() {
    return payForm.querySelector('[name=pay_type]:checked').value;
}

function payN() {
    if (payType() === 'single') return 1;
    const n = Math.floor(Number(payCount.value));
    return n >= 2 && n <= MAX_GROUP ? n : 0;
}

function renderPayCodes() {
    const n = payN() || (payType() === 'single' ? 1 : 2);
    const keep = [...payCodes.querySelectorAll('input')].map((i) => i.value);
    const keepAuto = payCodes.querySelector('input')?.dataset.auto === '1';
    payCodes.replaceChildren();
    for (let i = 0; i < n; i++) {
        const inp = el('input');
        inp.type = 'text';
        inp.name = 'codes';
        inp.inputMode = 'numeric';
        inp.maxLength = 12;
        inp.autocomplete = 'off';
        inp.placeholder = n > 1 ? `Code of registrant ${i + 1}` : 'e.g. 482915';
        inp.setAttribute('aria-label', n > 1 ? `Registration code ${i + 1}` : 'Registration code');
        inp.value = keep[i] || '';
        if (i === 0 && keepAuto) inp.dataset.auto = '1';
        payCodes.append(inp);
    }
    payCodes.classList.toggle('many', n > 1);
    $('pay-codes-label').textContent = n > 1 ? 'Registration codes' : 'Registration code';
    $('pay-codes-hint').textContent = n > 1
        ? 'Enter the 6-digit code from each person\'s pass card. Each person must register first.'
        : 'The 6-digit code on the pass card.';
    prefillPayCodes();
    updateDue();
}

/** Puts the logged-in person's code in the first box, unless the person typed something there. */
function prefillPayCodes() {
    const first = payCodes.querySelector('input');
    if (!first || (first.value && first.dataset.auto !== '1')) return;
    const mine = (loadMe() || []).find((r) => r.payment !== 'Verified' && r.payment !== 'Pending');
    first.value = mine ? String(mine.reg_code) : '';
    first.dataset.auto = mine ? '1' : '';
    if (!first.dataset.watch) {
        first.dataset.watch = '1';
        first.addEventListener('input', () => { first.dataset.auto = ''; });
    }
}

function updateDue() {
    const n = payN();
    $('pay-due').textContent = n ? peso(REG_FEE * n) : '—';
    $('pay-due-note').textContent = n ? `${n} registrant${n > 1 ? 's' : ''} × ${peso(REG_FEE)}` : `Enter 2 to ${MAX_GROUP} registrants`;
}

payForm.querySelectorAll('[name=pay_type]').forEach((r) => r.addEventListener('change', () => {
    $('pay-count-wrap').hidden = payType() === 'single';
    clearErrors(payForm, $('pay-alert'));
    renderPayCodes();
}));
payCount.addEventListener('input', () => {
    updateDue();
    if (payN()) renderPayCodes();
});

payForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(payForm, $('pay-alert'));
    const multiple = payType() === 'multiple';
    const n = payN();
    const codes = [...payCodes.querySelectorAll('input')].map((i) => i.value.replace(/\s+/g, '').toUpperCase());
    const ref = $('pay-ref').value.replace(/[\s-]/g, '').toUpperCase();
    const job = payReceipt.get();
    const errs = {};
    if (multiple && !n) errs.count = `Enter the number of registrants (2 to ${MAX_GROUP}).`;
    else if (codes.some((c) => !c)) errs.codes = n > 1 ? 'Please enter a registration code for every registrant.' : 'Please enter your registration code.';
    else {
        const twice = codes.find((c, i) => codes.indexOf(c) !== i);
        if (twice) errs.codes = `Code ${twice} is entered more than once.`;
    }
    if (!job) errs.receipt = 'Please upload a screenshot of your GCash receipt.';
    if (!/^[0-9A-Z]{6,20}$/.test(ref)) errs.ref = 'Enter the Reference No. exactly as it appears on your receipt.';
    if (Object.keys(errs).length) return setErrors(payForm, errs);

    const btn = $('pay-submit');
    btn.disabled = true;
    btn.textContent = 'Preparing receipt…';
    try {
        const receipt = await job;
        btn.textContent = 'Sending…';
        const out = await callApi({ action: 'pay', pay_type: multiple ? 'multiple' : 'single', count: n, codes, ref, receipt });
        if (out.ok) {
            $('pd-ref').textContent = out.ref;
            $('pd-amount').textContent = peso(out.amount);
            const list = $('pd-people');
            list.replaceChildren();
            out.people.forEach((p) => {
                const li = el('li');
                li.append(el('b', '', p.full_name), el('span', '', p.reg_code));
                list.append(li);
            });
            const paid = new Set(out.people.map((p) => String(p.reg_code)));
            saveMe((loadMe() || []).map((r) => (paid.has(String(r.reg_code)) ? Object.assign({}, r, { payment: 'Pending' }) : r)));
            renderMe();
            hide(payForm);
            show($('pay-done'));
            $('tab-pay').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (out.errors) {
            setErrors(payForm, out.errors);
        } else {
            show($('pay-alert'), out.error || 'Something went wrong. Please try again.');
        }
    } catch (err) {
        show($('pay-alert'), 'Could not reach the server. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit payment';
    }
});

$('pay-again').addEventListener('click', () => {
    payForm.reset();
    payReceipt.reset();
    payCodes.replaceChildren();
    $('pay-count-wrap').hidden = true;
    hide($('pay-done'));
    show(payForm);
    renderPayCodes();
});

renderPayCodes();


// ================= EVENT BADGE =================
// Drawn on this phone at 2.25 x 3.5 in, 300 dpi. Nothing is uploaded or saved online.
const BADGE_W = 675;
const BADGE_H = 1050;
const ROLE_COLORS = {
    'Youth Delegate': ['#ee7a22', '#1c1c1c'],
    'Pastor': ['#1c1c1c', '#f6cb4c'],
    'BGYF Officer': ['#b8321f', '#f6f1dd'],
    'Workers': ['#1f4e79', '#f6f1dd'],
    'Church Member/Volunteer': ['#2e7d4f', '#f6f1dd'],
};
let badgeUrl = null;

function resetBadge() {
    if (badgeUrl) URL.revokeObjectURL(badgeUrl);
    badgeUrl = null;
    hide($('badge-out'));
    hide($('badge-alert'));
}

function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Largest font size (down to min) at which text fits maxW; returns lines (1 or 2). */
function fitText(ctx, text, weight, max, min, maxW) {
    for (let size = max; size >= min; size -= 2) {
        ctx.font = `${weight} ${size}px Outfit, system-ui, sans-serif`;
        if (ctx.measureText(text).width <= maxW) return { size, lines: [text] };
    }
    // two lines: split at the space that balances the lines best
    const words = text.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ');
        const b = words.slice(i).join(' ');
        for (let size = max; size >= min; size -= 2) {
            ctx.font = `${weight} ${size}px Outfit, system-ui, sans-serif`;
            if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= maxW) {
                if (!best || size > best.size) best = { size, lines: [a, b] };
                break;
            }
        }
    }
    if (best) return best;
    ctx.font = `${weight} ${min}px Outfit, system-ui, sans-serif`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return { size: min, lines: [t + '…'] };
}

function drawBadge(r, photo) {
    const c = document.createElement('canvas');
    c.width = BADGE_W;
    c.height = BADGE_H;
    const ctx = c.getContext('2d');
    const W = BADGE_W;
    const cx = W / 2;

    // card
    ctx.fillStyle = '#f6f1dd';
    ctx.fillRect(0, 0, W, BADGE_H);

    // header: sunset gradient + halftone dots, like the poster
    const HEAD = 430;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, HEAD);
    g.addColorStop(0, '#e8641c');
    g.addColorStop(0.55, '#ee7a22');
    g.addColorStop(1, '#f6b23b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HEAD);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, HEAD);
    ctx.clip();
    for (let y = 6; y < HEAD; y += 14) {
        for (let x = (y / 14) % 2 ? 13 : 6; x < W; x += 14) {
            const d = Math.hypot(x - W * 0.72, y - 120) / 520;   // dots fade out from the "sun"
            const rad = 3.2 * Math.max(0, 1 - d);
            if (rad < 0.4) continue;
            ctx.fillStyle = 'rgba(246, 203, 76, 0.55)';
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // lanyard slot
    ctx.fillStyle = 'rgba(28, 28, 28, 0.18)';
    rrect(ctx, cx - 70, 34, 140, 26, 13);
    ctx.fill();

    ctx.fillStyle = '#fffaf0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 21px Outfit, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
    ctx.fillText('BICOL GRACE YOUTH FELLOWSHIP', cx, 108);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const title = fitText(ctx, 'NO TURNING', 800, 90, 64, W - 110);
    ctx.font = `800 ${title.size}px Outfit, system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowOffsetY = 4;
    ctx.shadowBlur = 8;
    ctx.fillText('NO TURNING', cx, 200);
    ctx.fillText('BACK', cx, 288);
    ctx.shadowColor = 'transparent';
    ctx.font = '600 24px Outfit, system-ui, sans-serif';
    ctx.fillStyle = '#1c1c1c';
    ctx.fillText('DEC 27–30, 2026  ·  BGYF 2026', cx, 334);

    // photo, framed, overlapping the header
    const PW = 268, PH = 357, PX = cx - PW / 2, PY = 362;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fffaf0';
    rrect(ctx, PX - 10, PY - 10, PW + 20, PH + 20, 22);
    ctx.fill();
    ctx.restore();
    ctx.save();
    rrect(ctx, PX, PY, PW, PH, 14);
    ctx.clip();
    const iw = photo.naturalWidth, ih = photo.naturalHeight;
    const scale = Math.max(PW / iw, PH / ih);   // cover the frame, crop the overflow
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(photo, PX + (PW - dw) / 2, PY + (PH - dh) * 0.35, dw, dh);
    ctx.restore();

    // name (1 or 2 lines, shrinks to fit)
    ctx.fillStyle = '#1c1c1c';
    let name = fitText(ctx, String(r.full_name).toUpperCase(), 800, 58, 36, W - 80);
    if (name.lines.length === 2) name = fitText(ctx, String(r.full_name).toUpperCase(), 800, 44, 32, W - 80);
    ctx.font = `800 ${name.size}px Outfit, system-ui, sans-serif`;
    const two = name.lines.length === 2;
    let y = two ? 782 : 796;
    name.lines.forEach((line, i) => ctx.fillText(line, cx, y + i * (name.size + 6)));
    y += (name.lines.length - 1) * (name.size + 6);

    // church
    const ch = fitText(ctx, String(r.local_church), 500, 30, 22, W - 80);
    ctx.font = `500 ${ch.size}px Outfit, system-ui, sans-serif`;
    ctx.fillStyle = '#6d6658';
    ctx.fillText(ch.lines[0], cx, y + (two ? 40 : 46));

    // role band
    const [bg, fg] = ROLE_COLORS[r.role] || ['#ee7a22', '#1c1c1c'];
    const BAND = 900;
    ctx.fillStyle = bg;
    ctx.fillRect(0, BAND, W, 76);
    ctx.fillStyle = fg;
    const role = fitText(ctx, String(r.role).toUpperCase(), 800, 40, 26, W - 60);
    ctx.font = `800 ${role.size}px Outfit, system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText(role.lines[0], cx, BAND + 52);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    // road strip with the registration no.
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, BAND + 76, W, BADGE_H - BAND - 76);
    ctx.fillStyle = '#f6f1dd';
    ctx.font = '600 18px Outfit, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillText('REG. NO.', cx - 120, BAND + 122);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = '700 38px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(String(r.reg_code), cx + 60, BAND + 125);
    ctx.fillStyle = 'rgba(246, 241, 221, 0.6)';
    for (let x = 18; x < W; x += 44) ctx.fillRect(x, BADGE_H - 14, 26, 4);   // lane markings

    return c;
}

async function badgePhoto(r) {
    const out = await callApi({ action: 'thumb', reg_code: r.reg_code, auth_name: r.full_name, auth_church: r.local_church });
    if (!out.ok) throw new Error('nophoto');
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('decode'));
        im.src = `data:${out.type};base64,${out.data}`;
    });
}

$('badge-make').addEventListener('click', async () => {
    const r = photoTarget();
    if (!r || !r.has_photo) return;
    const btn = $('badge-make');
    resetBadge();
    btn.disabled = true;
    btn.textContent = 'Making your badge…';
    try {
        const [photo] = await Promise.all([
            badgePhoto(r),
            document.fonts ? Promise.all(['800 40px Outfit', '600 20px Outfit', '500 20px Outfit'].map((f) => document.fonts.load(f))).catch(() => {}) : null,
        ]);
        const canvas = drawBadge(r, photo);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        badgeUrl = URL.createObjectURL(blob);
        $('badge-img').src = badgeUrl;
        const dl = $('badge-dl');
        dl.href = badgeUrl;
        dl.download = `${String(r.full_name).replace(/[\\/:*?"<>|]+/g, '').trim()} - ${r.reg_code} badge.png`;
        show($('badge-out'));
        $('badge-out').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
        show($('badge-alert'), err.message === 'nophoto'
            ? "We couldn't find your uploaded photo. Upload it again, then try once more."
            : 'Could not make the badge. Check your internet connection and try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Make my event badge';
    }
});

// ---------- start ----------
initProgram();
renderMe();
