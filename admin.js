// Admin page: statistics + event badges. Data comes from Apps Script only after the admin password.
// SCRIPT_URL is in config.js; the badge drawing (drawBadge) is in badge.js.

const $ = (id) => document.getElementById(id);
const PW_KEY = 'bgyf2026_admin_pw';   // kept for this browser tab only (sessionStorage)
const ROLES = ['Youth Delegate', 'Pastor', 'BGYF Officer', 'Workers', 'Church Member/Volunteer'];
const SAMPLE_PHOTOS = { Male: 'assets/avatar-male.jpg', Female: 'assets/avatar-female.jpg' };
const TEAMS = ['Red', 'Blue', 'Yellow', 'Green'];
const TEAM_ROLE = 'Youth Delegate';

let DATA = null;
let password = '';
const photoCache = new Map();   // reg_code -> HTMLImageElement

// ---------- helpers ----------
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

async function api(payload) {
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: 'admin', password }, payload)),
    });
    return res.json();
}

function savePw(v) { try { if (v) sessionStorage.setItem(PW_KEY, v); else sessionStorage.removeItem(PW_KEY); } catch (e) {} }
function loadPw() { try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; } }

function payLabel(st) {
    if (st === 'Verified') return 'Paid';
    if (st === 'Pending') return 'Pending';
    if (st === 'Rejected') return 'Rejected';
    if (st === 'Over the counter') return 'Cash due';
    return 'Not paid';
}

// ---------- login ----------
$('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-alert').hidden = true;
    password = $('pw').value;
    if (!password) return;
    await load($('login-btn'));
});

$('logout').addEventListener('click', () => {
    password = '';
    savePw('');
    DATA = null;
    photoCache.clear();
    $('rows').replaceChildren();
    $('dash').hidden = true;
    $('login').hidden = false;
    $('pw').value = '';
});

$('refresh').addEventListener('click', () => load($('refresh')));

async function load(btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
        const out = await api({ op: 'data' });
        if (!out.ok) {
            savePw('');
            $('dash').hidden = true;
            $('login').hidden = false;
            $('login-alert').textContent = out.error || 'Could not log in.';
            $('login-alert').hidden = false;
            return;
        }
        savePw(password);
        DATA = out;
        $('login').hidden = true;
        $('dash').hidden = false;
        render();
    } catch (err) {
        $('login-alert').textContent = 'Could not reach the server. Check your internet connection.';
        $('login-alert').hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

// ---------- statistics ----------
function count(list, key) {
    const m = new Map();
    list.forEach((x) => { const k = key(x); m.set(k, (m.get(k) || 0) + 1); });
    return m;
}

/** Horizontal bar list: label, bar, value. One series, so one colour and no legend. */
function bars(target, items, total, opts = {}) {
    const box = $(target);
    box.replaceChildren();
    const max = Math.max(1, ...items.map((i) => i.n));
    if (!items.length) { box.append(el('p', 'panel-note', 'No registrants yet.')); return; }
    items.forEach((i) => {
        const row = el('div', 'bar-row' + (i.cls ? ' ' + i.cls : ''));
        const label = el('span', 'bar-label', i.label);
        const track = el('span', 'bar-track');
        const fill = el('span', 'bar-fill');
        fill.style.width = (i.n / max) * 100 + '%';
        track.append(fill);
        const val = el('span', 'bar-val');
        val.append(el('b', '', String(i.n)));
        if (total && !opts.noPct) val.append(el('small', '', ` ${pct(i.n, total)}%`));
        row.title = `${i.label}: ${i.n}${total ? ` (${pct(i.n, total)}%)` : ''}`;
        row.append(label, track, val);
        box.append(row);
    });
}

function kpi(label, value, sub, cls) {
    const t = el('div', 'kpi' + (cls ? ' ' + cls : ''));
    t.append(el('span', 'kpi-label', label), el('b', 'kpi-val', value));
    if (sub) t.append(el('span', 'kpi-sub', sub));
    return t;
}

function render() {
    const R = DATA.registrants;
    const P = DATA.payments;
    const total = R.length;
    const paid = R.filter((r) => r.payment === 'Verified').length;
    const pending = R.filter((r) => r.payment === 'Pending').length;
    const photos = R.filter((r) => r.has_photo).length;
    const collected = P.filter((p) => p.status === 'Verified').reduce((a, p) => a + p.amount, 0);
    const cash = P.filter((p) => p.status === 'Verified' && p.method === 'Over the counter').reduce((a, p) => a + p.amount, 0);
    const otc = R.filter((r) => r.payment === 'Over the counter').length;
    const pendingAmt = P.filter((p) => p.status === 'Pending').reduce((a, p) => a + p.amount, 0);
    const churches = new Set(R.map((r) => r.local_church.trim().toLowerCase()).filter(Boolean)).size;

    $('updated').textContent = 'Updated ' + new Date(DATA.generated_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

    const k = $('kpis');
    k.replaceChildren(
        kpi('Registrants', String(total), `${churches} church${churches === 1 ? '' : 'es'}`, 'lead'),
        kpi('Paid', String(paid), `${pct(paid, total)}% of registrants`, 'good'),
        kpi('Pending verification', String(pending), pendingAmt ? `${peso(pendingAmt)} to check` : 'Nothing to check', pending ? 'warn' : ''),
        kpi('Not paid', String(total - paid - pending), `${peso((total - paid - pending) * DATA.fee)} expected` + (otc ? ` · ${otc} paying in cash` : '')),
        kpi('Collected', peso(collected), `${peso(collected - cash)} GCash · ${peso(cash)} cash`),
        kpi('With ID photo', String(photos), `${total - photos} still missing`),
    );

    const byRole = count(R, (r) => r.role);
    bars('by-role', ROLES.map((r) => ({ label: r, n: byRole.get(r) || 0 })), total);

    const groups = [['Under 13', (a) => a < 13], ['13–15', (a) => a >= 13 && a <= 15], ['16–18', (a) => a >= 16 && a <= 18], ['19 and up', (a) => a >= 19]];
    bars('by-age', groups.map(([label, f]) => ({ label, n: R.filter((r) => r.age && f(r.age)).length })).filter((g, i) => i > 0 || g.n), total);

    const bySex = count(R, (r) => r.sex);
    bars('by-sex', ['Male', 'Female'].map((s) => ({ label: s, n: bySex.get(s) || 0 })), total);

    bars('by-pay', [
        { label: 'Paid', n: paid, cls: 'good' },
        { label: 'Pending verification', n: pending, cls: 'warn' },
        { label: 'Paying over the counter', n: otc, cls: 'otc' },
        { label: 'Not paid', n: R.filter((r) => !r.payment).length, cls: 'muted' },
        { label: 'Rejected', n: R.filter((r) => r.payment === 'Rejected').length, cls: 'bad' },
    ].filter((x) => x.n || x.label !== 'Rejected'), total);
    const waiting = P.filter((p) => p.status === 'Pending').length;
    $('pay-note').textContent = waiting
        ? `${waiting} payment${waiting === 1 ? '' : 's'} (${pending} registrant${pending === 1 ? '' : 's'}) waiting. Verify them in the Payments tab of the Sheet.`
        : 'No payments waiting for verification.';

    const byChurch = new Map();
    R.forEach((r) => {
        const key = r.local_church.trim().toLowerCase();
        if (!byChurch.has(key)) byChurch.set(key, { label: r.local_church.trim(), n: 0 });
        byChurch.get(key).n += 1;
    });
    bars('by-church', [...byChurch.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)), total);

    renderDays(R);
    renderTeams();
    fillFilters(R);
    renderTable();
}

// ---------- teams ----------
function renderTeams() {
    const dels = DATA.registrants.filter((r) => r.role === TEAM_ROLE);
    const none = dels.filter((r) => !r.team).length;
    const box = $('team-tiles');
    box.replaceChildren();
    const sizes = TEAMS.map((t) => dels.filter((r) => r.team === t).length);
    TEAMS.forEach((t, i) => {
        const members = dels.filter((r) => r.team === t);
        const tile = el('div', 'team-tile team-' + t.toLowerCase());
        tile.append(el('span', 'team-name', `${t} team`), el('b', 'kpi-val', String(sizes[i])));
        const m = members.filter((r) => r.sex === 'Male').length;
        tile.append(el('span', 'kpi-sub', members.length ? `${m} male · ${members.length - m} female` : 'No one yet'));
        box.append(tile);
    });
    const spread = Math.max(...sizes) - Math.min(...sizes);
    $('teams-note').textContent = `${dels.length} Youth Delegates · ${none ? `${none} without a team` : 'everyone has a team'}`
        + (dels.length - none && spread > 1 ? ` · team sizes differ by ${spread}` : '');
    $('assign-new').disabled = !none;
    $('assign-all').disabled = !dels.length;
    $('teams-visible').checked = !!DATA.teams_visible;
}

async function teamOp(payload, btn, busyText, doneText) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = busyText; }
    $('team-status').textContent = '';
    try {
        const out = await api(payload);
        if (!out.ok) throw new Error(out.error || 'failed');
        DATA = Object.assign(DATA, out);
        render();
        $('team-status').textContent = doneText;
    } catch (err) {
        $('team-status').textContent = err.message && err.message !== 'failed' ? err.message : 'Could not save. Check your internet connection and try again.';
        renderTeams();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = label; renderTeams(); }
    }
}

$('assign-new').addEventListener('click', () => teamOp({ op: 'assign', mode: 'unassigned' }, $('assign-new'), 'Assigning…', 'Delegates without a team were added to the smallest teams.'));
$('assign-all').addEventListener('click', () => {
    if (!confirm('Reshuffle all teams? Every Youth Delegate gets a new team, including anyone you moved by hand.')) return;
    teamOp({ op: 'assign', mode: 'all' }, $('assign-all'), 'Reshuffling…', 'All teams were reshuffled into equal sizes.');
});
$('teams-visible').addEventListener('change', (e) => {
    const on = e.target.checked;
    teamOp({ op: 'teams_visible', visible: on }, null, '', on ? 'Teams are now shown to delegates.' : 'Teams are now hidden from delegates.');
});

async function setTeam(r, select) {
    const before = r.team;
    select.disabled = true;
    try {
        const out = await api({ op: 'set_team', reg_code: r.reg_code, team: select.value });
        if (!out.ok) throw new Error(out.error || 'failed');
        r.team = out.team;
        renderTeams();
        $('team-status').textContent = `${r.full_name} is now ${r.team ? 'in the ' + r.team + ' team' : 'without a team'}.`;
        select.className = 'team-select' + (r.team ? ' team-' + r.team.toLowerCase() : '');
    } catch (err) {
        select.value = before;
        $('team-status').textContent = `Could not change ${r.full_name}'s team. Check your internet connection.`;
    } finally {
        select.disabled = false;
    }
}

/** Column chart of registrations per day, from the first registration to the last. */
function renderDays(R) {
    const box = $('by-day');
    box.replaceChildren();
    const days = new Map();
    R.forEach((r) => {
        const d = new Date(r.registered_at);
        if (isNaN(d)) return;
        const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });   // YYYY-MM-DD in PH time
        days.set(key, (days.get(key) || 0) + 1);
    });
    if (!days.size) { box.append(el('p', 'panel-note', 'No registrants yet.')); return; }
    const keys = [...days.keys()].sort();
    const all = [];
    for (let d = new Date(keys[0] + 'T00:00:00'); d <= new Date(keys.at(-1) + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        const key = d.toLocaleDateString('en-CA');
        all.push({ key, n: days.get(key) || 0, label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) });
    }
    const max = Math.max(...all.map((x) => x.n));
    const plot = el('div', 'day-plot');
    all.forEach((x, i) => {
        const col = el('div', 'day-col');
        col.tabIndex = 0;
        col.dataset.tip = `${x.label}: ${x.n} registration${x.n === 1 ? '' : 's'}`;
        col.setAttribute('aria-label', col.dataset.tip);
        const bar = el('span', 'day-bar');
        bar.style.height = (x.n / max) * 100 + '%';
        col.append(bar);
        const every = Math.ceil(all.length / 8);
        if (i % every === 0 || i === all.length - 1) col.append(el('span', 'day-label', x.label));
        plot.append(col);
    });
    const peak = all.reduce((a, b) => (b.n > a.n ? b : a));
    box.append(el('p', 'panel-note', `Busiest day: ${peak.label} with ${peak.n}. ${all.length} day${all.length === 1 ? '' : 's'} shown.`), plot);
}

// ---------- registrant list ----------
function fillFilters(R) {
    const sel = $('f-role');
    const keep = sel.value;
    sel.length = 1;
    ROLES.forEach((r) => sel.add(new Option(r, r)));
    sel.value = keep;
    const cs = $('f-church');
    const keepC = cs.value;
    cs.length = 1;
    [...new Set(R.map((r) => r.local_church.trim()))].sort((a, b) => a.localeCompare(b)).forEach((c) => cs.add(new Option(c, c)));
    cs.value = keepC;
}

function shown() {
    if (!DATA) return [];
    const q = $('f-q').value.trim().toLowerCase();
    const role = $('f-role').value;
    const church = $('f-church').value;
    const pay = $('f-pay').value;
    const photo = $('f-photo').value;
    const team = $('f-team').value;
    return DATA.registrants
        .filter((r) => !q || [r.full_name, r.reg_code, r.local_church, r.email].join(' ').toLowerCase().includes(q))
        .filter((r) => !role || r.role === role)
        .filter((r) => !church || r.local_church.trim() === church)
        .filter((r) => !pay || (pay === 'none' ? !r.payment : r.payment === pay))
        .filter((r) => !photo || (photo === 'yes' ? r.has_photo : !r.has_photo))
        .filter((r) => !team || (team === 'none' ? r.role === TEAM_ROLE && !r.team : r.team === team))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function renderTable() {
    const list = shown();
    const body = $('rows');
    body.replaceChildren();
    $('list-count').textContent = `${list.length} of ${DATA.registrants.length} shown`;
    const unpaid = list.filter(canMarkCash).length;
    $('cash-all').disabled = !unpaid;
    $('cash-all').textContent = unpaid ? `Mark ${unpaid} shown as paid (cash)` : 'Mark shown as paid (cash)';
    if (!list.length) {
        const tr = el('tr');
        const td = el('td', 'empty', 'No registrants match these filters.');
        td.colSpan = 10;
        tr.append(td);
        body.append(tr);
    }
    list.forEach((r) => {
        const tr = el('tr');
        const cashPaid = r.payment === 'Verified' && /^CASH-/i.test(r.payment_ref || '');
        const pay = el('span', 'pill ' + (r.payment === 'Verified' ? 'good' : r.payment === 'Pending' ? 'warn' : r.payment === 'Rejected' ? 'bad' : r.payment === 'Over the counter' ? 'otc' : 'muted'), payLabel(r.payment) + (cashPaid ? ' · cash' : ''));
        const ph = el('span', 'pill ' + (r.has_photo ? 'good' : 'muted'), r.has_photo ? 'Yes' : 'No');
        const btn = el('button', 'linkbtn', 'Badge');
        btn.type = 'button';
        btn.disabled = !r.has_photo && !$('use-sample').checked;
        btn.title = btn.disabled ? 'No photo yet. Tick "Include people without a photo" to use the sample.' : 'Make this badge';
        btn.addEventListener('click', () => oneBadge(r, btn));
        [r.reg_code, r.full_name, r.local_church, r.role].forEach((v, i) => tr.append(el('td', i === 0 ? 'mono' : '', String(v))));
        const tdTeam = el('td');
        if (r.role === TEAM_ROLE) {
            const sel = el('select', 'team-select' + (r.team ? ' team-' + r.team.toLowerCase() : ''));
            sel.setAttribute('aria-label', `Team for ${r.full_name}`);
            sel.add(new Option('No team', ''));
            TEAMS.forEach((t) => sel.add(new Option(t, t)));
            sel.value = r.team || '';
            sel.addEventListener('change', () => setTeam(r, sel));
            tdTeam.append(sel);
        } else {
            tdTeam.append(el('span', 'muted-dash', '—'));
        }
        tr.append(tdTeam);
        [r.age || '', r.sex].forEach((v) => tr.append(el('td', '', String(v))));
        const tdPh = el('td');
        tdPh.append(ph);
        tr.append(tdPh);
        const tdPay = el('td', 'pay-cell');
        tdPay.append(pay);
        if (canMarkCash(r)) {
            const m = el('button', 'mini', 'Mark paid (cash)');
            m.type = 'button';
            m.addEventListener('click', () => markCash([r], m));
            tdPay.append(m);
        } else if (cashPaid) {
            const u = el('button', 'mini undo', 'Undo');
            u.type = 'button';
            u.title = 'Undo this cash payment';
            u.addEventListener('click', () => undoCash(r, u));
            tdPay.append(u);
        }
        tr.append(tdPay);
        const td = el('td');
        td.append(btn);
        tr.append(td);
        body.append(tr);
    });
}

// ---------- cash paid over the counter ----------
function canMarkCash(r) {
    return !r.payment || r.payment === 'Over the counter' || r.payment === 'Rejected';
}

async function cashOp(payload, btn, busy, done) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = busy;
    try {
        const out = await api(payload);
        if (!out.ok) throw new Error(out.error || 'failed');
        DATA = Object.assign(DATA, out);
        render();
        $('cash-status').textContent = done(out);
    } catch (err) {
        btn.disabled = false;
        btn.textContent = label;
        $('cash-status').textContent = err.message && err.message !== 'failed' ? err.message : 'Could not save. Check your internet connection and try again.';
    }
}

function markCash(list, btn) {
    const names = list.length === 1 ? list[0].full_name : `${list.length} registrants`;
    if (list.length > 1 && !confirm(`Record ${peso(DATA.fee * list.length)} cash paid for ${names}?`)) return;
    cashOp({ op: 'cash_paid', codes: list.map((r) => r.reg_code) }, btn, 'Saving…',
        (out) => `${out.marked} registrant${out.marked === 1 ? '' : 's'} marked as paid in cash (${peso(DATA.fee * out.marked)}).`);
}

function undoCash(r, btn) {
    if (!confirm(`Undo the cash payment for ${r.full_name}? They will show as Not paid again.`)) return;
    cashOp({ op: 'cash_undo', reg_code: r.reg_code }, btn, 'Undoing…', () => `${r.full_name}'s cash payment was undone.`);
}

$('cash-all').addEventListener('click', () => {
    const list = shown().filter(canMarkCash);
    if (!list.length) { $('cash-status').textContent = 'No unpaid registrants in this list.'; return; }
    markCash(list, $('cash-all'));
});

['f-q', 'f-role', 'f-church', 'f-pay', 'f-team', 'f-photo'].forEach((id) => $(id).addEventListener('input', renderTable));
$('use-sample').addEventListener('change', renderTable);

// ---------- badges ----------
function loadImg(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('decode'));
        im.src = src;
    });
}

async function photoFor(r) {
    if (photoCache.has(r.reg_code)) return photoCache.get(r.reg_code);
    let im = null;
    if (r.has_photo) {
        const out = await api({ op: 'photo', reg_code: r.reg_code });
        if (out.ok) im = await loadImg(`data:${out.type};base64,${out.data}`).catch(() => null);
    }
    if (!im && $('use-sample').checked && SAMPLE_PHOTOS[r.sex]) im = await loadImg(SAMPLE_PHOTOS[r.sex]);
    if (im && r.has_photo) photoCache.set(r.reg_code, im);
    return im;
}

let fontsReady = null;
function fonts() {
    if (!fontsReady) {
        fontsReady = document.fonts
            ? Promise.all(['800 40px Outfit', '600 20px Outfit', '500 20px Outfit'].map((f) => document.fonts.load(f))).catch(() => {})
            : Promise.resolve();
    }
    return fontsReady;
}

async function badgeBlob(r) {
    await fonts();
    const photo = await photoFor(r);
    if (!photo) return null;
    const canvas = drawBadge(r, photo);
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

const fileName = (r) => `${String(r.full_name).replace(/[\\/:*?"<>|]+/g, '').trim()} - ${r.reg_code} badge.png`;

let modalUrl = null;
async function oneBadge(r, btn) {
    btn.disabled = true;
    btn.textContent = 'Making…';
    try {
        const blob = await badgeBlob(r);
        if (!blob) throw new Error('nophoto');
        if (modalUrl) URL.revokeObjectURL(modalUrl);
        modalUrl = URL.createObjectURL(blob);
        $('modal-img').src = modalUrl;
        $('modal-img').alt = `Event badge for ${r.full_name}`;
        $('modal-dl').href = modalUrl;
        $('modal-dl').download = fileName(r);
        $('modal').hidden = false;
        $('modal-close').focus();
    } catch (err) {
        alertBulk(err.message === 'nophoto' ? `${r.full_name} has no photo to use.` : 'Could not make the badge. Check your internet connection.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Badge';
    }
}

$('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; });

function alertBulk(msg) { $('bulk-status').textContent = msg; }

/** Makes badges for the shown registrants, 3 at a time, reporting progress. */
async function makeMany(onEach) {
    const list = shown().filter((r) => r.has_photo || $('use-sample').checked);
    const skipped = shown().length - list.length;
    if (!list.length) {
        alertBulk(skipped ? `None of the ${skipped} registrants shown have a photo yet. Tick the box to use the sample photo.` : 'No registrants shown.');
        return null;
    }
    let done = 0;
    let failed = 0;
    const queue = list.slice();
    const worker = async () => {
        while (queue.length) {
            const r = queue.shift();
            try {
                const blob = await badgeBlob(r);
                if (blob) await onEach(r, blob); else failed += 1;
            } catch (e) {
                failed += 1;
            }
            done += 1;
            alertBulk(`Making badges… ${done} of ${list.length}`);
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { made: done - failed, failed, skipped };
}

function bulkBusy(on) {
    $('zip-btn').disabled = on;
    $('print-btn').disabled = on;
}

$('zip-btn').addEventListener('click', async () => {
    if (typeof JSZip === 'undefined') return alertBulk('The ZIP tool did not load. Check your internet connection and refresh.');
    bulkBusy(true);
    try {
        const zip = new JSZip();
        const used = new Set();
        const res = await makeMany(async (r, blob) => {
            let name = fileName(r);
            for (let i = 2; used.has(name); i++) name = fileName(r).replace(' badge.png', ` badge (${i}).png`);
            used.add(name);
            zip.file(name, blob);
        });
        if (!res) return;
        alertBulk('Packing the ZIP…');
        const out = await zip.generateAsync({ type: 'blob' });
        const a = el('a');
        a.href = URL.createObjectURL(out);
        a.download = `BGYF 2026 badges (${res.made}).zip`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        alertBulk(summary(res, 'in the ZIP'));
    } finally {
        bulkBusy(false);
    }
});

$('print-btn').addEventListener('click', async () => {
    bulkBusy(true);
    const sheet = $('print-sheet');
    sheet.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
    sheet.replaceChildren();
    try {
        const urls = [];
        const res = await makeMany(async (r, blob) => { urls.push({ name: r.full_name, url: URL.createObjectURL(blob) }); });
        if (!res) return;
        urls.sort((a, b) => a.name.localeCompare(b.name));
        let page = null;
        urls.forEach((u, i) => {
            if (i % 9 === 0) { page = el('div', 'print-page'); sheet.append(page); }
            const im = el('img');
            im.src = u.url;
            im.alt = '';
            page.append(im);
        });
        await Promise.all([...sheet.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
        alertBulk(summary(res, 'on the print sheet') + ' Print at 100% scale (no "fit to page") on A4 paper.');
        window.print();
    } finally {
        bulkBusy(false);
    }
});

function summary(res, where) {
    let msg = `${res.made} badge${res.made === 1 ? '' : 's'} ${where}.`;
    if (res.skipped) msg += ` ${res.skipped} skipped (no photo).`;
    if (res.failed) msg += ` ${res.failed} could not be made; try again.`;
    return msg;
}

// ---------- start ----------
password = loadPw();
if (password) load($('login-btn'));
